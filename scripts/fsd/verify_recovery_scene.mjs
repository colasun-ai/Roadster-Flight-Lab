import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import {createRequire} from 'node:module';
import {RoadNetwork,at,project,distance,wrap} from '../../src/fsd/RoadNetwork.js';
import {roadPin} from '../../src/fsd/PointNavigation.js';
import {TrafficSystem,overlaps} from '../../src/fsd/TrafficSystem.js';
import {Autopilot,rearAxleState,trafficVehicleState} from '../../src/fsd/Autopilot.js';
import {CityScene} from '../../src/fsd/CityScene.js';
import {createWorld} from '../../src/physics/PhysicsWorld.js';
import {createVehicle} from '../../src/vehicles/VehicleFactory.js';

const root=path.resolve(import.meta.dirname,'../..'),{Planner}=createRequire(import.meta.url)('../../desktop/plan-r1.cjs');
const fixture=JSON.parse(await fs.readFile(path.join(root,'reports/recovery/stuck-scene.json')));
const planner=new Planner(path.join(root,'fsd-runtime')),net=new RoadNetwork(),{world}=await createWorld();
const city=new CityScene(new THREE.Scene(),world,net),session=createVehicle(world,'model3-performance-2018'),v=session.vehicle;
const traffic=new TrafficSystem(net,world,32),pilot=new Autopilot(net,planner);
const test=process.env.SCENE||'recorded',seconds=Number(process.env.SECONDS_TO_RUN||80);
const pin=test==='pin'?roadPin(net,at(net.lanes.get('320:300>550:300/0'),70)):null;
const ego=test==='reverse'?at(net.lanes.get('320:300>550:300/0'),45):test==='pin'?at(net.lanes.get(pin.lane),16):fixture.ego;
v.reset({x:ego.x+1.43005*Math.sin(ego.yaw),z:ego.z+1.43005*Math.cos(ego.yaw),yaw:ego.yaw,y:0});
for(const [i,orig] of fixture.traffic.entries()){
 const a=traffic.actors[i];let lane=net.lanes.get(orig.lane),q=project(lane,orig);
 if(q.distance>1){const near=net.nearest(orig,orig.yaw);lane=near.lane;q=near;}
 Object.assign(a,orig,{lane,s:q.s,route:net.route(lane.id,orig.destination),routeIndex:0,laneChange:null});
 a.body.setTranslation({x:a.x,y:.65,z:a.z},true);a.body.setRotation({x:0,y:Math.sin(a.yaw/2),z:0,w:Math.cos(a.yaw/2)},true);
}
if(test==='reverse'){
 // A construction block just beyond the front bumper: forward turning arcs
 // cannot clear it, but backing along the current lane opens the adjacent lane.
 const lane=net.lanes.get('320:300>550:300/0'),b=at(lane,49.4);
 city.box(b.x,.6,b.z,1.9,1.2,1,city.materials.curb,true,b.yaw);
}
traffic.time=pilot.time=fixture.ego.time;pilot.mapFeatures=city.modelFeatures;pilot.obstacles=city.recoveryObstacles;
pilot.setDestination(v,pin?.lane??fixture.destination,pin);pilot.engage(v);
const direct={};for(const k of ['setTranslation','setRotation','setLinvel','setAngvel']){direct[k]=0;const fn=v.body[k].bind(v.body);v.body[k]=(...args)=>{direct[k]++;return fn(...args);};}
const trace=[],contacts=[];let overlapsSteps=0,physicsContactSteps=0,minSpeed=0,maxStep=0,last=rearAxleState(v);
try{
 for(let i=0;i<120*seconds;i++){
  traffic.step(1/120,trafficVehicleState(v));pilot.sample(1/120,v,traffic);
  if(i%24===0)await pilot.update(v,traffic);
  const cmd=pilot.control(v,traffic,{})??{};v.step(cmd);
  const p=rearAxleState(v),box=trafficVehicleState(v);
  const hit=traffic.actors.find(a=>distance(a,box)<6&&overlaps(a,box,-.06));
  if(hit){overlapsSteps++;if(contacts.length===0||i/120-contacts.at(-1).t>.35)contacts.push({t:i/120,ego:p,id:hit.id,x:hit.x,z:hit.z,speed:hit.speed,yaw:hit.yaw,state:pilot.safetyReason});}
  let touching=false;
  for(let collider=0;collider<v.body.numColliders()&&!touching;collider++){
   const part=v.body.collider(collider);
   world.contactPairsWith(part,other=>{
    if(!other.parent()?.isKinematic())return;
    world.contactPair(part,other,manifold=>{
     for(let j=0;j<manifold.numContacts();j++)if(manifold.contactDist(j)<=0)touching=true;
    });
   });
  }
  if(touching)physicsContactSteps++;
  minSpeed=Math.min(minSpeed,v.forwardSpeed());maxStep=Math.max(maxStep,distance(p,last));last=p;
  if(i%120===0){trace.push({t:i/120,x:p.x,z:p.z,yaw:p.yaw,v:v.forwardSpeed(),state:pilot.safetyReason,lane:pilot.route[0],cmd});}
  if(!pilot.enabled)break;
 }
 const result={scene:test,count:traffic.actors.length,initial:ego,end:last,destination:pilot.destination,pin,offset:pin?distance(last,pin):null,status:pilot.status,overlapsSteps,physicsContactSteps,contacts,minSpeed,maxStep,direct,events:pilot.events,trace};
 await fs.writeFile(path.join(root,'reports/recovery',(process.env.RECORD_NAME||test)+'.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,trace:trace.filter((_,i)=>i%5===0)},null,0));
 if(test==='reverse'&&minSpeed>-.4)process.exitCode=1;
 if(overlapsSteps||physicsContactSteps||Object.values(direct).some(Boolean)||result.status!=='已到达目的地')process.exitCode=1;
}finally{planner.stop();traffic.dispose();session.dispose();city.dispose();world.free();}
