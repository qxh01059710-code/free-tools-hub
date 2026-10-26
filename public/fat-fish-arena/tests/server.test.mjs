import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,handleMcp} from '../functions/_lib/server.mjs';
const env={};
const request=(method,path,data,headers={})=>new Request('https://arena.example'+path,{method,headers,body:data?JSON.stringify(data):undefined});
test('The backend advertises setup state without inventing live results',async()=>{
 const r=await handleApi({env,request:request('GET','/api/health')});
 assert.equal((await r.json()).ready,false);
 const rank=await handleApi({env,request:request('GET','/api/leaderboard')});
 assert.equal(rank.status,503);
});
test('MCP initialize, tools and safety checks',async()=>{
 const post=(data,headers={})=>request('POST','/mcp',data,headers);
 const init=await handleMcp({env,request:post({jsonrpc:'2.0',id:1,method:'initialize'})});
 assert.equal((await init.json()).result.serverInfo.name,'fat-fish-arena');
 const tools=await handleMcp({env,request:post({jsonrpc:'2.0',id:2,method:'tools/list'})});
 assert.deepEqual((await tools.json()).result.tools.map(x=>x.name),['join_game','look_around','move','get_status','get_leaderboard']);
 const origin=await handleMcp({env,request:post({jsonrpc:'2.0',id:3,method:'tools/list'},{origin:'https://bad.example'})});
 assert.equal(origin.status,403);
 const get=await handleMcp({env,request:request('GET','/mcp')});assert.equal(get.status,405);
});
