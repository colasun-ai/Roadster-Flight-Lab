import fs from 'node:fs/promises';
import R from '@dimforge/rapier3d-compat';
import {RoadNetwork} from '../../src/fsd/RoadNetwork.js';
import {TrafficSystem,overlaps} from '../../src/fsd/TrafficSystem.js';
await R.init();const count=Number(process.env.FSD_TEST_TRAFFIC||20),records=[];
for(const seed of [20261122,923475,712991]){
 const network=new RoadNetwork(),world=new R.World({x:0,y:0,z:0}),traffic=new TrafficSystem(network,world,count,seed),lastMoving=new Map(traffic.actors.map(a=>[a.id,0]));let overlapSamples=0,maxStepM=0;
 for(let step=0;step<180*120;step++){
  const before=traffic.actors.map(a=>[a.x,a.z]);traffic.step(1/120,null);world.step();
  traffic.actors.forEach((a,i)=>{if(a.speed>.3)lastMoving.set(a.id,traffic.time);maxStepM=Math.max(maxStepM,Math.hypot(a.x-before[i][0],a.z-before[i][1]));});
  if(step%120===0)for(let a=0;a<count;a++)for(let b=a+1;b<count;b++)if(overlaps(traffic.actors[a],traffic.actors[b],-.05))overlapSamples++;
 }
 const stalled=traffic.actors.filter(a=>traffic.time-lastMoving.get(a.id)>45).map(a=>({id:a.id,stoppedSeconds:traffic.time-lastMoving.get(a.id),lane:a.lane.id,progress:a.s,next:a.route[a.routeIndex+1]}));
 records.push({seed,cars:count,simulatedSeconds:180,wallClockSoak:false,overlapSamples,maxStepM,stalled,passed:overlapSamples===0&&maxStepM<.25&&stalled.length===0});
 world.free();
}
await fs.writeFile(process.env.FSD_TRAFFIC_REPORT||'reports/fsd/traffic-liveness.json',JSON.stringify({passed:records.every(r=>r.passed),method:'120 Hz continuous motion; overlap sampled each second; no car stationary over 45s at end; maximum single-step movement <0.25m.',records},null,2));
console.log(records.map(({seed,passed,maxStepM,stalled,overlapSamples})=>({seed,passed,maxStepM,stalled:stalled.length,overlapSamples})));
if(records.some(r=>!r.passed))process.exitCode=1;
