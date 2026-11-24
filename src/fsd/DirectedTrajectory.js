import {distance,wrap} from './RoadNetwork.js';

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function sample(corridor,s){
 let lo=0,hi=corridor.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(corridor[mid].s<s)lo=mid+1;else hi=mid;}
 const b=corridor[lo],a=corridor[Math.max(0,lo-1)],f=clamp((s-a.s)/Math.max(.00001,b.s-a.s),0,1);
 return {x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f,yaw:a.yaw+wrap(b.yaw-a.yaw)*f,
  left:a.left+(b.left-a.left)*f,right:a.right+(b.right-a.right)*f,limit:Math.min(a.limit,b.limit)};
}
function lateral(p,q){return (p.x-q.x)*Math.cos(q.yaw)-(p.z-q.z)*Math.sin(q.yaw);}

// Work in route order, including the selected turning connector. A nearby
// parallel road or the returning limb of a U-turn cannot become the reference.
export function directedTrajectory(raw,origin,corridor,ego,guided=false){
 const result={...raw,origin};
 if(!corridor?.length)return null;
 let previous=origin,s=0,firstUnsafe=Infinity;
 // Approach a bend at the speed its radius permits, even when a decoder
 // chooses a fast token with endpoints just inside the junction.
 for(const q of corridor){
  if(q.s>ego.speed*ego.speed/6+15)break;
  result.bendSpeed=Math.min(result.bendSpeed??Infinity,Math.sqrt(q.limit*q.limit+5*Math.max(0,q.s-4)));
 }
 const stations=[],front=ego.rearAxle+ego.length/2,tail=ego.length/2-ego.rearAxle;
 for(const p of raw.points){
  const d=distance(previous,p),steps=Math.max(1,Math.ceil(d/.75));
  for(let j=1;j<=steps;j++){
   const f=j/steps,station=s+d*f,q=sample(corridor,station);
   const v={x:previous.x+(p.x-previous.x)*f,z:previous.z+(p.z-previous.z)*f};
   const angle=wrap(previous.yaw+wrap(p.yaw-previous.yaw)*f-q.yaw);
   const side=lateral(v,q),overhang=Math.sin(angle),half=ego.width/2*Math.abs(Math.cos(angle));
   const left=side+half+Math.max(front*overhang,-tail*overhang);
   const right=-side+half+Math.max(-front*overhang,tail*overhang);
   if(left>q.left-.12||right>q.right-.12||Math.abs(angle)>.80||station>corridor.at(-1).s+.15){
    firstUnsafe=Math.min(firstUnsafe,station);
   }
  }
  s+=d;stations.push(s);previous=p;
 }
 if(guided){
  // In route-ranked mode the manoeuvre already has a specific lane or turning
  // connector. Use decoded progress and stop timing on that committed geometry.
  // A small tracking error rejoins the lane continuously in world space.
  const path=[{...origin,t:0}], points=[];
  const offset=lateral(origin,corridor[0]);
  const joinLength=Math.max(6,ego.speed*.85,Math.abs(offset)*5);
  let start=0,startTime=0;
  for(const [i,end] of stations.entries()){
   const endTime=raw.points[i].t, steps=Math.max(1,Math.ceil((end-start)/.8));
   for(let j=1;j<=steps;j++){
    const f=j/steps,station=start+(end-start)*f,q=sample(corridor,station);
    const u=clamp(station/joinLength,0,1),side=offset*(1-u)*(1-u)*(1+2*u);
    path.push({x:q.x+side*Math.cos(q.yaw),z:q.z-side*Math.sin(q.yaw),
     yaw:q.yaw,t:startTime+(endTime-startTime)*f});
   }
   points.push(path.at(-1));start=end;startTime=endTime;
  }
  for(let i=1;i<path.length;i++){
   const a=path[i-1],b=path[Math.min(i+1,path.length-1)];
   if(distance(a,b)>.03)path[i].yaw=Math.atan2(b.x-a.x,b.z-a.z);
  }
  return {...result,points,trackingPath:path,guided:true,decodedPoints:raw.points,
   directionGuard:Number.isFinite(firstUnsafe),firstUnsafe};
 }
 if(!Number.isFinite(firstUnsafe))return result;
 // Keep the approaching part of a valid prediction. Blend towards the legal
 // route before the first violation, retaining each token's travelled metres
 // and stop timing. At a turn the dense steering path follows the actual arc.
 const path=[{...origin,t:0}],points=[];
 const initial=lateral(origin,corridor[0]);
 const transition=Math.max(5,ego.speed*1.1),start=Math.max(0,firstUnsafe-transition);
 let lastS=0,last={...origin,t:0};
 for(const [i,p] of raw.points.entries()){
  const end=stations[i],length=end-lastS,n=Math.max(1,Math.ceil(length/.8));
  for(let j=1;j<=n;j++){
   const f=j/n,u=lastS+length*f,q=sample(corridor,u);
   const v={x:last.x+(p.x-last.x)*f,z:last.z+(p.z-last.z)*f};
   const blend=clamp((u-start)/Math.max(.1,firstUnsafe-start),0,1);
   const w=blend*blend*(3-2*blend);
   const side=initial*(1-clamp(u/Math.max(6,ego.speed),0,1))**2;
   const x=q.x+side*Math.cos(q.yaw),z=q.z-side*Math.sin(q.yaw);
   path.push({x:v.x+(x-v.x)*w,z:v.z+(z-v.z)*w,yaw:last.yaw+wrap(p.yaw-last.yaw)*f,t:last.t+(p.t-last.t)*f});
  }
  points.push(path.at(-1));last=p;lastS=end;
 }
 for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[Math.min(i+1,path.length-1)];
  path[i].yaw=distance(a,b)>.03?Math.atan2(b.x-a.x,b.z-a.z):a.yaw;
 }
 return {...result,points,trackingPath:path,directionGuard:true,firstUnsafe};
}

// Compare footprint corners against actual oncoming pavement outside junctions.
// The chosen incoming/outgoing roads define the legal directions for recovery.
export function opposingIncursion(roads,pose,ego){
 const sx=Math.sin(pose.yaw),cz=Math.cos(pose.yaw);
 let worst=0;
 for(const road of roads){
  const a=road.points[0],b=road.points.at(-1),dx=(b.x-a.x)/road.length,dz=(b.z-a.z)/road.length;
  for(const along of [ego.rearAxle-ego.length/2,ego.rearAxle+ego.length/2])for(const side of [-ego.width/2,ego.width/2]){
   const x=pose.x+sx*along+cz*side-a.x,z=pose.z+cz*along-sx*side-a.z;
   const s=x*dx+z*dz;
   if(s<0||s>road.length)continue;
   const cross=x*dz-z*dx-(1.8+3.6*road.index);
   // Ignore non-overlapping parallel streets, including the far edge of a
   // wide boulevard. Positive values begin at the left edge of our carriageway.
   if(cross>0&&cross<7.2+2*(road.median??0))worst=Math.max(worst,cross);
  }
 }
 return worst;
}
