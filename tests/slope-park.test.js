import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import RAPIER from '@dimforge/rapier3d-compat';
import {createWorld} from '../src/physics/PhysicsWorld.js';
import {createVehicle} from '../src/vehicles/VehicleFactory.js';
import {slopeCourses,slopeStart} from '../src/world/SlopePark.js';

const {world,track}=await createWorld();
world.step();
const solids=track.filter(p=>p.kind==='slope');
let rayCount=0;
for(const p of solids){
 const edges=new Map();
 for(let i=0;i<p.indices.length;i+=3){
  const tri=p.indices.slice(i,i+3);
  for(let j=0;j<3;j++){
   const a=tri[j],b=tri[(j+1)%3],key=Math.min(a,b)+','+Math.max(a,b);
   const e=edges.get(key)??[0,0];e[0]++;e[1]+=Math.sign(b-a);edges.set(key,e);
  }
 }
 assert.ok([...edges.values()].every(([n,sum])=>n===2&&sum===0),p.course+' open solid');
 // Sample triangle interiors on the left, centre and right, on the actual collision world.
 for(let row=0;row<p.rows;row+=3)for(const col of new Set([0,Math.floor((p.cols-1)/2),p.cols-2])){
  const i=6*(row*(p.cols-1)+col),v=p.indices.slice(i,i+3).map(n=>p.vertices.slice(n*3,n*3+3));
  const [x,y,z]=[0,1,2].map(k=>v.reduce((n,q)=>n+q[k],0)/3);
  const hit=world.castRay(new RAPIER.Ray({x,y:25,z},{x:0,y:-1,z:0}),27,true);
  assert.ok(hit&&Math.abs(25-hit.timeOfImpact-y)<.003,p.course+' collider mismatch');rayCount++;
 }
}
function drive(car,c){
 car.reset(slopeStart(c));let peak=0,maxRoll=0,air=0,airSteps=0,landed=false,sideError=0,progress=-100;
 const target=c.speed/3.6;
 for(let tick=0;tick<120*85;tick++){
  const {p,q}=car.rootPose(),s=p.z-c.z,speed=car.forwardSpeed();
  const look=Math.max(5,speed*.65),ahead=Math.max(0,Math.min(c.length,s+look));
  const targetX=c.x+(c.shift?.(ahead)??0),yaw=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.x*q.x));
  const error=Math.atan2(targetX-p.x,look)-yaw;
  const steer=Math.max(-1,Math.min(1,4*Math.atan2(Math.sin(error),Math.cos(error))));
  car.step({steer,drive:Math.max(0,Math.min(1,.24*(target-speed))),brake:Math.max(0,Math.min(1,.15*(speed-target-.4)))});
  if(car.error)throw Error(c.id+' '+car.error);
  if(s>=0){
   peak=Math.max(peak,p.y);maxRoll=Math.max(maxRoll,Math.abs(Math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.z*q.z+q.x*q.x))*180/Math.PI));
   if(car.wheels.some(w=>w.contact)){if(airSteps>4)landed=true;airSteps=0;}else air=Math.max(air,++airSteps);
   sideError=Math.max(sideError,Math.abs(p.x-c.x-(c.shift?.(Math.min(s,c.length))??0)));
  }
  progress=s;if(s>c.length+18&&car.wheels.some(w=>w.contact))break;
 }
 return {id:c.id,finished:progress>c.length+18&&sideError<c.width/2-1&&maxRoll<55,peakM:+peak.toFixed(2),maxRollDeg:+maxRoll.toFixed(1),maxOffCentreM:+sideError.toFixed(2),airSeconds:+(air/120).toFixed(3),landed};
}
const passes=[];
for(const id of ['model3-performance-2018','roadster','model-y-performance-2026']){
 const vehicle=createVehicle(world,id);
 for(const c of slopeCourses){
  const result=drive(vehicle.vehicle,c);passes.push({vehicle:id,...result});console.log(id,c.id,JSON.stringify(result));
 }
 vehicle.dispose();
}
world.free();
const passed=passes.every(p=>p.finished)&&passes.filter(p=>['D2','D4','D5'].includes(p.id)).every(p=>p.landed&&p.airSeconds>.06);
const report={passed,lanes:slopeCourses.length,solids:solids.length,rayCount,passes};
await fs.mkdir('reports/slope-park',{recursive:true});await fs.writeFile('reports/slope-park/坡道物理验证.json',JSON.stringify(report,null,2)+'\n');
assert.ok(passed,'Inspect course or speed for failed runs');
