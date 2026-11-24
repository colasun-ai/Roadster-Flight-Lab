import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import RAPIER from '@dimforge/rapier3d-compat';
import {RoadNetwork,at,distance} from '../src/fsd/RoadNetwork.js';
import {TrafficSystem,idm,mobil,overlaps,clearRoadPose} from '../src/fsd/TrafficSystem.js';
import {Autopilot,trackPrediction} from '../src/fsd/Autopilot.js';
import {createVehicle} from '../src/vehicles/VehicleFactory.js';
import {createWorld} from '../src/physics/PhysicsWorld.js';
const records=[];async function test(name,fn){await fn();records.push({name,passed:true});console.log('PASS',name);}
const n=new RoadNetwork();
await test('A* reaches every destination and obeys directed links',()=>{for(const start of n.roads)for(const goal of n.roads){const route=n.route(start.id,goal.id);assert.equal(route[0],start.id);assert.equal(route.at(-1),goal.id);for(let i=1;i<route.length;i++){const lane=n.lanes.get(route[i-1]);assert.ok(lane.next.includes(route[i])||lane.adjacent?.id===route[i]);}}});
await test('All road and connector joins are continuous',()=>{for(const lane of n.lanes.values())for(const id of lane.next)assert.ok(distance(at(lane,lane.length),at(n.lanes.get(id),0))<1e-8);});
await test('Conflicting traffic signal approaches never green together',()=>{for(let t=0;t<80;t+=.1){const incoming=n.roads.filter(l=>l.to.x===1000&&l.to.z===600);const ns=incoming.filter(l=>l.from.x===1000).some(l=>n.light(l,t)===0),ew=incoming.filter(l=>l.from.z===600).some(l=>n.light(l,t)===0);assert.ok(!(ns&&ew));}});
await test('Diagonal and opposite avenue approaches receive their own green phases',()=>{
 for(const id of ['320:300','2600:840']){
  const node=n.nodes.find(j=>j.id===id),incoming=n.roads.filter(l=>l.to===node&&l.index===0);
  for(let t=0;t<node.phaseCount*20;t++){
   const active=incoming.filter(l=>n.light(l,t)===0);
   assert.ok(new Set(active.map(l=>node.signalGroups.get(l.from.id))).size<=1);
  }
  for(const l of incoming)assert.ok(Array.from({length:node.phaseCount*20},(_,t)=>n.light(l,t)).includes(0));
 }
});
await test('IDM brakes for short gaps and closed gap is finite',()=>{assert.ok(idm({speed:10,desiredSpeed:14,gap:5,closingSpeed:8})<0);assert.ok(Number.isFinite(idm({speed:10,desiredSpeed:14,gap:0})));assert.ok(idm({speed:0,desiredSpeed:14})>0);});
await test('MOBIL rejects unsafe follower braking and accepts beneficial safe changes',()=>{assert.equal(mobil({currentAcceleration:-2,newAcceleration:1,newFollowerAfter:-5}),false);assert.equal(mobil({currentAcceleration:-2,newAcceleration:1,newFollowerAfter:-1}),true);});
await test('OBB collision detection distinguishes perpendicular paths and parallel lanes',()=>{const a={x:0,z:0,yaw:0,length:4.8,width:2};assert.ok(overlaps(a,{...a,yaw:Math.PI/2}));assert.equal(overlaps(a,{...a,x:3.6}),false);});
await test('City resets and newly created traffic avoid an occupied spawn',async()=>{
 const lane=n.roads[0],dimensions={length:4.85,width:2},obstacle={...at(lane,10),...dimensions},pose=clearRoadPose(n,lane,10,[obstacle],{...obstacle,x:5000,z:5000});
 assert.equal(overlaps({...pose,...dimensions},obstacle,2),false);
 await RAPIER.init();const world=new RAPIER.World({x:0,y:0,z:0}),traffic=new TrafficSystem(n,world,20,20261122,[obstacle]);
 assert.ok(traffic.actors.every(a=>!overlaps(a,obstacle,.12)));traffic.dispose();world.free();
});
await test('20 independent traffic cars remain finite over 120 simulated seconds',async()=>{await RAPIER.init();const world=new RAPIER.World({x:0,y:0,z:0}),traffic=new TrafficSystem(n,world,20,923475);let overlapsCount=0;for(let i=0;i<120*120;i++){traffic.step(1/120,null);world.step();assert.ok(traffic.actors.every(a=>[a.x,a.z,a.yaw,a.speed].every(Number.isFinite)));if(i%120===0)for(let a=0;a<20;a++)for(let b=a+1;b<20;b++)if(overlaps(traffic.actors[a],traffic.actors[b],-.05))overlapsCount++;}records.push({name:'traffic overlap observations (reported independently)',overlapSamples:overlapsCount,movingAtEnd:traffic.actors.filter(a=>a.speed>.3).length,riskStops:traffic.events.filter(e=>e.event==='collision-risk-stop').length});traffic.dispose();assert.equal(world.bodies.len(),0);world.free();});
await test('Planner failure holds brakes and rapid manual input restores control',async()=>{const{world}=await createWorld(),session=createVehicle(world,'roadster'),traffic={actors:[]},pilot=new Autopilot(n,{predict:async()=>{throw Error('injected failure');}}),vehicle=session.vehicle;const lane=n.roads[0],p=at(lane,10);vehicle.reset({...p,y:0});pilot.setDestination(vehicle,n.roads[10].id);pilot.engage(vehicle);for(let i=0;i<260;i++)pilot.sample(1/120,vehicle,traffic);await pilot.update(vehicle,traffic);assert.equal(pilot.error,'injected failure');assert.equal(pilot.control(vehicle,traffic,{}).brake,1);pilot.control(vehicle,traffic,{steer:.2});assert.equal(pilot.enabled,false);assert.deepEqual(pilot.control(vehicle,traffic,{}),null);session.dispose();world.free();});
await test('A late model response cannot restore FSD after manual takeover',async()=>{
 const{world}=await createWorld(),session=createVehicle(world,'roadster'),traffic={actors:[]};let resolve;
 const pilot=new Autopilot(n,{predict:()=>new Promise(r=>resolve=r)}),vehicle=session.vehicle;
 vehicle.reset({...at(n.roads[0],10),y:0});pilot.setDestination(vehicle,n.roads[10].id);pilot.engage(vehicle);
 for(let i=0;i<260;i++)pilot.sample(1/120,vehicle,traffic);
 const pending=pilot.update(vehicle,traffic);assert.ok(pilot.busy);pilot.disengage('驾驶员已接管');
 resolve({model:'official-plan-r1-fine-tuning',points:Array.from({length:16},(_,i)=>({x:0,z:i,yaw:0,t:(i+1)*.5}))});await pending;
 assert.equal(pilot.enabled,false);assert.equal(pilot.prediction,null);assert.equal(pilot.status,'驾驶员已接管');assert.equal(pilot.busy,false);
 pilot.engage(vehicle);vehicle.body.setRotation({x:1,y:0,z:0,w:0},true);pilot.control(vehicle,traffic,{});assert.equal(pilot.enabled,false);assert.match(pilot.status,/翻滚/);
 session.dispose();world.free();
});
await test('Facing traffic on an occupied carriageway cannot start a route across the divider',async()=>{
 const {world}=await createWorld(),session=createVehicle(world,'model3-performance-2018');
 const lane=n.lanes.get('0:-120>0:0/0'),p=at(lane,40),pilot=new Autopilot(n,{});
 session.vehicle.reset({...p,yaw:p.yaw+Math.PI,y:0});
 pilot.setDestination(session.vehicle,lane.id);pilot.engage(session.vehicle);
 assert.equal(pilot.control(session.vehicle,{actors:[]},{}).brake,1);assert.equal(pilot.enabled,false);
 session.vehicle.reset({...p,y:0});pilot.engage(session.vehicle);
 assert.equal(pilot.wrongWayStart,false);assert.equal(pilot.enabled,true);
 session.dispose();world.free();
});
await test('An oncoming car in its own lane does not trigger a stopped-car escape',async()=>{
 const {Recovery}=await import('../src/fsd/Recovery.js'),recovery=new Recovery();
 const lane=n.lanes.get('0:-120>0:0/0'),p=at(lane,35),near={s:35,lane},pilot={network:n,route:[lane.id],events:[]};
 const ego={...p,speed:0,length:4.66,width:1.93,rearAxle:1.43},vehicle={forwardSpeed:()=>0};
 const traffic={actors:[{...p,x:p.x+3.6,z:p.z+4,yaw:Math.PI,width:2,length:4.85}]};
 for(let i=0;i<60;i++){pilot.time=i/10;assert.equal(recovery.control(pilot,ego,vehicle,traffic,null,near,0),null);}
 assert.equal(recovery.committed,false);
});
await test('All hero physics sources are identical to preserved v0.7',async()=>{
 const {createHash}=await import('node:crypto');
 const {files}=JSON.parse(await fs.readFile(new URL('./fixtures/vehicle-v07-hashes.json',import.meta.url),'utf8'));
 const actual=[];
 for(const dir of ['src/vehicle','src/thrusters','src/physics','src/vehicles']){
  for(const name of await fs.readdir(dir,{recursive:true})){
   const file=dir+'/'+name.replaceAll('\\','/');
   if((await fs.stat(file)).isFile()) actual.push(file);
  }
 }
 assert.deepEqual(actual.sort(),Object.keys(files).sort());
 for(const file of actual) assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'),files[file],file);
});
await fs.writeFile('reports/fsd/fsd-unit-results.json',JSON.stringify({passed:true,records},null,2));
