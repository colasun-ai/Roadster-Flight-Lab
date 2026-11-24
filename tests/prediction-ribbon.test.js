import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {ribbonCurve} from '../src/fsd/RibbonCurve.js';
import {aheadOfBumper,PredictionRibbon,predictionCentres,smoothPrediction,segmentDistance,clipPassedPrediction} from '../src/fsd/PredictionRibbon.js';
const cases=[];
const nosePath=[0,1,3,5].map(z=>({x:0,z,t:z/2}));
const pose={p:{x:0,z:0},q:{x:0,y:0,z:0,w:1}};
assert.ok(Math.abs(aheadOfBumper(nosePath,pose,4)[0].z-2.08)<1e-9);
assert.deepEqual(aheadOfBumper(nosePath.slice(0,2),pose,4),[]);
cases.push({name:'Visible path begins beyond the bumper and disappears for a shorter stop',passed:true});
const paths={straight:Array.from({length:17},(_,i)=>({x:0,z:i*3,t:i*.5})),curve:Array.from({length:17},(_,i)=>({x:15*(1-Math.cos(i*Math.PI/32)),z:15*Math.sin(i*Math.PI/32),t:i*.5})),laneChange:Array.from({length:17},(_,i)=>({x:3.6*(1-Math.cos(i*Math.PI/16))/2,z:i*2,t:i*.5})),jitter:Array.from({length:17},(_,i)=>({x:.1*Math.sin(i*2.1),z:i*3,t:i*.5})),hairpin:[{x:0,z:0,t:0},{x:0,z:3,t:.5},{x:.03,z:0,t:1},{x:0,z:-3,t:1.5}]};
for(const[name,points]of Object.entries(paths)){
 const smooth=smoothPrediction(points),deviation=Math.max(...smooth.map(p=>segmentDistance(p,points[p.rawSegment],points[p.rawSegment+1])));
 assert.ok(deviation<=.10+1e-8,`${name}: invented geometry ${deviation}`);
 for(const raw of points)assert.ok(smooth.some(p=>Math.abs(p.t-raw.t)<1e-8&&Math.hypot(p.x-raw.x,p.z-raw.z)<=.045+1e-8));
 assert.ok(smooth.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)&&p.t>=0&&p.t<=points.at(-1).t));
 const current=smooth.find(p=>Math.abs(p.t-.5)<1e-8);const clipped=clipPassedPrediction(smooth,current);assert.ok(clipped[0].t>=.5-1e-7);assert.equal(clipped.at(-1).t,points.at(-1).t);
 cases.push({name,rawPoints:points.length,displayPoints:smooth.length,maxDeviationM:deviation,passed:true});
}
const prediction={origin:{x:10,z:20,yaw:Math.PI/2},points:Array.from({length:16},(_,i)=>({x:13+i*3,z:20,yaw:Math.PI/2,t:(i+1)*.5}))};
const centres=predictionCentres(prediction,1.43,3.2);assert.ok(Math.abs(centres[0].x-11.43)<1e-9);assert.equal(centres.at(-1).t,3.2);assert.ok(Math.abs(centres.at(-1).x-(10+3.2*6+1.43))<1e-9);
cases.push({name:'Rear axle to body centre uses predicted yaw; fractional horizon never extrapolates',passed:true});
const scene=new THREE.Scene(),ribbon=new PredictionRibbon(scene),vehicle={forwardSpeed:()=>6,wheels:[null,null,{center:[0,.3,-1.43]}],config:{frontTrack:1.6,chassisLength:4.8},rootPose:()=>({p:{x:11.43,z:20},q:{x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2}})};
const buffer=ribbon.core.geometry.attributes.position.array;
prediction.sourceTime=0;for(let i=0;i<60;i++)ribbon.update(prediction,vehicle,.2,1/60);
assert.ok(ribbon.core.geometry.drawRange.count>0);
assert.equal(ribbon.core.geometry.attributes.position.array,buffer);
assert.equal(ribbon.group.children.length,1); // One continuous strip.
ribbon.update(null,vehicle,.3,1/60);assert.equal(ribbon.visible,false);assert.equal(ribbon.display.length,0);
cases.push({name:'Persistent single ribbon and stale reset',passed:true});

