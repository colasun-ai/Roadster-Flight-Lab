// The divider oracle uses the map nodes and footprint corners, independently
// of the trajectory guard. Legal crossings within junctions are excluded.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve(process.env.DIRECTION_ROOT??path.join(import.meta.dirname,'../..'));
const load=file=>import(pathToFileURL(path.join(root,file)));
const {RoadNetwork,at}=await load('src/fsd/RoadNetwork.js');
const {Autopilot,rearAxleState}=await load('src/fsd/Autopilot.js');
const {createVehicle}=await load('src/vehicles/VehicleFactory.js');
const {createWorld}=await load('src/physics/PhysicsWorld.js');
const net=new RoadNetwork();
import {medianOverlap} from './divider_measurement.mjs';
const results=[];
for(const file of process.argv.slice(2)){
 const {frames,record}=JSON.parse(await fs.readFile(file,'utf8'));
 let sampled=0,max=0;
 for(const {ego} of frames){const d=medianOverlap(ego,net.links);if(d>.01)sampled++;max=Math.max(max,d);}
 results.push({scenario:record.scenario,samples:frames.length,opposingSamples:sampled,maxIntrusionM:max,traffic:record.traffic,collisionSamples:record.collisionSamples,
  headingChange:record.maxHeadingChange,metres:record.distanceM,passedSlowCar:record.overtaking?.observedPass});
}
if(!process.argv[2]){
 for(const [start,end] of [['0:-120','0:0'],['0:0','0:-120'],['0:0','120:0'],['120:0','0:0']]){
  const lane=net.lanes.get(start+'>'+end+'/0'),p=at(lane,15);
  const {world}=await createWorld(),session=createVehicle(world,'model3-performance-2018'),vehicle=session.vehicle;
  vehicle.reset({...p,y:0});
  // Repeated biased output deliberately aims at the opposite lane, which is
  // empty. Feed identical world-space targets to both controller versions.
  const bridge={predict:async state=>{
   const {origin:o}=state;
   const points=Array.from({length:16},(_,i)=>{
    const t=(i+1)*.5,v=6,q=at(lane,(o.x-p.x)*Math.sin(p.yaw)+(o.z-p.z)*Math.cos(p.yaw)+15+v*t);
    const bias=3.6*Math.min(1,t/1.8);
    return {x:q.x+bias*Math.cos(q.yaw),z:q.z-bias*Math.sin(q.yaw),yaw:p.yaw,t};
   });
   return {model:'official-plan-r1-fine-tuning',sourceTime:state.time,points};
  }};
  const pilot=new Autopilot(net,bridge),traffic={actors:[]};
  pilot.setDestination(vehicle,lane.id);pilot.engage(vehicle);
  let ticks=0,max=0,guard=0;
  const link=net.links.find(l=>[l.a,l.b].includes(lane.from)&&[l.a,l.b].includes(lane.to));
  for(let i=0;i<13*120;i++){
   pilot.sample(1/120,vehicle,traffic);if(i%24===0)await pilot.update(vehicle,traffic);
   vehicle.step(pilot.control(vehicle,traffic,{})??{});
   const d=medianOverlap(rearAxleState(vehicle),[link]);if(d>.01)ticks++;max=Math.max(max,d);if(pilot.prediction?.directionGuard)guard++;
  }
  const ego=rearAxleState(vehicle),m=(ego.x-p.x)*Math.sin(p.yaw)+(ego.z-p.z)*Math.cos(p.yaw);
  results.push({direction:lane.id,steps:1560,opposingTicks:ticks,maxIntrusionM:max,travelM:m,guardTicks:guard});
  if(!process.env.DIRECTION_BASELINE){assert.equal(ticks,0);assert.ok(m>34&&guard>300);}
  session.dispose();world.free();
 }
}
console.log(JSON.stringify(results,null,2));
