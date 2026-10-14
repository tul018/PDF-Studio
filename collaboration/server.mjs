import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
const rooms=new Map();const token=()=>randomBytes(24).toString('base64url');
const wss=new WebSocketServer({host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||32150),maxPayload:20*1024*1024});
const send=(ws,data)=>{if(ws.readyState===1)ws.send(JSON.stringify(data));};
wss.on('connection',ws=>{
  let room,role;const deadline=setTimeout(()=>ws.close(1008,'Join timeout'),10000);
  ws.on('message',raw=>{try{
    const m=JSON.parse(String(raw));
    if(m.type==='create'&&!room){if(rooms.size>=20)throw new Error('Session limit reached.');clearTimeout(deadline);const id=token();room={id,host:ws,editor:token(),viewer:token(),peers:new Map([[ws,'host']]),history:[],bytes:0,expires:Date.now()+4*3600000};role='host';rooms.set(id,room);send(ws,{type:'created',room:id,editor:room.editor,viewer:room.viewer});return;}
    if(m.type==='join'&&!room){const found=rooms.get(m.room);if(!found||found.expires<Date.now())throw new Error('Session not found or expired.');role=m.token===found.editor?'editor':m.token===found.viewer?'viewer':null;if(!role)throw new Error('Invalid invitation.');if(found.peers.size>=10)throw new Error('Session is full.');clearTimeout(deadline);room=found;room.peers.set(ws,role);send(ws,{type:'joined',role});for(const data of room.history)send(ws,{type:'update',data});return;}
    if(m.type==='update'&&room&&role!=='viewer'){
      if(typeof m.data!=='string'||!/^[A-Za-z0-9+/=]+$/.test(m.data))throw new Error('Invalid encrypted update.');
      if(room.bytes+m.data.length>64*1024*1024)throw new Error('Session data limit reached. Save and start a new session.');
      room.bytes+=m.data.length;room.history.push(m.data);for(const peer of room.peers.keys())if(peer!==ws)send(peer,{type:'update',data:m.data});return;
    }
    throw new Error('Action is not allowed.');
  }catch(e){send(ws,{type:'error',message:e.message});}});
  ws.on('close',()=>{clearTimeout(deadline);if(!room)return;room.peers.delete(ws);if(room.host===ws){rooms.delete(room.id);for(const peer of room.peers.keys()){send(peer,{type:'closed'});peer.close();}room.history=[];}});
});
const expiry=setInterval(()=>{for(const room of rooms.values())if(room.expires<Date.now())room.host.close(1000,'Session expired');},60000);expiry.unref();
wss.once('listening',()=>console.log(`PDF Studio encrypted collaboration relay: ws://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||32150}`));
process.on('SIGINT',()=>{for(const ws of wss.clients)ws.close();wss.close();});