const {laneShift,fitDecision,cumulative,sampleAlong}=await import('../src/fsd/RibbonShape.js');
const shifting=Array.from({length:17},(_,i)=>({x:3.6*laneShift(i/16),z:i*2,t:i/2}));
const turns=fitDecision(paths.curve,0,smoothPrediction),shift=fitDecision(shifting,0,smoothPrediction);
assert.equal(turns.kind,'curve');assert.equal(shift.kind,'lane-change');
const middleSlope=(laneShift(.6)-laneShift(.5))/.1;
assert.ok(Math.abs(middleSlope-(laneShift(.5)-laneShift(.4))/.1)<1e-8);
assert.ok(laneShift(.01)<.0001&&1-laneShift(.99)<.0001);
assert.equal(fitDecision(paths.jitter,0,smoothPrediction).kind,'straight');
cases.push({name:'Straight quantization, continuous corner and eased-diagonal-eased lane change',middleSlope,passed:true});

const car={...vehicle,forwardSpeed:()=>8,rootPose:()=>pose,wheels:[null,null,{center:[0,0,0]}]};
function decode(fn,time){return {sourceTime:time,origin:{x:0,z:0,yaw:0},points:Array.from({length:16},(_,i)=>({...fn(i+1),t:(i+1)/2,yaw:0}))};}
const jitter=sign=>i=>({x:sign*.8*Math.min(1,i/4),z:i*3});
const first=decode(jitter(1),0),second=decode(jitter(-1),.2);
ribbon.update(first,car,.19,1/60);
const before=sampleAlong(ribbon.display,cumulative(ribbon.display),3);
ribbon.update(second,car,.2,1/60);
const after=sampleAlong(ribbon.display,cumulative(ribbon.display),3);
const jump=Math.hypot(after.x-before.x,after.z-before.z);
assert.ok(jump<.14);
for(let i=1;i<=40;i++)ribbon.update(second,car,.2+i/60,1/60);
assert.ok(sampleAlong(ribbon.display,cumulative(ribbon.display),3).x<0);
const diverge=decode(i=>({x:-i*i*.6,z:i*2}),.9);
ribbon.update(diverge,car,.91,1/60);
assert.ok(ribbon.stats.visibleMetres<10);
// Displaced and already-turning forecasts previously began off to the side.
const metrics=await Promise.all(['roadster-geometry-metrics','model3-geometry','model-y-geometry']
 .map(async name=>JSON.parse(await fs.readFile('public/models/'+name+'.json','utf8'))));
