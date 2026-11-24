import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const source=pathToFileURL(path.resolve(process.argv[2]||'.')+'/');
const {createWorld}=await import(new URL('src/physics/PhysicsWorld.js',source));
const {VehiclePhysics}=await import(new URL('src/vehicle/VehiclePhysics.js',source));
const {ThrusterSystem}=await import(new URL('src/thrusters/ThrusterSystem.js',source));
const {config:C}=await import(new URL('src/vehicle/VehicleConfig.js',source));
const {world}=await createWorld(),car=new VehiclePhysics(world),jets=new ThrusterSystem(car);
const out=[];
function probe(name,{x=-110,z=-150,speed=0,seconds=8,input={},yaw=0}={}){
 car.reset({x,z,yaw});jets.enabled=false;
 for(let i=0;i<240;i++)car.step({});
 car.body.setLinvel({x:Math.sin(yaw)*speed/3.6,y:0,z:Math.cos(yaw)*speed/3.6},true);
 car.wheels.forEach(w=>w.omega=speed/3.6/w.radius);
 const start=car.telemetry();let peakY=-Infinity,minY=Infinity,peakVy=0,airSteps=0,contactSteps=0,impulse=0,peakRoll=0,peakLoad=0;
 const samples=[];
 for(let i=0;i<seconds*120;i++){
  car.step(input);const t=car.telemetry();
  peakY=Math.max(peakY,t.position.y);minY=Math.min(minY,t.position.y);peakVy=Math.max(peakVy,Math.abs(t.velocity.y));peakRoll=Math.max(peakRoll,Math.abs(t.rollDegrees));peakLoad=Math.max(peakLoad,...t.wheels.map(w=>w.load));
  if(!t.wheels.some(w=>w.contact))airSteps++;
  let hardContact=false;
  for(const c of car.hardStops)world.contactPairsWith(c,other=>world.contactPair(c,other,m=>{for(let k=0;k<m.numContacts();k++){const n=m.contactImpulse(k);if(n>0){hardContact=true;impulse+=n;}}}));
  if(hardContact)contactSteps++;
  if(i%120===0||t.position.y>.04&&i%12===0)samples.push({time:i/120,y:t.position.y,vy:t.velocity.y,z:t.position.z,x:t.position.x,speed:t.speedKmh,roll:t.rollDegrees,steer:t.wheels[0].steerDegrees,load:t.wheels.map(w=>w.load),contacts:t.wheels.map(w=>w.contact),hardContact});
 }
 const end=car.telemetry(),q=end.rotation;
 out.push({name,startSpeed:start.speedKmh,endSpeed:end.speedKmh,peakY,minY,peakVy,peakRoll,peakLoad,airSeconds:airSteps/120,hardContactSeconds:contactSteps/120,hardContactImpulse:impulse,headingDegrees:Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.x*q.x))*180/Math.PI,lateralDisplacement:end.position.x-x,forwardDisplacement:end.position.z-z,end,samples});
}
probe('flat-full-throttle',{seconds:20,input:{drive:1}});
probe('flat-200-coast',{speed:200,seconds:10});
probe('flat-300-coast',{speed:300,seconds:10});
for(const speed of [100,150,200])for(const drive of [0,1])probe(`steer-${speed}-drive-${drive}`,{x:-330,z:-600,speed,seconds:3,input:{steer:1,drive}});
// A 7 cm curb at the circuit's eastern straight, crossed at an oblique angle.
probe('curb-50',{x:314,z:200,yaw:Math.PI/2,speed:50,seconds:2});
probe('curb-100',{x:314,z:200,yaw:Math.PI/2,speed:100,seconds:2});
world.free();
const filename=process.argv[3]||'handling-probe.json';fs.writeFileSync(filename,JSON.stringify(out,null,2));
console.log(JSON.stringify(out.map(({end,samples,...summary})=>summary),null,2));
