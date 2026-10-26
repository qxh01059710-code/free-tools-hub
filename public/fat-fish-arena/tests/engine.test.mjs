import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,buildMaze,mazeDistance,getPublicState,act,score} from '../public/shared/engine.mjs';
const moves=[[1,0,'right'],[-1,0,'left'],[0,1,'down'],[0,-1,'up']];
function solvedPath(map){
 const queue=[[1,1]],parent=new Map(),seen=new Set(['1,1']);let end;
 for(let i=0;i<queue.length;i++){
  const [x,y]=queue[i];if(map[y][x]==='E'){end=`${x},${y}`;break;}
  for(const [dx,dy] of moves){const xx=x+dx,yy=y+dy,key=`${xx},${yy}`;if(map[yy]?.[xx]&&map[yy][xx]!=='#'&&!seen.has(key)){seen.add(key);parent.set(key,`${x},${y}`);queue.push([xx,yy]);}}
 }
 const path=[];while(end){path.push(end.split(',').map(Number));end=parent.get(end);}return path.reverse();
}
test('Each unique ranked map has optimal length 72',()=>{
 for(let i=0;i<45;i++){const s=createState('private-test:'+i,{targetDistance:72});assert.equal(mazeDistance(s.map),72);}
 assert.notDeepEqual(createState('private-test:1',{targetDistance:72}).map,createState('private-test:2',{targetDistance:72}).map);
});
test('The key is found before the locked door, then maze can be cleared',()=>{
 const s=createState('ranked',{targetDistance:72}),path=solvedPath(s.map),tiles=path.map(([x,y])=>s.map[y][x]);
 assert.ok(tiles.indexOf('K')<tiles.indexOf('D'));assert.ok(tiles.indexOf('D')<tiles.indexOf('E'));
 for(let i=1;i<path.length;i++){
  const [x,y]=path[i-1],[xx,yy]=path[i],direction=moves.find(([dx,dy])=>x+dx===xx&&y+dy===yy)[2];
  assert.equal(act(s,'move',direction).ok,true);
 }
 assert.equal(s.status,'won');assert.equal(s.turns,72);assert.equal(score(s),72);
 assert.equal(act(s,'move','up').ok,false);
});
test('Fog hides unrevealed positions; walking into a wall is penalized',()=>{
 const s=createState('fog');const view=getPublicState(s);
 assert.equal(view.map,undefined);assert.ok(view.visible.join('').includes('?'));
 const before=score(s);act(s,'move','left');assert.equal(score(s),before+3);
 act(s,'look');assert.equal(s.looks,1);assert.equal(s.bumps,1);
});
