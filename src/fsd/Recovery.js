import {opposingIncursion} from './DirectedTrajectory.js';
import {at,distance,project,wrap} from './RoadNetwork.js';
import {overlaps,bodyClearance} from './TrafficSystem.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const offset=(p,d)=>({...p,x:p.x+d*Math.sin(p.yaw),z:p.z+d*Math.cos(p.yaw)});
function advance(p,d,k){
 const mid=p.yaw+d*k/2;
 return {x:p.x+Math.sin(mid)*d,z:p.z+Math.cos(mid)*d,yaw:wrap(p.yaw+d*k)};
}
function footprint(p,ego){
 return {...offset(p,ego.rearAxle),width:ego.width+.18,length:ego.length+.25};
}
function localObstacles(pilot,ego,traffic){
 return [...traffic.actors.filter(a=>distance(a,ego)<34),...(pilot.obstacles??[]).filter(a=>
  distance(a,ego)<30+Math.hypot(a.width,a.length)/2)];
}
function clear(p,ego,obstacles){const box=footprint(p,ego);return obstacles.every(b=>!overlaps(box,b,.1));}

// Short forward/reverse bicycle arcs. Search only when stopped and track the
// chosen arc with ordinary pedals and steering. Never move an actor by hand.
function recoveryRoads(pilot,ego){
 const lanes=pilot.route.slice(0,4).map(id=>pilot.network.lanes.get(id)).filter(Boolean);
 const roads=new Set();
 for(const lane of lanes){
  for(const road of lane.connector?[lane.approach,pilot.network.lanes.get(lane.next[0])]:[lane]){
   if(road&&project(road,ego).distance<32)roads.add(road);
  }
 }
 return [...roads].filter(road=>{
  const reverse=[...roads].some(other=>other.from===road.to&&other.to===road.from);
  return !reverse||Math.cos(at(road,0).yaw-ego.yaw)>=0;
 });
}
export function escapePath(pilot,ego,traffic,vehicle){
 const obstacles=localObstacles(pilot,ego,traffic);
 const routeLanes=pilot.route.slice(0,4).map(id=>pilot.network.lanes.get(id));
 const lanes=new Set(routeLanes);
 for(const lane of routeLanes)if(lane.adjacent)lanes.add(lane.adjacent);
 const roads=recoveryRoads(pilot,ego);
 const goals=[];
 for(const lane of lanes){
  const q=project(lane,ego);if(q.distance>20)continue;
  for(const extra of [7,12,17]){
   const p=at(lane,q.s+extra);
   if(distance(ego,p)<4||distance(ego,p)>25||!clear(p,ego,obstacles))continue;
   goals.push({...p,lane:lane.id});
  }
 }
 if(!goals.length)return null;
 const estimate=p=>Math.min(...goals.map(g=>distance(p,g)+2.7*Math.abs(wrap(p.yaw-g.yaw))));
 const key=(p,dir)=>[Math.round(p.x/1.05),Math.round(p.z/1.05),Math.round(wrap(p.yaw)*8),dir].join(',');
 const curvature=Math.tan(vehicle.config.maxInnerSteer*.78)/vehicle.config.wheelbase;
 const open=[{...ego,cost:0,f:estimate(ego),dir:0}],costs=new Map();
 for(let i=0;open.length&&i<1600;i++){
  let j=0;for(let k=1;k<open.length;k++)if(open[k].f<open[j].f)j=k;
  const p=open[j];open[j]=open.at(-1);open.pop();
  if(goals.some(g=>distance(g,p)<1.65&&Math.abs(wrap(p.yaw-g.yaw))<.30)){
   const path=[];for(let n=p;n.parent;n=n.parent)path.unshift({x:n.x,z:n.z,yaw:n.yaw,dir:n.dir,k:n.k});
   return path;
  }
  for(const dir of [1,-1])for(const k of [0,-curvature,curvature]){
   const m=advance(p,dir*.9,k),n=advance(m,dir*.9,k);
   if(distance(n,ego)>24)continue;
   // Leave room for the actuator to reach the commanded steering angle. Sample
   // the swept footprint as well as the endpoint, particularly on the first arc.
   const startBox=footprint(p,ego),initialIntrusion=opposingIncursion(roads,p,ego);
   const clearance=pose=>{
    if(opposingIncursion(roads,pose,ego)>initialIntrusion+.001)return false;
    const box=footprint(pose,ego);
    return obstacles.every(o=>!overlaps(box,o,.22)||bodyClearance(box,o)>=bodyClearance(startBox,o)+.005);
   };
   if(![.30,.60,.90,1.20,1.50,1.80].every(d=>clearance(advance(p,dir*d,k))))continue;
   const cost=p.cost+1.8*(dir<0?1.4:1)+(p.dir&&dir!==p.dir?3:0)+Math.abs(k)*.9;
   const id=key(n,dir);if(cost>=(costs.get(id)??Infinity)||cost>42)continue;
   costs.set(id,cost);open.push({...n,cost,dir,k,parent:p,f:cost+1.4*estimate(n)});
  }
 }
 return null;
}
export function solidAhead(pilot,ego,control){
 if(!pilot.obstacles?.length||ego.speed>6)return false;
 if(!pilot.staticOrigin||distance(ego,pilot.staticOrigin)>4||pilot.staticSource!==pilot.obstacles){
  pilot.staticSource=pilot.obstacles;pilot.staticOrigin={...ego};
  pilot.staticNearby=pilot.obstacles.filter(o=>distance(ego,o)<13+Math.hypot(o.length,o.width)/2);
 }
 const current=footprint(ego,ego),travel=.9+ego.speed**2/7;
 for(const d of [.55,travel]){
  const box=footprint(advance(ego,d,(control.steer||0)*.16),ego);
  if(pilot.staticNearby.some(o=>overlaps(box,o,.05)&&bodyClearance(box,o)<bodyClearance(current,o)-.035))return true;
 }
 return false;
}
export class Recovery{
 constructor(){this.reset();}
 reset(){this.committed=false;this.path=null;this.since=null;this.retry=0;this.index=0;this.label=null;this.lastMotion=null;this.motionAt=0;}
 control(pilot,ego,vehicle,traffic,reason,near,requestedDrive){
  const now=pilot.time,v=vehicle.forwardSpeed(),signal=near&&pilot.network.light(near.lane,now);
  const red=near&&!near.lane.connector&&signal!==0&&signal!==4&&near.lane.length-near.s<20;
  if(red){this.reset();return null;}
  if(!this.path){
   const body=offset(ego,ego.rearAxle);
   const headOn=traffic.actors.some(a=>{
    const dx=a.x-body.x,dz=a.z-body.z,along=dx*Math.sin(ego.yaw)+dz*Math.cos(ego.yaw);
    const lateral=Math.abs(dx*Math.cos(ego.yaw)-dz*Math.sin(ego.yaw));
    return along>0&&along<9&&lateral<(a.width+ego.width)/2+.25&&Math.cos(a.yaw-ego.yaw)<-.35;
   });
   const pushing=requestedDrive>.12&&!reason;
   const blocked=pushing||reason==='偏离车道保护'||reason==='预测方向异常'||reason==='碰撞风险保护'||reason==='前方固定障碍'||headOn;
   if(!this.committed&&(!blocked||Math.abs(v)>.4)){this.since=null;this.label=null;return null;}
   if(this.committed&&(Math.abs(v)>.25||now<this.retry)){this.label='等待脱困空间';return {brake:1,steer:0};}
   this.since??=now;
   if(now<this.retry&&this.label==='等待脱困空间')return {brake:1,steer:0};
   if(now-this.since<(pushing?6:2.3)||now<this.retry)return null;
   this.retry=now+2;
   // Regular same-direction queues get a legal alternative first. Stay put if
   // every route shares the same queue, and never reverse just for a red light.
   if(!this.committed&&!headOn&&reason==='碰撞风险保护'){
    if(now-this.since>7)pilot.tryDetour(near);
    return null;
   }
   this.committed=true;this.path=escapePath(pilot,ego,traffic,vehicle);
   if(!this.path){this.label='等待脱困空间';return {drive:0,brake:1,steer:0};}
   this.index=0;this.lastMotion={...ego};this.motionAt=now;
   pilot.events.push({time:now,event:'recovery-start',reverse:this.path.some(p=>p.dir<0)});
  }
  let target=this.path[this.index];
  if(distance(ego,target)<.64){
   this.index++;target=this.path[this.index];
   if(!target){this.reset();pilot.events.push({time:now,event:'recovery-complete'});return {brake:1};}
  }
  const dir=target.dir,delta=wrap(Math.atan2(target.x-ego.x,target.z-ego.z)-ego.yaw-(dir<0?Math.PI:0));
  const cfg=vehicle.config,centreMax=Math.atan(cfg.wheelbase/(cfg.wheelbase/Math.tan(cfg.maxInnerSteer)+cfg.frontTrack/2));
  const trackingCurvature=dir*2*Math.sin(delta)/Math.max(.85,distance(ego,target));
  const steer=clamp(Math.atan(cfg.wheelbase*trackingCurvature)/centreMax,-1,1);
  const obstacles=localObstacles(pilot,ego,traffic), k=Math.tan(steer*centreMax)/cfg.wheelbase;
  const horizon=.75+v*v/5;
  const current=footprint(ego,ego),roads=recoveryRoads(pilot,ego),intrusion=opposingIncursion(roads,ego,ego);
  // A bumper can already touch a kerb or a stopped car. In that case allow
  // only moves that measurably increase the existing clearance.
  const safe=[.3,horizon*.65,horizon].every(d=>{
   const pose=advance(ego,dir*d,k);
   if(opposingIncursion(roads,pose,ego)>intrusion+.001)return false;
   const box=footprint(pose,ego);
   return obstacles.every(o=>!overlaps(box,o,.12)||bodyClearance(box,o)>bodyClearance(current,o)+.02);
  });
  if(distance(ego,this.lastMotion)>.30){this.motionAt=now;this.lastMotion={...ego};}
  if(!safe||now-this.motionAt>3||Math.abs(delta)>1.9){
   this.path=null;this.retry=now+1.0;this.label='等待脱困空间';return {brake:1,steer:0};
  }
  this.label=dir<0?'低速倒车脱困':'低速重新汇入';
  const targetSpeed=dir<0?1.4:2.2;
  return {drive:v*dir<-.18?0:dir*clamp((targetSpeed-v*dir)*.24,0,.24),brake:v*dir<-.18?.8:clamp((v*dir-targetSpeed)*.4,0,1),steer};
 }
}
