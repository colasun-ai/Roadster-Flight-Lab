import {metroLayout, roadSpeed} from './MetroLayout.js';
// One geometry definition drives render meshes, navigation, traffic and Plan-R1.
export const CITY_ORIGIN={x:1000,z:600};
export const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function at(lane,s){
 s=Math.max(0,Math.min(s,lane.length));let i=1;while(i<lane.cumulative.length-1&&lane.cumulative[i]<s)i++;
 const a=lane.points[i-1],b=lane.points[i],f=(s-lane.cumulative[i-1])/Math.max(.001,lane.cumulative[i]-lane.cumulative[i-1]);
 return{x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f,yaw:Math.atan2(b.x-a.x,b.z-a.z)};
}
export function project(lane,p){
 let best={distance:Infinity,s:0};for(let i=1;i<lane.points.length;i++){
  const a=lane.points[i-1],b=lane.points[i],dx=b.x-a.x,dz=b.z-a.z,L=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(L*L))),x=a.x+t*dx,z=a.z+t*dz,d=Math.hypot(p.x-x,p.z-z);
  if(d<best.distance)best={distance:d,s:lane.cumulative[i-1]+t*L,x,z,yaw:Math.atan2(dx,dz)};
 }return best;
}
export class RoadNetwork{
 constructor(){
  const layout=metroLayout();
  for(const node of layout.nodes){
   const groups=[];
   for(const from of node.neighbors){
    const yaw=Math.atan2(node.x-from.x,node.z-from.z);
    let group=groups.find(g=>Math.abs(Math.cos(g.yaw-yaw))>Math.cos(.42));
    if(!group){group={yaw,from:[]};groups.push(group);}
    group.from.push(from.id);
   }
   groups.sort((a,b)=>Math.abs(Math.sin(a.yaw))-Math.abs(Math.sin(b.yaw)));
   node.signalGroups=new Map(groups.flatMap((g,i)=>g.from.map(id=>[id,i])));
   node.phaseCount=groups.length;
  }
  this.nodes=layout.nodes;this.links=layout.links;this.lanes=new Map();
  const add=lane=>{lane.cumulative=[0];for(let i=1;i<lane.points.length;i++)lane.cumulative.push(lane.cumulative.at(-1)+distance(lane.points[i-1],lane.points[i]));lane.length=lane.cumulative.at(-1);lane.next=[];lane.previous=[];lane.speedLimit??=lane.connector?8.33:13.89;const xs=lane.points.map(p=>p.x),zs=lane.points.map(p=>p.z);lane.bounds={x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};this.lanes.set(lane.id,lane);return lane;};
  for(const link of this.links) for(const [a,b] of [[link.a,link.b],[link.b,link.a]]) for(let index=0;index<2;index++){
   const length=distance(a,b), dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
   const offset=(link.median??0)+1.8+index*3.6;
   const trim=n=>n.trim??(['bend','merge'].includes(n.kind)?36:14);
   const start={x:a.x+dx*trim(a)-dz*offset,z:a.z+dz*trim(a)+dx*offset};
   const end={x:b.x-dx*trim(b)-dz*offset,z:b.z-dz*trim(b)+dx*offset};
   add({id:a.id+'>'+b.id+'/'+index,from:a,to:b,index,kind:link.kind,median:link.median??0,connector:false,
    speedLimit:roadSpeed[link.kind]/3.6,points:[start,end]});
  }
  this.roads=[...this.lanes.values()];
  for(const incoming of this.roads)for(const c of incoming.to.neighbors){
   const uturn=c===incoming.from;
   if(uturn&&incoming.to.kind!=='turnaround')continue;
   const a=at(incoming,incoming.length),out=this.lanes.get(`${incoming.to.id}>${c.id}/${incoming.index}`),b=at(out,0),turn=wrap(b.yaw-a.yaw);
   if(incoming.to.kind==='merge'){
    const ramp=incoming.kind==='ramp'||out.kind==='ramp';
    if(ramp&&(Math.abs(turn)>Math.PI*.77||out.kind==='ramp'&&incoming.index!==1))continue;
   }else if(incoming.to.neighbors.length>2&&(turn>.3&&incoming.index!==0||turn<-.3&&incoming.index!==1))continue;
   const control=distance(a,b)*.56,points=[];for(let i=0;i<=16;i++){const t=i/16,u=1-t;points.push({x:u*u*u*a.x+3*u*u*t*(a.x+Math.sin(a.yaw)*control)+3*u*t*t*(b.x-Math.sin(b.yaw)*control)+t*t*t*b.x,z:u*u*u*a.z+3*u*u*t*(a.z+Math.cos(a.yaw)*control)+3*u*t*t*(b.z-Math.cos(b.yaw)*control)+t*t*t*b.z});}
   if(uturn){
    const radius=distance(a,b)/2;
    points.length=0;
    for(let j=0;j<=32;j++){
     const angle=Math.PI*j/32, forward=radius*Math.sin(angle), left=radius*(1-Math.cos(angle));
     points.push({x:a.x+Math.sin(a.yaw)*forward+Math.cos(a.yaw)*left,
                  z:a.z+Math.cos(a.yaw)*forward-Math.sin(a.yaw)*left});
    }
   }
   const lane=add({kind:uturn?'uturn':incoming.to.kind,speedLimit:uturn?4:Math.min(incoming.speedLimit,out.speedLimit,Math.abs(turn)>.5?10:26),id:`turn:${incoming.id}>${out.id}`,connector:true,from:incoming.to,to:incoming.to,index:incoming.index,junction:incoming.to,approach:incoming,turn,points});
   incoming.next.push(lane.id);lane.previous.push(incoming.id);lane.next.push(out.id);out.previous.push(lane.id);
  }
  this.routesByGoal=new Map();
  this.cells=new Map();
  for(const lane of this.lanes.values()){
   const b=lane.bounds;for(let x=Math.floor(b.x0/96);x<=Math.floor(b.x1/96);x++)for(let z=Math.floor(b.z0/96);z<=Math.floor(b.z1/96);z++){const key=x+','+z;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(lane);}
  }
  for(const lane of this.roads)lane.adjacent=this.lanes.get(`${lane.from.id}>${lane.to.id}/${1-lane.index}`);
 }
 nearby(p,r){
  const list=new Set();
  for(let x=Math.floor((p.x-r)/96);x<=Math.floor((p.x+r)/96);x++)for(let z=Math.floor((p.z-r)/96);z<=Math.floor((p.z+r)/96);z++)
   for(const lane of this.cells.get(x+','+z)??[])list.add(lane);
  return list;
 }
 nearest(p,yaw=null){let best=null;
  const search=lanes=>{for(const lane of lanes){if(best&&lane.bounds&&(p.x<lane.bounds.x0-best.distance||p.x>lane.bounds.x1+best.distance||p.z<lane.bounds.z0-best.distance||p.z>lane.bounds.z1+best.distance))continue;const q=project(lane,p);if(yaw!==null&&Math.abs(wrap(q.yaw-yaw))>1.2)continue;if(!best||q.distance<best.distance)best={...q,lane};}};search(this.nearby(p,30));if(!best||best.distance>=30)search(this.lanes.values());return best;}
 route(start,goal,{allowStartLaneChange=true,avoid=null}={}){
  if(!this.lanes.has(start)||!this.lanes.has(goal))return[];
  if(!avoid?.size){
   let tree=this.routesByGoal.get(goal);
   if(!tree){
    const cost=new Map([[goal,0]]),next=new Map(),open=new Set([goal]);
    while(open.size){
     let id=null,least=Infinity;for(const k of open)if(cost.get(k)<least){least=cost.get(k);id=k;}
     open.delete(id);const lane=this.lanes.get(id);
     for(const prev of lane.adjacent?[...lane.previous,lane.adjacent.id]:lane.previous){
      const c=least+(prev===lane.adjacent?.id?20:lane.length);
      if(c<(cost.get(prev)??Infinity)){next.set(prev,id);cost.set(prev,c);open.add(prev);}
     }
    }
    tree={cost,next};this.routesByGoal.set(goal,tree);
   }
   if(start===goal)return [start];
   const first=this.lanes.get(start);
   let id=tree.next.get(start);
   if(!allowStartLaneChange&&id===first.adjacent?.id){
    id=first.next.reduce((best,k)=>!best||this.lanes.get(k).length+tree.cost.get(k)<this.lanes.get(best).length+tree.cost.get(best)?k:best,null);
   }
   const route=[start];while(id){route.push(id);if(id===goal)return route;id=tree.next.get(id);if(id===start)break;}
   if(!id)return [];
  }
  const open=new Set([start]),g=new Map([[start,0]]),prev=new Map(),end=at(this.lanes.get(goal),this.lanes.get(goal).length);
  while(open.size){let id=null,cost=Infinity;for(const candidate of open){const f=g.get(candidate)+distance(at(this.lanes.get(candidate),this.lanes.get(candidate).length),end);if(f<cost){cost=f;id=candidate;}}
   if(id===goal){const result=[id];while(prev.has(result[0]))result.unshift(prev.get(result[0]));return result;}
   open.delete(id);const lane=this.lanes.get(id),edges=[...lane.next,...(lane.adjacent&&(allowStartLaneChange||id!==start)?[lane.adjacent.id]:[])];
   for(const next of edges){const step=this.lanes.get(next),score=g.get(id)+(avoid?.has(next)?900:0)+(next===lane.adjacent?.id?20:step.length);if(score<(g.get(next)??Infinity)){g.set(next,score);prev.set(next,id);open.add(next);}}
  }return[];
 }
 light(lane,time){
  const connector=lane.connector?lane:this.lanes.get(lane.next[0]);if(!connector||connector.junction.kind==='merge'||connector.junction.neighbors.length<3)return 4;
  const incoming=connector.approach,node=incoming.to,count=node.phaseCount;
  if(count<=1)return 4;
  const period=count*20,offset=(node.x+node.z)%11,group=node.signalGroups.get(incoming.from.id);
  const local=((time+offset-group*20)%period+period)%period;
  return local<17?0:local<20?1:2;
 }
 modelLanes(ego,route,time,radius=85,preferredLane=null){
  const onRoute=new Set(route);for(const id of route){const adjacent=this.lanes.get(id)?.adjacent;if(adjacent&&!preferredLane)onRoute.add(adjacent.id);}
  const selected=[...this.nearby(ego,radius)].filter(l=>project(l,ego).distance<radius);
  const present=new Set(selected.map(l=>l.id)),output=[];
  const count=l=>Math.max(1,Math.ceil(l.length/20));
  for(const lane of selected){
   const n=count(lane),adjacent=lane.adjacent;
   if(!lane.modelSegments){
    lane.modelSegments=Array.from({length:n},(_,k)=>{
     const start=k*lane.length/n,end=(k+1)*lane.length/n;
     return {id:lane.id+'#'+k,start,end,center:at(lane,(start+end)/2)};
    });
   }
   const trafficLight=lane.connector?this.light(lane,time):4,routeFlag=onRoute.has(lane.id);
   for(let k=0;k<n;k++){
    const part=lane.modelSegments[k];
    if(distance(part.center,ego)>radius+10)continue;
    if(!part.points){
     const size=Math.ceil((part.end-part.start)/5);
     part.points=Array.from({length:size+1},(_,j)=>{
      const p=at(lane,part.start+(part.end-part.start)*j/size);
      return [p.x,p.z];
     });
    }
    const neighbor=adjacent&&present.has(adjacent.id)?[adjacent.id+'#'+Math.min(k,count(adjacent)-1)]:[];
    const incoming=k?[lane.modelSegments[k-1].id]:lane.previous.filter(id=>present.has(id)).map(id=>id+'#'+(count(this.lanes.get(id))-1));
    const outgoing=k<n-1?[lane.modelSegments[k+1].id]:lane.next.filter(id=>present.has(id)).map(id=>id+'#0');
    output.push({id:part.id,points:part.points,width:3.6,speedLimit:lane.speedLimit,route:routeFlag,trafficLight,
     left:lane.index===1?neighbor:[],right:lane.index===0?neighbor:[],incoming,outgoing});
   }
  }
  return output;
 }
}
