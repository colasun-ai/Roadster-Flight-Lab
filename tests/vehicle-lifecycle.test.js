import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createWorld} from '../src/physics/PhysicsWorld.js';
import {VehicleSwitcher} from '../src/vehicles/VehicleSwitcher.js';
import {InputController} from '../src/input/InputController.js';

// Run directly: node tests/vehicle-lifecycle.test.js
// Only this suite's own report is written; no baseline test result is changed.
const started = performance.now(), tests = [];
async function test(name, fn) {
  const start = performance.now();
  try {
    const measurements = await fn();
    tests.push({name, passed:true, durationMs:performance.now()-start, measurements});
    console.log('PASS', name);
  } catch (error) {
    tests.push({name, passed:false, durationMs:performance.now()-start, error:error.stack});
    console.error('FAIL', name, error.message);
  }
}

async function withWorld(fn) {
  const {world} = await createWorld();
  const base = {bodies:world.bodies.len(), colliders:world.colliders.len()};
  let switcher;
  const own = options => (switcher = new VehicleSwitcher(world, options));
  try { return await fn({world, base, own}); }
  finally { switcher?.dispose(); world.free(); }
}
function counts(world) { return {bodies:world.bodies.len(), colliders:world.colliders.len()}; }
function assertEmpty(world, base) { assert.deepEqual(counts(world), base); }
function assertActive(world, base, session, id) {
  assert.equal(session.id, id);
  assert.equal(session.disposed, false);
  assert.equal(session.vehicle.disposed, undefined);
  assert.equal(world.getRigidBody(session.vehicle.body.handle), session.vehicle.body);
  assert.deepEqual(counts(world), {bodies:base.bodies+1, colliders:base.colliders+7});
  assert.equal(!!session.thrusters, id === 'roadster');
}
function assertFresh(session) {
  assert.deepEqual(session.vehicle.currentInput, {});
  assert.equal(session.vehicle.steer, 0);
  assert.equal(session.vehicle.telemetry().speedKmh, 0);
  assert.ok(session.vehicle.wheels.every(w => w.omega===0 && w.angle===0 && w.steer===0 && !w.contact));
  assert.equal(session.launchTimer.state, 'ready');
}

await test('prepare-rejection-retains-and-halts-old-live-session', () => withWorld(async ({world,base,own}) => {
  let failPrepare = false;
  const phases = [];
  const switcher = own({prepare:async id => { if (failPrepare) throw Error('injected prepare failure'); return {id}; }, onPhase:(phase,id)=>phases.push({phase,id})});
  const previous = await switcher.switchTo('roadster');
  // Synthetic motion establishes that halt really clears old momentum. This is
  // lifecycle state setup, not an acceleration/performance measurement.
  previous.vehicle.body.setLinvel({x:3,y:2,z:10},true);
  previous.vehicle.body.setAngvel({x:1,y:2,z:3},true);
  previous.thrusters.takeoff(); previous.thrusters.setMode('Chaos'); previous.thrusters.infiniteGas=true;
  failPrepare = true;
  await assert.rejects(switcher.switchTo('model3-performance-2018'), /injected prepare failure/);
  assert.equal(switcher.active, previous);
  assertActive(world,base,previous,'roadster');
  assert.equal(switcher.busy,false);
  assert.equal(switcher.switches.length,1);
  assert.deepEqual({...previous.vehicle.body.linvel()},{x:0,y:0,z:0});
  assert.deepEqual({...previous.vehicle.body.angvel()},{x:0,y:0,z:0});
  assert.equal(previous.thrusters.enabled,false);
  assert.equal(previous.thrusters.hover,false);
  assert.equal(previous.thrusters.infiniteGas,false);
  assert.deepEqual(phases.slice(-2).map(p=>p.phase),['loading','error']);
  const retained = counts(world);
  failPrepare = false;
  const next = await switcher.switchTo('model3-performance-2018');
  assertActive(world,base,next,'model3-performance-2018'); assertFresh(next);
  assert.equal(previous.disposed,true);
  return {base,retained,afterRecovery:counts(world),phases};
}));

