import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';

const root=path.resolve(process.env.FSD_SOURCE??path.join(import.meta.dirname,'../..'));
const load=file=>import(pathToFileURL(path.join(root,file)));
const {RoadNetwork,project}=await load('src/fsd/RoadNetwork.js');
const {Autopilot,rearAxleState,trafficVehicleState}=await load('src/fsd/Autopilot.js');
const {PredictionRibbon,clipPassedPrediction}=await load('src/fsd/PredictionRibbon.js');
const {cumulative,sampleAlong}=await load('src/fsd/RibbonShape.js');
const {TrafficSystem}=await load('src/fsd/TrafficSystem.js');
const {CityScene}=await load('src/fsd/CityScene.js');
const {createWorld}=await load('src/physics/PhysicsWorld.js');
const {createVehicle}=await load('src/vehicles/VehicleFactory.js');
const {Planner}=createRequire(import.meta.url)(path.join(root,'desktop/plan-r1.cjs'));
const planner=new Planner(path.join(root,'fsd-runtime'));
const {world}=await createWorld(),net=new RoadNetwork(),scene=new THREE.Scene();
const city=new CityScene(scene,world,net),session=createVehicle(world,'model-y-performance-2026');
const vehicle=session.vehicle,lane=net.lanes.get('4400:-780>4400:1500/1');
const origin={x:5394.56,z:1199.15,yaw:.01,y:0};
vehicle.reset(origin);
const traffic=new TrafficSystem(net,world,32,20261122,[{...origin,width:2,length:5}]);
let inFlight,delivered;
const latencyTicks=38;
const bridge={predict(state){
  const computed=planner.predict(state);
  return new Promise(resolve=>{delivered={computed,resolve};});
}};
const pilot=new Autopilot(net,bridge),ribbon=new PredictionRibbon(scene);
pilot.mapFeatures=city.modelFeatures;pilot.obstacles=city.recoveryObstacles;
pilot.setDestination(vehicle,'580:560>580:1030/1');pilot.engage(vehicle);
const laneErrors=[],lineJumps=[],positions=[],steering=[],speedSamples=[];
let previousLine=[],lastSteer=0,reversals=0,started=0,peakSpeed=0,contactTicks=0,nearbyMax=0;
const handles=new Set(traffic.actors.map(a=>a.body.handle));
try{
 for(let tick=0;tick<38*120;tick++){
  traffic.step(1/120,trafficVehicleState(vehicle));pilot.sample(1/120,vehicle,traffic);
  if(delivered&&tick-started>=latencyTicks){const job=delivered;delivered=null;job.resolve(await job.computed);await inFlight;}
  if(!pilot.busy){inFlight=pilot.update(vehicle,traffic);if(delivered)started=tick;}
  const control=pilot.control(vehicle,traffic,{})??{};
  vehicle.step(control);const ego=rearAxleState(vehicle);
  assert.ok(!vehicle.error);
  let contact=false;
  for(let i=0;i<vehicle.body.numColliders()&&!contact;i++){const own=vehicle.body.collider(i);world.contactPairsWith(own,other=>{if(handles.has(other.parent()?.handle))world.contactPair(own,other,m=>{for(let k=0;k<m.numContacts();k++)if(m.contactDist(k)<=0)contact=true;});});}
  if(contact)contactTicks++;
  if(tick%4!==0)continue;
  ribbon.update(pilot.prediction,vehicle,pilot.time,4/120);peakSpeed=Math.max(peakSpeed,ego.speed*3.6);
  if(ego.speed<15)continue;
  laneErrors.push(project(lane,ego).distance);positions.push(ego.x);speedSamples.push(ego.speed);
  const steer=control.steer??0;steering.push(steer);
  if(Math.abs(steer)>.09){if(lastSteer&&Math.sign(steer)!==lastSteer)reversals++;lastSteer=Math.sign(steer);}
  nearbyMax=Math.max(nearbyMax,pilot.records.at(-1)?.input.agents.length??0);
  // Compare the display after a complete 0.3 s interval at common WORLD stations.
  if(tick%36===0&&ribbon.display.length>1){
   const current=ribbon.display,old=clipPassedPrediction(previousLine,current[0]);
   if(old.length>1){const a=cumulative(old),b=cumulative(current);for(const s of [8,14,20])if(Math.min(a.at(-1),b.at(-1))>=s){
    const u=sampleAlong(old,a,s),v=sampleAlong(current,b,s);lineJumps.push(Math.abs(u.x-v.x));
   }}
   previousLine=current.map(p=>({...p}));
  }
 }
 if(delivered){delivered.resolve(await delivered.computed);await inFlight;}
 const percentile=(values,f)=>values.toSorted((a,b)=>a-b)[Math.floor((values.length-1)*f)];
 assert.ok(laneErrors.length>200&&lineJumps.length>50&&pilot.records.length>50&&!pilot.error);
 const result={car:'Model Y Performance 2026',traffic:traffic.actors.length,seed:20261122,road:lane.id,destination:pilot.destination,model:pilot.records.at(-1).rawPrediction.model,delaySeconds:latencyTicks/120,simSeconds:38,
  peakKmh:peakSpeed,medianMeasuredKmh:percentile(speedSamples,.5)*3.6,travelMetres:rearAxleState(vehicle).z-origin.z,peakToPeakM:Math.max(...positions)-Math.min(...positions),
  laneErrorP95M:percentile(laneErrors,.95),laneErrorMaxM:Math.max(...laneErrors),lineLateralJumpP95M:percentile(lineJumps,.95),lineLateralJumpMaxM:Math.max(...lineJumps),
  steeringReversals:reversals,contactTicks,nearbyAgentsMax:nearbyMax,inferences:pilot.records.length};
 await fs.writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(result);
 if(!process.env.FSD_BASELINE){assert.ok(result.laneErrorMaxM<.35&&result.lineLateralJumpP95M<.15&&reversals<4&&peakSpeed>70&&contactTicks===0);}
}finally{planner.stop();traffic.dispose();session.dispose();world.free();}
