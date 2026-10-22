/* Our Little Plans / V2 Cloud. No client-side service-role secrets.
 * Cloud: Supabase Auth + PostgREST RLS, private Storage, server-side scoring.
 * Sync: 8-second polling + immediate reload on focus/write (not WebSocket instant sync).
 * Deliberately no framework/CDN dependency; deployable as a Pages subdirectory. */
(() => {
'use strict';
const C=window.OLP_CONFIG||{};
const proxyMode=C.apiMode==='proxy';
const configured=/^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(C.supabaseUrl||'')&&
  /^((sb_publishable_|eyJ)[A-Za-z0-9_.-]+)$/.test(C.publishableKey||'');
const base=proxyMode?location.origin:(C.supabaseUrl||'').replace(/\/$/,'');
const apiPrefix=proxyMode?'/api':'';
const apiURL=path=>base+apiPrefix+path;
const el=id=>document.getElementById(id);
const enc=s=>encodeURIComponent(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const ic=(name,cl='')=>`<svg class="ic ${cl}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const shortId=x=>String(x||'').slice(0,8);
const fmt=t=>t?new Date(t).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const fmtDay=t=>t?new Date(t).toLocaleDateString('zh-CN',{year:'numeric',month:'short',day:'numeric'}):'';
const themes=['sage','sunset','sand','lilac','navy'];
const userSpace={couple_id:null,partner_id:null};
let session=null,me=null,profile=null,partner=null,workspace={...userSpace},route='home',currentEvent=null,tab='tasks',editingNote=null;
let data={events:[],tasks:[],notes:[],task_awards:[],activity:[],notifications:[],archived_copies:[],score_history:[],event_members:[]};
let currentLoad=0,loading=false,saveTimer=null,pollTimer=null,syncNotice='',inFlight=0,search='',filter='all',eventView='active';
let calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1),selectedDay=null,taskScope='all',taskSearch='',memoryFilter='all',lastSyncedAt=null;
const todayKey=()=>localDay(new Date());
function localDay(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function diffDays(date,from=todayKey()){return Math.round((Date.parse(date+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/864e5)}
function shiftDate(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function eventOccurrence(e,year){if(!e.event_date)return null;if(!e.anniversary_yearly)return e.event_date;
 if(year<Number(e.event_date.slice(0,4)))return null;
 const key=String(year)+'-'+e.event_date.slice(5),d=new Date(key+'T12:00:00Z');
 return !Number.isNaN(+d)&&d.toISOString().slice(0,10)===key?key:null;
}
function eventOnDay(e,day){return !!e.event_date&&!e.deleted_at&&(e.anniversary_yearly?eventOccurrence(e,Number(day.slice(0,4)))===day:e.event_date===day)}
function upcomingReminders(){const reminders=[],now=todayKey();
 for(const t of data.tasks){const e=event(t.event_id);if(!t.due_on||t.deleted_at||t.is_done||!e||e.deleted_at||e.status!=='active')continue;
  const days=diffDays(t.due_on,now);if(days>=-7&&days<=7)reminders.push({id:'task-'+t.id,event_id:e.id,when:t.due_on,days,label:days<0?'任务已逾期':days===0?'任务今天截止':'任务即将截止',title:t.title,detail:e.title});}
 for(const e of data.events){if(!e.event_date||e.deleted_at)continue;
  const years=e.anniversary_yearly?[Number(now.slice(0,4)),Number(now.slice(0,4))+1]:[Number(e.event_date.slice(0,4))];
  for(const year of years){const date=eventOccurrence(e,year);if(!date)continue;const days=diffDays(date,now);if(days>=0&&days<=7)reminders.push({id:'event-'+e.id+'-'+year,event_id:e.id,when:date,days,label:e.anniversary_yearly?'纪念日提醒':'事件日期提醒',title:e.title,detail:e.anniversary_yearly?'每年重复':'计划日期'});}
 }
 return reminders.sort((a,b)=>a.days-b.days||a.when.localeCompare(b.when));
}

const blobs=new Map();
const connection=()=>!!(session?.access_token&&me?.id);
const tell=(message)=>{const t=el('toast');if(!t)return;t.textContent=message;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),3600)};
function errorOf(e){return e?.message||'操作失败，请重试'}
function setSession(s){session=s?.access_token?s:null;try{session?localStorage.setItem('olp_session_v2',JSON.stringify(session)):localStorage.removeItem('olp_session_v2')}catch{} }
function sessionHeaders(auth=true){const h={'apikey':C.publishableKey};if(auth&&session?.access_token)h.Authorization='Bearer '+session.access_token;return h}
async function fetchJSON(path,{method='GET',body,auth=true,returnRows=false,headers={}}={},retry=true){
 const h={...sessionHeaders(auth),...headers};if(body!==undefined)h['content-type']='application/json';if(returnRows)h.Prefer='return=representation';
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),20000);
 let response;
 try{response=await fetch(apiURL(path),{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:ctl.signal})}
 catch(e){
  if(e?.name==='AbortError')throw Error('连接超时（20 秒），请检查网络并重试');
  if(method==='GET'&&retry){await new Promise(r=>setTimeout(r,700));return fetchJSON(path,{method,body,auth,returnRows,headers},false)}
  throw Error('网络连接失败：请检查当前网络，或稍后重试（'+(proxyMode?'API 转发':'Supabase 直连')+'）');
 }finally{clearTimeout(timer)}
 if(response.status===401&&auth&&retry&&session?.refresh_token){await refreshSession();return fetchJSON(path,{method,body,auth,returnRows,headers},false)}
 let parsed;const raw=await response.text();try{parsed=raw?JSON.parse(raw):null}catch{parsed=null}
 if(!response.ok)throw Error(parsed?.msg||parsed?.error_description||parsed?.message||parsed?.error||`请求失败 (${response.status})`);
 return parsed;
}
async function refreshSession(){if(!session?.refresh_token)throw Error('登录已失效');const next=await fetchJSON('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},auth:false});setSession(next);return next}
async function authUser(){const x=await fetchJSON('/auth/v1/user');if(!x?.id)throw Error('登录失效');return x}
async function signIn(email,password){const s=await fetchJSON('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},auth:false});setSession(s);me=s.user||await authUser();await loadAll();nav('home')}
async function signUp(email,password,nickname){const s=await fetchJSON('/auth/v1/signup?redirect_to='+enc(location.origin+location.pathname),{method:'POST',body:{email,password,data:{nickname}},auth:false});if(s?.access_token){setSession(s);me=s.user;await loadAll();nav('home')}else tell('注册请求已提交，请查看邮箱中的验证邮件，再返回登录')}
async function signOut(){try{await fetchJSON('/auth/v1/logout',{method:'POST',body:{}})}catch{}setSession(null);me=null;partner=null;profile=null;workspace={...userSpace};data=emptyData();clearInterval(pollTimer);route='home';render()}
function emptyData(){return {events:[],tasks:[],notes:[],task_awards:[],activity:[],notifications:[],archived_copies:[],score_history:[],event_members:[]}}
function pg(table,select='*',where='',sort=''){let q=`/rest/v1/${table}?select=${enc(select)}`;if(where)q+='&'+where;if(sort)q+='&order='+enc(sort);return q}
function eq(field,v){return `${field}=eq.${enc(v)}`}
async function rows(table,{select='*',where='',order='',limit}={}){let url=pg(table,select,where,order);if(limit)url+='&limit='+limit;return await fetchJSON(url)}
async function put(table,body){return (await fetchJSON(`/rest/v1/${table}`,{method:'POST',body,returnRows:true}))[0]}
async function patch(table,id,body,version){let q=`?id=eq.${enc(id)}`;if(version!==undefined)q+=`&version=eq.${enc(version)}`;const a=await fetchJSON(`/rest/v1/${table}${q}`,{method:'PATCH',body,returnRows:true});if(!a?.length)throw Error('内容已在另一台设备更新，已保护你的编辑，请重新打开后合并');return a[0]}
async function rpc(name,args={}){return await fetchJSON(`/rest/v1/rpc/${name}`,{method:'POST',body:args})}
async function loadAll(quiet=false){if(!connection())return;const serial=++currentLoad;try{
 const [space,profiles,evs,tasks,notes,awards,activity,notesNotice,archives,history,eventMembers]=await Promise.all([
 rpc('my_workspace'),rows('profiles'),rows('events',{order:'updated_at.desc'}),rows('tasks',{order:'updated_at.desc'}),
 rows('notes',{order:'pinned.desc,updated_at.desc'}),rows('task_awards'),rows('activity',{order:'created_at.desc',limit:120}),
 rows('notifications',{order:'updated_at.desc',limit:100}),rows('archived_copies',{order:'created_at.desc'}),rows('score_history',{order:'at.desc',limit:100}),rows('event_members')]);
 if(serial!==currentLoad)return;
 workspace=space||{...userSpace};profile=profiles.find(x=>x.id===me.id)||{nickname:'我',id:me.id};partner=profiles.find(x=>x.id===workspace.partner_id)||null;
 data={events:evs||[],tasks:tasks||[],notes:notes||[],task_awards:awards||[],activity:activity||[],notifications:notesNotice||[],archived_copies:archives||[],score_history:history||[],event_members:eventMembers||[]};
 if(route==='note'&&document.activeElement?.isContentEditable){syncNotice='有云端更新，编辑结束后请先保存或刷新';updateSaveHint();return}
 syncNotice='';lastSyncedAt=new Date();if(!quiet||!document.querySelector('[name="modal-form"]'))render();else updateIndicators();
 }catch(e){syncNotice=errorOf(e);if(!quiet)tell('读取云端数据失败：'+syncNotice);updateIndicators()}}
function activeEvents(){return data.events.filter(x=>x.status==='active'&&!x.deleted_at).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||new Date(b.updated_at)-new Date(a.updated_at))}
function event(id){return data.events.find(x=>x.id===id)}
function editableEvent(id){const e=event(id);return !!e&&!e.deleted_at&&e.status==='active'}
function tasksOf(id,deleted=false){return data.tasks.filter(x=>x.event_id===id&&(deleted?!!x.deleted_at:!x.deleted_at))}
function notesOf(id,deleted=false){return data.notes.filter(x=>x.event_id===id&&(deleted?!!x.deleted_at:!x.deleted_at)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||new Date(b.updated_at)-new Date(a.updated_at))}
function displayName(uid){if(uid===me?.id)return profile?.nickname||'我';if(uid===partner?.id)return partner.nickname;return uid?'成员':'共同'}
function ownerText(uid){return uid?displayName(uid):'共同'}
function score(uid){return data.task_awards.filter(x=>x.user_id===uid).reduce((sum,x)=>sum+x.points,0)}
function progress(id){const x=tasksOf(id);return x.length?Math.round(x.filter(t=>t.is_done).length/x.length*100):0}
function go(to){if(route==='note'&&to!=='note'&&editingNote){const e=event(data.notes.find(x=>x.id===editingNote)?.event_id);if(e&&el('noteEditor')?.dataset.dirty==='1'){tell('笔记有未保存的修改，请先保存');return}}
 route=to;render();window.scrollTo(0,0)}
function nav(to){route=to;editingNote=to==='note'?editingNote:null;render();window.scrollTo(0,0)}
function button(text,action,cls=''){return `<button class="btn ${cls}" data-act="${action}">${text}</button>`}
function pageHeader(title,desc,action=''){return `<div class="page-head"><div><div class="eyebrow">OUR LITTLE PLANS</div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${action}</div>`}
const photoFilePattern=/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:webp|jpg|png)$/i;
let photoGallery=[],photoIndex=0,photoTitle='',photoReturnFocus=null;
function notePhotoPaths(note){
 return [...new Set([...String(note?.body||'').matchAll(/data-asset="([0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:webp|jpg|png))"/gi)].map(x=>x[1]))];
}
function photoPreview(path,title='完整照片',gallery){
 if(!photoFilePattern.test(path))return tell('这张照片暂时无法预览');
 photoGallery=[...new Set((gallery?.length?gallery:[path]).filter(x=>photoFilePattern.test(x)))];
 if(!photoGallery.includes(path))photoGallery.unshift(path);
 photoIndex=photoGallery.indexOf(path);photoTitle=title;photoReturnFocus=document.activeElement;
 document.body.classList.add('photo-viewing');
 renderPhotoPreview();
}
function renderPhotoPreview(){
 const layer=el('photoLayer');if(!layer)return;
 const path=photoGallery[photoIndex];if(!path){closePhotoPreview();return}
 layer.innerHTML=`<div class="photo-backdrop" role="presentation" data-photo-backdrop="1"><div class="photo-dialog" role="dialog" aria-modal="true" aria-label="${esc(photoTitle)}">
  <div class="photo-toolbar"><strong>${esc(photoTitle)}</strong><span>${photoGallery.length>1?`${photoIndex+1} / ${photoGallery.length}`:'原图完整展示'}</span><button type="button" class="photo-close" data-close-photo="1" aria-label="关闭照片预览">✕ 关闭</button></div>
  <div class="photo-stage">${photoGallery.length>1?`<button type="button" class="photo-step previous" data-photo-step="-1" aria-label="上一张照片">‹</button>`:''}<img data-asset="${esc(path)}" alt="${esc(photoTitle)}" draggable="false">${photoGallery.length>1?`<button type="button" class="photo-step next" data-photo-step="1" aria-label="下一张照片">›</button>`:''}</div>
  <p class="photo-tip">完整比例展示 · 按 Esc 关闭${photoGallery.length>1?' · 左右方向键切换':''}</p>
 </div></div>`;
 hydrateAssets();
 layer.querySelector('[data-close-photo]')?.focus();
}
function stepPhotoPreview(delta){
 if(!photoGallery.length)return;
 photoIndex=(photoIndex+delta+photoGallery.length)%photoGallery.length;
 renderPhotoPreview();
}
function closePhotoPreview(){
 const layer=el('photoLayer');if(layer)layer.innerHTML='';
 document.body.classList.remove('photo-viewing');
 photoGallery=[];if(photoReturnFocus?.isConnected)photoReturnFocus.focus?.();photoReturnFocus=null;
}
function cover(e,size='tile'){const thumb=e.cover_path?`<img data-asset="${esc(e.cover_path)}" alt="事件封面">`:ic('book');return `<div class="cover ${themes.includes(e.cover_theme)?e.cover_theme:'sage'} ${size}">${thumb}</div>`}
function miniAvatar(uid){let a=displayName(uid);return `<span class="avatar ${uid===me?.id?'a':'b'}">${esc(a[0]||'人')}</span>`}
function empty(title,subtitle){return `<div class="empty">${ic('book')}<strong>${esc(title)}</strong><p>${esc(subtitle)}</p></div>`}
function renderNav(){const tabs=[['home','首页','book'],['events','事件','events'],['calendar','日历','calendar'],['tasks','待办','tasks'],['memories','回忆册','heart'],['score','积分','coin'],['profile','我的','user']];
 const mobile=['home','events','calendar','tasks','profile'];
 el('sideNav').innerHTML=tabs.map(([id,title,icon])=>`<button class="side-link ${route===id?'active':''}" data-nav="${id}">${ic(icon)}${title}</button>`).join('')+`<button class="side-link ${route==='trash'?'active':''}" data-nav="trash">${ic('trash')}回收站</button>`+`<button class="side-link ${route==='archives'?'active':''}" data-nav="archives">${ic('archive')}只读档案</button>`;
 el('bottomNav').innerHTML=tabs.filter(([id])=>mobile.includes(id)).map(([id,title,icon])=>`<button class="bottom-link ${route===id?'active':''}" data-nav="${id}">${ic(icon)}<span>${title}</span></button>`).join('');
 el('crumb').textContent={home:'首页',events:'事件',tasks:'待办',calendar:'日历',memories:'回忆册',score:'积分',profile:'我的',detail:'事件详情',note:'编辑笔记',notifications:'消息',trash:'回收站',archives:'只读档案'}[route]||'首页';
 el('unreadDot').classList.toggle('show',data.notifications.some(n=>!n.is_read));
 document.querySelectorAll('.account-trigger').forEach(x=>x.textContent=(profile?.nickname||'我')[0]);
 const foot=document.querySelector('.side-foot');if(foot)foot.textContent='V2.0.1 · '+(syncNotice?'连接需检查':'云端协作');
 const mini=document.querySelector('.couple-mini');if(mini)mini.innerHTML=workspace.partner_id?`${miniAvatar(me.id)}<span class="join-line"></span>${miniAvatar(workspace.partner_id)}<span>情侣空间</span>`:`${miniAvatar(me.id)}<span>尚未绑定情侣</span>`;
}
function render(){const main=el('content');if(!main)return;
 if(!configured){main.innerHTML=setupView();document.querySelector('.sidebar').style.display='none';el('bottomNav').style.display='none';return}
 if(!connection()){main.innerHTML=session?.access_token?offlineView():authView();document.querySelector('.sidebar').style.display='none';el('bottomNav').style.display='none';return}
 document.querySelector('.sidebar').style.display='';el('bottomNav').style.display='';renderNav();
 main.innerHTML=(syncNotice?`<div class="sync-warning" role="alert">⚠️ 数据同步暂时失败：${esc(syncNotice)} <button class="btn small" data-act="refresh">重试同步</button></div>`:'')+({home:homePage,events:eventsPage,tasks:tasksPage,calendar:calendarPage,memories:memoriesPage,score:scorePage,profile:profilePage,detail:detailPage,note:notePage,notifications:notificationsPage,trash:trashPage,archives:archivesPage}[route]||homePage)();hydrateAssets();updateIndicators();
}
function setupView(){return `<div class="auth-wrap"><div class="auth-card panel panel-pad">${ic('book','auth-mark')}<div class="eyebrow">OUR LITTLE PLANS</div><h1>连接你的云端空间</h1><p class="muted">尚未配置 Supabase 项目。为避免将本地演示误认为真实账号系统，应用暂不允许录入私人数据。</p><div class="notice">请先执行项目中的 <code>supabase/001_init.sql</code>，再编辑 <code>public/couple-plans/config.js</code>，填入 Supabase Project URL 和公开的 Publishable / anon key。不要填写 service_role 密钥。</div><p class="muted">请查看压缩包里的 README.md 和 DEPLOY.md。</p></div></div>`}
function offlineView(){return `<div class="auth-wrap"><div class="auth-card panel panel-pad"><div class="eyebrow">CONNECTING</div><h1>连接暂时中断</h1><p class="muted">已保留你的登录凭证。可能是国内网络或 API 代理暂时不可用，请重试，不需要重新注册。</p><button class="btn primary" data-act="retryBoot">重新连接</button> <button class="btn" data-act="signOut">退出并切换账号</button></div></div>`}
function authView(){return `<div class="auth-wrap"><div class="auth-card panel panel-pad"><div class="brand-mark auth-mark">${ic('book')}<span class="brand-dot"></span></div><div class="eyebrow">OUR LITTLE PLANS</div><h1>我们的小计划</h1><p>登录后，在两个人的空间里记录计划与进展。</p><div class="auth-switch"><button data-authmode="login" class="active" id="authLoginTab">登录</button><button data-authmode="signup" id="authSignupTab">注册</button></div><form id="authForm"><div class="field" id="authNameField" hidden><label>昵称</label><input class="input" name="nickname" maxlength="24" placeholder="怎么称呼你"></div><div class="field"><label>邮箱</label><input class="input" name="email" type="email" autocomplete="email" required placeholder="example@email.com"></div><div class="field"><label>密码</label><input class="input" name="password" type="password" minlength="8" autocomplete="current-password" required placeholder="至少 8 位密码"></div><button class="btn primary full-btn" type="submit" id="authSubmit">登录</button></form><p class="field-hint" style="line-height:1.8">注册后可能需要点击邮箱验证链接。如果忘记密码，可在下方发送重置邮件。</p><button class="text-link" data-act="resetPassword">忘记密码</button></div></div>`}
function eventPreview(e){return `<button class="event-banner" data-event="${e.id}" style="width:100%;background:none;border:0;text-align:left">${cover(e)}<div class="event-info"><strong>${e.pinned?'📌 ':''}${esc(e.title)}</strong><p>${esc(e.description)}</p><div class="progress"><i style="width:${progress(e.id)}%"></i></div><div class="meta">${tasksOf(e.id).filter(t=>t.is_done).length}/${tasksOf(e.id).length} 已完成 · ${progress(e.id)}%</div></div>${ic('chevron')}</button>`}
function taskRow(t){const ev=event(t.event_id);return `<div class="task-line"><input class="tick" type="checkbox" data-done="${t.id}" ${t.is_done?'checked':''} ${ev?.status!=='active'?'disabled':''} aria-label="完成任务"><div class="task-body"><strong class="${t.is_done?'done':''}">${esc(t.title)}</strong><small>${esc(ev?.title||'事件')} · ${esc(ownerText(t.assignee_id))}负责${t.due_on?' · '+esc(t.due_on)+(t.due_on<todayKey()&&!t.is_done?'（已逾期）':t.due_on===todayKey()&&!t.is_done?'（今天截止）':''):''}</small></div><span class="task-points">${t.assignee_id===null?'各 ':''}${t.points} 分</span><button class="icon-btn" data-act="taskEdit" data-id="${t.id}" aria-label="编辑任务">${ic('more')}</button></div>`}
function homePage(){const ev=activeEvents(),todo=data.tasks.filter(t=>!t.deleted_at&&!t.is_done&&editableEvent(t.event_id)).slice(0,5),activity=data.activity.slice(0,5);
 return pageHeader('今天的计划','把想做的事情记下来，然后慢慢完成。',button(ic('plus')+' 新建事件','newEvent','primary'))+`<div class="home-quick-links"><button data-nav="calendar">📅 日历安排</button><button data-nav="memories">❤️ 我们的回忆</button><button data-nav="tasks">✓ 今日待办</button><button data-nav="notifications">🔔 提醒 ${upcomingReminders().length?`(${upcomingReminders().length})`:''}</button></div><div class="dashboard-grid"><div class="column"><div class="hero"><div><div class="eyebrow">OUR SHARED SPACE</div><h2>每个计划，都有新的进展</h2><p>记录日常，也珍藏一起完成的事。</p></div><div class="hero-icon">${ic('book')}<i></i></div></div><div class="stat-row"><div class="panel stat"><label>进行中的计划</label><strong>${ev.length}</strong><span>项</span></div><div class="panel stat"><label>可查看的任务积分</label><strong>${data.task_awards.reduce((s,x)=>s+x.points,0)}</strong><span>分</span></div></div><section class="panel panel-pad"><div class="section-head"><h2>最近的计划</h2><button class="text-link" data-nav="events">全部事件</button></div>${ev.length?ev.slice(0,2).map(eventPreview).join('<div class="row-sep"></div>'):empty('还没有计划','新建一个事件，让计划从这里开始')}</section><section class="panel panel-pad"><div class="section-head"><h2>待办事项</h2><button class="text-link" data-nav="tasks">全部任务</button></div>${todo.length?todo.map(taskRow).join(''):empty('暂无待办','进入事件添加待办事项')}</section></div><div class="column"><section class="panel panel-pad"><div class="section-head"><h2>积分记录</h2><button class="text-link" data-nav="score">查看明细</button></div><div class="people-row">${miniAvatar(me.id)}<span>${esc(profile?.nickname||'我')}</span><strong>${score(me.id)} 分</strong></div>${workspace.partner_id?`<div class="people-row">${miniAvatar(workspace.partner_id)}<span>${esc(partner?.nickname||'TA')}</span><strong>${score(workspace.partner_id)} 分</strong></div>`:`<p class="muted">绑定情侣后，一起记录共同任务的积分。</p>`}</section><section class="panel panel-pad"><div class="section-head"><h2>最近动态</h2><button class="text-link" data-nav="notifications">消息中心</button></div>${activity.length?activity.map(activityRow).join(''):empty('暂无动态','有新的协作操作时将显示在这里')}</section><div class="notice">云端协作已开启。约每 30 秒检查一次更新（可在配置中调整），切回页面时也会刷新；遇到网络中断，可使用「我的 → 手动同步」。${lastSyncedAt?' 最近同步：'+fmt(lastSyncedAt):''}</div></div></div>`}
function activityRow(a){return `<div class="activity">${miniAvatar(a.actor_id)}<div><strong>${esc(displayName(a.actor_id))} · ${esc(a.detail||a.action)}</strong><small>${fmt(a.created_at)}</small></div></div>`}
function eventsPage(){const items=data.events.filter(e=>!e.deleted_at&&e.status===eventView).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||new Date(b.updated_at)-new Date(a.updated_at)).filter(e=>(filter==='all'||filter===e.visibility)&&((e.title+' '+e.description).toLowerCase().includes(search.toLowerCase())));
 return pageHeader('事件','进行中与已归档的计划都可以在这里查看。',button(ic('plus')+' 新建事件','newEvent','primary'))+`<div class="subnav event-status-tabs"><button data-eventview="active" class="${eventView==='active'?'active':''}">进行中 (${data.events.filter(e=>e.status==='active'&&!e.deleted_at).length})</button><button data-eventview="archived" class="${eventView==='archived'?'active':''}">已归档 (${data.events.filter(e=>e.status==='archived'&&!e.deleted_at).length})</button></div><div class="search-row"><div class="search-field">${ic('search')}<input class="input" id="eventSearch" value="${esc(search)}" placeholder="搜索计划"></div><select class="select" id="eventFilter">${[['all','全部事件'],['shared','自动共享'],['invite','邀请码'],['private','私有']].map(([a,b])=>`<option value="${a}" ${filter===a?'selected':''}>${b}</option>`).join('')}</select><button class="btn" data-act="joinEvent">${ic('key')} 输入邀请码</button></div>${items.length?`<div class="card-grid">${items.map(e=>`<button class="event-card panel" data-event="${e.id}" style="text-align:left;padding:0;border:1px solid #e9eee9">${cover(e,'grid-cover')}<div class="card-content"><h3 class="card-title">${e.pinned?'📌 ':''}${esc(e.title)}</h3><p class="card-desc">${esc(e.description)}</p><div class="card-footer"><span class="pill ${e.visibility}">${{shared:'自动共享',invite:'邀请码解锁',private:'私有'}[e.visibility]}</span><span class="muted">${e.event_date?`📅 ${esc(e.event_date.slice(5))} · `:''}${progress(e.id)}%</span></div></div></button>`).join('')}</div>`:empty('还没有符合条件的事件','可以新建事件或清除筛选条件')}`}
function detailPage(){const e=event(currentEvent);if(!e||e.deleted_at)return pageHeader('事件不可用','可能已解绑、权限发生变化或事件不存在。',button('返回事件','backEvents'));
 const ts=tasksOf(e.id),ns=notesOf(e.id),acts=data.activity.filter(x=>x.event_id===e.id),edit=e.status==='active';
 return `<div class="back-row"><button class="text-link" data-nav="events">${ic('back')} 返回事件</button></div><div class="details-grid"><div class="column"><div>${cover(e,'event-cover-large')}${e.cover_path?`<div class="event-cover-tools"><button type="button" class="btn small" data-act="viewEventCover">🔎 查看完整封面照片</button><span>已按照片原始比例展示，不再裁切</span></div>`:''}<div class="detail-summary"><h1>${e.pinned?'📌 ':''}${esc(e.title)}</h1><p>${esc(e.description)}</p>${e.event_date?`<p class="event-date-line">📅 ${esc(e.event_date)} ${e.anniversary_yearly?'· 每年纪念日':''} <button class="text-link" data-nav="calendar">日历中查看</button></p>`:''}<div class="detail-progress"><div class="progress"><i style="width:${progress(e.id)}%"></i></div><span>${progress(e.id)}% 已完成</span></div></div></div><div class="panel panel-pad"><div class="section-head"><h2>事件内容</h2><span class="pill ${e.visibility}">${{private:'私有',shared:'自动共享',invite:'邀请码'}[e.visibility]}</span></div><div class="subnav">${[['tasks','Todo'],['notes','笔记'],['activity','动态']].map(([v,title])=>`<button data-tab="${v}" class="${tab===v?'active':''}">${title}</button>`).join('')}</div>${tab==='tasks'?`${edit?`<div class="action-line">${button(ic('plus')+' 新建任务','newTask','primary')}</div>`:''}${ts.length?ts.map(taskRow).join(''):empty('还没有任务','可以添加一项待办')}`:tab==='notes'?`${edit?`<div class="action-line">${button(ic('plus')+' 新建笔记','newNote','primary')}</div>`:''}${ns.length?ns.map(n=>`<div class="note-item"><button class="note-main" data-note="${n.id}" style="border:0;background:none;text-align:left"><strong>${n.pinned?'▍ ':''}${esc(n.title)}</strong><p>${esc(stripMarkup(n.body)).slice(0,90)}</p><small>${fmt(n.updated_at)}</small></button>${edit?`<button class="icon-btn" data-act="pinNote" data-id="${n.id}" title="${n.pinned?'取消置顶':'置顶'}">${ic('pin')}</button>`:''}</div>`).join(''):empty('没有笔记','新增一篇旅行攻略或生活记录')}`:acts.length?acts.map(activityRow).join(''):empty('暂无动态','操作记录将显示在这里')}</div></div><div class="column"><div class="panel panel-pad"><div class="section-head"><h2>事件设置</h2></div><p class="muted">创建于 ${fmtDay(e.created_at)} · ${e.status==='archived'?'已归档':'进行中'}</p>${button(ic('pin')+(e.pinned?' 取消置顶':' 置顶事件'),'pinEvent')} ${button(ic('edit')+' 编辑事件','editEvent')}${e.visibility==='invite'&&e.owner_id===me.id?` ${button(ic('key')+' 生成邀请码','eventInvite')}`:''}<div class="settings-area">${(e.status==='archived'||finishedEvent(e))?button('♥ 查看回忆册','openMemories'):''} ${e.owner_id===me.id?button('调整共享方式','visibility'):''} ${e.status==='active'?button('归档事件','archiveEvent'):button('重新开启','unarchiveEvent')} ${button(ic('trash')+' 删除事件','trashEvent','danger')}</div></div><div class="panel panel-pad"><div class="section-head"><h2>完成进度</h2></div><div class="stat-row"><div class="stat-small"><strong>${ts.filter(t=>t.is_done).length}</strong><small>已完成</small></div><div class="stat-small"><strong>${ts.length-ts.filter(t=>t.is_done).length}</strong><small>待完成</small></div></div></div></div></div>`}
function notePage(){const n=data.notes.find(x=>x.id===editingNote&&!x.deleted_at),e=n?event(n.event_id):null;
 if(!n||!e)return pageHeader('无法访问笔记','请返回事件并重新打开。',button('返回事件','backDetail'));
 const readonly=e.status==='archived';return `<div class="back-row"><button class="text-link" data-act="backNote">${ic('back')} 返回 ${esc(e.title)}</button></div>${pageHeader('编辑笔记',`第 ${n.version} 版 · 最近更新 ${fmt(n.updated_at)}`)}<div class="panel panel-pad"><div class="field"><label>笔记标题</label><input class="input" id="noteTitle" value="${esc(n.title)}" maxlength="120" ${readonly?'readonly':''}></div><div class="note-editor"><div class="editor-toolbar">${[['bold','B'],['italic','I'],['insertUnorderedList','• 列表'],['insertOrderedList','1. 列表']].map(([act,txt])=>`<button data-format="${act}" type="button" ${readonly?'disabled':''}>${txt}</button>`).join('')}<button type="button" data-format="createLink" ${readonly?'disabled':''}>链接</button><button type="button" data-act="noteImage" ${readonly?'disabled':''}>${ic('image')} 图片</button>${notePhotoPaths(n).length?`<button type="button" data-act="viewNotePhotos">🔎 查看原图（${notePhotoPaths(n).length}）</button>`:''}</div><div class="editor-surface" id="noteEditor" contenteditable="${readonly?'false':'true'}" data-dirty="0" data-placeholder="写下你们的计划……">${sanitize(n.body)}</div></div><div class="toolbar-bottom"><span id="saveHint">云端同步 · 最近编辑 ${fmt(n.updated_at)}</span><div>${button('保存笔记','saveNote','primary')} ${button('移入回收站','trashNote','danger')}</div></div></div>`}

function calendarTasks(day){return data.tasks.filter(t=>t.due_on===day&&!t.deleted_at&&editableEvent(t.event_id))}
function calendarEvents(day){return data.events.filter(e=>eventOnDay(e,day))}
function calendarPage(){
 const y=calendarMonth.getFullYear(),m=calendarMonth.getMonth(),first=new Date(y,m,1);
 const offset=(first.getDay()+6)%7,start=new Date(y,m,1-offset);
 const days=Array.from({length:42},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i));
 if(!selectedDay)selectedDay=todayKey();
 const selectedTasks=calendarTasks(selectedDay),selectedEvents=calendarEvents(selectedDay),reminders=upcomingReminders();
 return pageHeader('我们的日历','约会、纪念日和任务截止日期，都集中在这里。',button(ic('plus')+' 新建事件','newEvent','primary'))+
 `<div class="calendar-layout"><section class="panel panel-pad">
 <div class="calendar-toolbar"><h2>${y} 年 ${m+1} 月</h2><div class="calendar-actions">
 <button class="btn small" data-calendar-nav="-1" aria-label="上个月">‹</button>
 <button class="btn small" data-calendar-nav="today">今天</button>
 <button class="btn small" data-calendar-nav="1" aria-label="下个月">›</button></div></div>
 <div class="calendar-grid">${['一','二','三','四','五','六','日'].map(x=>`<span class="calendar-weekday">周${x}</span>`).join('')}
 ${days.map(day=>{const date=localDay(day),ts=calendarTasks(date),es=calendarEvents(date);
 return `<button class="calendar-day ${day.getMonth()!==m?'is-outside':''} ${date===todayKey()?'is-today':''} ${date===selectedDay?'is-selected':''}" data-day="${date}" aria-label="${date}，${es.length}个事件，${ts.length}个任务"><span>${day.getDate()}</span><div class="day-markers">${es.length?'<i class="dot-event"></i>':''}${ts.length?'<i class="dot-task"></i>':''}</div>${ts.length+es.length?`<small>${es.length+ts.length} 项</small>`:''}</button>`;
 }).join('')}</div><div class="calendar-legend"><span><i class="dot-event"></i> 事件/纪念日</span><span><i class="dot-task"></i> 任务截止</span></div>
 </section><div class="calendar-aside"><section class="panel panel-pad"><div class="section-head"><h2>${esc(selectedDay)} 的安排</h2></div>
 ${selectedEvents.map(e=>`<button class="agenda-item" data-event="${e.id}"><span class="agenda-symbol">♥</span><span><strong>${esc(e.title)}</strong><small>${e.anniversary_yearly?'每年纪念日':'事件日期'} · ${e.status==='archived'?'已归档':'进行中'}</small></span>${ic('chevron')}</button>`).join('')}
 ${selectedTasks.map(t=>`<button class="agenda-item" data-event="${t.event_id}"><span class="agenda-symbol">✓</span><span><strong>${esc(t.title)}</strong><small>${esc(event(t.event_id)?.title||'事件')} · ${t.is_done?'已完成':'待完成'}</small></span>${ic('chevron')}</button>`).join('')}
 ${!selectedEvents.length&&!selectedTasks.length?empty('这天还没有安排','添加事件日期或任务截止日期即可在日历查看'):''}
 </section><section class="panel panel-pad"><div class="section-head"><h2>未来 7 天提醒</h2><button class="text-link" data-nav="notifications">消息中心</button></div>
 ${reminders.length?reminders.slice(0,6).map(reminderRow).join(''):empty('近期没有到期安排','日历会自动从事件日期和任务截止日期生成提醒')}
 </section></div></div>`;
}
function reminderRow(r){return `<button class="reminder-row" data-event="${r.event_id}"><span class="reminder-date">${esc(r.when.slice(5))}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.label)} · ${esc(r.detail)}${r.days<0?' · 逾期 '+(-r.days)+' 天':r.days===0?' · 今天':' · '+r.days+' 天后'}</small></span>${ic('chevron')}</button>`}
function finishedEvent(e){const tasks=tasksOf(e.id);return tasks.length>0&&tasks.every(t=>t.is_done)}
function memoryDate(e){const t=tasksOf(e.id).filter(t=>t.completed_at).map(t=>t.completed_at).sort().at(-1);return t||e.updated_at}
function memoryPhotos(eventId){const paths=notesOf(eventId).flatMap(n=>[...String(n.body||'').matchAll(/data-asset="([0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:webp|jpg|png))"/g)].map(m=>m[1]));
 return [...new Set(paths)].slice(0,3);
}
function memoriesPage(){
 const items=data.events.filter(e=>!e.deleted_at&&(e.status==='archived'||finishedEvent(e))).filter(e=>memoryFilter==='all'||(memoryFilter==='archived'?e.status==='archived':finishedEvent(e))).sort((a,b)=>new Date(memoryDate(b))-new Date(memoryDate(a)));
 return pageHeader('我们的回忆册','每个完成或归档的计划，都值得被记住。')+
 `<div class="memory-intro"><div><div class="eyebrow">OUR MEMORIES</div><h2>一起做过的事，慢慢变成故事。 ❤️</h2><p>从已有封面、任务与笔记中自动整理，不会复制或删除原始内容。</p></div><strong>${items.length} <small>篇回忆</small></strong></div>
 <div class="memory-filter"><button data-memory-filter="all" class="${memoryFilter==='all'?'active':''}">全部</button><button data-memory-filter="finished" class="${memoryFilter==='finished'?'active':''}">全部任务完成</button><button data-memory-filter="archived" class="${memoryFilter==='archived'?'active':''}">已归档</button></div>
 ${items.length?`<div class="memory-grid">${items.map(e=>{
   const ts=tasksOf(e.id),ns=notesOf(e.id),done=ts.filter(t=>t.is_done).length;
   return `<article class="memory-card panel">${cover(e,'memory-cover')}<div class="memory-body"><div class="memory-kicker">${e.status==='archived'?'归档的计划':'完成的计划'} · ${fmtDay(memoryDate(e))}</div><h3>${esc(e.title)}</h3><p>${esc(e.description||'每一次一起完成，都是值得保存的片段。')}</p><div class="memory-stats"><span>✓ ${done}/${ts.length} 项任务</span><span>✎ ${ns.length} 篇笔记</span></div>${done?`<div class="memory-achievements">${ts.filter(t=>t.is_done).slice(0,2).map(t=>`<span>✓ ${esc(t.title)}</span>`).join('')}</div>`:''}${memoryPhotos(e.id).length?`<div class="memory-photos">${memoryPhotos(e.id).map(path=>`<img data-asset="${esc(path)}" alt="回忆笔记照片" loading="lazy">`).join('')}</div>`:''}${ns.length?`<div class="memory-quote">“${esc(stripMarkup(ns[0].body).slice(0,100)||ns[0].title)}”</div>`:''}<button class="btn small" data-event="${e.id}">打开这段回忆 ${ic('chevron')}</button></div></article>`;
 }).join('')}</div>`:empty('回忆正在累积','完成某个事件的所有任务，或将事件归档，它就会来到这里')}
 <p class="muted memory-disclaimer">回忆册是现有事件、照片与笔记的实时整理视图，不是不可修改的历史备份。解绑后产生的只读副本请到「只读档案」查看。</p>`;
}

function tasksPage(){
 const now=todayKey();
 const base=data.tasks.filter(t=>!t.deleted_at&&editableEvent(t.event_id));
 const counts={all:base.length,mine:base.filter(t=>t.assignee_id===me.id||t.assignee_id===null).length,today:base.filter(t=>t.due_on===now&&!t.is_done).length,overdue:base.filter(t=>t.due_on&&t.due_on<now&&!t.is_done).length,upcoming:base.filter(t=>t.due_on&&t.due_on>now&&!t.is_done).length};
 const items=base.filter(t=>{
 const name=(t.title+' '+(event(t.event_id)?.title||'')).toLowerCase();
 if(!name.includes(taskSearch.toLowerCase()))return false;
 return taskScope==='all'||taskScope==='mine'&&(t.assignee_id===me.id||t.assignee_id===null)||
 taskScope==='today'&&t.due_on===now&&!t.is_done||taskScope==='overdue'&&t.due_on&&t.due_on<now&&!t.is_done||taskScope==='upcoming'&&t.due_on&&t.due_on>now&&!t.is_done;
 }).sort((a,b)=>Number(a.is_done)-Number(b.is_done)||(a.due_on||'9999').localeCompare(b.due_on||'9999'));
 return pageHeader('待办','可以跨事件搜索、按到期时间整理两个人的任务。',button(ic('plus')+' 新建任务','newTask','primary'))+
 `<div class="task-tools"><div class="search-field">${ic('search')}<input class="input" id="taskSearch" value="${esc(taskSearch)}" placeholder="搜索任务或事件"></div><div class="task-filters">${[['all','全部'],['mine','我负责'],['today','今天'],['overdue','已逾期'],['upcoming','即将到期']].map(([v,t])=>`<button data-task-scope="${v}" class="${taskScope===v?'active':''}">${t} <small>${counts[v]}</small></button>`).join('')}</div></div>
 <section class="panel panel-pad"><div class="section-head"><h2>待完成 · ${items.filter(t=>!t.is_done).length}</h2><button class="text-link" data-nav="calendar">查看日历</button></div>${items.filter(t=>!t.is_done).map(taskRow).join('')||empty('暂无待办','可以切换筛选条件或新增待办')}</section>
 <section class="panel panel-pad" style="margin-top:18px"><div class="section-head"><h2>已完成 · ${items.filter(t=>t.is_done).length}</h2></div>${items.filter(t=>t.is_done).map(taskRow).join('')||empty('当前筛选中暂无已完成任务','完成后会自动结算积分')}</section>`;
}
function scorePage(){let awards=data.task_awards,h=data.score_history;return pageHeader('积分','每件完成的小事，都会被记下来。')+`<div class="score-grid"><div class="panel score-card"><label>${esc(profile?.nickname||'我')}</label><strong>${score(me.id)}</strong><small>有效积分</small></div><div class="panel score-card"><label>${esc(partner?.nickname||'伴侣')} · 可见事件</label><strong>${partner?score(partner.id):'—'}</strong><small>可查看的任务积分</small></div><div class="panel score-card"><label>当前可见的共同成就</label><strong>${awards.reduce((s,a)=>s+a.points,0)}</strong><small>包括共同任务双方分别计分</small></div></div><div class="panel panel-pad" style="margin-top:20px"><div class="section-head"><h2>积分流水</h2></div>${h.length?h.map(x=>`<div class="score-entry">${miniAvatar(x.user_id)}<div><strong>${esc(displayName(x.user_id))}</strong><div class="muted">${esc(event(x.event_id)?.title||'事件')} · ${fmt(x.at)}</div></div><span class="right">${x.delta>0?'+':''}${x.delta} 分</span></div>`).join(''):empty('没有积分记录','完成任务后会由数据库记录积分')}</div><p class="muted">积分由数据库事务维护。删除或重新打开任务时会撤销对应的有效积分，历史流水仍保留。</p>`}
function profilePage(){const bound=!!workspace.partner_id;return pageHeader('个人设置','管理个人资料、情侣关系与账户安全。')+`<div class="profile-layout"><section class="panel profile-identity"><div class="profile-identity-main">${miniAvatar(me.id)}<div class="profile-identity-text"><strong>${esc(profile?.nickname||'我')}</strong><p class="muted">${esc(me.email||'')}</p><span class="profile-subtitle">个人账号 · 已登录</span></div></div><button class="btn profile-edit" data-act="editProfile">${ic('edit')} 编辑资料</button></section><section class="panel profile-section"><div class="profile-section-head"><div><h2>情侣空间</h2><p>与另一半一起记录计划、笔记和待办事项。</p></div><span class="profile-status ${bound?'is-bound':''}">${bound?'已绑定':'未绑定'}</span></div>${bound?`<div class="profile-partner">${miniAvatar(workspace.partner_id)}<div><strong>${esc(partner?.nickname||'伴侣')}</strong><small>已加入你们的共同空间</small></div></div><div class="profile-actions"><button class="btn" data-act="coupleInfo">${ic('people')} 查看情侣关系</button><button class="btn danger" data-act="unbind">解除绑定</button></div>`:`<div class="profile-actions"><button class="profile-action-tile" data-act="inviteCouple">${ic('key')}<strong>生成邀请码</strong><small>邀请另一半加入</small>${ic('chevron')}</button><button class="profile-action-tile" data-act="joinCouple">${ic('people')}<strong>输入邀请码</strong><small>加入对方的情侣空间</small>${ic('chevron')}</button></div>`}</section><section class="panel profile-section profile-menu"><div class="profile-section-head"><div><h2>数据与账户</h2><p>查看记录、同步数据和管理登录状态。</p></div></div><button class="settings-line" data-nav="calendar">${ic('calendar')}<span class="settings-copy"><strong>日历与纪念日</strong><small>事件日期、任务截止日和提醒</small></span><span class="last">${ic('chevron')}</span></button><button class="settings-line" data-nav="memories">${ic('heart')}<span class="settings-copy"><strong>我们的回忆册</strong><small>完成的计划、照片与笔记</small></span><span class="last">${ic('chevron')}</span></button><button class="settings-line" data-nav="score">${ic('coin')}<span class="settings-copy"><strong>积分记录</strong><small>查看积分与历史流水</small></span><span class="last">${ic('chevron')}</span></button><button class="settings-line" data-nav="trash">${ic('trash')}<span class="settings-copy"><strong>回收站</strong><small>恢复最近删除的事件、笔记与待办</small></span><span class="last">${ic('chevron')}</span></button><button class="settings-line" data-nav="archives">${ic('archive')}<span class="settings-copy"><strong>只读档案</strong><small>查看解绑后保留的历史记录</small></span><span class="last">${ic('chevron')}</span></button><button class="settings-line" data-act="refresh">${ic('clock')}<span class="settings-copy"><strong>手动同步</strong><small>立即检查云端最新数据</small></span><span class="last">${ic('chevron')}</span></button><button class="settings-line" data-act="signOut">${ic('exit')}<span class="settings-copy"><strong>退出登录</strong><small>结束当前设备的登录会话</small></span><span class="last">${ic('chevron')}</span></button></section><p class="profile-privacy">个人资料和共享内容均需经过服务器权限校验。</p></div>`}
function notificationsPage(){const reminders=upcomingReminders();return pageHeader('消息通知','协作消息来自云端；日程提醒根据当前日期实时计算。',button('全部已读','readAll'))+
 `<section class="panel panel-pad"><div class="section-head"><h2>日程提醒 · ${reminders.length}</h2><button class="text-link" data-nav="calendar">打开日历</button></div>${reminders.length?reminders.map(reminderRow).join(''):empty('近期没有提醒','给事件设置日期或给任务设置截止日，即可自动出现提醒')}</section>
 <section class="panel panel-pad" style="margin-top:18px"><div class="section-head"><h2>协作消息</h2></div>${data.notifications.length?data.notifications.map(n=>`<button class="message-row ${n.is_read?'':'unread'}" data-message="${n.id}" data-event="${n.event_id}"><div>${miniAvatar(n.actor_id)}</div><div class="message-copy"><strong>${esc(displayName(n.actor_id))} · ${esc(n.text)}</strong><small>${fmt(n.updated_at)}</small></div>${!n.is_read?'<span class="message-dot"></span>':''}</button>`).join(''):empty('暂无协作消息','伴侣更新共享计划时，通知会出现在这里')}</section>
 <p class="muted">日程提醒只在打开网站时显示，不会自动发送短信、邮件或系统推送；「全部已读」只针对协作消息。</p>`}
function trashPage(){const cutoff=Date.now()-30*864e5;const entries=[...data.notes.filter(x=>x.deleted_at).map(x=>({...x,_trashType:'notes'})),...data.tasks.filter(x=>x.deleted_at).map(x=>({...x,_trashType:'tasks'})),...data.events.filter(x=>x.deleted_at).map(x=>({...x,_trashType:'events'}))].filter(x=>new Date(x.deleted_at).getTime()>=cutoff).sort((a,b)=>new Date(b.deleted_at)-new Date(a.deleted_at));return pageHeader('回收站','删除后保留 30 天，期间可恢复。')+`<div class="panel panel-pad">${entries.length?entries.map(x=>`<div class="trash-row"><div><strong>${esc(x.title)}</strong><small>${{notes:'笔记',tasks:'任务',events:'事件'}[x._trashType]} · 删除于 ${fmt(x.deleted_at)}</small></div><button class="btn small" data-act="restore" data-id="${x.id}" data-type="${x._trashType}">恢复</button></div>`).join(''):empty('回收站为空','删除后的事件、笔记和任务会暂时保留在这里')}</div><p class="muted">超过 30 天的内容不能恢复。物理清理计划见部署说明。</p>`}
function archivesPage(){const ar=data.archived_copies;return pageHeader('只读档案','解绑后的共同事件只读副本，双方不再同步。')+`<div class="panel panel-pad">${ar.length?ar.map(a=>`<div class="archive-row"><div><strong>${esc(a.snapshot?.event?.title||'历史事件')}</strong><small>${fmt(a.created_at)} · 只读</small></div><button class="btn small" data-act="viewArchive" data-id="${a.id}">查看副本</button></div>`).join(''):empty('暂无只读档案','如果将来解除情侣关系，共同记录会保存为双方各自的只读副本')}</div>`}
function stripMarkup(html){const d=document.createElement('div');d.textContent='';d.innerHTML=sanitize(html);return d.textContent||''}
// Strict allowlist. No event handlers, CSS, iframe, arbitrary URLs or SVG.
function sanitize(html){const tmp=document.createElement('template');tmp.innerHTML=String(html||'');const allowed=new Set(['P','H2','H3','STRONG','EM','B','I','UL','OL','LI','BLOCKQUOTE','A','BR','DIV','IMG']);
 function clean(node){for(const ch of [...node.childNodes]){if(ch.nodeType===8){ch.remove();continue}if(ch.nodeType===3)continue;if(ch.nodeType!==1){ch.remove();continue}const tag=ch.tagName;if(!allowed.has(tag)){const str=document.createTextNode(ch.textContent||'');ch.replaceWith(str);continue}const originalHref=tag==='A'?nodeHref(ch):'';const originalPath=tag==='IMG'?nodeImagePath(ch):'';for(const at of [...ch.attributes])ch.removeAttribute(at.name);if(tag==='A'){if(originalHref)ch.setAttribute('href',originalHref);ch.setAttribute('rel','noreferrer noopener');ch.setAttribute('target','_blank')}if(tag==='IMG'){if(originalPath)ch.setAttribute('data-asset',originalPath);else{ch.remove();continue}}clean(ch)}}
 // capture attributes before stripping using a prepass map, since sanitize removes them.
 function nodeHref(ch){const h=ch.getAttribute('href')||'';return /^https:\/\//i.test(h)?h.slice(0,1500):''}
 function nodeImagePath(ch){const x=ch.getAttribute('data-asset')||'';return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/.test(x)?x:''}
 clean(tmp.content);return tmp.innerHTML}
// Modal actions and app behavior continue below.
let modalSubmit=null;
function modal(title,fields,submit='确认',handler=null,wide=false){modalSubmit=handler;el('modalLayer').innerHTML=`<div class="dialog-backdrop" data-close="1"><div class="dialog ${wide?'dialog-wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dialog-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close="1" aria-label="关闭">×</button></div><form name="modal-form"><div class="dialog-body">${fields}</div><div class="dialog-actions"><button type="button" class="btn" data-close="1">取消</button>${handler?`<button type="submit" class="btn primary" id="modalSubmit">${esc(submit)}</button>`:''}</div></form></div></div>`}
function closeModal(){el('modalLayer').innerHTML='';modalSubmit=null}
function field(label,name,value='',type='text',extra=''){return `<div class="field"><label>${label}</label><input class="input" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`}
function textarea(label,name,value=''){return `<div class="field"><label>${label}</label><textarea class="textarea" name="${name}">${esc(value)}</textarea></div>`}
function eventForm(existing=false){const x=existing?event(currentEvent):null;const allowed=!!workspace.couple_id;
 modal(existing?'编辑事件':'新建事件',(existing?'':'<div class="field"><button type="button" class="btn soft" data-act="fillDisney">套用标准事件：迪士尼之旅</button></div>')+field('事件名称','title',x?.title||'','text','maxlength="100" required')+textarea('描述','description',x?.description||'')+field('计划日期 / 纪念日（可选）','event_date',x?.event_date||'','date')+`<label class="field checkbox-field"><input type="checkbox" name="anniversary_yearly" ${x?.anniversary_yearly?'checked':''}> 每年重复提醒（纪念日）</label><div class="field"><label>共享方式</label><select name="visibility" class="select full-btn" ${existing?'disabled':''}><option value="private" ${x?.visibility==='private'?'selected':''}>私有，仅自己可见</option><option value="shared" ${x?.visibility==='shared'?'selected':''} ${!allowed?'disabled':''}>自动共享给情侣</option><option value="invite" ${x?.visibility==='invite'?'selected':''} ${!allowed?'disabled':''}>邀请码解锁</option></select>${!allowed?'<small>需要先绑定情侣才能选择共享事件。</small>':''}</div><div class="field"><label>系统封面</label><select name="cover_theme" class="select full-btn">${themes.map(c=>`<option value="${c}" ${x?.cover_theme===c?'selected':''}>${{sage:'浅青绿',sunset:'柔和暖粉',sand:'米杏',lilac:'淡紫灰',navy:'蓝灰'}[c]}</option>`).join('')}</select></div><div class="field"><label>上传封面（可选，最大 3MB）</label><input class="input" type="file" name="cover" accept="image/png,image/jpeg,image/webp"></div>`,existing?'保存修改':'创建事件',async f=>{
 const title=String(f.get('title')||'').trim(),description=String(f.get('description')||'').trim(),visibility=x?.visibility||String(f.get('visibility'));
  const event_date=String(f.get('event_date')||'')||null,anniversary_yearly=f.has('anniversary_yearly');
  if(anniversary_yearly&&!event_date)throw Error('每年重复的纪念日需要填写日期');
 if(!title)throw Error('请填写事件名称');if(description.length>1500)throw Error('描述最多 1500 字');
 let e;if(x)e=await patch('events',x.id,{title,description,event_date,anniversary_yearly,cover_theme:String(f.get('cover_theme'))});
 else e=await put('events',{owner_id:me.id,couple_id:visibility==='private'?null:workspace.couple_id,visibility,title,description,event_date,anniversary_yearly,cover_theme:String(f.get('cover_theme'))});
 const file=f.get('cover');if(file?.size){const path=await uploadAsset(e.id,file);e=await patch('events',e.id,{cover_path:path})}
 currentEvent=e.id;route='detail';tab='tasks';await loadAll();tell(existing?'事件已更新':'事件已创建');
 });}
function taskForm(id){const t=id?data.tasks.find(x=>x.id===id):null;let eid=t?.event_id||currentEvent||activeEvents()[0]?.id;
 if(!eid){tell('请先创建一个事件');return}const e=event(eid);if(!e)return;
 const chooseEvents=activeEvents().map(x=>`<option value="${x.id}" ${x.id===eid?'selected':''}>${esc(x.title)}</option>`).join('');
 const canBoth=e.visibility==='shared'&&!!workspace.partner_id || e.visibility==='invite'&&data.event_members.some(m=>m.event_id===e.id&&m.user_id===workspace.partner_id);
 const assignees=[{id:me.id,name:displayName(me.id)},...(workspace.partner_id&&canBoth?[{id:workspace.partner_id,name:displayName(workspace.partner_id)}]:[]),...(canBoth?[{id:'both',name:'两人共同'}]:[])];
 const selected=t?(t.assignee_id||'both'):me.id;
 modal(t?'编辑待办':'新增待办',`<div class="field"><label>所属事件</label><select class="select full-btn" name="event_id" ${t?'disabled':''}>${chooseEvents}</select></div>`+field('任务名称','title',t?.title||'','text','maxlength="120" required')+`<div class="two-cols"><div class="field"><label>负责人</label><select class="select full-btn" name="assignee_id">${assignees.map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>${field('任务积分','points',t?.points??10,'number','min="0" max="100" step="1" required')}</div>`+field('截止日期（可选）','due_on',t?.due_on||'','date')+(t?`<div class="notice">已完成任务需要先取消完成状态，才能修改负责人和积分。</div><button type="button" class="btn danger small" data-act="trashTask" data-id="${t.id}">移入回收站</button>`:''),t?'保存任务':'创建任务',async f=>{
 const title=String(f.get('title')||'').trim(),points=Number(f.get('points')),assignee=String(f.get('assignee_id'));
 if(!title||!Number.isInteger(points)||points<0||points>100)throw Error('检查任务名称和 0–100 的整数积分');
 const payload={title,points,assignee_id:assignee==='both'?null:assignee,due_on:f.get('due_on')||null};
 if(t)await patch('tasks',t.id,payload,t.version);else await put('tasks',{event_id:String(f.get('event_id')||eid),...payload,created_by:me.id});
 await loadAll();tell('待办已保存');
 });}
async function updateTaskDone(id,done){const t=data.tasks.find(x=>x.id===id);if(!t)return;await patch('tasks',t.id,{is_done:done},t.version);await loadAll(true);render();tell(done?'任务已完成，积分已结算':'已撤销完成状态和对应积分')}
async function newNote(){const e=event(currentEvent)||activeEvents()[0];if(!e){tell('请先创建事件');return}const n=await put('notes',{event_id:e.id,title:'未命名笔记',body:'',created_by:me.id});editingNote=n.id;currentEvent=e.id;route='note';await loadAll(true);render()}
async function saveNote(){const n=data.notes.find(x=>x.id===editingNote),title=el('noteTitle')?.value.trim()||'未命名笔记',editor=el('noteEditor');if(!n||!editor)return;
 if(editor.dataset.saving==='1')return;const html=sanitize(editor.innerHTML);if(html.length>120000)throw Error('笔记内容超出长度限制');if(title.length>120)throw Error('标题不能超过 120 字');
 if(n.title===title&&n.body===html){editor.dataset.dirty='0';el('saveHint').textContent='已同步至云端';return}
 editor.dataset.saving='1';el('saveHint').textContent='正在保存到云端';
 try{const updated=await patch('notes',n.id,{title,body:html},n.version);Object.assign(n,updated);if(sanitize(editor.innerHTML)===html&&el('noteTitle')?.value.trim()===title){editor.dataset.dirty='0';el('saveHint').textContent='已同步至云端 · '+fmt(updated.updated_at)}else{editor.dataset.dirty='1';el('saveHint').textContent='编辑过程中出现新修改，正在再次保存';clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNote().catch(()=>{}),1400)}}
 catch(e){el('saveHint').textContent='保存失败：'+errorOf(e);tell(errorOf(e));throw e}
 finally{editor.dataset.saving='0'}
}
function updateSaveHint(){const hint=el('saveHint');if(hint&&syncNotice)hint.textContent='同步提示：'+syncNotice}
function updateIndicators(){const unread=data.notifications.some(x=>!x.is_read);el('unreadDot')?.classList.toggle('show',unread)}
async function updateNotePin(id){const n=data.notes.find(x=>x.id===id);if(n){await patch('notes',id,{pinned:!n.pinned},n.version);await loadAll();tell(!n.pinned?'已置顶':'已取消置顶')}}
function confirmModal(title,text,onConfirm,accept='确认'){modal(title,`<p style="line-height:1.85;color:#65776a">${esc(text)}</p>`,accept,onConfirm)}
function trashItem(type,id){const t=data[type]?.find(x=>x.id===id);if(!t)return;confirmModal('移入回收站',`确定删除「${t.title}」吗？30 天内可恢复。${type==='tasks'&&t.is_done?'该任务积分将同步撤销。':''}`,async()=>{await patch(type,id,{deleted_at:new Date().toISOString()},t.version);if(type==='notes'&&route==='note'){route='detail';editingNote=null}if(type==='events'){route='events';eventView='active';currentEvent=null}await loadAll();tell('已移入回收站')},'确认移入')}
function restoreItem(type,id){const t=data[type]?.find(x=>x.id===id);if(!t)return;confirmModal('恢复内容',`将「${t.title}」从回收站恢复到原事件。`,async()=>{if(type!=='events'&&data.events.find(e=>e.id===t.event_id)?.deleted_at)throw Error('请先恢复所属事件');await patch(type,id,{deleted_at:null},t.version);await loadAll();tell('已恢复')},'恢复')}
function bindingInvite(){modal('生成情侣邀请码','<p class="muted">邀请码有效期为 24 小时，仅用于两个已注册的账号建立情侣关系。</p>','生成邀请码',async()=>{const code=await rpc('create_couple_invite');closeModal();showCode('情侣绑定邀请码',code,'24 小时有效。请通过安全方式分享给另一方。')})}
function showCode(title,code,description){modal(title,`<div class="share-code mono">${esc(code)}</div><p class="muted">${esc(description)}</p><button type="button" class="btn" data-copy="${esc(code)}">${ic('book')} 复制邀请码</button>`,'关闭',async()=>{})}
function joinForm(isCouple){modal(isCouple?'绑定情侣':'加入事件',field('邀请码','code','','text','maxlength="24" minlength="24" required autocomplete="off"')+`<p class="field-hint">请输入对方发来的 24 位邀请码。</p>`,'确认',async f=>{const code=String(f.get('code')||'').trim();if(!/^[0-9A-Fa-f]{24}$/.test(code))throw Error('邀请码应为 24 位字符');
 const eid=await rpc(isCouple?'accept_couple_invite':'accept_event_invite',{p_code:code});if(!isCouple&&eid){currentEvent=eid;route='detail'}await loadAll();tell(isCouple?'情侣绑定成功':'事件已解锁')})}