await test('initial-mount-rejection-unmounts-and-removes-new-body', () => withWorld(async ({world,base,own}) => {
  let partial = null;
  const unmounted = [];
  const switcher = own({mount:session=>{partial=session;throw Error('injected initial mount failure');},unmount:session=>unmounted.push(session)});
  await assert.rejects(switcher.switchTo('model3-performance-2018'),/injected initial mount failure/);
  assert.equal(unmounted.length,1); assert.equal(unmounted[0],partial);
  assert.equal(partial.disposed,true); assert.equal(partial.vehicle.disposed,true);
  assert.equal(switcher.active,null); assert.equal(switcher.busy,false);
  assert.equal(switcher.switches.length,0); assertEmpty(world,base);
  assert.equal(partial.vehicle.preStepProducers.length,0);
  assert.equal(partial.vehicle.forceProducers.length,0);
  assert.equal(partial.vehicle.postStepProducers.length,0);
  assert.equal(partial.vehicle.resetHooks.length,0);
  return {base,afterFailure:counts(world),unmountCalls:unmounted.length,disposed:true};
}));

await test('replacement-mount-failure-cleans-both-sessions-and-retries', () => withWorld(async ({world,base,own}) => {
  let rejectMount = false, failedSession;
  const unmounted = [];
  const switcher = own({mount:session=>{if(rejectMount){failedSession=session;throw Error('injected replacement mount failure');}},unmount:session=>unmounted.push(session)});
  const previous = await switcher.switchTo('roadster');
  rejectMount = true;
  await assert.rejects(switcher.switchTo('model3-performance-2018'),/injected replacement mount failure/);
  assert.equal(previous.disposed,true); assert.equal(failedSession.disposed,true);
  assert.deepEqual(unmounted,[previous,failedSession]);
  assert.equal(switcher.active,null); assert.equal(switcher.busy,false); assertEmpty(world,base);
  rejectMount = false;
  const recovered = await switcher.switchTo('roadster');
  assertActive(world,base,recovered,'roadster'); assertFresh(recovered);
  assert.notEqual(recovered,previous);
  assert.equal(recovered.thrusters.fuel.mass,160);
  assert.equal(recovered.vehicle.body.mass(),1800);
  return {base,afterRecovery:counts(world),unmountCalls:unmounted.length,recoveredVehicle:recovered.id};
}));

await test('twenty-four-queued-switches-serialize-and-keep-one-chassis', () => withWorld(async ({world,base,own}) => {
  let preparing=0,maxPreparing=0;
  const observations=[];
  const switcher=own({prepare:async id=>{preparing++;maxPreparing=Math.max(maxPreparing,preparing);assert.ok(world.bodies.len()<=base.bodies+1);await Promise.resolve();preparing--;return{id};},mount:session=>{assertActive(world,base,session,session.id);assertFresh(session);observations.push({id:session.id,...counts(world)});}});
  const ids=Array.from({length:24},(_,i)=>i%2?'model3-performance-2018':'roadster');
  const sessions=await Promise.all(ids.map(id=>switcher.switchTo(id)));
  assert.equal(maxPreparing,1); assert.equal(switcher.busy,false);
  assert.equal(switcher.switches.length,24);
  assert.deepEqual(observations.map(o=>o.id),ids);
  assert.ok(switcher.switches.every(r=>r.oldHandleRemoved));
  assert.ok(sessions.slice(0,-1).every(s=>s.disposed && s.vehicle.disposed));
  assert.equal(switcher.active,sessions.at(-1));
  assertActive(world,base,switcher.active,ids.at(-1));
  return {base,switches:24,maxConcurrentPrepare:maxPreparing,observations,allOldHandlesRemoved:true};
}));

await test('queued-prepare-failure-does-not-poison-following-switches', () => withWorld(async ({world,base,own}) => {
  let attempts=0;
  const switcher=own({prepare:async id=>{if(++attempts===2)throw Error('injected queued prepare failure');return{id};}});
  const ids=['roadster','model3-performance-2018','model3-performance-2018','roadster'];
  const outcomes=await Promise.allSettled(ids.map(id=>switcher.switchTo(id)));
  assert.deepEqual(outcomes.map(o=>o.status),['fulfilled','rejected','fulfilled','fulfilled']);
  assert.match(outcomes[1].reason.message,/injected queued prepare failure/);
  assert.equal(switcher.switches.length,3); assert.equal(switcher.busy,false);
  assertActive(world,base,switcher.active,'roadster'); assertFresh(switcher.active);
  return {base,outcomes:outcomes.map(o=>o.status),successfulSwitches:3,afterRecovery:counts(world)};
}));

