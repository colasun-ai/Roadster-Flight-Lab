import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import R from '@dimforge/rapier3d-compat';
import {RoadNetwork,at} from '../../src/fsd/RoadNetwork.js';
import {TrafficSystem,overlaps} from '../../src/fsd/TrafficSystem.js';
await R.init();
const results=[];
for(const seed of [20261122,923475,712991]){
 const net=new RoadNetwork(),world=new R.World({x:0,y:0,z:0}),t=new TrafficSystem(net,world,20,seed);
 const roads=net.roads.filter(l=>l.to.id==='0:0');
 const waits=new Float32Array(20);let maxWait=0,contacts=0,maxStep=0,failed=null;
 const crossed=new Set(),entering=new Set();
 for(const [i,a] of t.actors.entries()){
  const lane=roads[i%roads.length],s=lane.length-4-Math.floor(i/roads.length)*8;
  const turn=net.lanes.get(lane.next[(i+seed)%lane.next.length]),goal=turn.next[0];
  Object.assign(a,{lane,s,speed:0,route:[lane.id,turn.id,goal],routeIndex:0,destination:goal,...at(lane,s)});
 }
 for(let i=0;i<120*150;i++){
  const last=t.actors.map(a=>[a.x,a.z]);
  t.step(1/120,null);
  t.actors.forEach((a,j)=>{
   const d=Math.hypot(last[j][0]-a.x,last[j][1]-a.z);maxStep=Math.max(maxStep,d);
   waits[j]=a.speed<.25?waits[j]+1/120:0;
   if(waits[j]>maxWait){maxWait=waits[j];failed={t:i/120,id:a.id,lane:a.lane.id,route:a.route.slice(a.routeIndex,a.routeIndex+3)};}
   if(a.lane.connector&&a.lane.junction.id==='0:0')entering.add(a.id);
   if(entering.has(a.id)&&!a.lane.connector&&a.lane.from.id==='0:0'&&a.s>a.length/2)crossed.add(a.id);
   for(let k=0;k<j;k++)if(Math.hypot(a.x-t.actors[k].x,a.z-t.actors[k].z)<6&&overlaps(a,t.actors[k],-.05))contacts++;
  });
 }
 results.push({seed,cars:20,crossed:crossed.size,contacts,maxStep,maxWait,worst:failed});
 world.free();
}
await fs.writeFile('reports/metro/dense-queue.json',JSON.stringify(results,null,2));console.log(results);
assert.ok(results.every(r=>r.crossed===20&&r.contacts===0&&r.maxWait<80&&r.maxStep<.25));
