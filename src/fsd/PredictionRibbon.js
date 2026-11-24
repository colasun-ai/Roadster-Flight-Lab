import * as THREE from 'three';
import {ribbonCurve} from './RibbonCurve.js';
import {cumulative,sampleAlong,fitDecision} from './RibbonShape.js';
const hypot=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,t:a.t+(b.t-a.t)*t});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,f=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/Math.max(1e-12,dx*dx+dz*dz),0,1);return Math.hypot(p.x-a.x-f*dx,p.z-a.z-f*dz);}
// The model predicts the rear axle. Convert each actual predicted pose into
// the visible chassis centre, then clip/interpolate INSIDE its valid horizon.
export function predictionCentres(prediction,rearAxleToCentre,horizon=8){
 const raw=prediction.trackingPath??[{...prediction.origin,t:0},...prediction.points];
 const points=[];for(let i=0;i<raw.length;i++){
  const p=raw[i],body={x:p.x+Math.sin(p.yaw)*rearAxleToCentre,z:p.z+Math.cos(p.yaw)*rearAxleToCentre,t:p.t};
  if(body.t>horizon){if(i&&points.length){const prev=raw[i-1],a={x:prev.x+Math.sin(prev.yaw)*rearAxleToCentre,z:prev.z+Math.cos(prev.yaw)*rearAxleToCentre,t:prev.t};points.push(lerp(a,body,(horizon-a.t)/(body.t-a.t)));}break;}
  points.push(body);
 }
 // Repeated stationary tokens must not produce zero-area or spiky triangles.
 return points.filter((p,i)=>!i||hypot(p,points[i-1])>.025);
}
export function smoothPrediction(input,{spacing=.22,maxDeviation=.055,maxPointAdjustment=.045}={}){
 if(input.length<2)return input.slice();let points=input.map(p=>({...p}));
 // Tiny token-quantization wiggles can remain visible even in an interpolant.
 // Regularize only within 4.5 cm of each actual point; keep both endpoints.
 // Together with the Bezier corridor the complete display stays within 10 cm
 // of the original predicted polyline. This never changes controller inputs.
 for(let pass=0;pass<3;pass++)points=points.map((p,i)=>{if(!i||i===points.length-1)return p;const a=points[i-1],b=points[i+1],candidate={x:(a.x+2*p.x+b.x)/4,z:(a.z+2*p.z+b.z)/4,t:p.t},raw=input[i],d=hypot(candidate,raw),f=Math.min(1,maxPointAdjustment/Math.max(d,1e-9));return{x:raw.x+(candidate.x-raw.x)*f,z:raw.z+(candidate.z-raw.z)*f,t:p.t};});
 const tangents=points.map((p,i)=>{
  const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],length=Math.max(1e-9,hypot(a,b));return{x:(b.x-a.x)/length,z:(b.z-a.z)/length};
 });
 const output=[];
 for(let i=0;i<points.length-1;i++){
  const a=points[i],b=points[i+1],length=hypot(a,b);if(length<1e-8)continue;
  const samples=Math.max(2,Math.ceil(length/spacing)),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
  // Shorten handles, preserving their common direction at each join.
  // Blending the tangent with each chord separately creates a visible kink.
  const handle=v=>v.x*dx+v.z*dz<0?0:Math.min(length/3,maxDeviation/Math.max(1e-8,Math.abs(v.x*dz-v.z*dx)));
  const ta=tangents[i],tb=tangents[i+1],ha=handle(ta),hb=handle(tb);
  const c1={x:a.x+ta.x*ha,z:a.z+ta.z*ha},c2={x:b.x-tb.x*hb,z:b.z-tb.z*hb};
  const curve=t=>{const u=1-t;return{x:u*u*u*a.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*b.x,z:u*u*u*a.z+3*u*u*t*c1.z+3*u*t*t*c2.z+t*t*t*b.z,t:a.t+(b.t-a.t)*t};};
  for(let k=0;k<samples;k++){const point=curve(k/samples);point.rawSegment=i;output.push(point);}
 }
 output.push({...points.at(-1),rawSegment:points.length-2});return output;
}
export function clipPassedPrediction(points,position){
 if(points.length<2)return points;let best=Infinity,index=0,fraction=0;
 for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((position.x-a.x)*dx+(position.z-a.z)*dz)/Math.max(1e-9,dx*dx+dz*dz),0,1),p=lerp(a,b,t),d=hypot(position,p);if(d<best){best=d;index=i;fraction=t;}}
 return[lerp(points[index],points[index+1],fraction),...points.slice(index+1)];
}
// Start the visible strip at the front bumper, including on a turning path.
export function aheadOfBumper(points,pose,length){
 if(!pose.q||!Number.isFinite(length))return points;
 const {p,q}=pose,yaw=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.z*q.z));
 const along=v=>(v.x-p.x)*Math.sin(yaw)+(v.z-p.z)*Math.cos(yaw)-length/2-.08;
 for(let i=0;i<points.length;i++){
  const d=along(points[i]);if(d<0)continue;
  if(!i)return points;
  const a=points[i-1],before=along(a);
  return [lerp(a,points[i],-before/(d-before)),...points.slice(i)];
 }
 return [];
}
// One stencil bit per vehicle class. Glass contributes its actual silhouette
// without writing depth or changing the existing glass shading.
export function maskVehicleForPath(root,bit){
 root.traverse(mesh=>{
  if(!mesh.isMesh)return;
  for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
   m.stencilWrite=true;m.stencilWriteMask=bit;m.stencilRef=bit;
   m.stencilFunc=THREE.AlwaysStencilFunc;m.stencilZPass=THREE.ReplaceStencilOp;
  }
 });
}

