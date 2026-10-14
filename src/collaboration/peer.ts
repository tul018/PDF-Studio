import { packDescription, SHORT_PREFIX, unpackDescription } from "./shortCode";

/**
 * "Work together live" over the internet with nothing to install or run:
 * the apps connect to each other directly (WebRTC data channels, encrypted
 * by the browser engine on top of our own end-to-end encryption).
 *
 * With no server, the two apps swap their network addresses through you,
 * once per person: the host sends an invitation code, the guest sends back
 * a reply code (each about 100 characters, see shortCode.ts). Public STUN
 * servers only tell each app its own internet address; no document data
 * goes through them.
 *
 * The host's app is the meeting point: it keeps the session history and
 * passes updates between guests, exactly like the relay server does.
 */

/** Address lookup only (STUN). Several, in case one is down. */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
];

/** Invitation and reply codes start with this, so Join can tell them from same-network codes. */
export const PEER_PREFIX = SHORT_PREFIX;

/** What the session code talks to: a WebSocket, or one of these. */
export interface LiveSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onmessage: ((e: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}

const OPEN = 1,
  CLOSED = 3;

/**
 * A data channel as a LiveSocket. Big messages (the PDF itself) are sent in
 * pieces, and sending waits when the channel's buffer is full, since browsers
 * close a channel whose buffer overflows.
 */
class ChannelSocket implements LiveSocket {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private queue = Promise.resolve();
  private parts = new Map<string, string[]>();
  private static CHUNK = 16 * 1024;

  constructor(
    private dc: RTCDataChannel,
    private pc: RTCPeerConnection,
  ) {
    dc.bufferedAmountLowThreshold = 1024 * 1024;
    dc.onmessage = (e) => this.receive(String(e.data));
    dc.onclose = () => this.onclose?.();
    dc.onerror = () => this.onerror?.();
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.onclose?.();
        this.onclose = null;
      }
    };
  }

  get readyState(): number {
    return this.dc.readyState === "open" ? OPEN : CLOSED;
  }

  send(data: string): void {
    this.queue = this.queue.then(async () => {
      if (data.length <= ChannelSocket.CHUNK) return this.write("m" + data);
      const id = Math.random().toString(36).slice(2, 10);
      const n = Math.ceil(data.length / ChannelSocket.CHUNK);
      for (let k = 0; k < n; k++) await this.write(`c${id}:${k}:${n}:` + data.slice(k * ChannelSocket.CHUNK, (k + 1) * ChannelSocket.CHUNK));
    });
  }

  private async write(s: string): Promise<void> {
    if (this.dc.readyState !== "open") return;
    if (this.dc.bufferedAmount > 4 * 1024 * 1024) {
      await new Promise<void>((r) => this.dc.addEventListener("bufferedamountlow", () => r(), { once: true }));
    }
    if (this.dc.readyState === "open") this.dc.send(s);
  }

  private receive(s: string): void {
    if (s[0] === "m") return this.onmessage?.({ data: s.slice(1) });
    const m = /^c([a-z0-9]+):(\d+):(\d+):/.exec(s);
    if (!m) return;
    const [head, id, k, n] = m;
    let list = this.parts.get(id);
    if (!list) this.parts.set(id, (list = []));
    list[Number(k)] = s.slice(head.length);
    if (list.filter((x) => x !== undefined).length === Number(n)) {
      this.parts.delete(id);
      this.onmessage?.({ data: list.join("") });
    }
  }

  close(): void {
    try {
      this.dc.close();
    } catch {
      /* already closed */
    }
    this.pc.close();
  }
}

/** Wait until the app knows all its addresses (so they fit in one code), at most a few seconds. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, 6000);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function opened(dc: RTCDataChannel, pc: RTCPeerConnection, ms: number, what: string): Promise<void> {
  if (dc.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    // The state at the end helps tell "never reached each other" from "blocked after".
    const fail = (m: string) => new Error(`${m} (connection: ${pc.connectionState}, network: ${pc.iceConnectionState})`);
    const timer = setTimeout(() => reject(fail(what)), ms);
    dc.addEventListener("open", () => (clearTimeout(timer), resolve()), { once: true });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") {
        clearTimeout(timer);
        reject(fail(NO_ROUTE));
      }
    });
  });
}

const NO_ROUTE =
  "Couldn't connect directly. Some networks (often mobile data or strict office firewalls) block direct connections: try another network, e.g. home Wi-Fi, or both use Tailscale with the same-network option.";

export type PeerRole = "editor" | "viewer";

/** First message from the host on a new connection: what the code doesn't carry. */
interface Hello {
  type: "hello";
  /** Session encryption key (base64). */
  key: string;
  role: PeerRole;
  name: string;
}

// ------------------------------------------------------------------ host

/**
 * The host's meeting point, in the app: keeps the session's (encrypted)
 * history so late joiners catch up, passes each update to everyone else,
 * and ignores edits from view-only guests. Same rules as the relay server.
 */
export class PeerHub {
  private peers = new Map<LiveSocket, "host" | PeerRole>();
  private history: string[] = [];
  private bytes = 0;
  private hostSide: LiveSocket | null = null;
  private pending = new Set<RTCPeerConnection>();
  onPeersChange: (count: number) => void = () => {};

  constructor(
    private key: string,
    private name: string,
  ) {}

  get guests(): number {
    return this.peers.size - (this.hostSide ? 1 : 0);
  }

