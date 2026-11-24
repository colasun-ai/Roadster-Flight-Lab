import {MapFeatureIndex} from './MapFeatureIndex.js';
import {directedTrajectory} from './DirectedTrajectory.js';
import {Recovery,solidAhead} from './Recovery.js';
import {planToPoint} from './PointNavigation.js';
import {maneuverGuidance} from './ManeuverGuidance.js';
import {distance,project,wrap,at} from './RoadNetwork.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function rearAxleState(vehicle){
 const{p,q}=vehicle.rootPose(),yaw=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.z*q.z)),rear=vehicle.wheels[2].center[2],v=vehicle.body.linvel();
 return{x:p.x+Math.sin(yaw)*rear,z:p.z+Math.cos(yaw)*rear,yaw,vx:v.x,vz:v.z,speed:Math.max(0,vehicle.forwardSpeed()),length:vehicle.config.chassisLength??(vehicle.config.wheelbase+1.8),width:vehicle.config.frontTrack+.27,rearAxle:-rear,id:'ego'};
}
export function trafficVehicleState(vehicle){const state=rearAxleState(vehicle),{p}=vehicle.rootPose();return{...state,x:p.x,z:p.z};}
export function trackPrediction(vehicle,prediction,time){
 const ego=rearAxleState(vehicle),age=Math.max(0,time-prediction.sourceTime),origin=prediction.origin;
 const path=[{...origin,t:0},...prediction.points];
 const steeringPath=prediction.trackingPath??path;
 let best=Infinity,nearest=1,fraction=0;
 for(let i=1;i<steeringPath.length;i++){
  const a=steeringPath[i-1],b=steeringPath[i];
  if(prediction.guided&&a.t>age+1.25)break;
  const dx=b.x-a.x,dz=b.z-a.z;
  const f=clamp(((ego.x-a.x)*dx+(ego.z-a.z)*dz)/Math.max(1e-8,dx*dx+dz*dz),0,1);
  const d=Math.hypot(ego.x-a.x-f*dx,ego.z-a.z-f*dz);
  if(d<best){best=d;nearest=i;fraction=f;}
 }
 let target=steeringPath.at(-1);
 const preview=prediction.guided?(prediction.bendSpeed<12?.60:.95):(prediction.directionGuard?.60:ego.speed>12?1.05:.68);
 let remaining=Math.max(2.7,ego.speed*preview);
 for(let i=nearest;i<steeringPath.length;i++){
  const a=steeringPath[i-1],b=steeringPath[i],length=distance(a,b),start=i===nearest?fraction:0;
  if(length*(1-start)>=remaining){
   const f=start+remaining/length;
   target={x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f};break;
  }
  remaining-=length*(1-start);
 }
 const heading=wrap(Math.atan2(target.x-ego.x,target.z-ego.z)-ego.yaw),L=Math.max(2,distance(ego,target));
 const lateralAcceleration=2*ego.speed*ego.speed*Math.sin(heading)/L;
 const curvature=ego.speed>10?clamp(lateralAcceleration,-3.6,3.6)/(ego.speed**2):2*Math.sin(heading)/L;
 const yawCorrection=ego.speed>10?clamp(.14*(curvature*ego.speed-vehicle.body.angvel().y),-.10,.10):0;
 const desiredAngle=Math.atan(vehicle.config.wheelbase*curvature)+yawCorrection;
 const C=vehicle.config,centreMax=Math.atan(C.wheelbase/(C.wheelbase/Math.tan(C.maxInnerSteer)+C.frontTrack/2));
 const limit=centreMax/(1+ego.speed/10+ego.speed*ego.speed/1800);
 const i=Math.min(14,Math.max(0,Math.floor((age+.6)/.5))),motion=prediction.decodedPoints??prediction.points;
 const a=i?motion[i-1]:origin,b=motion[i],desiredSpeed=Math.min(distance(a,b)/.5,prediction.bendSpeed??Infinity);
 if(distance(ego,target)<1&&desiredSpeed<.35)return{drive:0,brake:1,steer:0,targetSpeed:desiredSpeed,headingError:0,crossTrack:best};
 const error=desiredSpeed-ego.speed,drive=clamp(error*.24,0,.55),brake=clamp(-error*.22,0,1);
 return{drive,brake,steer:clamp(desiredAngle/Math.max(.02,limit),-1,1),targetSpeed:desiredSpeed,headingError:heading,crossTrack:best};
}
export class Autopilot{
 constructor(network,bridge){Object.assign(this,{recovery:new Recovery(),avoid:new Set(),avoidUntil:0,queueSince:new Map(),pin:null,network,bridge,enabled:false,busy:false,prediction:null,error:null,status:'手动驾驶',time:0,nextSample:0,nextInference:0,histories:new Map(),records:[],events:[],inferences:0,epoch:0,safetyEnabled:true,assertive:true,passLane:null,lastChange:-20,maneuver:null,safetyReason:null,route:[],destination:null,lastRequestMs:0});}
 set mapFeatures(features){this.featureIndex=features?.length?new MapFeatureIndex(features):null;}
 startSession(){
  this.time=0;this.inferences=0;this.lastRequestMs=0;this.error=null;
  this.events=[];this.records=[];this.lastControl=null;this.requestCorridor=null;
  this.reset('城市已就绪 · 手动驾驶');
 }
 reset(reason='已退出自动驾驶'){this.changePlan=null;this.followReason=null;this.overtake=null;this.recovery.reset();this.queueSince.clear();this.avoid.clear();this.passLane=null;this.lastChange=-20;this.maneuver=null;this.enabled=false;this.prediction=null;this.histories.clear();this.nextSample=this.time;this.nextInference=this.time;this.epoch++;this.status=reason;this.safetyReason=null;this.events.push({time:this.time,event:'reset',reason});}
 routeFrom(near){return planToPoint(this.network,near,this.destination,this.pin,this.avoid);}
 tryDetour(near,blocked=this.route.find((id,i)=>i>0&&this.network.lanes.get(id).connector)){
  if(!near||!blocked||this.time<this.avoidUntil||this.route.length<3||blocked===this.destination)return;
  this.avoid.add(blocked);const alternate=this.routeFrom(near);
  if(alternate.length&&!alternate.includes(blocked)){
   this.route=alternate;this.avoidUntil=this.time+75;this.events.push({time:this.time,event:'detour',avoided:blocked});
  }else{this.avoid.delete(blocked);this.avoidUntil=this.time+5;}
 }
 observeQueues(near,actors){
  if(!near||this.avoid.size)return;
  const entries=this.route.slice(1,6).map(id=>this.network.lanes.get(id)).filter(l=>!l.connector);
  const blocked=new Set();
  for(const lane of entries){
   if(this.network.light(lane,this.time)===2)continue;
   const queue=actors.filter(a=>a.lane===lane&&a.speed<.45&&a.s<34);
   if(queue.length<2)continue;
   blocked.add(lane.id);
   if(!this.queueSince.has(lane.id))this.queueSince.set(lane.id,this.time);
   if(this.time-this.queueSince.get(lane.id)>5)this.tryDetour(near,lane.id);
  }
  for(const id of this.queueSince.keys())if(!blocked.has(id))this.queueSince.delete(id);
 }
 setDestination(vehicle,destination,pin=null){
  const ego=rearAxleState(vehicle),near=this.network.nearest(ego,ego.yaw);
  this.changePlan=null;this.followReason=null;this.overtake=null;this.recovery.reset();this.queueSince.clear();this.avoid.clear();this.avoidUntil=0;this.passLane=null;this.maneuver=null;
  const pavement=this.network.nearest(ego);
  this.wrongWayStart=!!(pavement&&!pavement.lane.connector&&pavement.s>ego.length&&pavement.lane.length-pavement.s>ego.length&&
   pavement.distance<1.82&&Math.cos(pavement.yaw-ego.yaw)<-.55);
  this.destination=destination;this.pin=pin;this.route=this.routeFrom(near);this.prediction=null;this.epoch++;
 }
 engage(vehicle){if(this.destination)this.setDestination(vehicle,this.destination,this.pin);if(!this.destination)this.setDestination(vehicle,this.network.roads.find(l=>distance(at(l,l.length),rearAxleState(vehicle))>160).id);this.enabled=true;this.status='等待真实预测';this.error=null;this.events.push({time:this.time,event:'engage'});}
 disengage(reason){this.changePlan=null;this.followReason=null;this.overtake=null;this.passLane=null;this.recovery.reset();this.enabled=false;this.epoch++;this.prediction=null;this.status=reason;this.safetyReason=null;this.events.push({time:this.time,event:'disengage',reason});}
 sample(dt,vehicle,traffic){
  this.time+=dt;if(this.time+1e-7<this.nextSample)return;this.nextSample=this.time+.1;
  const ego=rearAxleState(vehicle),actors=[ego,...traffic.actors];
  for(const a of actors){const h=this.histories.get(a.id)||[];h.push({time:this.time,x:a.x,z:a.z,yaw:a.yaw,vx:a.vx??Math.sin(a.yaw)*a.speed,vz:a.vz??Math.cos(a.yaw)*a.speed});while(h.length>25)h.shift();this.histories.set(a.id,h);}
 }
 locate(ego){
  const nearest=this.network.nearest(ego,ego.yaw);
  if(!nearest||!this.route.length)return nearest;
  // Only advance onto a connected continuation while the planned movement
  // still fits. Crossing paths often overlap in the middle of an intersection.
  const current=this.network.lanes.get(this.route[0]);
  if(this.assertive&&current?.adjacent===nearest.lane&&!this.changePlan&&!this.recovery.committed){
   const q=project(current,ego);
   if(q.distance<3.6&&Math.abs(wrap(ego.yaw-q.yaw))<.65)return {...q,lane:current};
  }
  let best=null;
  for(const id of this.route.slice(0,3)){
   const lane=this.network.lanes.get(id),q=project(lane,ego);
   if(q.distance>Math.min(4.5,nearest.distance+1.9)||Math.abs(wrap(ego.yaw-q.yaw))>1.26)continue;
   const candidate={...q,lane};
   if(lane===nearest.lane)return nearest;
   if(!best||q.distance<best.distance)best=candidate;
  }
  if(best && (nearest.lane.connector||best.lane.connector||nearest.lane.from===best.lane.to&&nearest.lane.to===best.lane.from))return best;
  return nearest;
 }
 state(vehicle,traffic){
  const dimensions=rearAxleState(vehicle),history=this.histories.get('ego');if(!history||history.length<21)return null;
  // The decoder uses the last 10 Hz history pose as its coordinate origin.
  // Build guidance and label its timestamp at that exact same pose.
  const origin=history.at(-1),ego={...dimensions,...origin,
   speed:Math.max(0,origin.vx*Math.sin(origin.yaw)+origin.vz*Math.cos(origin.yaw))};
  const pack=a=>({id:a.id,length:a.length,width:a.width,...(a.id==='ego'?{rearAxle:a.rearAxle}:{}),history:this.histories.get(a.id).slice(-21).map(({time,...v})=>v)});
  const nearby=traffic.actors.filter(a=>distance(a,ego)<60&&this.histories.get(a.id)?.length>=21).sort((a,b)=>distance(a,ego)-distance(b,ego)).slice(0,20);
  const near=this.locate(ego);if(this.time>=this.avoidUntil)this.avoid.clear();if(near&&this.destination)this.route=this.routeFrom(near);
  if(this.assertive)this.observeQueues(near,traffic.actors);
  // Gap checks also see fast approaching traffic outside the decoder's 20-agent input.
  const sampledActors=traffic.actors.filter(a=>distance(a,ego)<140).map(actor=>{
   const h=this.histories.get(actor.id)?.at(-1);
   return h?{...actor,...h,speed:Math.hypot(h.vx,h.vz)}:actor;
  });
  const advice=near?maneuverGuidance(this,near,ego,sampledActors):null;
  this.requestCorridor=advice?.corridor;
  const guided=this.assertive?advice:null;
  const lanes=this.network.modelLanes(ego,guided?.route??this.route,this.time,85,!!guided);
  return{guidance:guided?.aim,requestId:++this.inferences,time:origin.time,ego:pack(ego),agents:nearby.map(pack),lanes,features:this.featureIndex?.nearby(ego,400-lanes.length)??[],origin:history.at(-1)};
 }
 async update(vehicle,traffic){
  if(!this.enabled||this.busy||this.time<this.nextInference)return;
  const state=this.state(vehicle,traffic);if(!state){this.status='采集 2 秒驾驶历史';return;}
  if(!this.prediction)this.status='正在等待本地模型首次预测';
  const corridor=this.requestCorridor,dimensions={...rearAxleState(vehicle),speed:Math.hypot(state.origin.vx,state.origin.vz)};
  this.busy=true;const epoch=this.epoch,start=performance.now();this.nextInference=this.time+.16;
  try{const result=await this.bridge.predict(state);if(epoch!==this.epoch)return;
   if(result.error)throw Error(result.error);if(result.model!=='official-plan-r1-fine-tuning'||result.points.length!==16||!result.points.every(p=>[p.x,p.z,p.yaw,p.t].every(Number.isFinite)))throw Error('无效模型预测');
   this.prediction=directedTrajectory(result,state.origin,corridor,dimensions,!!state.guidance);this.lastRequestMs=performance.now()-start;this.error=null;this.status=this.prediction?.guided?'Plan-R1 · 车道跟踪':this.prediction?.directionGuard?'保持同向车道':this.prediction?'Plan-R1 正在驾驶':'等待可行车道';
   this.records.push({time:this.time,followReason:this.followReason,input:state,rawPrediction:result,directedPoints:(this.prediction?.guided||this.prediction?.directionGuard)?this.prediction.points:undefined,latencyMs:this.lastRequestMs});if(this.records.length>180)this.records.shift();
  }catch(error){if(epoch===this.epoch){this.error=error.message;this.prediction=null;this.status='推理失败 · 制动等待';this.events.push({time:this.time,event:'inference-error',error:error.message});}}
  finally{this.busy=false;}
 }
 control(vehicle,traffic,manual){
  if(!this.enabled)return null;
  if(manual.drive||manual.steer||manual.brake||manual.handbrake||manual.boost||manual.lift||manual.descend||manual.pitch||manual.roll||manual.yaw){this.disengage('驾驶员已接管');return manual;}
  const pose=vehicle.rootPose(),upY=1-2*(pose.q.x*pose.q.x+pose.q.z*pose.q.z);
  if(vehicle.thrusters?.flightArmed||pose.p.y>1||upY<.5){this.disengage('飞行或翻滚已退出地面 FSD');return manual;}
  if(this.wrongWayStart){this.disengage('车头朝向逆行，请在本侧摆正后启用');return {brake:1};}
  const p=this.prediction;this.safetyReason=null;
  if(!p||this.time-p.sourceTime>1.1){this.safetyReason=p?'预测已过期':'等待模型';return{brake:1};}
  const control=trackPrediction(vehicle,p,this.time),ego=rearAxleState(vehicle);
  const goal=this.network.lanes.get(this.destination),goalPosition=goal?project(goal,ego):null;
  const finalApproach=this.route.length===1&&this.route[0]===this.destination&&goalPosition&&
   goalPosition.distance<2.5&&Math.abs(wrap(ego.yaw-goalPosition.yaw))<.8;
  if(finalApproach&&(this.pin?distance(ego,this.pin)<1.35:goal.length-goalPosition.s<7)){
   control.drive=0;control.brake=1;this.safetyReason='导航到达制动';
   if(ego.speed<.25)this.disengage('已到达目的地');
   return control;
  }
  if(finalApproach){
   // The raw decoder has no point-stop target. Apply the same destination
   // braking envelope to both driving styles while keeping the prediction intact.
   const ahead=(this.pin?.s??goal.length-5)-goalPosition.s;
   if(ahead>0&&ahead<ego.speed*ego.speed/4+6){
    const allowed=Math.sqrt(4*Math.max(0,ahead-.7));
    if(ego.speed>allowed){control.drive=0;control.brake=Math.max(control.brake,clamp((ego.speed-allowed)*.38,0,1));}
   }
  }
  if(this.safetyEnabled){
   const near=this.locate(ego),next=near?.lane;
   if(near?.distance>2.6)this.safetyReason='偏离车道保护';
   if(next&&!next.connector&&this.network.light(next,this.time)===2&&next.length-near.s<ego.speed*ego.speed/8+ego.length/2+2)this.safetyReason='红灯保护';
   for(const actor of traffic.actors){const dx=actor.x-ego.x,dz=actor.z-ego.z,along=dx*Math.sin(ego.yaw)+dz*Math.cos(ego.yaw),cross=dx*Math.cos(ego.yaw)-dz*Math.sin(ego.yaw);if(along>0&&along<ego.length+Math.max(1,ego.speed*1.1)&&Math.abs(cross)<(ego.width+actor.width)*.45){this.safetyReason='碰撞风险保护';break;}}
   if(!this.safetyReason&&(control.headingError>1.2||control.headingError< -1.2))this.safetyReason='预测方向异常';
   if(!this.safetyReason&&solidAhead(this,ego,control))this.safetyReason='前方固定障碍';
   const escape=this.recovery.control(this,ego,vehicle,traffic,this.safetyReason,near,control.drive);
   if(escape){this.safetyReason=this.recovery.label;this.lastControl={...escape,time:this.time,safetyReason:this.safetyReason};return escape;}
  }
  if(this.safetyReason){control.drive=0;control.brake=1;}
  this.lastControl={...control,time:this.time,safetyReason:this.safetyReason};
  const last=this.records.at(-1);if(last)last.latestControl=this.lastControl;
  return control;
 }
 telemetry(){return{pin:this.pin,recovery:this.recovery.label,detour:this.avoid.size>0,enabled:this.enabled,status:this.status,error:this.error,inferences:this.inferences,busy:this.busy,latencyMs:this.lastRequestMs,sourceTime:this.prediction?.sourceTime,age:this.prediction?this.time-this.prediction.sourceTime:null,directionGuard:!!this.prediction?.directionGuard,rawPoints:this.prediction?this.records.at(-1)?.rawPrediction.points??[]:[],route:this.route,destination:this.destination,safetyEnabled:this.safetyEnabled,safetyReason:this.safetyReason,control:this.lastControl,events:this.events.slice(-50)};}
}