function lineMaterial(){
 return new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false,
  stencilWrite:true,stencilWriteMask:0,stencilFunc:THREE.EqualStencilFunc,stencilRef:0,stencilFuncMask:3,
  polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,
  uniforms:{color:{value:new THREE.Color('#1676ff')},opacity:{value:1}},
  vertexShader:`varying vec2 pathUV;
   void main(){pathUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform vec3 color; uniform float opacity; varying vec2 pathUV;
   void main(){
    float side=abs(pathUV.x*2.-1.);
    float edge=1.-smoothstep(1.-max(.001,fwidth(side)),1.,side);
    gl_FragColor=vec4(color,edge*(1.-smoothstep(.90,1.,pathUV.y))*opacity);
    #include <colorspace_fragment>
   }`
 });
}

// Join the rendered nose to the swept bumper path. Both end tangents are
// specified so a laterally displaced prediction cannot leave a detached strip.
function joinNose(nose,heading,path){
 const lengths=cumulative(path),available=lengths.at(-1);
 if(!(available>.025))return [];
 const join=Math.min(available,Math.max(2,2*hypot(nose,path[0])));
 const end=sampleAlong(path,lengths,join),before=sampleAlong(path,lengths,Math.max(0,join-.18));
 const magnitude=hypot(before,end),handle=Math.min(hypot(nose,end),join)/3;
 const a={x:nose.x+heading.x*handle,z:nose.z+heading.z*handle};
 const b={x:end.x-(end.x-before.x)*handle/Math.max(.0001,magnitude),z:end.z-(end.z-before.z)*handle/Math.max(.0001,magnitude)};
 const samples=Math.max(4,Math.ceil((join+hypot(nose,path[0]))/.18)),output=[];
 for(let i=0;i<=samples;i++){
  const v=i/samples,u=1-v;
  output.push({x:u**3*nose.x+3*u*u*v*a.x+3*u*v*v*b.x+v**3*end.x,
   z:u**3*nose.z+3*u*u*v*a.z+3*u*v*v*b.z+v**3*end.z,t:path[0].t+(end.t-path[0].t)*v});
 }
 for(let i=1;i<path.length;i++)if(lengths[i]>join+.001)output.push(path[i]);
 return output;
}
function withinHorizon(points,horizon){
 const result=[];
 for(const p of points){
  if(p.t>horizon){const a=result.at(-1);if(a)result.push(lerp(a,p,(horizon-a.t)/(p.t-a.t)));break;}
  result.push(p);
 }
 return result;
}
function geometry(points,width,target){
 if(points.length<2){target.setDrawRange(0,0);return;}const positions=target.attributes.position.array,uv=target.attributes.uv.array;points=points.slice(0,4096);const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative.at(-1)+hypot(points[i-1],points[i]));const length=cumulative.at(-1);
 for(let i=0;i<points.length;i++){const f=cumulative[i]/Math.max(.001,length),nx=points[i].nx*width/2,nz=points[i].nz*width/2;positions.set([points[i].x+nx,.029,points[i].z+nz,points[i].x-nx,.029,points[i].z-nz],i*6);uv.set([0,f,1,f],i*4);}
 target.setDrawRange(0,(points.length-1)*6);for(const[name,count]of[['position',points.length*6],['uv',points.length*4]]){const attribute=target.attributes[name];attribute.clearUpdateRanges();attribute.addUpdateRange(0,count);attribute.needsUpdate=true;}
}
function emptyGeometry(){const indices=[];for(let i=1;i<4096;i++){const k=i*2;indices.push(k-2,k,k-1,k-1,k,k+1);}const result=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(4096*6),3).setUsage(THREE.DynamicDrawUsage)).setAttribute('uv',new THREE.BufferAttribute(new Float32Array(4096*4),2).setUsage(THREE.DynamicDrawUsage)).setIndex(indices);result.setDrawRange(0,0);return result;}
export class PredictionRibbon{
 constructor(scene){
  this.group=new THREE.Group();this.group.name='ActualPlanR1Prediction';scene.add(this.group);
  this.core=new THREE.Mesh(emptyGeometry(),lineMaterial());
  this.group.renderOrder=5;this.core.renderOrder=5;this.core.frustumCulled=false;this.group.add(this.core);
  this.horizon=4;this.reset();
 }
 reset(){this.opacity=0;this.last=null;this.display=[];this.history=[];this.fitted=null;this.stats={};this.visible=false;}
 set visible(value){this.group.visible=value;}get visible(){return this.group.visible;}
 update(prediction,vehicle,time,dt,visual=null){
  if(!prediction||time-prediction.sourceTime>=1.1){this.reset();return;}
  const speed=Math.abs(vehicle.forwardSpeed()),target=Math.min(8,2+speed*.55);
  this.horizon+=(target-this.horizon)*(1-Math.exp(-Math.max(0,dt)*5));
  const pose=visual??vehicle.rootPose(),centre=pose.p,rear=-vehicle.wheels[2].center[2];
  const front=visual?.front??(vehicle.config.chassisLength??vehicle.config.wheelbase+1.8)/2;
  const q=pose.q,dir=new THREE.Vector3(0,0,1).applyQuaternion(q);
  const nose={x:centre.x+dir.x*front,z:centre.z+dir.z*front};
  if(this.last!==prediction){
   this.last=prediction;
   const centres=predictionCentres(prediction,rear,8);
   this.fitted=prediction.trackingPath?{kind:'tracking-path',points:centres}
    :fitDecision(centres,prediction.origin.yaw,smoothPrediction);
   this.sweep=predictionCentres(prediction,rear+front,8);
  }
  const passed=clipPassedPrediction(withinHorizon(this.fitted.points,this.horizon),centre);
  const legacy=aheadOfBumper(passed,pose,vehicle.config.chassisLength??vehicle.config.wheelbase+1.8);
  const path=clipPassedPrediction(withinHorizon(this.sweep,this.horizon),nose);
  // Once the centreline reaches the front of the car, follow that exact
  // decision around the corner. A tight turn may never cross the nose plane.
  const ahead=prediction.trackingPath&&legacy.length>1?legacy:path;
  const next=ahead.length>1?joinNose(nose,dir,ahead):[];
  if(next.length<2){this.display=[];this.history=[];this.visible=false;this.stats={visibleMetres:0};return;}
  const lengths=cumulative(next),old=clipPassedPrediction(this.history,nose),oldLengths=cumulative(old);
  const previousLimit=Math.min(5+3.2*speed,legacy.length>1?cumulative(legacy).at(-1):lengths.at(-1));
  const budget=Math.min(lengths.at(-1),previousLimit/3),step=clamp(dt,0,.1);
  const extent=Math.min(lengths.at(-1),budget+2);
  const out=[],count=Math.max(1,Math.ceil(extent/.16));
  for(let i=0;i<=count;i++){
   const s=extent*i/count,p=sampleAlong(next,lengths,s);
   if(i&&!prediction.trackingPath&&old.length>1&&s<oldLengths.at(-1)){
    const past=sampleAlong(old,oldLengths,s),err=hypot(past,p);
    if(err>1.10&&s>2)break;
    const keep=Math.min(1,s/2)*Math.min(Math.exp(-step/.15),.35/Math.max(.001,err));
    p.x+=(past.x-p.x)*keep;p.z+=(past.z-p.z)*keep;
   }
   out.push(p);
  }
  this.history=out;
  const width=visual?.bodyWidth??vehicle.config.frontTrack+.27;
  this.display=budget>.025?ribbonCurve(out,dir,width,budget):[];
  this.visible=this.display.length>1;
  const freshness=clamp((1.1-(time-prediction.sourceTime))/.25,0,1);
  this.opacity=Math.min(freshness,this.opacity+step*7);
  this.core.material.uniforms.opacity.value=this.opacity;
  this.core.material.stencilFuncMask=visual?.cockpit?2:3;
  geometry(this.display,width,this.core.geometry);
  this.stats={rawPoints:prediction.points.length,displayVertices:this.display.length,displayHorizonSeconds:this.horizon,
   validHorizonSeconds:8,shape:this.fitted.kind,sourceTime:prediction.sourceTime,visibleMetres:cumulative(this.display).at(-1),
   previousLimitMetres:previousLimit,widthMetres:width,nose,first:this.display[0]};
 }
}