const widths=[metrics[0].body.dimensions[0],metrics[1].dimensions.bodyWidth,metrics[2].dimensions.bodyWidth];
for(const bodyWidth of widths)for(const heading of [0,Math.PI/2,-Math.PI/2,Math.PI]){
 const q={x:0,y:Math.sin(heading/2),z:0,w:Math.cos(heading/2)};
 const rendered={p:{x:30,z:80},q,front:2.53,bodyWidth};
 for(const corner of [0,.055,-.055]){
  const points=Array.from({length:16},(_,i)=>{
   const d=(i+1)*2,yaw=heading+corner*d;
   return {x:30+Math.cos(heading)*1.5+(corner?(Math.cos(heading)-Math.cos(yaw))/corner:d*Math.sin(heading)),
    z:80-Math.sin(heading)*1.5+(corner?(Math.sin(yaw)-Math.sin(heading))/corner:d*Math.cos(heading)),yaw,t:(i+1)*.5};
  });
  const origin={x:30+1.5*Math.cos(heading),z:80-1.5*Math.sin(heading),yaw:heading,t:0};
  const prediction={origin,points,sourceTime:0,trackingPath:[origin,...points]};
  ribbon.reset();ribbon.update(prediction,car,.22,1/60,rendered);
  const first=ribbon.display[0];assert.ok(first);
  assert.ok(Math.hypot(first.x-30-2.53*Math.sin(heading),first.z-80-2.53*Math.cos(heading))<1e-8);
  assert.ok(Math.abs(ribbon.stats.visibleMetres-ribbon.stats.previousLimitMetres/3)<.04);
  const a=ribbon.core.geometry.attributes.position.array;
  for(let i=0;i<ribbon.display.length;i++){
   const j=i*6;
   assert.ok(Math.abs(Math.hypot(a[j]-a[j+3],a[j+2]-a[j+5])-bodyWidth)<.0001);
  }
  assert.equal(ribbon.stats.widthMetres,bodyWidth);
 }
}
cases.push({name:'Rendered bumper anchors on offset straights and turns in four headings; one third arc length; full measured width of each of the three cars',passed:true});
ribbon.update(null,car,1,1/60);assert.equal(ribbon.visible,false);
cases.push({name:'Moving forecast updates converge on one line and truncate on genuine branch changes',firstFrameDisplacementM:jump,passed:true});
// Coarse 1.8 m chords expose polygon corners when a wide ribbon simply
// resamples its centreline. Check both offset contours, including S bends.
for(const direction of [-1,1,'s']){
 const radius=7.5, width=1.95, start={x:0,z:0,t:0}, input=[start];
 let heading=0;
 for(let i=1;i<=16;i++){
  const turn=(direction==='s'?(i<8?1:-1):direction)*.24;
  const mid=heading+turn/2, last=input.at(-1), chord=2*radius*Math.sin(.12);
  input.push({x:last.x+chord*Math.sin(mid),z:last.z+chord*Math.cos(mid),t:i*.5});
  heading+=turn;
 }
 const curve=ribbonCurve(input,{x:0,z:1},width,24);
 assert.ok(Math.hypot(curve[0].x,curve[0].z)<1e-10);
 assert.ok(Math.abs(curve[0].nx-1)<1e-10&&Math.abs(curve[0].nz)<1e-10);
 let worstAngle=0, deviation=0;
 for(const side of [-1,1]){
  let prevAngle;
  for(let i=1;i<curve.length;i++){
   const a=curve[i-1],b=curve[i], r=side*width/2;
   const angle=Math.atan2(b.x-a.x+r*(b.nx-a.nx), b.z-a.z+r*(b.nz-a.nz));
   if(i>1)worstAngle=Math.max(worstAngle,Math.abs(Math.atan2(Math.sin(angle-prevAngle),Math.cos(angle-prevAngle))));
   prevAngle=angle;
  }
 }
 for(const p of curve)deviation=Math.max(deviation,Math.min(...input.slice(1).map((b,i)=>segmentDistance(p,input[i],b))));
 assert.ok(worstAngle*180/Math.PI<1.2,'Visible edge corner '+worstAngle*180/Math.PI);
 assert.ok(deviation<.13,'Curve left predicted corridor by '+deviation);
 assert.ok(Math.abs(cumulative(curve).at(-1)-24)<1e-8);
 cases.push({name:'Continuous car-width outlines on coarse '+direction+' bend',maxEdgeTurnDegrees:worstAngle*180/Math.PI,maxCentreDeviationM:deviation,passed:true});
}
const straight=ribbonCurve(paths.straight,{x:0,z:1},1.95,15);
assert.ok(straight.every(p=>Math.abs(p.x)<1e-12&&Math.abs(p.nx-1)<1e-12));
cases.push({name:'Straight ribbon stays exactly straight',passed:true});
await fs.writeFile('reports/fsd/prediction-ribbon-tests.json',JSON.stringify({passed:true,cases},null,2));
console.log(JSON.stringify(cases,null,2));