function unbind(){confirmModal('解除情侣绑定','解绑后，双方各自保留已经有权限查看的共同事件只读副本；历史共享停止同步，旧邀请码将失效。该操作不可逆，请确认。',async()=>{await rpc('unbind_couple');route='archives';currentEvent=null;await loadAll();tell('已解除绑定，共同记录已保存为只读副本')},'确认解绑')}
function visibilityForm(){const e=event(currentEvent);if(!e||e.owner_id!==me.id)return;tell('修改权限将立即影响对方的访问资格');modal('修改事件共享方式',`<div class="field"><label>选择新的访问方式</label><select name="visibility" class="select full-btn"><option value="private" ${e.visibility==='private'?'selected':''}>私有</option><option value="shared" ${e.visibility==='shared'?'selected':''} ${!workspace.couple_id?'disabled':''}>自动共享</option><option value="invite" ${e.visibility==='invite'?'selected':''} ${!workspace.couple_id?'disabled':''}>邀请码解锁</option></select></div><div class="notice warn">改变共享方式会撤销之前的邀请或授权；对方可能立即失去访问资格。请确保已确认。</div>`,'确认修改',async f=>{await rpc('set_event_visibility',{p_event:e.id,p_visibility:String(f.get('visibility'))});await loadAll();tell('访问权限已更新')})}
function archiveView(id){const archive=data.archived_copies.find(x=>x.id===id);if(!archive)return;const s=archive.snapshot,e=s?.event||{},tasks=s?.tasks||[],notes=s?.notes||[];
 modal('只读副本：'+(e.title||'事件'),`<p class="muted">归档时间：${fmt(archive.created_at)} · 与原情侣账号停止同步</p><p>${esc(e.description||'')}</p><h3>任务（${tasks.length}）</h3>${tasks.map(t=>`<div class="archive-row">${t.is_done?'已完成':'待完成'} · ${esc(t.title)} · ${t.points} 分</div>`).join('')||'<p class="muted">无任务</p>'}<h3>笔记（${notes.length}）</h3>${notes.map(n=>`<details class="archive-note"><summary>${esc(n.title)}</summary><div>${sanitize(n.body||'')}</div></details>`).join('')||'<p class="muted">无笔记</p>'}`,null,null,true);hydrateAssets()}
