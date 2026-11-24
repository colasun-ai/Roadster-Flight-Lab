import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {RoadNetwork,at} from '../../src/fsd/RoadNetwork.js';
import {CityScene} from '../../src/fsd/CityScene.js';
import {Autopilot,rearAxleState} from '../../src/fsd/Autopilot.js';
import {MapFeatureIndex} from '../../src/fsd/MapFeatureIndex.js';
import {routeSections,sectionPoints,remainingDistance} from '../../src/fsd/PointNavigation.js';
import {createWorld} from '../../src/physics/PhysicsWorld.js';
import {createVehicle} from '../../src/vehicles/VehicleFactory.js';

const net=new RoadNetwork(),{world}=await createWorld(),session=createVehicle(world,'model3-performance-2018');
const v=session.vehicle,view=new THREE.Scene(),base=world.colliders.len();
const city=new CityScene(view,world,net,{active:false});
const track=city.trackColliders.slice();
assert.ok(track.length>0&&track.every(c=>c.isEnabled()));
assert.ok(!city.root.visible&&city.colliders.every(c=>!c.isEnabled()));
const features=city.modelFeatures,index=new MapFeatureIndex(features);
city.activate();
assert.ok(track.every(c=>!c.isEnabled())&&city.root.visible&&city.colliders.every(c=>c.isEnabled()));
city.dispose();assert.equal(world.colliders.len(),base);assert.ok(track.every(c=>c.isEnabled()));
const lane=net.lanes.get('0:-120>0:0/0'),terminal=at(lane,lane.length-1);
const traffic={actors:[]},pilot=new Autopilot(net,{predict:async s=>({model:'official-plan-r1-fine-tuning',sourceTime:s.time,
 points:Array.from({length:16},(_,i)=>({...s.origin,t:(i+1)*.5}))})});
v.reset({...terminal,z:terminal.z-1.43005,yaw:Math.PI,y:0});
pilot.setDestination(v,lane.id);pilot.engage(v);
const origin=rearAxleState(v);pilot.prediction=await pilot.bridge.predict({time:0,origin});pilot.prediction.origin=origin;
assert.ok(pilot.route.length>1);pilot.control(v,traffic,{});assert.ok(pilot.enabled);
pilot.time=90;pilot.reset();pilot.startSession();v.reset({...at(lane,30),y:0});pilot.setDestination(v,lane.id);pilot.engage(v);
for(let i=0;i<4*120;i++){pilot.sample(1/120,v,traffic);await pilot.update(v,traffic);}
assert.ok(pilot.records.length>0&&pilot.records[0].input.time<2.2);
const highway=net.lanes.get('-280:390>430:390/0'),point=at(highway,500),route=[highway.id,highway.adjacent.id];
const sections=[...routeSections(net,point,route,null)],mapped=sections.flatMap(sectionPoints);
assert.equal(sections[0].start,500);
assert.ok(mapped.every(p=>(p.x-point.x)*Math.sin(point.yaw)+(p.z-point.z)*Math.cos(point.yaw)>=-.001));
const mapLength=remainingDistance(net,point,route,null);
assert.ok(mapLength>=highway.length-500&&mapLength<highway.length-498);
const samples=[];
for(const [i,l] of [...net.lanes.values()].entries())if(i%11===0)samples.push(at(l,l.length*.44));
samples.push({x:-100,z:-100},{x:75,z:75},{x:-75,z:-75});
const legacyFeatures=p=>features.filter(f=>f.points.some(([x,z])=>Math.hypot(x-p.x,z-p.z)<75));
for(const p of samples)for(const cap of [0,5,400])assert.deepEqual(index.nearby(p,cap),legacyFeatures(p).slice(0,cap));
function measure(fn){
 const start=performance.now();let sum=0;
 for(let n=0;n<4;n++)for(const p of samples)sum+=fn(p).length;
 assert.ok(sum>0);return (performance.now()-start)/(4*samples.length);
}
function compare(oldFn,newFn){
 measure(oldFn);measure(newFn);
 const before=[],after=[];
 for(let i=0;i<5;i++){
  if(i%2){after.push(measure(newFn));before.push(measure(oldFn));}
  else{before.push(measure(oldFn));after.push(measure(newFn));}
 }
 return {beforeMs:before.sort((a,b)=>a-b)[2],afterMs:after.sort((a,b)=>a-b)[2]};
}
const report={trackColliders:track.length,features:features.length,locations:samples.length,firstPredictionSimSeconds:pilot.records[0].input.time,
 map:{s:500,remainingMetres:mapLength,segments:sections.length},featureLookup:compare(legacyFeatures,p=>index.nearby(p,400))};
if(process.argv[2]){
 const {RoadNetwork:Baseline}=await import(pathToFileURL(path.resolve(process.argv[2],'src/fsd/RoadNetwork.js')));
 const before=new Baseline();
 for(const [i,p] of samples.entries()){
  const id=net.nearest(p).lane.id,route=[id],t=.75*i;
  for(const guided of [false,true])assert.deepEqual(net.modelLanes(p,route,t,85,guided),before.modelLanes(p,route,t,85,guided));
 }
 report.lanePreparation=compare(p=>before.modelLanes(p,[],20),p=>net.modelLanes(p,[],20));
}
console.log(JSON.stringify(report,null,2));
if(process.env.REVIEW_RESULT)await fs.writeFile(process.env.REVIEW_RESULT,JSON.stringify(report,null,2)+'\n');
session.dispose();world.free();
