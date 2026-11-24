import {laneShift} from './RibbonShape.js';
import {at,distance,project} from './RoadNetwork.js';

// Pin positions are measured along a directed lane at the rear axle. Mark both
// the requested location and the point reachable by road on the map.
export function roadPin(network,point){
 let best=null;
 for(const lane of network.lanes.values()){
  const q=project(lane,point);
  if(!best||q.distance<best.offset){
   best={lane:lane.id,s:q.s,x:q.x,z:q.z,requested:{x:point.x,z:point.z},offset:q.distance};
  }
 }
 return best;
}
export function planToPoint(network,near,goal,pin,avoid){
 const opts={allowStartLaneChange:near.lane.length-near.s>35,avoid};
 const lane=near.lane,final=network.lanes.get(goal);
 // A pin behind the car on this carriageway requires a real trip around the
 // block. A lateral hop to the adjacent lane would still leave it behind.
 if(pin&&(lane===final||lane.adjacent===final)&&near.s>pin.s+1.3){
  let best=[],length=Infinity;
  for(const id of lane.next){
   const tail=network.route(id,goal,{...opts,allowStartLaneChange:false});
   if(!tail.length)continue;
   const cost=tail.reduce((sum,k)=>sum+network.lanes.get(k).length+(avoid?.has(k)?900:0),0);
   if(cost<length){length=cost;best=[lane.id,...tail];}
  }
  return best;
 }
 return network.route(lane.id,goal,opts);
}
// A lateral edge changes carriageway position at the current station. Drawing
// each lane in full adds a second line all the way back to the junction.
export function* routeSections(net,position,route,pin){
 if(!route.length)return;
 const first=net.lanes.get(route[0]);
 let start=project(first,position).s;
 for(let i=0;i<route.length;i++){
  const lane=net.lanes.get(route[i]),next=net.lanes.get(route[i+1]);
  if(next&&lane.adjacent===next){
   const available=pin&&i+1===route.length-1?pin.s:next.length;
   const end=Math.min(available,start+Math.max(18,(position.speed??0)*2.4));
   if(end>=start){yield {from:lane,lane:next,start,end};start=end;}
   continue;
  }
  const end=pin&&i===route.length-1?pin.s:lane.length;
  if(end>=start)yield {lane,start,end};
  start=0;
 }
}
export function sectionPoints({from,lane,start,end}){
 if(!from)return [at(lane,start),...lane.points.filter((_,i)=>lane.cumulative[i]>start&&lane.cumulative[i]<end),at(lane,end)];
 const n=Math.max(2,Math.ceil((end-start)/3));
 return Array.from({length:n+1},(_,i)=>{
  const u=i/n,s=start+(end-start)*u,f=laneShift(u),a=at(from,s),b=at(lane,s);
  return {x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f};
 });
}
export function remainingDistance(net,position,route,pin){
 let total=0;
 for(const section of routeSections(net,position,route,pin)){
  if(!section.from){total+=section.end-section.start;continue;}
  const points=sectionPoints(section);
  for(let i=1;i<points.length;i++)total+=distance(points[i-1],points[i]);
 }
 return total;
}