function forceReadAll(){return Promise.all(data.notifications.filter(n=>!n.is_read).map(n=>fetchJSON(`/rest/v1/notifications?id=eq.${n.id}`,{method:'PATCH',body:{is_read:true}}))).then(()=>loadAll())}
async function uploadAsset(eventId,file){if(!file||!file.size)throw Error('请选择图片');if(file.size>3*1024*1024)throw Error('图片不能超过 3MB');
 const ext=({"image/jpeg":"jpg","image/png":"png","image/webp":"webp"})[file.type];if(!ext)throw Error('仅支持 JPG、PNG 或 WebP 图片');
 const uuid=crypto.randomUUID();const path=`${eventId}/${uuid}.${ext}`;
 const response=await fetch(apiURL(`/storage/v1/object/couple-private/${path}`),{method:'POST',headers:{...sessionHeaders(),'content-type':file.type,'cache-control':'3600','x-upsert':'false'},body:file});
 if(response.status===401){await refreshSession();throw Error('登录凭证刚更新，请重试上传')}
 if(!response.ok){const j=await response.json().catch(()=>({}));throw Error(j.message||'图片上传失败')}
 return path;
}
async function assetURL(path){if(blobs.has(path))return blobs.get(path);const response=await fetch(apiURL(`/storage/v1/object/authenticated/couple-private/${path}`),{headers:sessionHeaders(),cache:'no-store'});if(!response.ok)throw Error('图片暂不可访问');const obj=URL.createObjectURL(await response.blob());blobs.set(path,obj);return obj}
function hydrateAssets(){for(const image of document.querySelectorAll('img[data-asset]')){const path=image.dataset.asset;assetURL(path).then(src=>{if(image.isConnected)image.src=src}).catch(()=>{image.alt='图片暂不可访问'})}}
function formatEditor(cmd){const e=el('noteEditor');if(!e)return;if(cmd==='createLink'){const href=prompt('请输入 HTTPS 链接');if(href&&/^https:\/\//i.test(href))document.execCommand('createLink',false,href)}else document.execCommand(cmd,false,null);e.dataset.dirty='1';updateDirty()}
function updateDirty(){const hint=el('saveHint');if(hint)hint.textContent='存在未保存的修改';clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNote().catch(()=>{}),1400)}
function imageToNote(){const inp=document.createElement('input');inp.type='file';inp.accept='image/jpeg,image/png,image/webp';inp.onchange=async()=>{try{const n=data.notes.find(x=>x.id===editingNote);if(!n)return;const path=await uploadAsset(n.event_id,inp.files[0]);const node=el('noteEditor');node.focus();document.execCommand('insertHTML',false,`<img data-asset="${esc(path)}" alt="笔记图片">`);node.dataset.dirty='1';const img=node.querySelector(`img[data-asset="${path}"]`);if(img)img.src=await assetURL(path);await saveNote();tell('图片已上传')}catch(e){tell(errorOf(e))}};inp.click()}
async function action(kind,id){switch(kind){
 case 'newEvent':return eventForm();case 'editEvent':return eventForm(true);
 case 'fillDisney':{const f=document.querySelector('form[name=modal-form]');if(f){f.elements.title.value='迪士尼之旅';f.elements.description.value='一起规划我们的第一次迪士尼旅行 ✨';if(workspace.couple_id)f.elements.visibility.value='shared';f.elements.cover_theme.value='sage'}return;}
 case 'newTask':return taskForm();case 'taskEdit':return taskForm(id);
 case 'newNote':return newNote();case 'saveNote':return saveNote();case 'backNote':await saveNote();currentEvent=data.notes.find(x=>x.id===editingNote)?.event_id;tab='notes';editingNote=null;return go('detail');
 case 'backDetail':return go('events');case 'backEvents':return go('events');case 'noteImage':return imageToNote();
 case 'viewEventCover':{const e=event(currentEvent);if(e?.cover_path)photoPreview(e.cover_path,e.title+' · 完整封面');return}
 case 'viewNotePhotos':{const n=data.notes.find(x=>x.id===editingNote);const paths=notePhotoPaths(n);if(paths.length)photoPreview(paths[0],(n?.title||'笔记')+' · 照片',paths);else tell('当前笔记没有已上传的照片');return}
 case 'pinNote':return updateNotePin(id);case 'trashNote':return trashItem('notes',editingNote);case 'trashTask':closeModal();return trashItem('tasks',id);
 case 'restore':return restoreItem(document.querySelector(`[data-act="restore"][data-id="${id}"]`)?.dataset.type,id);
 case 'joinEvent':return joinForm(false);case 'inviteCouple':return bindingInvite();case 'joinCouple':return joinForm(true);
 case 'coupleInfo':return modal('情侣空间',`<p>你和 ${esc(partner?.nickname||'伴侣')} 已绑定。</p><p class="muted">已绑定的双方有权管理已经共享的事件，但各自的私有事件仍然独立。</p>`,'关闭',async()=>{});
 case 'eventInvite':{const code=await rpc('create_event_invite',{p_event:currentEvent});return showCode('事件邀请码',code,'72 小时有效，使用一次后失效')}
 case 'visibility':return visibilityForm();case 'unbind':return unbind();
  case 'retryBoot':return boot();
  case 'refresh':await loadAll();return tell(syncNotice?'同步仍未完成，请检查网络':'已刷新云端数据');
 case 'signOut':return confirmModal('退出登录','退出当前设备的账号吗？',signOut,'退出');
 case 'editProfile':return modal('修改昵称',field('昵称','nickname',profile?.nickname||'','text','maxlength="24" required'),'保存',async f=>{const nickname=String(f.get('nickname')||'').trim();if(!nickname)throw Error('请输入昵称');await fetchJSON(`/rest/v1/profiles?id=eq.${me.id}`,{method:'PATCH',body:{nickname}});await loadAll();tell('昵称已更新')});
 case 'openMemories':return go('memories');
  case 'pinEvent':{const e=event(currentEvent);if(!e||e.deleted_at)return;const wasPinned=!!e.pinned;await patch('events',e.id,{pinned:!wasPinned});await loadAll();tell(wasPinned?'已取消置顶':'已置顶事件');return}
  case 'trashEvent':return trashItem('events',currentEvent);
 case 'archiveEvent':case 'unarchiveEvent':{const e=event(currentEvent);if(!e)return;const to=kind==='archiveEvent'?'archived':'active';return confirmModal(kind==='archiveEvent'?'归档事件':'重新开启','归档后内容只读，重新开启后可以继续编辑。',async()=>{await patch('events',e.id,{status:to});await loadAll();tell('事件状态已更新')})}
 case 'readAll':await forceReadAll();tell('全部消息已读');return;
 case 'resetPassword':{const email=prompt('请输入注册邮箱');if(email&&email.includes('@')){await fetchJSON('/auth/v1/recover?redirect_to='+enc(location.origin+location.pathname),{method:'POST',body:{email},auth:false});tell('如邮箱已注册，将收到密码重置邮件')}}return;
 case 'changePassword':return modal('设置新密码',field('新密码','newpass','','password','required minlength=8 autocomplete=new-password'),'更新密码',async f=>{await fetchJSON('/auth/v1/user',{method:'PUT',body:{password:String(f.get('newpass'))}});tell('密码已更新，请妥善保存')});
 case 'viewArchive':return archiveView(id);
 }}
let authMode='login';
document.addEventListener('click',async ev=>{try{
  if(ev.target.closest('[data-close-photo]')){closePhotoPreview();return}
  if(ev.target.matches('[data-photo-backdrop]')){closePhotoPreview();return}
  const step=ev.target.closest('[data-photo-step]');if(step){stepPhotoPreview(Number(step.dataset.photoStep));return}
  const image=ev.target.closest('.event-cover-large img[data-asset], .memory-photos img[data-asset], .archive-note img[data-asset], .editor-surface[contenteditable="false"] img[data-asset]');
  if(image){const group=image.closest('.memory-photos,.archive-note,.editor-surface');
    const paths=group?[...group.querySelectorAll('img[data-asset]')].map(x=>x.dataset.asset):[image.dataset.asset];
    photoPreview(image.dataset.asset,image.alt||'照片',paths);return}
 const dismiss=ev.target.closest('[data-close]');if(dismiss&&(ev.target===dismiss||dismiss.tagName==='BUTTON')){closeModal();return}
 const link=ev.target.closest('[data-copy]');if(link){await navigator.clipboard.writeText(link.dataset.copy);tell('已复制邀请码');return}
 const fmt=ev.target.closest('[data-format]');if(fmt){formatEditor(fmt.dataset.format);return}
 const mode=ev.target.closest('[data-authmode]');if(mode){authMode=mode.dataset.authmode;el('authNameField').hidden=authMode!=='signup';el('authSubmit').textContent=authMode==='signup'?'注册':'登录';el('authLoginTab').classList.toggle('active',authMode==='login');el('authSignupTab').classList.toggle('active',authMode==='signup');return}
 const calNav=ev.target.closest('[data-calendar-nav]');if(calNav){const v=calNav.dataset.calendarNav;if(v==='today'){calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);selectedDay=todayKey()}else{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+Number(v),1);selectedDay=localDay(calendarMonth)}render();return}
  const day=ev.target.closest('[data-day]');if(day){selectedDay=day.dataset.day;const dt=new Date(selectedDay+'T12:00:00');calendarMonth=new Date(dt.getFullYear(),dt.getMonth(),1);render();return}
  const scoped=ev.target.closest('[data-task-scope]');if(scoped){taskScope=scoped.dataset.taskScope;render();return}
  const memory=ev.target.closest('[data-memory-filter]');if(memory){memoryFilter=memory.dataset.memoryFilter;render();return}
  const viewBtn=ev.target.closest('[data-eventview]');if(viewBtn){eventView=viewBtn.dataset.eventview;render();return}
 const tabBtn=ev.target.closest('[data-tab]');if(tabBtn){tab=tabBtn.dataset.tab;render();return}
 const message=ev.target.closest('[data-message]');if(message){const n=data.notifications.find(x=>String(x.id)===message.dataset.message);if(n){await fetchJSON(`/rest/v1/notifications?id=eq.${n.id}`,{method:'PATCH',body:{is_read:true}});currentEvent=n.event_id;tab='activity';await loadAll(true);nav('detail')}return}
 const act=ev.target.closest('[data-act]');if(act){await action(act.dataset.act,act.dataset.id);return}
 const n=ev.target.closest('[data-nav]');if(n){go(n.dataset.nav);return}
 const e=ev.target.closest('[data-event]');if(e){currentEvent=e.dataset.event;tab='tasks';go('detail');return}
 const note=ev.target.closest('[data-note]');if(note){editingNote=note.dataset.note;go('note');return}
 }catch(e){tell(errorOf(e))}});