await test('unknown-vehicle-id-rejects-without-allocation-and-queue-recovers', () => withWorld(async ({world,base,own}) => {
  const switcher=own();
  await assert.rejects(switcher.switchTo('not-a-real-tesla'),/Unknown vehicle/);
  assert.equal(switcher.active,null); assert.equal(switcher.busy,false); assertEmpty(world,base);
  const recovered=await switcher.switchTo('model3-performance-2018');
  assertActive(world,base,recovered,'model3-performance-2018'); assertFresh(recovered);
  return {base,invalidId:'not-a-real-tesla',allocationOnInvalidId:0,recoveredVehicle:recovered.id};
}));

await test('roadster-chaos-and-model3-track-settings-do-not-cross-contaminate', () => withWorld(async ({world,base,own}) => {
  const switcher=own();
  const roadster=await switcher.switchTo('roadster');
  roadster.thrusters.setMode('Chaos');roadster.thrusters.infiniteGas=true;roadster.thrusters.highThrust=true;roadster.thrusters.fuel.mass=11;roadster.thrusters.takeoff();
  for(let i=0;i<24;i++)roadster.vehicle.step({drive:1,boost:true,lift:1,steer:.4});
  assert.equal(roadster.vehicle.error,null);
  const model3=await switcher.switchTo('model3-performance-2018');
  assertActive(world,base,model3,'model3-performance-2018'); assertFresh(model3);
  assert.equal(model3.thrusters,null);assert.equal(model3.vehicle.thrusters,undefined);
  assert.equal(model3.vehicle.drivetrain.mode,'Performance');
  assert.equal(model3.vehicle.drivetrain.soc,.9);
  assert.equal(model3.vehicle.currentMass,1929);
  model3.vehicle.drivetrain.setMode('Track');model3.vehicle.drivetrain.setSOC(.2);model3.vehicle.drivetrain.setPayload(120);model3.vehicle.drivetrain.absEnabled=false;model3.vehicle.drivetrain.tcsEnabled=false;model3.vehicle.surface='ice';
  for(let i=0;i<24;i++)model3.vehicle.step({drive:1,steer:.5,boost:true,lift:1});
  assert.equal(model3.vehicle.error,null);
  assert.equal(model3.vehicle.currentInput.boost,undefined);assert.equal(model3.vehicle.currentInput.lift,undefined);
  const freshRoadster=await switcher.switchTo('roadster');
  assertActive(world,base,freshRoadster,'roadster');assertFresh(freshRoadster);
  assert.equal(freshRoadster.vehicle.drivetrain,undefined);
  assert.equal(freshRoadster.thrusters.mode,'Stabilized');assert.equal(freshRoadster.thrusters.infiniteGas,false);assert.equal(freshRoadster.thrusters.highThrust,false);assert.equal(freshRoadster.thrusters.hover,false);
  assert.equal(freshRoadster.thrusters.fuel.mass,160);assert.equal(freshRoadster.vehicle.currentMass,1800);assert.equal(freshRoadster.vehicle.surface,'auto');
  const freshModel3=await switcher.switchTo('model3-performance-2018');
  assertFresh(freshModel3);assert.equal(freshModel3.vehicle.drivetrain.absEnabled,true);assert.equal(freshModel3.vehicle.drivetrain.tcsEnabled,true);assert.equal(freshModel3.vehicle.drivetrain.mode,'Performance');assert.equal(freshModel3.vehicle.drivetrain.soc,.9);assert.equal(freshModel3.vehicle.drivetrain.payloadKg,75);assert.equal(freshModel3.vehicle.surface,'auto');
  return {base,physicalStepsPerOldSession:24,roadsterMassKg:1800,model3MassKg:freshModel3.vehicle.currentMass,freshModel3Mode:freshModel3.vehicle.drivetrain.mode,afterSwitch:counts(world)};
}));

await test('dispose-is-idempotent-and-removes-all-owned-colliders-and-hooks', () => withWorld(async ({world,base,own}) => {
  const switcher=own(),session=await switcher.switchTo('roadster');
  assert.ok(session.vehicle.preStepProducers.length>0);assert.ok(session.vehicle.postStepProducers.length>0);assert.ok(session.vehicle.resetHooks.length>0);
  switcher.dispose();switcher.dispose();session.dispose();session.vehicle.dispose();
  assert.equal(switcher.active,null);assert.equal(session.disposed,true);assertEmpty(world,base);
  for(const name of ['preStepProducers','forceProducers','postStepProducers','resetHooks'])assert.equal(session.vehicle[name].length,0,name);
  return {base,afterRepeatedDisposal:counts(world),repeatedCalls:4,allHooksCleared:true};
}));

