export const SIZE=15,MAX_TURNS=180,MAX_LOOKS=80;
export const DIRS={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
const pos=(x,y)=>`${x},${y}`;
function rng(seed){let h=2166136261;for(const c of String(seed)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return()=>{h+=0x6d2b79f5;let t=h;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
export function buildMaze(seed){
 const random=rng(seed),g=Array.from({length:SIZE},()=>Array(SIZE).fill('#')),stack=[[1,1]];g[1][1]='.';
 while(stack.length){
  const [x,y]=stack.at(-1),options=[];
  for(const [dx,dy] of Object.values(DIRS)){const nx=x+dx*2,ny=y+dy*2;if(nx>0&&ny>0&&nx<SIZE-1&&ny<SIZE-1&&g[ny][nx]==='#')options.push([nx,ny,dx,dy]);}
  if(!options.length){stack.pop();continue;}
  const [nx,ny,dx,dy]=options[Math.floor(random()*options.length)];
  g[y+dy][x+dx]='.';g[ny][nx]='.';stack.push([nx,ny]);
 }
 const queue=[[1,1]],seen=new Set(['1,1']),parent=new Map();let end=[1,1];
 for(let i=0;i<queue.length;i++){const [x,y]=queue[i];end=[x,y];for(const [dx,dy] of Object.values(DIRS)){const nx=x+dx,ny=y+dy,k=pos(nx,ny);if(nx<0||ny<0||nx>=SIZE||ny>=SIZE||g[ny][nx]==='#'||seen.has(k))continue;seen.add(k);parent.set(k,pos(x,y));queue.push([nx,ny]);}}
 let path=[],p=pos(...end);while(p){path.push(p.split(',').map(Number));p=parent.get(p);}path.reverse();
 const key=path[Math.max(2,Math.floor(path.length*.27))],door=path[Math.max(4,Math.floor(path.length*.66))],exit=path.at(-1);
 g[key[1]][key[0]]='K';g[door[1]][door[0]]='D';g[exit[1]][exit[0]]='E';g[1][1]='S';
 return g.map(row=>row.join(''));
}
export function mazeDistance(map){
 const queue=[[1,1,0]],seen=new Set(['1,1']);
 for(let i=0;i<queue.length;i++){const [x,y,d]=queue[i];if(map[y][x]==='E')return d;for(const [dx,dy] of Object.values(DIRS)){const nx=x+dx,ny=y+dy,k=pos(nx,ny);if(map[ny]?.[nx]&&map[ny][nx]!=='#'&&!seen.has(k)){seen.add(k);queue.push([nx,ny,d+1]);}}}
 return Infinity;
}
function reveal(s,r){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(Math.abs(dx)+Math.abs(dy)<=r){const x=s.x+dx,y=s.y+dy;if(x>=0&&y>=0&&x<SIZE&&y<SIZE)s.seen[pos(x,y)]=1;}}
export function createState(seed,{targetDistance=null}={}){
 let map=buildMaze(seed);
 if(targetDistance!==null){let found=false;for(let i=0;i<300;i++){const candidate=buildMaze(seed+':v'+i);if(mazeDistance(candidate)===targetDistance){map=candidate;found=true;break;}}if(!found)throw Error('Could not find balanced maze');}
 const s={map,x:1,y:1,hasKey:false,turns:0,looks:0,bumps:0,status:'active',seen:{},events:[{type:'start',x:1,y:1,turn:0}],message:'Ready'};
 reveal(s,1);return s;
}
export const score=s=>s.turns+s.looks*2+s.bumps*2;
export function getPublicState(s,extra={}){
 const visible=s.map.map((row,y)=>[...row].map((tile,x)=>s.seen[pos(x,y)]?tile:'?').join(''));
 visible[s.y]=visible[s.y].slice(0,s.x)+'F'+visible[s.y].slice(s.x+1);
 return {...extra,position:{x:s.x,y:s.y},visible,hasKey:s.hasKey,turns:s.turns,looks:s.looks,bumps:s.bumps,status:s.status,maxTurns:MAX_TURNS,maxLooks:MAX_LOOKS,message:s.message,score:s.status==='won'?score(s):null};
}
export function act(s,action,direction){
 if(s.status!=='active')return{ok:false,code:'GAME_ENDED',message:'This run has ended'};
 if(action==='look'){
  if(s.looks>=MAX_LOOKS)return{ok:false,code:'LOOK_LIMIT',message:'No looks left'};
  s.looks++;reveal(s,2);s.message='Looked around';s.events.push({type:'look',x:s.x,y:s.y,turn:s.turns,look:s.looks});return{ok:true,code:'LOOKED',message:s.message};
 }
 if(action!=='move'||!DIRS[direction])return{ok:false,code:'BAD_DIRECTION',message:'Direction must be up/down/left/right'};
 if(s.turns>=MAX_TURNS)return{ok:false,code:'TURN_LIMIT',message:'No turns left'};
 const [dx,dy]=DIRS[direction],nx=s.x+dx,ny=s.y+dy,tile=s.map[ny]?.[nx]||'#';s.turns++;
 if(tile==='#'||(tile==='D'&&!s.hasKey)){
  s.bumps++;if(nx>=0&&ny>=0&&nx<SIZE&&ny<SIZE)s.seen[pos(nx,ny)]=1;
  s.message=tile==='D'?'The door is locked':'A wall blocks the way';
  s.events.push({type:'bump',x:s.x,y:s.y,direction,reason:tile==='D'?'door':'wall',turn:s.turns});
 }else{
  s.x=nx;s.y=ny;
  s.message=tile==='K'?'Found the golden key':tile==='D'?'Opened the gate':'Moved '+direction;
  if(tile==='K')s.hasKey=true;if(tile==='E'){s.status='won';s.message='Maze cleared';}
  reveal(s,1);s.events.push({type:'move',x:nx,y:ny,key:s.hasKey,direction,turn:s.turns,won:s.status==='won'});
 }
 if(s.turns>=MAX_TURNS&&s.status==='active'){s.status='lost';s.message='Turn limit reached';s.events.push({type:'end',status:'lost',x:s.x,y:s.y,turn:s.turns});}
 return{ok:true,code:s.status==='won'?'WIN':s.status==='lost'?'LOSS':'MOVED',message:s.message};
}
