import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.argv[2]??'reports/metro/release';
const cases=[
 ['metro-pass',1,'-280:390>430:390/1'],
 ['metro-uturn',0,'550:300>320:300/0'],
 ['metro-ramp',0,'430:390>580:560/1'],
 ['metro-tunnel',0,'580:560>580:1030/1'],
 ['left',20,'0:0>120:0/0'],
 ['right',0,'0:0>-120:0/1'],
];
for (const [scenario,cars,goal] of cases){
 const file=path.join(root,`closed-loop-${scenario}-protected-${cars}.json`);
 const [run]=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(run.error,null,scenario);
 assert.equal(run.lastStatus,'已到达目的地',scenario);
 assert.equal(run.finishedLane,goal,scenario);
 assert.equal(run.collisionSamples,0,scenario);
 assert.equal(run.redStopLineCrossings,0,scenario);
 assert.ok(run.maxLaneDistanceM<2.3&&run.inferences>10,scenario);
 assert.ok(Object.values(run.directRigidBodyWritesDuringDriving).every(x=>x===0),scenario);
 if(scenario==='metro-uturn')assert.ok(run.maxHeadingChange>3.1);
 if(scenario==='metro-pass'){
  assert.ok(run.overtaking.observedPass&&run.lanesDriven.includes('-280:390>430:390/0'));
 }
 console.log('PASS',scenario);
}
