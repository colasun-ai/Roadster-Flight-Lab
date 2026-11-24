import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PredictionRibbon,predictionCentres,clipPassedPrediction,smoothPrediction} from '../../src/fsd/PredictionRibbon.js';
import {cumulative,sampleAlong} from '../../src/fsd/RibbonShape.js';

const dir=process.argv[2]??'desktop-build/replays';
const p95=values=>values.sort((a,b)=>a-b)[Math.floor(.95*(values.length-1))];
const results=[];
for(const scene of ['straight','left','metro-pass']){
 const data=JSON.parse(await fs.readFile(path.join(dir,'closed-loop-'+scene+'-protected-32-replay.json')));
 const ribbon=new PredictionRibbon(new THREE.Scene());
 let speed=0,pose={x:0,z:0};
 const rear=1.43,car={forwardSpeed:()=>speed,wheels:[0,0,{center:[0,0,-rear]}],config:{frontTrack:1.66},rootPose:()=>({p:pose})};
 const before=[],after=[],shapes={};let prior=null,shortened=0;
 for(const r of data.predictions){
  const p={...r.rawPrediction,origin:r.input.origin},a=p.origin;
  function applyPose(u){
   const q=prior?.origin??a,dyaw=Math.atan2(Math.sin(a.yaw-q.yaw),Math.cos(a.yaw-q.yaw)),yaw=q.yaw+dyaw*u;
   speed=Math.hypot(q.vx+(a.vx-q.vx)*u,q.vz+(a.vz-q.vz)*u);
   pose={x:q.x+(a.x-q.x)*u+rear*Math.sin(yaw),z:q.z+(a.z-q.z)*u+rear*Math.cos(yaw)};
  }
  applyPose(1);
  if(prior){
   for(let t=prior.sourceTime+1/60;t<r.time-1e-7;t+=1/60){
    applyPose(Math.min(1,(t-prior.sourceTime)/(p.sourceTime-prior.sourceTime)));ribbon.update(prior,car,t,1/60);
   }
   applyPose(1);const old=clipPassedPrediction(ribbon.display,pose);
   const raw=q=>clipPassedPrediction(smoothPrediction(predictionCentres(q,rear,ribbon.horizon)),pose);
   const from=raw(prior),to=raw(p);
   ribbon.update(p,car,r.time,1/60);
   const next=ribbon.display,curves=[from,to,old,next],lengths=curves.map(cumulative);
   if(lengths[3].at(-1)+2<lengths[1].at(-1))shortened++;
   for(const d of [3,6,10,15]){
    if(lengths.some(l=>l.at(-1)<d))continue;
    const [a,b,c,e]=curves.map((curve,i)=>sampleAlong(curve,lengths[i],d));
    before.push(Math.hypot(a.x-b.x,a.z-b.z));after.push(Math.hypot(c.x-e.x,c.z-e.z));
   }
  }else ribbon.update(p,car,r.time,1/60);
  const kind=ribbon.stats.shape??'stopped';shapes[kind]=(shapes[kind]??0)+1;prior=p;
 }
 const record={scene,traffic:data.record.traffic,inferences:data.predictions.length,samples:after.length,rawRefreshP95M:p95(before),firstDisplayFrameP95M:p95(after),shorterCommonPrefix:shortened,shapes,headingChangeRad:data.record.maxHeadingChange,observedPass:data.record.overtaking?.observedPass??null,contactSamples:data.record.collisionSamples};
 assert.ok(record.samples>30&&record.firstDisplayFrameP95M<record.rawRefreshP95M);
 results.push(record);
}
await fs.writeFile('reports/metropolis/ribbon-replay.json',JSON.stringify(results,null,2));console.log(results);
