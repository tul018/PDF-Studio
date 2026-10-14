//! Built-in relay for "Work together live": when you host a session, your own
//! PDF Studio is the meeting point. Others connect to it over the network
//! (same Wi-Fi/office, or anywhere through a private network such as
//! Tailscale) - no server, no account, no cost.
//!
//! The relay only passes along end-to-end encrypted updates (AES-GCM, key in
//! the invitation, never sent here). Rules: only this PC can create a session;
//! others join with an editor or view-only token; at most 10 people; 64 MB
//! of updates per session; sessions end when the host leaves or after 4 hours.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

pub const DEFAULT_PORT: u16 = 32150;
const MAX_PEERS: usize = 10;
const MAX_ROOM_BYTES: usize = 64 * 1024 * 1024;
const ROOM_LIFETIME: Duration = Duration::from_secs(4 * 3600);
const JOIN_TIMEOUT: Duration = Duration::from_secs(10);

type Tx = mpsc::UnboundedSender<Message>;

struct Room {
    host: u64,
    editor: String,
    viewer: String,
    peers: HashMap<u64, (&'static str, Tx)>,
    history: Vec<String>,
    bytes: usize,
    expires: Instant,
}

#[derive(Default)]
struct Rooms {
    rooms: HashMap<String, Room>,
    next_id: u64,
}

/// A running relay (managed by Tauri state).
pub struct Running {
    pub port: u16,
    stop: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct RelayState(pub Mutex<Option<Running>>);

#[derive(Serialize)]
pub struct RelayInfo {
    pub port: u16,
    /// Addresses others can try ("ip:port"), best first.
    pub addresses: Vec<String>,
}

fn token() -> String {
    let mut b = [0u8; 24];
    getrandom::getrandom(&mut b).expect("random numbers");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// This PC's addresses on its networks (private LAN and Tailscale's 100.x first).
pub fn local_addresses(port: u16) -> Vec<String> {
    let mut ips: Vec<IpAddr> = local_ip_address::list_afinet_netifas()
        .map(|l| l.into_iter().map(|(_, ip)| ip).collect())
        .unwrap_or_default();
    ips.retain(|ip| match ip {
        IpAddr::V4(v4) => !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified(),
        IpAddr::V6(_) => false, // IPv4 is enough for homes/offices and Tailscale
    });
    ips.sort_by_key(|ip| match ip {
        IpAddr::V4(v4) if v4.is_private() => 0,
        IpAddr::V4(v4) if v4.octets()[0] == 100 => 1, // Tailscale / CGNAT range
        _ => 2,
    });
    ips.dedup();
    ips.into_iter().map(|ip| format!("{ip}:{port}")).collect()
}

/// Start the relay (or return the running one).
pub async fn start(state: &RelayState) -> Result<RelayInfo, String> {
    if let Some(r) = state.0.lock().unwrap().as_ref() {
        return Ok(RelayInfo { port: r.port, addresses: local_addresses(r.port) });
    }
    let listener = match TcpListener::bind(("0.0.0.0", DEFAULT_PORT)).await {
        Ok(l) => l,
        Err(_) => TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| e.to_string())?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (stop, mut stopped) = oneshot::channel::<()>();
    let rooms = Arc::new(Mutex::new(Rooms::default()));
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut stopped => break,
                accepted = listener.accept() => {
                    if let Ok((stream, addr)) = accepted {
                        let rooms = rooms.clone();
                        tauri::async_runtime::spawn(async move { let _ = serve(stream, addr, rooms).await; });
                    }
                }
            }
        }
    });
    *state.0.lock().unwrap() = Some(Running { port, stop: Some(stop) });
    Ok(RelayInfo { port, addresses: local_addresses(port) })
}

pub fn stop(state: &RelayState) {
    if let Some(mut r) = state.0.lock().unwrap().take() {
        if let Some(s) = r.stop.take() {
            let _ = s.send(());
        }
    }
}

fn send(tx: &Tx, v: Value) {
    let _ = tx.send(Message::text(v.to_string()));
}

async fn serve(stream: TcpStream, addr: SocketAddr, rooms: Arc<Mutex<Rooms>>) -> Result<(), String> {
    let mut config = WebSocketConfig::default();
    config.max_message_size = Some(20 * 1024 * 1024);
    config.max_frame_size = Some(20 * 1024 * 1024);
    let ws = tokio_tungstenite::accept_async_with_config(stream, Some(config)).await.map_err(|e| e.to_string())?;
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(m) = rx.recv().await {
            let close = matches!(m, Message::Close(_));
            if sink.send(m).await.is_err() || close {
                break;
            }
        }
    });
    let id = {
        let mut r = rooms.lock().unwrap();
        r.next_id += 1;
        r.next_id
    };
    let mut room: Option<String> = None;
    let mut role: &'static str = "";
    let started = Instant::now();

    loop {
        let wait = if room.is_none() { JOIN_TIMEOUT.saturating_sub(started.elapsed()) } else { Duration::from_secs(3600) };
        let next = tokio::time::timeout(wait, source.next()).await;
        let msg = match next {
            Err(_) if room.is_none() => break, // never joined: drop
            Err(_) => continue,
            Ok(None) | Ok(Some(Err(_))) => break,
            Ok(Some(Ok(m))) => m,
        };
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        let reply = handle(&text, id, addr, &tx, &rooms, &mut room, &mut role);
        if let Err(e) = reply {
            send(&tx, json!({ "type": "error", "message": e }));
        }
    }

    // Leaving: the host's leaving ends the session for everyone.
    if let Some(rid) = room {
        let mut r = rooms.lock().unwrap();
        let ended = r.rooms.get(&rid).map(|room| room.host == id).unwrap_or(false);
        if ended {
            if let Some(room) = r.rooms.remove(&rid) {
                for (pid, (_, peer)) in room.peers {
                    if pid != id {
                        send(&peer, json!({ "type": "closed" }));
                        let _ = peer.send(Message::Close(None));
                    }
                }
            }
        } else if let Some(room) = r.rooms.get_mut(&rid) {
            room.peers.remove(&id);
        }
    }
    drop(tx);
    let _ = writer.await;
    Ok(())
}

