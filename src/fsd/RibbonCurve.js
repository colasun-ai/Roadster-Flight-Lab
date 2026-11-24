// Fit in world metres so the same turn keeps its shape at every camera zoom.
import {cumulative,sampleAlong} from './RibbonShape.js';

const knotSpacing=1.0;
const maxEdgeError=.00075;
const maxHeadingStep=Math.PI/180;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const mirror=(a,b)=>({x:2*a.x-b.x,z:2*a.z-b.z,t:2*a.t-b.t});

export function ribbonCurve(path,heading,width,limit){
 if(path.length<2||limit<=0)return [];
 const lengths=cumulative(path),length=lengths.at(-1);
 if(length<.0001)return [];
 const count=Math.max(3,Math.ceil(length/knotSpacing)),step=length/count;
 const controls=Array.from({length:count+1},(_,i)=>sampleAlong(path,lengths,step*i));
 const nose=controls[0],horizontal=Math.hypot(heading.x,heading.z);
 if(horizontal>.0001){
  controls[1].x=nose.x+step*heading.x/horizontal;
  controls[1].z=nose.z+step*heading.z/horizontal;
 }
 // Mirrored end controls interpolate the endpoints. Uniform cubic B-spline
 // spans have a common tangent and second derivative on each interior knot.
 controls.unshift(mirror(nose,controls[1]));
 controls.push(mirror(controls.at(-1),controls.at(-2)));
 const half=width/2,samples=[];
 let travelled=0;
 function append(p){
  const prev=samples.at(-1);
  if(prev){
   const span=distance(prev,p),remaining=limit-travelled;
   if(remaining<=0||span<1e-9)return;
   if(span>remaining){
    const f=remaining/span;
    p=Object.fromEntries(['x','z','t','nx','nz'].map(k=>[k,prev[k]+(p[k]-prev[k])*f]));
    const mag=Math.hypot(p.nx,p.nz);p.nx/=mag;p.nz/=mag;
   }
   travelled+=Math.min(span,remaining);
  }
  samples.push(p);
 }
 for(let i=0;i<count&&travelled<limit;i++){
  const [a,b,c,d]=controls.slice(i,i+4);
  function at(u){
   const v=1-u,u2=u*u,v2=v*v;
   const weights=[v2*v/6,(3*u2*u-6*u2+4)/6,(-3*u2*u+3*u2+3*u+1)/6,u2*u/6];
   const coord=k=>a[k]*weights[0]+b[k]*weights[1]+c[k]*weights[2]+d[k]*weights[3];
   const tangent=k=>((b[k]-a[k])*v2+(c[k]-b[k])*(1+2*u*v)+(d[k]-c[k])*u2)/2;
   const dx=tangent('x'),dz=tangent('z'),mag=Math.hypot(dx,dz)||1;
   return {x:coord('x'),z:coord('z'),t:coord('t'),nx:dz/mag,nz:-dx/mag};
  }
  function subdivide(u,p,v,q,depth){
   if(travelled>=limit)return;
   const mid=(u+v)/2,m=at(mid);
   // A centreline-only test misses corners on a car-wide strip. Bound
   // the error of both actual outlines, including within S-shaped spans.
   function needsSplit(probe,f){
    const dx=probe.x-(p.x+(q.x-p.x)*f),dz=probe.z-(p.z+(q.z-p.z)*f);
    const nx=half*(probe.nx-(p.nx+(q.nx-p.nx)*f));
    const nz=half*(probe.nz-(p.nz+(q.nz-p.nz)*f));
    return Math.max(Math.hypot(dx+nx,dz+nz),Math.hypot(dx-nx,dz-nz))>maxEdgeError;
   }
   if(depth<10&&(p.nx*q.nx+p.nz*q.nz<Math.cos(maxHeadingStep)||
      needsSplit(m,.5)||needsSplit(at((u+mid)/2),.25)||needsSplit(at((mid+v)/2),.75))){
    subdivide(u,p,mid,m,depth+1);subdivide(mid,m,v,q,depth+1);
   }else append(q);
  }
  const start=at(0);
  if(!i)append({...start,x:nose.x,z:nose.z});
  subdivide(0,start,1,at(1),0);
 }
 return samples;
}
