import { integrationInstructions, toolDefinitions } from "./tools";

/** Providers run this dependency-free shim. It rereads private discovery on every call. */
export function bridgeSource(): string {
  return String.raw`"use strict";
const fs = require("node:fs/promises");
const http = require("node:http");
const readline = require("node:readline");
const endpointFile = process.argv[2];
const owner = process.argv[3];
const tools = /*TOOLS*/;
const instructions = /*INSTRUCTIONS*/;
function reply(id, result, error) {
  process.stdout.write(JSON.stringify(error ? {jsonrpc:"2.0",id,error} : {jsonrpc:"2.0",id,result}) + "\n");
}
async function backend(name, args) {
  let endpoint;
  try { endpoint = JSON.parse(await fs.readFile(endpointFile, "utf8")); }
  catch { throw new Error("Canvas plugin is unavailable. Enable or reload the plugin, then retry."); }
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || typeof endpoint.token !== "string" || !/^owner_[a-f0-9]{32}$/.test(owner || "")) throw new Error("Canvas owner context is missing. Use canvas.agent.setup and reload the idle agent.");
  const body = JSON.stringify({name,arguments:args});
  return new Promise((resolve,reject) => {
    const request = http.request({hostname:"127.0.0.1",port:endpoint.port,path:"/tool",method:"POST",headers:{authorization:"Bearer " + endpoint.token,"x-canvas-owner":owner,"content-type":"application/json","content-length":Buffer.byteLength(body)},timeout:30000},response => {
      const chunks = []; let size = 0;
      response.on("data", chunk => { size += chunk.length; if (size > 1000000) response.destroy(new Error("Canvas response exceeded limit.")); else chunks.push(chunk); });
      response.on("error",reject);
      response.on("end",() => {
        try { const result = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (response.statusCode !== 200) reject(Object.assign(new Error(result.error?.message || "Canvas request failed."), {canvasError:result.error})); else resolve(result); }
        catch(error) { reject(error); }
      });
    });
    request.on("timeout",() => request.destroy(new Error("Canvas request timed out.")));
    request.on("error",reject); request.end(body);
  });
}
async function dispatch(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string" || (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number")) return reply(null,undefined,{code:-32600,message:"Invalid request"});
  if (message.id === undefined) return;
  const id = message.id;
  if (message.method === "initialize") {
    const versions = ["2024-11-05","2025-03-26","2025-06-18","2025-11-25"];
    return reply(id,{protocolVersion:versions.includes(message.params?.protocolVersion) ? message.params.protocolVersion : "2024-11-05",capabilities:{tools:{}},serverInfo:{name:"paseo-canvas",version:"0.1.0"},instructions});
  }
  if (message.method === "ping") return reply(id,{});
  if (message.method === "tools/list") return reply(id,{tools});
  if (message.method === "tools/call") {
    if (!message.params || typeof message.params.name !== "string") return reply(id,undefined,{code:-32602,message:"Tool name is required"});
    try { const data = await backend(message.params.name,message.params.arguments || {}); return reply(id,{content:[{type:"text",text:JSON.stringify(data)}]}); }
    catch(error) { return reply(id,{isError:true,content:[{type:"text",text:JSON.stringify(error.canvasError || {code:"UNAVAILABLE",message:error.message})}]}); }
  }
  reply(id,undefined,{code:-32601,message:"Method not found"});
}
const input = readline.createInterface({input:process.stdin,crlfDelay:Infinity});
input.on("line",line => {
  if (Buffer.byteLength(line) > 1024*1024) return reply(null,undefined,{code:-32600,message:"Request exceeds 1 MiB"});
  let message; try { message = JSON.parse(line); } catch { return reply(null,undefined,{code:-32700,message:"Parse error"}); }
  void dispatch(message).catch(() => reply(message?.id ?? null,undefined,{code:-32603,message:"Internal error"}));
});
`.replace("/*TOOLS*/", () => JSON.stringify(toolDefinitions)).replace("/*INSTRUCTIONS*/", () => JSON.stringify(integrationInstructions));
}