fn handle(
    text: &str,
    id: u64,
    addr: SocketAddr,
    tx: &Tx,
    rooms: &Arc<Mutex<Rooms>>,
    room: &mut Option<String>,
    role: &mut &'static str,
) -> Result<(), String> {
    let m: Value = serde_json::from_str(text).map_err(|_| "Invalid message.".to_string())?;
    let kind = m.get("type").and_then(Value::as_str).unwrap_or("");
    let mut r = rooms.lock().unwrap();
    r.rooms.retain(|_, room| room.expires > Instant::now());
    match kind {
        "create" if room.is_none() => {
            // Only the PDF Studio on this PC may start a session here.
            if !addr.ip().is_loopback() {
                return Err("Only the host can start a session.".into());
            }
            if r.rooms.len() >= 20 {
                return Err("Session limit reached.".into());
            }
            let rid = token();
            let (editor, viewer) = (token(), token());
            let mut peers = HashMap::new();
            peers.insert(id, ("host", tx.clone()));
            r.rooms.insert(
                rid.clone(),
                Room { host: id, editor: editor.clone(), viewer: viewer.clone(), peers, history: vec![], bytes: 0, expires: Instant::now() + ROOM_LIFETIME },
            );
            *room = Some(rid.clone());
            *role = "host";
            send(tx, json!({ "type": "created", "room": rid, "editor": editor, "viewer": viewer }));
            Ok(())
        }
        "join" if room.is_none() => {
            let rid = m.get("room").and_then(Value::as_str).unwrap_or("");
            let tok = m.get("token").and_then(Value::as_str).unwrap_or("");
            let found = r.rooms.get_mut(rid).ok_or("Session not found or expired.")?;
            let who: &'static str = if tok == found.editor { "editor" } else if tok == found.viewer { "viewer" } else { return Err("Invalid invitation.".into()) };
            if found.peers.len() >= MAX_PEERS {
                return Err("Session is full.".into());
            }
            found.peers.insert(id, (who, tx.clone()));
            send(tx, json!({ "type": "joined", "role": who }));
            for data in &found.history {
                send(tx, json!({ "type": "update", "data": data }));
            }
            *room = Some(rid.to_string());
            *role = who;
            Ok(())
        }
        "update" if room.is_some() && *role != "viewer" => {
            let data = m.get("data").and_then(Value::as_str).ok_or("Invalid encrypted update.")?;
            if !data.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/' || c == b'=') {
                return Err("Invalid encrypted update.".into());
            }
            let found = r.rooms.get_mut(room.as_ref().unwrap()).ok_or("Session ended.")?;
            if found.bytes + data.len() > MAX_ROOM_BYTES {
                return Err("Session data limit reached. Save and start a new session.".into());
            }
            found.bytes += data.len();
            found.history.push(data.to_string());
            for (pid, (_, peer)) in &found.peers {
                if *pid != id {
                    send(peer, json!({ "type": "update", "data": data }));
                }
            }
            Ok(())
        }
        _ => Err("Action is not allowed.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    async fn recv(ws: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin)) -> Value {
        loop {
            if let Some(Ok(Message::Text(t))) = ws.next().await {
                return serde_json::from_str(&t).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn host_creates_guest_joins_updates_flow() {
        let state = RelayState::default();
        let info = start(&state).await.unwrap();
        let url = format!("ws://127.0.0.1:{}", info.port);
        let (mut host, _) = connect_async(&url).await.unwrap();
        host.send(Message::text(r#"{"type":"create"}"#)).await.unwrap();
        let created = recv(&mut host).await;
        assert_eq!(created["type"], "created");
        let room = created["room"].as_str().unwrap().to_string();
        host.send(Message::text(r#"{"type":"update","data":"QUJD"}"#)).await.unwrap();

        let (mut guest, _) = connect_async(&url).await.unwrap();
        guest.send(Message::text(json!({"type":"join","room":room,"token":created["viewer"]}).to_string())).await.unwrap();
        assert_eq!(recv(&mut guest).await["role"], "viewer");
        assert_eq!(recv(&mut guest).await["data"], "QUJD"); // earlier updates replayed
        // A viewer can't send changes.
        guest.send(Message::text(r#"{"type":"update","data":"WFla"}"#)).await.unwrap();
        assert_eq!(recv(&mut guest).await["type"], "error");
        // A wrong token is refused.
        let (mut bad, _) = connect_async(&url).await.unwrap();
        bad.send(Message::text(json!({"type":"join","room":room,"token":"nope"}).to_string())).await.unwrap();
        assert_eq!(recv(&mut bad).await["message"], "Invalid invitation.");
        // The host leaving ends the session for everyone.
        host.close(None).await.unwrap();
        assert_eq!(recv(&mut guest).await["type"], "closed");
        stop(&state);
    }
}