await test('single-input-instance-blocks-model3-flight-and-restores-roadster-controls', async () => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window'),listeners=new Map(),actions={hover:0,infinite:0,mode:0,reset:0,camera:0,pause:0,garage:0};
  const mockWindow={addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}};
  Object.defineProperty(globalThis,'window',{value:mockWindow,configurable:true,writable:true});
  const listenerCount=()=>[...listeners.values()].reduce((sum,set)=>sum+set.size,0);
  const emit=(type,code,{tagName='CANVAS',repeat=false}={})=>{const event={code,target:{tagName},repeat,preventDefault(){}};for(const fn of listeners.get(type)||[])fn(event);};
  let input;
  try{
    input=new InputController({},Object.fromEntries(Object.keys(actions).map(name=>[name,()=>actions[name]++])));
    assert.equal(listenerCount(),4);
    emit('keydown','KeyW');emit('keydown','ShiftLeft');emit('keydown','KeyJ');emit('keydown','KeyH');emit('keydown','KeyG');
    assert.equal(input.read().drive,1);assert.equal(input.read().boost,true);assert.equal(input.read().lift,1);assert.equal(actions.hover,1);assert.equal(actions.infinite,1);
    input.setCapabilities({flight:false});assert.equal(input.keys.size,0);
    for(const code of ['ShiftLeft','ShiftRight','KeyJ','KeyK','KeyH','KeyG','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE'])emit('keydown',code);
    const blocked=input.read();
    assert.equal(blocked.boost,false);for(const name of ['lift','descend','pitch','roll','yaw'])assert.equal(blocked[name],0,name);
    assert.equal(input.keys.size,0);assert.equal(actions.hover,1);assert.equal(actions.infinite,1);
    emit('keydown','KeyW');emit('keydown','KeyA');emit('keydown','KeyT');
    assert.equal(input.read().drive,1);assert.equal(input.read().steer,1);assert.equal(actions.mode,1);
    emit('keyup','KeyA');assert.equal(input.read().steer,0);
    input.setEnabled(false);assert.equal(input.keys.size,0);emit('keydown','KeyW');emit('keydown','KeyR');assert.deepEqual(input.read(),{});assert.equal(actions.reset,0);
    emit('keydown','Escape');assert.equal(actions.garage,1);
    input.setEnabled(true);input.setCapabilities({flight:true});emit('keydown','ShiftLeft');emit('keydown','KeyJ');assert.equal(input.read().boost,true);assert.equal(input.read().lift,1);
    emit('blur');assert.equal(input.keys.size,0);
    emit('keydown','KeyW',{tagName:'INPUT'});assert.equal(input.read().drive,0);
    emit('keydown','KeyC');emit('keydown','KeyC',{repeat:true});assert.equal(actions.camera,1);
    assert.equal(listenerCount(),4);
    input.dispose();assert.equal(input.keys.size,0);assert.equal(listenerCount(),0);
    emit('keydown','KeyH');assert.equal(actions.hover,1);
    input.dispose();assert.equal(listenerCount(),0);
    return {instancesCreated:1,windowListenersBeforeDisposal:4,windowListenersAfterDisposal:0,blockedFlightControls:Object.keys(blocked).filter(k=>['boost','lift','descend','pitch','roll','yaw'].includes(k)),actions,model3DriveAndModeAvailable:true,roadsterFlightRestored:true};
  }finally{input?.dispose();if(descriptor)Object.defineProperty(globalThis,'window',descriptor);else delete globalThis.window;}
});

const report={
  generatedAt:new Date().toISOString(),suite:'VehicleSwitcher real-Rapier error recovery and isolated InputController mock',
  engine:'Rapier 0.19.3',node:process.version,platform:process.platform,
  command:'node tests/vehicle-lifecycle.test.js',durationMs:performance.now()-started,
  passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,
  boundaries:{realRapierBodiesAndColliders:true,rendering:false,browser:false,nativeDesktop:false,
    inputController:'Production InputController with a process-local mock window; real key handler functions invoked.',
    mainOnPhaseInputRecoveryTested:false,mainGarageErrorRecoveryTested:false,
    note:'No claim of browser/native UI coverage. Synthetic motion is used only to test lifecycle halt, never to measure acceleration. Unknown-ID test begins with an empty session; it does not establish active-session preservation for invalid IDs.'},tests
};
fs.writeFileSync(new URL('../reports/vehicle-lifecycle-errors.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(`${report.passed} passed, ${report.failed} failed`);
if(report.failed)process.exitCode=1;
