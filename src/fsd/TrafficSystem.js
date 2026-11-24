import RAPIER from '@dimforge/rapier3d-compat';
import {at,project,distance,wrap} from './RoadNetwork.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function idm({speed,desiredSpeed,gap=Infinity,closingSpeed=0,timeHeadway=1.5,minGap=2,acceleration=1.5,deceleration=2.2}){
 const target=minGap+Math.max(0,speed*timeHeadway+speed*closingSpeed/(2*Math.sqrt(acceleration*deceleration)));
 return acceleration*(1-(speed/Math.max(1,desiredSpeed))**4-(Number.isFinite(gap)?(target/Math.max(.1,gap))**2:0));
}
export function mobil({currentAcceleration,newAcceleration,newFollowerBefore=0,newFollowerAfter=0,oldFollowerBefore=0,oldFollowerAfter=0,politeness=.35,threshold=.25,safeBrake=3}){
 return newFollowerAfter>=-safeBrake&&newAcceleration-currentAcceleration+politeness*(newFollowerAfter-newFollowerBefore+oldFollowerAfter-oldFollowerBefore)>threshold;
}
export function overlaps(a,b,margin=.12){
 const dx=b.x-a.x,dz=b.z-a.z;
 for(const yaw of [a.yaw,b.yaw])for(const side of [0,Math.PI/2]){const x=Math.sin(yaw+side),z=Math.cos(yaw+side),extent=v=>Math.abs(x*Math.sin(v.yaw)+z*Math.cos(v.yaw))*v.length/2+Math.abs(x*Math.cos(v.yaw)-z*Math.sin(v.yaw))*v.width/2;if(Math.abs(dx*x+dz*z)>extent(a)+extent(b)+margin)return false;}
 return true;
}
// Signed separating-axis distance. Positive is clear, negative is penetration.
export function bodyClearance(a,b){
 const dx=b.x-a.x,dz=b.z-a.z;
 let gap=-Infinity;
 for(const yaw of [a.yaw,b.yaw])for(const side of [0,Math.PI/2]){
  const x=Math.sin(yaw+side),z=Math.cos(yaw+side);
  const half=v=>Math.abs(x*Math.sin(v.yaw)+z*Math.cos(v.yaw))*v.length/2+
   Math.abs(x*Math.cos(v.yaw)-z*Math.sin(v.yaw))*v.width/2;
  gap=Math.max(gap,Math.abs(dx*x+dz*z)-half(a)-half(b));
 }
 return gap;
}
export function clearRoadPose(network,lane,s,obstacles,dimensions,margin=2){
 const lanes=[lane,...network.roads.filter(l=>l!==lane)];
 for(const road of lanes)for(const position of [Math.min(s,road.length-10),16,28,40,52,64]){
  if(position>road.length-10)continue;const pose=at(road,position),candidate={...pose,length:dimensions.length,width:dimensions.width};
  if(obstacles.every(a=>!overlaps(candidate,a,margin)))return{lane:road,s:position,...pose};
 }
 throw Error('城市暂时没有安全的车辆出生位置');
}
export class TrafficSystem{
 constructor(network,world,count=12,seed=20261122,avoid=[]){
  Object.assign(this,{network,world,actors:[],time:0,decisionTimer:0,events:[],seed,reservations:new Map(),passages:new Map(),conflicts:new Map()});
  const random=()=>{this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;};this.random=random;
  const candidates=[...network.roads];
  for(let i=candidates.length-1;i>0;i--){
   const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];
  }
  const focus=avoid[0]??{x:1000,z:600};
  const local=candidates.filter(l=>project(l,focus).distance<420),localSet=new Set(local);
  const spawnRoads=[...local.slice(0,Math.ceil(count*.72)),...candidates.filter(l=>!localSet.has(l)),...local];
  for(let i=0;i<count;i++){
   const lane=spawnRoads[i%spawnRoads.length],style=['cautious','normal','assertive'][i%3],actor={id:'traffic-'+i,lane,s:10+(i*13)%50,speed:3+random()*4,acceleration:0,style,desiredSpeed:style==='cautious'?10:style==='normal'?12:13.5,headway:style==='cautious'?1.9:style==='normal'?1.5:1.15,length:4.85,width:2.0,route:[],destination:null,indicator:'off',braking:false,history:[],wheelAngle:0,steer:0,laneChange:null,lastChange:-10};
   const pose=clearRoadPose(network,lane,actor.s,[...this.actors,...avoid],actor,.12);actor.lane=pose.lane;actor.s=pose.s;Object.assign(actor,{x:pose.x,z:pose.z,yaw:pose.yaw});this.destination(actor);
   const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(actor.x,.65,actor.z).setRotation({x:0,y:Math.sin(actor.yaw/2),z:0,w:Math.cos(actor.yaw/2)}));
   world.createCollider(RAPIER.ColliderDesc.cuboid(.98,.6,2.37).setFriction(.5).setRestitution(.02),body);actor.body=body;this.actors.push(actor);
  }
 }
 destination(actor,atJunction=false){
  const goals=this.network.roads.filter(l=>l!==actor.lane&&distance(at(l,0),at(actor.lane,actor.s))>100),goal=goals[Math.floor(this.random()*goals.length)];
  actor.destination=goal.id;actor.route=this.network.route(actor.lane.id,goal.id,{allowStartLaneChange:!atJunction});actor.routeIndex=0;
 }
 gap(actor,lane=actor.lane,s=actor.s,ego=null){
  let result={gap:Infinity,closingSpeed:0,leader:null};const list=[...this.actors,...(ego?[ego]:[])];
  const path=[lane.id];
  for(const id of actor.route.slice(actor.routeIndex+1,actor.routeIndex+4)){
   const last=this.network.lanes.get(path.at(-1));
   if(!last.next.includes(id))break;
   path.push(id);
  }
  for(const other of list){if(other===actor)continue;let along=null,offset=-s;
   for(const id of path){const road=this.network.lanes.get(id);if(!road)break;const q=project(road,other);if(q.distance<1.85&&Math.abs(wrap(q.yaw-other.yaw))<1.2){along=offset+q.s;break;}offset+=road.length;}
   if(along!==null&&along> -actor.length*.5){const gap=along-(actor.length+other.length)/2;if(gap<result.gap)result={gap,closingSpeed:actor.speed-other.speed,leader:other.id};}
  }
  return result;
 }
 pathsConflict(first,second){
  if(first===second||first.next[0]===second.next[0])return true;
  const key=[first.id,second.id].sort().join('|');
  if(this.conflicts.has(key))return this.conflicts.get(key);
  const footprints=lane=>{
   const steps=Math.ceil(lane.length/1.5);
   return Array.from({length:steps+1},(_,i)=>({...at(lane,i*lane.length/steps),length:5.8,width:2.35}));
  };
  const other=footprints(second);
  const conflict=footprints(first).some(a=>other.some(b=>distance(a,b)<7&&overlaps(a,b)));
  this.conflicts.set(key,conflict);
  return conflict;
 }
 acceleration(actor,lane=actor.lane,s=actor.s,ego=null){
  let lead=this.gap(actor,lane,s,ego),light=this.network.light(lane,this.time),stopDistance=lane.length-s-actor.length/2-1;
  if(!lane.connector&&light!==0&&light!==4&&stopDistance>-.5&&stopDistance<lead.gap)lead={gap:stopDistance,closingSpeed:actor.speed,leader:'signal'};
  // Predict intersecting paths at junctions. Equal rules apply to ego and NPCs.
  const next=this.network.lanes.get(actor.route[actor.routeIndex+1]);
  if(!lane.connector&&next?.connector){const owner=this.reservations.get(next.junction.id);if(owner&&!this.passages.get(next.junction.id)?.has(actor.id)&&stopDistance<lead.gap)lead={gap:Math.max(.1,stopDistance),closingSpeed:actor.speed,leader:'junction-reservation'};}
  if(!lane.connector&&next?.connector&&stopDistance<25){
   const center=next.junction;
   for(const other of [...this.actors,...(ego?[ego]:[])]){
    if(other===actor||distance(other,center)>22)continue;
    const occupied=other.lane?.connector||distance(other,center)<9;
    const heldByReservation=this.passages.get(center.id)?.has(actor.id)&&this.actors.includes(other)&&!other.lane?.connector;
    const priority=!heldByReservation&&next.turn>.4&&other.speed>.5&&Math.cos(other.yaw-at(lane,lane.length).yaw)<-.5;
    const compatible=other.lane?.connector&&other.lane.junction===center&&!this.pathsConflict(next,other.lane);
    const nearConflict=occupied&&!compatible&&Math.abs(wrap(other.yaw-at(lane,lane.length).yaw))>.5;
    if(priority||nearConflict){lead={gap:Math.min(lead.gap,Math.max(.2,stopDistance)),closingSpeed:actor.speed,leader:'junction-conflict'};break;}
   }
  }
  if(actor.laneChange){
   const target=this.gap(actor,actor.laneChange.to,actor.s,ego);
   if(target.gap<lead.gap)lead=target;
  }
  const cruise=actor.desiredSpeed*(lane.kind==='highway'||lane.kind==='tunnel'?1.95:1);
  const approachCap=next?.connector?Math.sqrt(next.speedLimit**2+4*Math.max(0,stopDistance)):Infinity;
  return clamp(idm({speed:actor.speed,desiredSpeed:Math.min(cruise,lane.speedLimit,approachCap),...lead,timeHeadway:actor.headway}),-7,2.2);
 }
 decide(ego){
  // Acquire a junction before entering its conflict zone. Keep the first
  // entrant until its tail clears; equal FIFO rules apply to every NPC.
  // This prevents two perpendicular cars from reaching a mutual OBB stop.
  const groups=new Map(), all=ego?[...this.actors,ego]:this.actors;
  for(const actor of this.actors){
   if(!actor.lane.connector&&actor.lane.length-actor.s<Math.max(35,actor.speed*3+16)&&!actor.laneChange){
    if(actor.routeIndex>=actor.route.length-1)this.destination(actor,true);
    else if(actor.route[actor.routeIndex+1]===actor.lane.adjacent?.id){
     actor.route=this.network.route(actor.lane.id,actor.destination,{allowStartLaneChange:false});actor.routeIndex=0;
    }
   }
   const junctionPath=actor.lane.connector?actor.lane:this.network.lanes.get(actor.route[actor.routeIndex+1]);
   if(!junctionPath?.connector || !actor.lane.connector && actor.lane.length-actor.s>Math.max(24,actor.speed*2)) {
    actor.waitingJunction=null;continue;
   }
   const id=junctionPath.junction.id;
   if(actor.waitingJunction!==id){actor.waitingJunction=id;actor.junctionArrival=this.time;}
   if(!groups.has(id))groups.set(id,[]);
   groups.get(id).push({actor,junctionPath});
  }
  for(const [id,group] of groups){
   // A queued follower used to reserve the intersection ahead of its own
   // leader. Admit only a lane head whose exit has room for its entire car.
   const atHead=entry=>!group.some(other=>other.actor.lane===entry.actor.lane&&other.actor.s>entry.actor.s);
   const exitClear=entry=>{
    const exit=this.network.lanes.get(entry.junctionPath.next[0]),mouth=at(exit,0);
    return !all.some(b=>b!==entry.actor&&distance(b,mouth)<9&&project(exit,b).distance<1.65);
   };
   const laneHeads=group.filter(entry=>!entry.actor.lane.connector&&atHead(entry)&&exitClear(entry));
   const eligible=[...group.filter(e=>e.actor.lane.connector),...laneHeads.filter(e=>[0,4].includes(this.network.light(e.actor.lane,this.time)))];
   eligible.sort((a,b)=>Number(b.actor.lane.connector)-Number(a.actor.lane.connector)||
    a.actor.junctionArrival-b.actor.junctionArrival||a.actor.id.localeCompare(b.actor.id));
   // Long junctions can take longer to clear than the change of lights.
   // Reserve the next usable gap for a waiting lane head; moving vehicles
   // already inside always finish, and a waiting red signal never grants entry.
   const priority=laneHeads.filter(e=>this.time-e.actor.junctionArrival>13&&
    (eligible.includes(e)||this.network.light(e.actor.lane,this.time+7)===0)
   ).sort((a,b)=>a.actor.junctionArrival-b.actor.junctionArrival)[0];
   const previous=this.passages.get(id);
   const inBox=eligible.find(e=>e.actor.lane.connector);
   const owner=inBox??eligible.find(e=>e.actor.id===this.reservations.get(id))??eligible[0];
   // Sentinel blocks entry until downstream traffic clears.
   this.reservations.set(id,owner?.actor.id??'occupied-exit');
   const granted=eligible.filter(e=>e.actor.lane.connector);
   for(const entry of [owner,...eligible.filter(e=>previous?.has(e.actor.id)),...eligible]){
    if(!entry||granted.includes(entry))continue;
    if(priority&&entry!==priority&&this.pathsConflict(priority.junctionPath,entry.junctionPath))continue;
    if(granted.every(e=>!this.pathsConflict(e.junctionPath,entry.junctionPath)))granted.push(entry);
   }
   this.passages.set(id,new Set(granted.map(e=>e.actor.id)));
  }
  for(const id of this.reservations.keys())if(!groups.has(id)){this.reservations.delete(id);this.passages.delete(id);}
  for(const actor of this.actors){
   actor.acceleration=this.acceleration(actor,actor.lane,actor.s,ego);
   const lane=actor.lane,target=lane.adjacent;
   if(target&&!actor.laneChange&&this.time-actor.lastChange>6&&actor.s>12&&actor.s<lane.length-Math.max(35,actor.speed*3+16)){
    const q=project(target,actor),nextAcceleration=this.acceleration(actor,target,q.s,ego);
    const followers=this.actors.filter(a=>a!==actor&&a.lane===target&&a.s<q.s).sort((a,b)=>b.s-a.s),follower=followers[0];
    const before=follower?this.acceleration(follower,target,follower.s,ego):0;
    const after=follower?idm({speed:follower.speed,desiredSpeed:follower.desiredSpeed,gap:q.s-follower.s-4.85,closingSpeed:follower.speed-actor.speed,timeHeadway:follower.headway}):0;
    const routeNeeds=actor.route[actor.routeIndex+1]===target.id;
    if((routeNeeds&&q.s-(follower?.s??-100)>12&&this.gap(actor,target,q.s,ego).gap>10)||mobil({currentAcceleration:actor.acceleration,newAcceleration:nextAcceleration,newFollowerBefore:before,newFollowerAfter:after,politeness:actor.style==='assertive'?.2:.5})){
     actor.laneChange={from:lane,to:target,start:this.time,progress:0};actor.indicator=lane.index===0?'right':'left';actor.lastChange=this.time;
     this.events.push({time:this.time,event:'mobil-lane-change',id:actor.id,incentive:nextAcceleration-actor.acceleration,followerAfter:after});
    }
   }
   if(!actor.laneChange){const next=this.network.lanes.get(actor.route[actor.routeIndex+1]);actor.indicator=next?.connector&&lane.length-actor.s<28?(next.turn>.3?'left':next.turn<-.3?'right':'off'):'off';}
  }
  this.events=this.events.slice(-200);
 }
 step(dt,ego){
  this.time+=dt;this.decisionTimer-=dt;if(this.decisionTimer<=0){this.decide(ego);this.decisionTimer+=.1;}
  for(const actor of this.actors){
   const beforeLane=actor.lane,beforeS=actor.s,beforeIndex=actor.routeIndex,beforeRoute=actor.route,beforeGoal=actor.destination;
   const old=actor.speed;actor.speed=Math.max(0,actor.speed+actor.acceleration*dt);const travelled=(old+actor.speed)*.5*dt;actor.s+=travelled;actor.braking=actor.acceleration<-.5;
   while(actor.s>=actor.lane.length){
    if(!actor.lane.connector&&!this.passages.get(actor.lane.to.id)?.has(actor.id)){
     actor.s=actor.lane.length-.001;actor.speed=0;actor.braking=true;break;
    }
    actor.s-=actor.lane.length;let nextId=actor.route[++actor.routeIndex];
    if(nextId===actor.lane.adjacent?.id){actor.route=this.network.route(actor.lane.id,actor.destination,{allowStartLaneChange:false});actor.routeIndex=1;nextId=actor.route[1];}
    if(!nextId){this.destination(actor,true);nextId=actor.route[1];actor.routeIndex=1;}
    const next=this.network.lanes.get(nextId);if(!next){actor.s=actor.lane.length;actor.speed=0;break;}actor.lane=next;
   }
   let pose=at(actor.lane,actor.s),completedChange=null;
   if(actor.laneChange){const change=actor.laneChange;change.distance??=Math.max(14,actor.speed*3);change.progress=clamp((change.progress||0)+travelled/change.distance,0,1);const t=change.progress,f=t*t*(3-2*t),target=at(change.to,actor.s);pose={x:pose.x+(target.x-pose.x)*f,z:pose.z+(target.z-pose.z)*f,yaw:pose.yaw+Math.atan2(((target.x-pose.x)*Math.cos(pose.yaw)-(target.z-pose.z)*Math.sin(pose.yaw))*6*t*(1-t),change.distance)};if(t===1)completedChange=change.to;}
   const candidate={...pose,length:actor.length,width:actor.width};
   const blocker=[...this.actors,...(ego?[ego]:[])].find(other=>other!==actor&&distance(candidate,other)<7&&overlaps(candidate,other)&&(!overlaps(actor,other)||bodyClearance(candidate,other)<bodyClearance(actor,other)-1e-6));
   if(blocker){actor.lane=beforeLane;actor.s=beforeS;actor.routeIndex=beforeIndex;actor.route=beforeRoute;actor.destination=beforeGoal;actor.speed=0;actor.braking=true;if(actor.laneChange)actor.laneChange.progress=Math.max(0,actor.laneChange.progress-travelled/actor.laneChange.distance);pose={x:actor.x,z:actor.z,yaw:actor.yaw};this.events.push({time:this.time,event:'collision-risk-stop',id:actor.id,other:blocker.id});}
   else if(completedChange){actor.lane=completedChange;actor.laneChange=null;actor.route=this.network.route(actor.lane.id,actor.destination);actor.routeIndex=0;}
   const movement=distance(pose,actor);actor.wheelAngle+=movement/.3435;actor.steer=clamp(wrap(pose.yaw-actor.yaw)*2.9/Math.max(.001,movement),-.5,.5);Object.assign(actor,pose);
   actor.body.setNextKinematicTranslation({x:actor.x,y:.65,z:actor.z});actor.body.setNextKinematicRotation({x:0,y:Math.sin(actor.yaw/2),z:0,w:Math.cos(actor.yaw/2)});
  }
 }
 dispose(){for(const actor of this.actors)this.world.removeRigidBody(actor.body);this.actors=[];}
}