  /** The host's own connection to the hub (in memory). */
  hostSocket(): LiveSocket {
    const hub = this;
    const sock: LiveSocket = {
      readyState: OPEN,
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data: string) {
        const m = JSON.parse(data);
        if (m.type === "create") return queueMicrotask(() => sock.onmessage?.({ data: JSON.stringify({ type: "created", room: "p2p", editor: "", viewer: "" }) }));
        hub.update(sock, m);
      },
      close() {
        hub.end();
      },
    };
    this.hostSide = sock;
    this.peers.set(sock, "host");
    return sock;
  }

  /**
   * Start inviting one person: returns their invitation code, and `accept`
   * for the reply code they send back.
   */
  async invite(role: PeerRole): Promise<{ code: string; accept: (reply: string) => Promise<void>; cancel: () => void }> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pending.add(pc);
    const dc = pc.createDataChannel("live", { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const code = packDescription(pc.localDescription!);
    let usedReply: string | null = null;
    const accept = async (reply: string) => {
      const d = unpackDescription(reply);
      if (d.type !== "answer") throw new Error("That's an invitation code. Paste the reply code the other person sent back.");
      if (pc.signalingState === "closed" || pc.connectionState === "failed")
        throw new Error("This invitation can't connect any more. Click “Invite an editor” (or “Invite view-only”) for a new invitation, and ask for a new reply code.");
      // One reply per invitation. Pressing Connect again with the same reply just keeps trying.
      if (usedReply === null) {
        await pc.setRemoteDescription(d);
        usedReply = d.sdp;
      } else if (usedReply !== d.sdp) {
        throw new Error("This invitation was already used with a different reply code. Click “Invite an editor” for a new invitation, and ask for a new reply code.");
      }
      await opened(dc, pc, 45_000, NO_ROUTE);
      this.pending.delete(pc);
      this.attach(new ChannelSocket(dc, pc), role);
    };
    const cancel = () => {
      this.pending.delete(pc);
      if (dc.readyState !== "open") pc.close();
    };
    return { code, accept, cancel };
  }

  private attach(sock: LiveSocket, role: PeerRole): void {
    this.peers.set(sock, role);
    sock.send(JSON.stringify({ type: "hello", key: this.key, role, name: this.name } satisfies Hello));
    sock.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "join") {
          sock.send(JSON.stringify({ type: "joined", role }));
          for (const data of this.history) sock.send(JSON.stringify({ type: "update", data }));
          return;
        }
        this.update(sock, m);
      } catch (err) {
        sock.send(JSON.stringify({ type: "error", message: (err as Error).message }));
      }
    };
    sock.onclose = () => {
      if (this.peers.delete(sock)) this.onPeersChange(this.guests);
    };
    this.onPeersChange(this.guests);
  }

  private update(from: LiveSocket, m: { type?: string; data?: unknown }): void {
    if (m.type !== "update" || this.peers.get(from) === "viewer") return;
    if (typeof m.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(m.data)) return;
    if (this.bytes + m.data.length > 64 * 1024 * 1024) {
      return void this.hostSide?.onmessage?.({ data: JSON.stringify({ type: "error", message: "Session data limit reached. Save and start a new session." }) });
    }
    this.bytes += m.data.length;
    this.history.push(m.data);
    const out = JSON.stringify({ type: "update", data: m.data });
    for (const peer of this.peers.keys()) {
      if (peer === from) continue;
      if (peer === this.hostSide) queueMicrotask(() => peer.onmessage?.({ data: out }));
      else peer.send(out);
    }
  }

  /** Host leaves: everyone is told, all connections close. */
  end(): void {
    for (const [peer, role] of this.peers) {
      if (role === "host") continue;
      peer.onclose = null;
      peer.send(JSON.stringify({ type: "closed" }));
      setTimeout(() => peer.close(), 500);
    }
    for (const pc of this.pending) pc.close();
    this.pending.clear();
    this.peers.clear();
    this.history = [];
    this.hostSide = null;
  }
}

// ------------------------------------------------------------------ guest

/**
 * Join with an invitation code: returns the reply code to send back, and
 * `connected`, which resolves once the host has pasted it (with the session
 * key, role and document name the host sends first).
 */
export async function answerInvite(
  code: string,
): Promise<{ reply: string; connected: Promise<{ socket: LiveSocket; key: string; role: PeerRole; name: string }>; cancel: () => void }> {
  const d = unpackDescription(code);
  if (d.type !== "offer") throw new Error("That's a reply code. To join, paste the invitation code the host sent you.");
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channel = new Promise<RTCDataChannel>((resolve) => (pc.ondatachannel = (e) => resolve(e.channel)));
  await pc.setRemoteDescription(d);
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const reply = packDescription(pc.localDescription!);
  const connected = (async () => {
    const dc = await Promise.race([
      channel,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("The host didn't connect within 15 minutes. Ask for a new invitation.")), 15 * 60_000),
      ),
    ]);
    const socket = new ChannelSocket(dc, pc);
    const hello = new Promise<Hello>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The host's app didn't answer. Ask for a new invitation.")), 60_000);
      socket.onmessage = (e) => {
        const m = JSON.parse(e.data) as Hello;
        if (m.type === "hello" && m.key) {
          clearTimeout(timer);
          socket.onmessage = null;
          resolve(m);
        }
      };
    });
    await opened(dc, pc, 60_000, NO_ROUTE);
    const h = await hello;
    return { socket: socket as LiveSocket, key: h.key, role: h.role === "viewer" ? ("viewer" as const) : ("editor" as const), name: h.name ?? "" };
  })();
  return { reply, connected, cancel: () => pc.close() };
}