document.addEventListener('dblclick',ev=>{
 const image=ev.target.closest('.editor-surface[contenteditable="true"] img[data-asset]');
 if(image){ev.preventDefault();const group=image.closest('.editor-surface');photoPreview(image.dataset.asset,'笔记照片',[...group.querySelectorAll('img[data-asset]')].map(x=>x.dataset.asset))}
});
document.addEventListener('keydown',ev=>{
 if(!el('photoLayer')?.firstElementChild)return;
 if(ev.key==='Escape'){ev.preventDefault();closePhotoPreview()}
 else if(ev.key==='ArrowLeft'){ev.preventDefault();stepPhotoPreview(-1)}
 else if(ev.key==='ArrowRight'){ev.preventDefault();stepPhotoPreview(1)}
});
document.addEventListener('change',async ev=>{try{const t=ev.target;if(t.matches('[data-done]')){await updateTaskDone(t.dataset.done,t.checked);return}if(t.id==='eventFilter'){filter=t.value;render()}}catch(e){tell(errorOf(e));await loadAll(true);render()}});
document.addEventListener('input',ev=>{if(ev.target.id==='eventSearch'){search=ev.target.value;const pos=ev.target.selectionStart;render();const n=el('eventSearch');n?.focus();n?.setSelectionRange(pos,pos)}
 if(ev.target.id==='taskSearch'){taskSearch=ev.target.value;const pos=ev.target.selectionStart;render();const n=el('taskSearch');n?.focus();n?.setSelectionRange(pos,pos)}if(ev.target.id==='noteTitle'||ev.target.id==='noteEditor'){const editor=el('noteEditor');if(editor)editor.dataset.dirty='1';updateDirty()}});
