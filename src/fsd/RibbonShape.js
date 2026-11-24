// The fitted shape must agree with the decoded body centres. Navigation lanes
// are deliberately not an input, even when a decoder chooses a different turn.
const gap=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function cumulative(points){
 const lengths=[0];
 for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+gap(points[i],points[i-1]));
 return lengths;
}
export function sampleAlong(points,lengths,s){
 let lo=0,hi=lengths.length-1;
 while(lo+1<hi){const i=(lo+hi)>>1;if(lengths[i]<=s)lo=i;else hi=i;}
 const a=points[lo],b=points[hi],u=clamp((s-lengths[lo])/Math.max(1e-8,lengths[hi]-lengths[lo]),0,1);
 return {x:a.x+(b.x-a.x)*u,z:a.z+(b.z-a.z)*u,t:a.t+(b.t-a.t)*u};
}

// Integral of a raised-cosine steering-in / constant diagonal / steering-out
// slope. Position, heading and curvature are continuous at all four joins.
export function laneShift(u){
 const ramp=.24;
 if(u<=0)return 0;if(u>=1)return 1;
 if(u>1-ramp)return 1-laneShift(1-u);
 if(u>=ramp)return (u-ramp/2)/(1-ramp);
 return (u-ramp/Math.PI*Math.sin(Math.PI*u/ramp))/(2*(1-ramp));
}
export function fitDecision(points,heading,smooth){
 if(points.length<3)return {kind:'short',points};
 const a=points[0],b=points.at(-1),length=gap(a,b);
 if(length<.3)return {kind:'curve',points:smooth(points)};
 const axis=(x,z)=>({forward:p=>(p.x-a.x)*x+(p.z-a.z)*z,side:p=>(p.x-a.x)*z-(p.z-a.z)*x,
                     point:(s,y,t)=>({x:a.x+x*s+z*y,z:a.z+z*s-x*y,t})});
 let xx=0,zz=0,xz=0;
 for(const p of points){const x=p.x-a.x,z=p.z-a.z;xx+=x*x;zz+=z*z;xz+=x*z;}
 let bearing=.5*Math.atan2(2*xz,zz-xx);
 if((b.x-a.x)*Math.sin(bearing)+(b.z-a.z)*Math.cos(bearing)<0)bearing+=Math.PI;
 const chord=axis(Math.sin(bearing),Math.cos(bearing));
 const monotone=v=>v.every((n,i)=>!i||n>=v[i-1]-.01);
 if(monotone(points.map(chord.forward))&&points.every(p=>Math.abs(chord.side(p))<=.16))
  return {kind:'straight',points:points.map(p=>chord.point(chord.forward(p),0,p.t))};
 const tail=points[Math.max(0,points.length-4)],tailHeading=Math.atan2(b.x-tail.x,b.z-tail.z);
 const angles=[heading];
 if(gap(tail,b)>4&&Math.cos(heading-tailHeading)>.91)angles.push(tailHeading);
 for(const angle of angles){
  const frame=axis(Math.sin(angle),Math.cos(angle)),s=points.map(frame.forward),y=points.map(frame.side);
  const span=s.at(-1),shift=y.at(-1);
  if(span<=9||Math.abs(shift)<1.45||Math.abs(shift)>5.3||!monotone(s))continue;
  let best=null;
  // Search in metres. A lane change may finish near the start of a long
  // high-speed prediction, or may already have started in the preceding one.
  for(const start of [-5,-2,0,2,4,8,12,18,span*.24,span*.40]){
   for(const width of [8,10,12,14,16,19,22,26,32,38,span-start]){
    if(width<7||start+width>span+1)continue;
    const initial=laneShift(-start/width);
    const lateral=x=>shift*(laneShift((x-start)/width)-initial)/(1-initial);
    const error=y.map((v,i)=>Math.abs(v-lateral(s[i])));
    const score=error.reduce((sum,e)=>sum+e*e,0);
    if(Math.max(...error)<.34&&(!best||score<best.score))best={score,lateral};
   }
  }
  if(best){
   const n=Math.ceil(span/.30),out=[];let j=1;
   for(let i=0;i<=n;i++){const d=span*i/n;while(j<s.length-1&&s[j]<d)j++;const u=clamp((d-s[j-1])/Math.max(.0001,s[j]-s[j-1]),0,1);out.push(frame.point(d,best.lateral(d),points[j-1].t+(points[j].t-points[j-1].t)*u));}
   return {kind:'lane-change',points:out};
  }
 }
 return {kind:'curve',points:smooth(points)};
}
