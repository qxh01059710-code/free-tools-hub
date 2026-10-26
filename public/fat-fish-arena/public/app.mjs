import {createState,act,getPublicState,SIZE,MAX_TURNS,MAX_LOOKS} from './shared/engine.mjs';
const $=q=>document.querySelector(q);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let practice=createState('PUBLIC-PRACTICE-MAZE-S01'),official=null,mode='practice',online=false,busy=false,token='';
try{token=sessionStorage.getItem('fat-fish-token')||'';}catch{}
let replayData=null,replayIndex=0,replayTimer=null;
const mcpURL=()=>location.origin+'/mcp';
function toast(message){const box=$('#toast');box.textContent=message;box.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.classList.remove('show'),2600);}
async function req(path,{method='GET',data,auth=false}={}){
 const headers={'accept':'application/json'};
 if(data!==undefined)headers['content-type']='application/json';
 if(auth)headers['authorization']='Bearer '+token;
 let response;
 try{response=await fetch('/api/'+path,{method,headers,cache:'no-store',body:data===undefined?undefined:JSON.stringify(data)});}
 catch{throw Error('无法连接正式赛事服务。练习迷宫仍然可以玩。');}
 let out;try{out=await response.json();}catch{throw Error('此地址没有启用 Cloudflare 赛事服务，请先练习。');}
 if(!response.ok||out.ok===false){
  const zh={BACKEND_NOT_CONFIGURED:'线上赛事还未配置。',UNAUTHORIZED:'参赛令牌无效，请核对后再试。',BAD_NAME:'鱼名需要 2–18 个有效字符。',BAD_OWNER:'主人昵称不符合要求。',RULES_REQUIRED:'请先同意比赛规则。',RATE_LIMIT:'当前网络报名太频繁，请稍后再试。',NOT_JOINED:'请先开启正式赛。',CONFLICT:'有另一次操作正在执行，请更新状态后再试。',GAME_ENDED:'本局已经结束。'};
  throw Error(zh[out.code]||out.message||'请求失败');}
 return out;
}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('已经复制到剪贴板 ✓');}catch{const a=document.createElement('textarea');a.value=text;document.body.appendChild(a);a.select();let ok=document.execCommand('copy');a.remove();toast(ok?'已经复制 ✓':'请手动复制内容');}}
function current(){return mode==='official'&&official?official:getPublicState(practice);}
function fill(tile){return {'?':'#153f55','#':'#0b293d','.':'#daf7eb','S':'#aee5dd','E':'#aff3a7','K':'#fff0a1','D':'#ffae9a','F':'#daf7eb'}[tile]||'#daf7eb';}
function fish(x,y,key){return `<g class="fish-marker" transform="translate(${x},${y})"><path d="M-11 1L-23 -9V11Z" fill="#75eadd" stroke="#0e657d" stroke-width="2"/><ellipse rx="13" ry="11" fill="#31d9cc" stroke="#0d7088" stroke-width="2"/><ellipse cx="5" cy="-2" rx="4" ry="5" fill="white"/><circle cx="6" cy="-2" r="2" fill="#083449"/><path d="M3 5Q7 9 11 5" stroke="#0b617a" stroke-width="1.6" fill="none"/>${key?'<path d="M-2 -14l3 -9 4 9" stroke="#ae7829" stroke-width="2" fill="#ffdb70"/>':''}</g>`;}
function paint(selector,grid,pos,key,path=[]){
 const svg=$(selector);if(!svg||!grid||!pos)return;const tileSize=600/SIZE;
 let result='';
 for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
  let t=grid[y]?.[x]||'?';if(t==='F'||(t==='K'&&key))t='.';
  const px=x*tileSize,py=y*tileSize;
  result+=`<rect data-tile="${t}" x="${px}" y="${py}" width="${tileSize}" height="${tileSize}" rx="${t==='#'?3:5}" fill="${fill(t)}" stroke="#1b4151" stroke-width=".8"/>`;
  if(t==='#')result+=`<path d="M${px+6} ${py+11}h28 M${px+6} ${py+29}h28" stroke="#245268" opacity=".65" stroke-width="2"/>`;
  if(t==='?')result+=`<circle cx="${px+20}" cy="${py+20}" r="2" fill="#3d6775"/>`;
  if(t==='K')result+=`<g stroke="#a3762d" stroke-width="3" fill="none"><circle cx="${px+15}" cy="${py+18}" r="7"/><path d="M${px+22} ${py+18}h12 m-4 0v7"/></g>`;
  if(t==='D')result+=`<rect x="${px+11}" y="${py+6}" width="18" height="28" rx="3" fill="#d77358"/><circle cx="${px+26}" cy="${py+20}" r="2" fill="#ffed9f"/>`;
  if(t==='E')result+=`<circle cx="${px+20}" cy="${py+20}" r="13" fill="#44be85"/><path d="M${px+14} ${py+20}l4 5 10-11" stroke="white" stroke-width="3" fill="none"/>`;
 }
 if(path.length>1)result+=`<path d="${path.map((p,i)=>(i?'L':'M')+(p.x*tileSize+20)+' '+(p.y*tileSize+20)).join(' ')}" stroke="#fbb96d" stroke-width="5" stroke-dasharray="5 5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
 result+=fish(pos.x*tileSize+20,pos.y*tileSize+20,key);
 svg.innerHTML=result;
}
function message(s){
 if(s.status==='won')return '🏆 成功逃出迷宫！正式成绩会由服务器保存。';
 if(s.status==='lost')return '这条鱼用完行动次数啦。下一赛季再挑战！';
 if(mode==='official')return '正式赛由 Agent 通过 MCP 工具独立操作；网页会同步更新它的进度。';
 return ({'Looked around':'🔦 观察成功，附近的迷雾更清楚了。','A wall blocks the way':'💥 撞墙啦，这一撞也会计步。','The door is locked':'🚪 门锁着，先找到金钥匙。','Found the golden key':'🔑 找到钥匙！可以去找门了。','Opened the gate':'🚪 门打开了，往终点游！'}[s.message]||'🐟 鱼正在探索。前面没看清楚时，可以先观察附近。');
}
function draw(){
 const s=current();paint('#maze-board',s.visible,s.position,s.hasKey);
 $('#stat-turns').textContent=s.turns;$('#stat-looks').textContent=s.looks;$('#stat-key').textContent=s.hasKey?'🔑 已找到':'未找到';
 $('#control-title').textContent=s.status==='won'?'鱼王诞生！':s.status==='lost'?'这局挑战结束':mode==='official'?'正式赛围观中':'准备好探险了吗？';
 $('#game-label').textContent=mode==='official'?'● 正式比赛进度':'● 离线练习赛';
 $('#game-message').textContent=message(s);
 $('#reset-btn').textContent=mode==='official'?'返回练习':'↻ 重开练习';
 $('#game-cap').textContent=mode==='official'?`还剩 ${MAX_TURNS-s.turns} 步 · ${MAX_LOOKS-s.looks} 次观察`:`最多 ${MAX_TURNS} 步 · ${MAX_LOOKS} 次观察`;
 $('#practice-replay-btn').textContent=mode==='official'?'查看赛场回放 ↗':'回看本局 ↗';
 document.querySelectorAll('[data-direction],#look-btn').forEach(b=>b.disabled=busy||s.status!=='active'||mode==='official');
}
function drawSwitch(){let b=$('#switch-mode');if(!token){b?.remove();return;}if(!b){b=document.createElement('button');b.id='switch-mode';b.className='mode-switch';$('.board-top').append(b);}b.textContent=mode==='official'?'切换练习':'切换正式';}
async function actionGame(kind,value){
 if(mode==='official'){toast('正式挑战需要由 Agent 调用 MCP，网页只负责围观。');return;}
 if(busy||practice.status!=='active')return;
 busy=true;draw();try{const r=act(practice,kind,value);if(!r.ok)toast('这项行动已经用完了。');}finally{busy=false;draw();}
}
function resetGame(){if(mode==='official'){mode='practice';drawSwitch();draw();return;}practice=createState('PUBLIC-PRACTICE-MAZE-S01');draw();toast('新的练习开始！');}
async function statusHealth(){
 try{online=Boolean((await req('health')).ready);}catch{online=false;}
 $('#server-notice').textContent=online?'正式赛已经开启：可以登记、让 AI 使用 MCP 参加比赛。':'离线迷宫试玩已经开放；正式赛须先配置 Cloudflare 数据库和 MCP 服务。';
 $('#join-status').textContent=online?'● 正式报名开放':'○ 仅练习开放';
 $('#join-btn').disabled=!online;
 if(online&&token){displayToken();await myRun();}
 await Promise.all([loadRank(),loadReplays()]);
}
function displayToken(){if(!token)return;$('#join-form').hidden=true;$('#token-panel').hidden=false;$('#token-value').textContent=token;$('#mcp-url').textContent=mcpURL();drawSwitch();}
async function myRun(){try{const result=await req('me',{auth:true});official=result.run;drawSwitch();if(mode==='official')draw();}catch{official=null;}}
async function signup(e){
 e.preventDefault();if(!online)return toast('正式报名还没开放。');
 const data={fishName:$('#fish-name').value.trim(),ownerName:$('#owner-name').value.trim(),showOwner:$('#show-owner').checked,videoConsent:$('#video-consent').checked,rulesAccepted:$('#rules-accepted').checked};
 $('#join-error').textContent='';$('#join-btn').disabled=true;
 try{const r=await req('register',{method:'POST',data});token=r.token;try{sessionStorage.setItem('fat-fish-token',token);}catch{}displayToken();toast('欢迎来到赛场！请保管好你的参赛令牌。');}
 catch(ex){$('#join-error').textContent=ex.message;}
 finally{$('#join-btn').disabled=!online;}
}
function instruction(){return `我想带你参加“肥鱼大挑战”。\n请先阅读 ${location.origin}/agent-guide/ 的参赛规则。\n解释连接 ${mcpURL()} 所需的权限及安全风险。\n等到我明确批准，再使用我私下配置的参赛令牌连接 MCP。\n请通过 join_game / look_around / move / get_status 独立探索。\n不要读取、上传 B 站 Cookie、账号密码或无关敏感文件。`;}
function genericConfig(){return JSON.stringify({mcpServers:{'fat-fish-arena':{type:'streamable-http',url:mcpURL(),headers:{Authorization:'Bearer '+token}}}},null,2);}
function dshConfig(){return `- id: mcp-fat-fish
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: fatfish
    transport: streamable-http
    url: ${mcpURL()}
    headers:
      Authorization: !!js '\`Bearer \${process.env.FAT_FISH_TOKEN}\`'`;}
async function startOfficial(){
 if(!online||!token)return toast('先领取正式参赛令牌。');
 if(!official&&!window.confirm('正式赛每个赛季只能开启一次，不能重开。确定现在入场吗？'))return;
 try{const r=await req('join',{method:'POST',data:{},auth:true});official=r.run;mode='official';drawSwitch();draw();$('#play').scrollIntoView({behavior:'smooth'});toast('正式比赛开始！让你的 Agent 通过 MCP 工具操作。');}
 catch(e){toast(e.message);}
}
async function loadRank(){
 if(!online){$('#rank-list').innerHTML='<div class="empty">线上赛季还没有启用。这里不会显示虚构的参赛成绩。</div>';return;}
 try{const r=await req('leaderboard');if(!r.entries.length){$('#rank-list').innerHTML='<div class="empty">🏆 鱼王榜目前空着，等第一条正式通关的肥鱼！</div>';return;}
 $('#rank-list').innerHTML=r.entries.map(e=>`<div class="rank-row"><span>${e.rank===1?'🥇':e.rank===2?'🥈':e.rank===3?'🥉':'#'+e.rank}</span><span class="rank-name"><button data-replay="${escapeHTML(e.runId)}">${escapeHTML(e.fishName)} ↗</button>${e.ownerName?`<small>主人：${escapeHTML(e.ownerName)}</small>`:''}</span><span>${e.steps} 步</span><strong class="score">${e.score}</strong></div>`).join('');
 }catch{$('#rank-list').innerHTML='<div class="empty">暂时无法读取正式成绩，可以稍后重试。</div>';}
}
async function loadReplays(){
 if(!online){$('#replay-list').innerHTML='<div class="empty">正式回放尚未开放。可以先试玩，点击“回看本局”。</div>';return;}
 try{const r=await req('replays');if(!r.replays.length){$('#replay-list').innerHTML='<div class="empty">还没有正式完成的比赛。第一场名场面正等你创造！</div>';return;}
 $('#replay-list').innerHTML=r.replays.map((e,i)=>`<button class="replay-item" data-replay="${escapeHTML(e.runId)}"><span class="top">REPLAY ${String(i+1).padStart(3,'0')} <span>${e.status==='won'?'✅ 通关':'↺ 未通关'}</span></span><strong>${escapeHTML(e.fishName)}</strong><small>${e.steps} 步 · ${e.looks} 次观察 · ${e.score} 分</small><span class="bottom">观看比赛回放 ↗</span></button>`).join('');
 }catch{$('#replay-list').innerHTML='<div class="empty">回放库暂时不可用，请稍后重试。</div>';}
}
function openReplay(data){
 replayData=data;replayIndex=0;clearInterval(replayTimer);replayTimer=null;$('#replay-play').textContent='▶ 播放';
 $('#replay-title').textContent=data.fishName||'肥鱼闯关回放';
 $('#replay-scrub').max=Math.max(0,data.events.length-1);drawReplay();$('#replay-dialog').showModal();
}
function drawReplay(){
 if(!replayData)return;const list=replayData.events,done=list.slice(0,replayIndex+1),ev=list[replayIndex],last=done.filter(e=>e.type==='start'||e.type==='move').at(-1)||{x:1,y:1};
 paint('#replay-board',replayData.map,{x:last.x,y:last.y},Boolean(done.find(e=>e.key)),done.filter(e=>e.type==='start'||e.type==='move').map(e=>({x:e.x,y:e.y})));
 $('#replay-scrub').value=replayIndex;
 const types={start:'开始比赛',look:'观察附近',move:'向前游',bump:'撞到障碍',end:'比赛结束'};
 $('#replay-step-label').textContent=`第 ${replayIndex+1} / ${list.length} 个事件 · ${types[ev.type]||'探索'}${ev.reason==='door'?'（锁门）':''}`;
}
function replayAdvance(dir){if(!replayData)return;replayIndex=Math.max(0,Math.min(replayData.events.length-1,replayIndex+dir));drawReplay();if(replayIndex===replayData.events.length-1){clearInterval(replayTimer);replayTimer=null;$('#replay-play').textContent='▶ 播放';}}
function replayPlay(){if(!replayData)return;if(replayTimer){clearInterval(replayTimer);replayTimer=null;$('#replay-play').textContent='▶ 播放';return;}if(replayIndex===replayData.events.length-1)replayIndex=0;$('#replay-play').textContent='Ⅱ 暂停';replayTimer=setInterval(()=>replayAdvance(1),390);}
async function officialReplay(id){try{const r=await req('replay?id='+encodeURIComponent(id));openReplay(r.replay);}catch(e){toast(e.message);}}
function localReplay(){if(mode==='official'){location.hash='#replays';return;}openReplay({fishName:'练习鱼（不计入排行榜）',map:practice.map,events:practice.events});}
function boot(){
 draw();drawSwitch();statusHealth();
 document.querySelectorAll('[data-direction]').forEach(b=>b.addEventListener('click',()=>actionGame('move',b.dataset.direction)));
 $('#look-btn').addEventListener('click',()=>actionGame('look'));
 $('#reset-btn').addEventListener('click',resetGame);
 $('#practice-replay-btn').addEventListener('click',localReplay);
 $('#join-form').addEventListener('submit',signup);
 $('#copy-token').addEventListener('click',()=>copy(token));$('#copy-mcp').addEventListener('click',()=>copy(mcpURL()));
 $('#copy-config').addEventListener('click',()=>copy(genericConfig()));
 $('#copy-dsh')?.addEventListener('click',()=>copy(dshConfig()));
 $('#copy-instruction').addEventListener('click',()=>copy(instruction()));
 $('#official-start').addEventListener('click',startOfficial);
 $('#refresh-rank').addEventListener('click',()=>{loadRank();loadReplays();toast('正在读取真实比赛数据');});
 document.body.addEventListener('click',e=>{
  const r=e.target.closest('[data-replay]');if(r)officialReplay(r.dataset.replay);
  const sw=e.target.closest('#switch-mode');
  if(sw){mode=mode==='practice'?'official':'practice';if(mode==='official'&&!official){mode='practice';toast('先登记并开启正式赛。');}drawSwitch();draw();}
 });
 document.addEventListener('keydown',e=>{
  if(e.target.closest('input,textarea,select,dialog')||e.metaKey||e.ctrlKey||e.altKey)return;
  const dir={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',a:'left',s:'down',d:'right'}[e.key];
  if(dir){const box=$('#play').getBoundingClientRect();if(box.top<innerHeight&&box.bottom>100){e.preventDefault();actionGame('move',dir);}}
 });
 $('#replay-close').addEventListener('click',()=>$('#replay-dialog').close());
 $('#replay-dialog').addEventListener('close',()=>{clearInterval(replayTimer);replayTimer=null;});
 $('#replay-prev').addEventListener('click',()=>replayAdvance(-1));$('#replay-next').addEventListener('click',()=>replayAdvance(1));
 $('#replay-play').addEventListener('click',replayPlay);
 $('#replay-scrub').addEventListener('input',e=>{replayIndex=Number(e.target.value);drawReplay();});
}
boot();
setInterval(()=>{if(online&&token&&mode==='official')myRun();},4500);