document.addEventListener('submit',async ev=>{if(ev.target.id==='authForm'){ev.preventDefault();const form=new FormData(ev.target);const btn=el('authSubmit');btn.disabled=true;try{const email=String(form.get('email')).trim(),password=String(form.get('password'));if(authMode==='signup')await signUp(email,password,String(form.get('nickname')||'新用户').trim());else await signIn(email,password)}catch(e){tell(errorOf(e))}finally{if(btn.isConnected)btn.disabled=false}return}
 if(ev.target.name==='modal-form'){ev.preventDefault();if(!modalSubmit)return;const handler=modalSubmit,btn=el('modalSubmit');if(btn)btn.disabled=true;try{await handler(new FormData(ev.target));if(modalSubmit===handler)closeModal()}catch(e){tell(errorOf(e));if(btn?.isConnected)btn.disabled=false}}});
window.addEventListener('storage',e=>{if(e.key==='olp_session_v2'){session=e.newValue?JSON.parse(e.newValue):null;boot()}});
window.addEventListener('online',()=>{if(session?.access_token){if(connection())loadAll(true);else boot()}});
window.addEventListener('offline',()=>{syncNotice='设备已离线，恢复网络后可重试';if(connection()&&route!=='note')render()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&connection()&&route!=='note')loadAll(true)});
window.addEventListener('beforeunload',()=>{for(const v of blobs.values())URL.revokeObjectURL(v)});
async function boot(){render();if(!configured)return;let recovery=false;const h=new URLSearchParams(location.hash.slice(1));if(h.get('access_token')&&h.get('refresh_token')){recovery=h.get('type')==='recovery';setSession({access_token:h.get('access_token'),refresh_token:h.get('refresh_token'),expires_at:Math.floor(Date.now()/1000)+Number(h.get('expires_in')||3600)});history.replaceState(null,'',location.pathname+location.search)}else{try{session=JSON.parse(localStorage.getItem('olp_session_v2')||'null')}catch{session=null}}
 if(!session){render();return}try{if(session.expires_at&&session.expires_at<Date.now()/1000+60)await refreshSession();me=await authUser();await loadAll();}catch(e){
  const reason=errorOf(e);
  if(/网络连接失败|连接超时|Upstream connection failed|Load failed|Failed to fetch/i.test(reason)){
    me=null;syncNotice=reason;tell('暂时无法连接，登录信息已保留，请重试');
  }else{setSession(null);me=null;tell('请重新登录：'+reason)}
 }render();if(recovery&&connection())action('changePassword').catch(e=>tell(errorOf(e)));clearInterval(pollTimer);pollTimer=setInterval(()=>{if(connection()&&!document.hidden&&!el('modalSubmit')&&route!=='note')loadAll(true)},Math.max(15000,Number(C.syncIntervalMs)||30000))}
boot();
})();
