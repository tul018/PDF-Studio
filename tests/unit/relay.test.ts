import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { WebSocket } from "ws";

it("relay rejects view-only writes and invalid invitations",async()=>{
 const child=spawn(process.execPath,[join(process.cwd(),"collaboration/server.mjs")],{env:{...process.env,PORT:"32151"},windowsHide:true});
 const sockets:WebSocket[]=[];
 const connect=()=>new Promise<WebSocket>((resolve,reject)=>{const socket=new WebSocket("ws://127.0.0.1:32151");sockets.push(socket);socket.once("open",()=>resolve(socket));socket.once("error",reject);});
 const request=(socket:WebSocket,message:object)=>new Promise<Record<string,string>>((resolve,reject)=>{socket.once("message",raw=>{try{resolve(JSON.parse(String(raw)));}catch(e){reject(e);}});socket.send(JSON.stringify(message));});
 try{
  await new Promise<void>((resolve,reject)=>{child.stdout.once("data",()=>resolve());child.once("error",reject);});
  const host=await connect(),room=await request(host,{type:"create"});expect(room.type).toBe("created");
  const bad=await connect();expect((await request(bad,{type:"join",room:room.room,token:"wrong"})).type).toBe("error");
  const viewer=await connect();expect((await request(viewer,{type:"join",room:room.room,token:room.viewer})).role).toBe("viewer");
  expect((await request(viewer,{type:"update",data:"YWJj"})).message).toBe("Action is not allowed.");
 }finally{for(const socket of sockets)socket.terminate();child.kill();}
},10000);
