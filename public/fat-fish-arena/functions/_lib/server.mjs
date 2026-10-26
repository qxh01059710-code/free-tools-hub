import {createState,act,getPublicState,score} from '../../public/shared/engine.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(code,message,status=400)=>json({ok:false,code,message},status);
const season=env=>env.SEASON_ID||'S01';
const ready=env=>Boolean(env.FISH_DB&&env.MAZE_SEED&&String(env.MAZE_SEED).length>=16);
const now=()=>Date.now();
async function digest(text){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function payload(request){const text=await request.text();if(text.length>8192)throw Error('Too large');return JSON.parse(text||'{}');}
function validName(value,max){if(typeof value!=='string')return'';const s=value.normalize('NFKC').trim();return[...s].length>=2&&[...s].length<=max&&!/[<>\x00-\x1f\x7f]/.test(s)?s:'';}
async function player(request,db){const h=request.headers.get('authorization')||'',m=/^Bearer (fy_[a-zA-Z0-9_-]{20,120})$/.exec(h);if(!m)return null;return db.prepare('SELECT id,fish_name,owner_name,show_owner,video_consent FROM players WHERE token_hash=?').bind(await digest(m[1])).first();}
async function findRun(env,p){return env.FISH_DB.prepare('SELECT * FROM runs WHERE player_id=? AND season=?').bind(p.id,season(env)).first();}
const clientState=(state,r,p)=>getPublicState(state,{runId:r.id,season:r.season,fishName:p.fish_name,ownerName:p.show_owner?p.owner_name:null,startedAt:r.started_at});
async function register(request,env){
 const v=await payload(request),name=validName(v.fishName,18),owner=v.ownerName?validName(v.ownerName,24):'';
 if(!name)return fail('BAD_NAME','Please provide a safe fish name (2-18 chars).');
 if(v.ownerName&&!owner)return fail('BAD_OWNER','Invalid owner name.');
 if(v.rulesAccepted!==true)return fail('RULES_REQUIRED','Read and accept the rules.');
 const ip=request.headers.get('CF-Connecting-IP')||request.headers.get('x-real-ip')||'local';
 const ipHash=await digest(ip+':'+(env.IP_SALT||'local-fish-ip-hash'));
 const count=await env.FISH_DB.prepare('SELECT COUNT(*) AS c FROM players WHERE ip_hash=? AND created_at>?').bind(ipHash,now()-86400000).first();
 if(Number(count?.c||0)>=5)return fail('RATE_LIMIT','Daily signup limit reached for this network.',429);
 const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
 const token='fy_'+[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
 await env.FISH_DB.prepare('INSERT INTO players (id,fish_name,owner_name,show_owner,video_consent,token_hash,ip_hash,created_at) VALUES (?,?,?,?,?,?,?,?)')
 .bind(crypto.randomUUID(),name,owner||null,v.showOwner===true?1:0,v.videoConsent===true?1:0,await digest(token),ipHash,now()).run();
 return json({ok:true,token,fishName:name,season:season(env),note:'Save this secret token. It is shown once only.'},201);
}
async function join(env,p){
 let r=await findRun(env,p);
 if(!r){
  const st=createState(env.MAZE_SEED+':'+season(env)+':'+p.id,{targetDistance:72}),t=now();
  await env.FISH_DB.prepare('INSERT OR IGNORE INTO runs (id,player_id,season,status,state_json,events_json,version,started_at,updated_at,steps,looks,bumps,score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(crypto.randomUUID(),p.id,season(env),'active',JSON.stringify(st),JSON.stringify(st.events),0,t,t,0,0,0,null).run();
  r=await findRun(env,p);
 }
 return{ok:true,run:clientState(JSON.parse(r.state_json),r,p)};
}
async function myStatus(env,p){const r=await findRun(env,p);return{ok:true,player:{fishName:p.fish_name,ownerName:p.show_owner?p.owner_name:null},run:r?clientState(JSON.parse(r.state_json),r,p):null};}
async function action(env,p,kind,value){
 const r=await findRun(env,p);if(!r)return{ok:false,code:'NOT_JOINED',message:'Start with join_game.'};
 const st=JSON.parse(r.state_json),result=act(st,kind,value);
 if(!result.ok)return{...result,run:clientState(st,r,p)};
 const ended=st.status!=='active',t=now();
 const updated=await env.FISH_DB.prepare('UPDATE runs SET state_json=?,events_json=?,status=?,version=version+1,steps=?,looks=?,bumps=?,score=?,finished_at=?,updated_at=? WHERE id=? AND version=?')
 .bind(JSON.stringify(st),JSON.stringify(st.events),st.status,st.turns,st.looks,st.bumps,ended?score(st):null,ended?t:null,t,r.id,r.version).run();
 if(!updated.meta?.changes)return{ok:false,code:'CONFLICT',message:'Concurrent action. Read get_status and retry.'};
 return{...result,run:clientState(st,r,p)};
}
async function leaderboard(env,limit=25){
 const data=await env.FISH_DB.prepare("SELECT r.id,r.steps,r.looks,r.bumps,r.score,r.finished_at,p.fish_name,p.owner_name,p.show_owner FROM runs r JOIN players p ON p.id=r.player_id WHERE r.season=? AND r.status='won' ORDER BY r.score ASC,r.finished_at ASC LIMIT ?").bind(season(env),limit).all();
 return{ok:true,season:season(env),entries:(data.results||[]).map((r,i)=>({rank:i+1,runId:r.id,fishName:r.fish_name,ownerName:r.show_owner?r.owner_name:null,steps:r.steps,looks:r.looks,bumps:r.bumps,score:r.score,finishedAt:r.finished_at}))};
}
async function replays(env){
 const data=await env.FISH_DB.prepare("SELECT r.id,r.score,r.steps,r.looks,r.status,r.finished_at,p.fish_name,p.owner_name,p.show_owner FROM runs r JOIN players p ON p.id=r.player_id WHERE r.season=? AND r.status IN ('won','lost') ORDER BY r.finished_at DESC LIMIT 12").bind(season(env)).all();
 return{ok:true,replays:(data.results||[]).map(r=>({runId:r.id,fishName:r.fish_name,ownerName:r.show_owner?r.owner_name:null,score:r.score,steps:r.steps,looks:r.looks,status:r.status,finishedAt:r.finished_at}))};
}
async function replay(env,id){
 if(!/^[a-f0-9-]{36}$/i.test(id||''))return null;
 const r=await env.FISH_DB.prepare("SELECT r.id,r.season,r.status,r.state_json,r.events_json,r.steps,r.looks,r.bumps,r.score,r.finished_at,p.fish_name,p.owner_name,p.show_owner,p.video_consent FROM runs r JOIN players p ON p.id=r.player_id WHERE r.id=? AND r.status IN ('won','lost')").bind(id).first();
 if(!r)return null;
 return{runId:r.id,season:r.season,status:r.status,fishName:r.fish_name,ownerName:r.show_owner?r.owner_name:null,videoConsent:Boolean(r.video_consent),score:r.score,steps:r.steps,looks:r.looks,bumps:r.bumps,finishedAt:r.finished_at,map:JSON.parse(r.state_json).map,events:JSON.parse(r.events_json)};
}
export async function handleApi({request,env}){
 const u=new URL(request.url),route=u.pathname.replace(/^\/api\/?/,'').replace(/\/$/,'');
 if(route==='health'&&request.method==='GET')return json({ok:true,ready:ready(env),season:season(env)});
 if(!ready(env))return fail('BACKEND_NOT_CONFIGURED','D1 and a private MAZE_SEED must be configured.',503);
 try{
  if(request.method==='GET'&&route==='leaderboard')return json(await leaderboard(env));
  if(request.method==='GET'&&route==='replays')return json(await replays(env));
  if(request.method==='GET'&&route==='replay'){const r=await replay(env,u.searchParams.get('id'));return r?json({ok:true,replay:r}):fail('NOT_FOUND','Replay not available.',404);}
  if(request.method==='POST'&&route==='register')return register(request,env);
  const p=await player(request,env.FISH_DB);if(!p)return fail('UNAUTHORIZED','Private Bearer token required.',401);
  if(request.method==='GET'&&route==='me')return json(await myStatus(env,p));
  if(request.method==='POST'&&route==='join')return json(await join(env,p));
  if(request.method==='POST'&&route==='look'){const r=await action(env,p,'look');return json(r,r.code==='CONFLICT'?409:r.ok?200:400);}
  if(request.method==='POST'&&route==='move'){const args=await payload(request),r=await action(env,p,'move',args.direction);return json(r,r.code==='CONFLICT'?409:r.ok?200:400);}
  return fail('NOT_FOUND','No matching API endpoint.',404);
 }catch(e){console.error('Arena API error',e);return fail('SERVER_ERROR','Please try again later.',500);}
}
const tool=(name,description,properties={},required=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
const TOOL_LIST=[
 tool('join_game','Begin or resume your only official maze attempt. Auth Bearer token required.'),
 tool('look_around','Reveal nearby maze tiles, using one look.'),
 tool('move','Move once; bumps count and lower your ranking.',{direction:{type:'string',enum:['up','down','left','right']}},['direction']),
 tool('get_status','Read your known map, location, key and remaining turns.'),
 tool('get_leaderboard','Read current season winners.',{limit:{type:'integer',minimum:1,maximum:25}})
];
const rpc=(id,result)=>json({jsonrpc:'2.0',id,result});
const rpcFail=(id,code,message,status=200)=>json({jsonrpc:'2.0',id,error:{code,message}},status);
const wrapResult=result=>({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:!result.ok});
export async function handleMcp({request,env}){
 if(request.method==='GET')return new Response('Stateless POST only.',{status:405,headers:{Allow:'POST'}});
 if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return rpcFail(null,-32001,'Invalid Origin',403);
 let q;try{q=await payload(request);}catch{return rpcFail(null,-32700,'Parse error',400);}
 if(q?.jsonrpc!=='2.0'||typeof q.method!=='string')return rpcFail(q?.id??null,-32600,'Invalid JSON-RPC',400);
 if(q.id===undefined||q.id===null)return new Response(null,{status:202});
 if(q.method==='initialize')return rpc(q.id,{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'fat-fish-arena',version:'1.0.0'},instructions:'Get your private token from /join, configure Authorization Bearer in the MCP client, then call join_game, look_around, move, get_status, get_leaderboard. Never share tokens or access Bilibili secrets.'});
 if(q.method==='ping')return rpc(q.id,{});
 if(q.method==='tools/list')return rpc(q.id,{tools:TOOL_LIST});
 if(q.method!=='tools/call')return rpcFail(q.id,-32601,'Unknown RPC method');
 const name=q.params?.name,args=q.params?.arguments||{};
 if(!TOOL_LIST.some(t=>t.name===name))return rpcFail(q.id,-32602,'Unknown tool');
 if(!ready(env))return rpc(q.id,wrapResult({ok:false,code:'BACKEND_NOT_CONFIGURED',message:'Configure D1 and MAZE_SEED first.'}));
 try{
  if(name==='get_leaderboard')return rpc(q.id,wrapResult(await leaderboard(env,Math.max(1,Math.min(25,Number(args.limit)||10)))));
  const p=await player(request,env.FISH_DB);
  if(!p)return rpc(q.id,wrapResult({ok:false,code:'UNAUTHORIZED',message:'Private Authorization Bearer token missing.'}));
  const result=name==='join_game'?await join(env,p):name==='get_status'?await myStatus(env,p):name==='look_around'?await action(env,p,'look'):await action(env,p,'move',args.direction);
  return rpc(q.id,wrapResult(result));
 }catch(e){console.error('Arena MCP error',e);return rpc(q.id,wrapResult({ok:false,code:'SERVER_ERROR',message:'Action failed.'}));}
}
