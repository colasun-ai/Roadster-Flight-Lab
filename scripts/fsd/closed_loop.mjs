import {medianOverlap} from './divider_measurement.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {createWorld} from '../../src/physics/PhysicsWorld.js';
import {createVehicle} from '../../src/vehicles/VehicleFactory.js';
import {RoadNetwork,at,distance} from '../../src/fsd/RoadNetwork.js';
import {TrafficSystem} from '../../src/fsd/TrafficSystem.js';
import {Autopilot,rearAxleState,trafficVehicleState} from '../../src/fsd/Autopilot.js';
import {CityScene} from '../../src/fsd/CityScene.js';
const require=createRequire(import.meta.url),{Planner}=require('../../desktop/plan-r1.cjs');
const root=path.resolve(import.meta.dirname,'../..'),planner=new Planner(path.join(root,'fsd-runtime'));
const seconds=Number(process.env.FSD_TEST_SECONDS||30),count=Number(process.env.FSD_TEST_TRAFFIC||0),safety=process.env.FSD_TEST_RAW!=='1';
const output=path.resolve(process.env.FSD_TEST_OUTPUT||path.join(root,'reports/fsd'));await fs.mkdir(output,{recursive:true});
const results=[];const suite=process.env.FSD_TEST_SCENARIO||'straight';
try{
 for(const id of (process.env.FSD_TEST_VEHICLE?[process.env.FSD_TEST_VEHICLE]:['model3-performance-2018'])){
  const{world}=await createWorld(),network=new RoadNetwork(),city=new CityScene(new THREE.Scene(),world,network),session=createVehicle(world,id),vehicle=session.vehicle,traffic=new TrafficSystem(network,world,count,Number(process.env.FSD_TEST_SEED||20261122)),pilot=new Autopilot(network,planner);pilot.safetyEnabled=safety;pilot.assertive=process.env.FSD_TEST_STYLE?process.env.FSD_TEST_STYLE!=='standard':safety;pilot.mapFeatures=city.modelFeatures;
  const turning=['left','right','unprotected-left'].includes(suite),left=suite.includes('left');
  const metroTest=['metro-pass','metro-uturn','metro-tunnel','metro-ramp','city-pass'].includes(suite);
  const lane=metroTest?network.lanes.get(({'city-pass':'800:840>1250:840/1','metro-ramp':'320:300>430:390/1','metro-pass':'-280:390>430:390/1','metro-uturn':'320:300>550:300/0','metro-tunnel':'580:560>580:1030/1'})[suite]):network.roads.find(l=>l.from.x===1000&&l.from.z===480&&l.to.z===600&&l.index===(suite==='right'?1:0)),spawn=at(lane,suite==='metro-uturn'?lane.length-28:turning?57:8);vehicle.reset({...spawn,y:0});
  const goal=metroTest?(suite==='metro-ramp'?network.lanes.get('430:390>580:560/1'):suite==='metro-uturn'?network.lanes.get('550:300>320:300/0'):lane):network.roads.find(l=>!turning?l.to.z===720&&l.to.x===1000&&l.from.z===600&&l.index===0:left?l.to.x===1120&&l.to.z===600&&l.from.x===1000&&l.index===0:l.to.x===880&&l.to.z===600&&l.from.x===1000&&l.index===1);
  let scriptedActor=traffic.actors[0],eventApplied=false;
  if(scriptedActor&&['city-pass','metro-pass','following','front-brake','cut-in','overtake','unprotected-left'].includes(suite)){
   const opposite=network.roads.find(l=>l.from.x===1000&&l.from.z===720&&l.to.z===600&&l.index===0);scriptedActor.lane=suite==='cut-in'?lane.adjacent:suite==='unprotected-left'?opposite:lane;scriptedActor.s=suite==='unprotected-left'?70:(['city-pass','metro-pass'].includes(suite)?8:spawn.z-at(lane,0).z)+(suite==='cut-in'?10:20);scriptedActor.speed=suite==='city-pass'?35/3.6:3;scriptedActor.desiredSpeed=suite==='city-pass'?35/3.6:suite==='unprotected-left'?6:3;scriptedActor.route=network.route(scriptedActor.lane.id,suite==='unprotected-left'?lane.from.neighbors.map(n=>network.roads.find(l=>l.from.id===lane.to.id&&l.to.id===lane.from.id&&l.index===0)).filter(Boolean)[0].id:goal.id);scriptedActor.routeIndex=0;Object.assign(scriptedActor,at(scriptedActor.lane,scriptedActor.s));scriptedActor.body.setTranslation({x:scriptedActor.x,y:.65,z:scriptedActor.z},true);scriptedActor.body.setRotation({x:0,y:Math.sin(scriptedActor.yaw/2),z:0,w:Math.cos(scriptedActor.yaw/2)},true);
  }
  pilot.setDestination(vehicle,goal.id);pilot.engage(vehicle);let maxSpeed=0,maxOffroad=0,protectedSteps=0,collisions=0,manualPoseWrites=0,redViolations=0;const frames=[],start=performance.now(),brakeReasons={},noseDistances=new Map(),crossedRed=new Set();
  let opposingTicks=0,maxIntrusionM=0,touchingTrafficTicks=0;
  const actorBodies=new Set(traffic.actors.map(a=>a.body.handle));
  const directWrites={setTranslation:0,setRotation:0,setLinvel:0,setAngvel:0};for(const name of Object.keys(directWrites)){const original=vehicle.body[name].bind(vehicle.body);vehicle.body[name]=(...args)=>{directWrites[name]++;return original(...args);};}
  // 120 Hz actual force simulation. Await the real worker at each 5 Hz
  // planning boundary; simulated time never includes model wall-clock wait.
  for(let step=0;step<seconds*120;step++){
   if(scriptedActor&&!eventApplied&&step===8*120&&suite==='cut-in'){scriptedActor.laneChange={from:scriptedActor.lane,to:lane,start:traffic.time,progress:0};scriptedActor.indicator='left';eventApplied=true;}
   if(scriptedActor&&suite==='front-brake'&&step>=10*120)scriptedActor.desiredSpeed=1;
   traffic.step(1/120,trafficVehicleState(vehicle));pilot.sample(1/120,vehicle,traffic);
   if(step%24===0){
    await pilot.update(vehicle,traffic);
    const sample=pilot.records.at(-1);
    if(!safety&&pilot.enabled&&sample)pilot.prediction={...sample.rawPrediction,origin:sample.input.origin};
   }
   const command=pilot.control(vehicle,traffic,{})||{};vehicle.step(command);
   const ego=rearAxleState(vehicle),near=network.nearest(ego,ego.yaw);maxSpeed=Math.max(maxSpeed,ego.speed);maxOffroad=Math.max(maxOffroad,near?.distance??0);if(pilot.safetyReason){protectedSteps++;brakeReasons[pilot.safetyReason]=(brakeReasons[pilot.safetyReason]||0)+1/120;}
   const intrusion=medianOverlap(ego,network.links);
   if(intrusion>.01)opposingTicks++;maxIntrusionM=Math.max(maxIntrusionM,intrusion);
   let touches=false;
   for(let i=0;i<vehicle.body.numColliders()&&!touches;i++){
    const part=vehicle.body.collider(i);
    world.contactPairsWith(part,other=>{
     if(!actorBodies.has(other.parent()?.handle))return;
     world.contactPair(part,other,manifold=>{
      for(let j=0;j<manifold.numContacts();j++)if(manifold.contactDist(j)<=0)touches=true;
     });
    });
   }
   if(touches)touchingTrafficTicks++;
   if(near&&!near.lane.connector){const nose=near.lane.length-near.s-ego.length/2-ego.rearAxle,prior=noseDistances.get(near.lane.id);if(prior>=0&&nose<0&&network.light(near.lane,pilot.time)===2&&!crossedRed.has(near.lane.id)){redViolations++;crossedRed.add(near.lane.id);}noseDistances.set(near.lane.id,nose);}
   if(step%24===0){world.contactPairsWith(vehicle.body.collider(0),other=>{if(other.parent()?.isKinematic())collisions++;});frames.push({t:pilot.time,ego,input:command,safety:pilot.safetyReason,prediction:pilot.prediction?.points??[],traffic:traffic.actors.map(a=>({id:a.id,x:a.x,z:a.z,yaw:a.yaw,speed:a.speed,lane:a.lane.id}))});}
   if(vehicle.error)throw Error(JSON.stringify(vehicle.error));
  }
  const record={opposingTicks,maxIntrusionM,touchingTrafficTicks,physicsTicks:seconds*120,id,scenario:suite,seconds,traffic:count,seed:Number(process.env.FSD_TEST_SEED||20261122),safetyEnabled:safety,start:spawn,finish:rearAxleState(vehicle),distanceM:distance(spawn,rearAxleState(vehicle)),maxSpeedKmh:maxSpeed*3.6,maxLaneDistanceM:maxOffroad,protectedSeconds:protectedSteps/120,brakeReasons,redStopLineCrossings:redViolations,collisionSamples:collisions,inferences:pilot.inferences,latencyMs:pilot.lastRequestMs,error:pilot.error,lastStatus:pilot.status,model:pilot.records.at(-1)?.rawPrediction.model,manualPoseWritesDuringDriving:manualPoseWrites,simulationWallSeconds:(performance.now()-start)/1000,mapFeatures:city.modelFeatures.length};
  record.directRigidBodyWritesDuringDriving=structuredClone(directWrites);record.manualPoseWritesDuringDriving=directWrites.setTranslation+directWrites.setRotation;record.model='official-plan-r1-fine-tuning';
  record.scriptedTraffic=scriptedActor?{id:scriptedActor.id,x:scriptedActor.x,z:scriptedActor.z,speed:scriptedActor.speed}:null;
  record.trafficEvents=traffic.events;
  record.decoding=pilot.records.at(-1)?.rawPrediction.decoding;
  record.maxHeadingChange=Math.max(...frames.map(f=>Math.abs(Math.atan2(Math.sin(f.ego.yaw-spawn.yaw),Math.cos(f.ego.yaw-spawn.yaw)))));
  record.finishedLane=network.nearest(record.finish,record.finish.yaw)?.lane.id;
  record.lanesDriven=[...new Set(frames.map(f=>network.nearest(f.ego,f.ego.yaw)?.lane.id))];
  if(['metro-pass','city-pass','overtake'].includes(suite)){
   const first=frames[0].traffic.find(a=>a.id===scriptedActor.id),startForward={x:Math.sin(spawn.yaw),z:Math.cos(spawn.yaw)};
   const passing=frames.filter(f=>{const a=f.traffic.find(a=>a.id===scriptedActor.id);return a&&Math.cos(a.yaw-spawn.yaw)>.95&&Math.cos(f.ego.yaw-spawn.yaw)>.95&&((f.ego.x-a.x)*startForward.x+(f.ego.z-a.z)*startForward.z)>(f.ego.length+scriptedActor.length)/2;});
   record.overtaking={initialLeadM:(first.x-spawn.x)*startForward.x+(first.z-spawn.z)*startForward.z,observedPass:passing.length>0,firstPassSeconds:passing[0]?.t??null,note:'Passing requires actual ego position to clear the initially leading car while both still face the initial direction. No scripted ego lane change.'};
  }
  if(Object.values(directWrites).some(Boolean))throw Error('Driving used direct rigid-body state writes');
  results.push(record);await fs.writeFile(path.join(output,`closed-loop-${suite}-${safety?'protected':'raw'}-${count}-replay.json`),JSON.stringify({record,frames,predictions:pilot.records}));console.log(JSON.stringify({...record,trafficEvents:record.trafficEvents.length}));traffic.dispose();session.dispose();world.free();
 }
}finally{planner.stop();}
await fs.writeFile(path.join(output,`closed-loop-${suite}-${safety?'protected':'raw'}-${count}.json`),JSON.stringify(results,null,2));
