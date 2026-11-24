import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

// A golden fixture may only be created explicitly, from the clean stable source.
// Ordinary runs never update it or change the zero-difference acceptance limit.
const scriptPath=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(scriptPath),'..');
const stableCommit='a69bffe6c221186d00b02b1009ebac2acf41755f';
const fixturePath=path.join(root,'reports/roadster-trace-regression-baseline.json');
const reportPath=path.join(root,'reports/roadster-trace-regression-results.json');
const markdownPath=path.join(root,'reports/roadster-trace-regression-report.md');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const entries=['src/physics/PhysicsWorld.js','src/vehicle/VehiclePhysics.js','src/thrusters/ThrusterSystem.js'];
const run=(args,cwd)=>spawnSync('git',args,{cwd,encoding:'utf8'});
const runtime=()=>({node:process.version,platform:process.platform,architecture:process.arch});
const suite=[
  {id:'electric-straight-20s',seconds:20,warmupSeconds:2,pose:{x:-110,z:-150,y:.006},jets:false,input:'drive=1'},
  {id:'electric-steer-brake-reverse',seconds:14,warmupSeconds:2,pose:{x:-330,z:-600,y:.006},jets:false,input:'0-6 drive;6-7.5 left;7.5-9 right;9-11 brake;11-14 reverse'},
  {id:'jet-boost-and-continuous-refill',seconds:30,warmupSeconds:2,pose:{x:-110,z:-150,y:.006},jets:true,input:'0-1.5 drive+boost;1.5-3 drive;then idle;compressor always enabled'},
  {id:'stabilized-hover-disturbance',seconds:6,warmupSeconds:2,pose:{x:-300,z:-300,y:.006},jets:true,input:'takeoff;physical roll impulse at 2s;finite gas and always refill'},
  {id:'manual-attitude-finite-gas',seconds:10,warmupSeconds:0,pose:{x:-300,z:-300,y:100},jets:true,mode:'Manual',input:'pitch/roll/yaw plus first-second lift;finite gas, always refill'},
  {id:'chaos-infinite-double-thrust',seconds:12,warmupSeconds:0,pose:{x:-300,z:-300,y:3000},jets:true,mode:'Chaos',infinite:true,highThrust:true,input:'boost;3s lift alternating;sin pitch,roll .8,cos yaw'},
  {id:'assisted-takeoff-and-landing',seconds:12,warmupSeconds:2,pose:{x:-300,z:-300,y:.006},jets:true,input:'takeoff;land at 2s;then drive+steer at 9s'},
  {id:'natural-touchdown-control-release',seconds:12,warmupSeconds:0,pose:{x:-300,z:-300,y:12,yaw:.4},jets:true,input:'armed with opposing yaw target;fall naturally;drive+left at 6s'},
  {id:'wall-impact-150mps',seconds:5,warmupSeconds:2,pose:{x:0,z:120,y:.006},jets:false,initialCondition:'150 m/s forward with matching wheel speed;controlled collision setup, not an acceleration test',input:'idle'},
  {id:'hard-nose-landing',seconds:8,warmupSeconds:0,pose:{x:-300,z:-300,y:80},jets:false,initialCondition:'nose pitch .8 rad;velocity [0,-80,30] m/s;controlled landing setup',input:'idle'}
];

function sourceManifest(directory){
  const found=new Set();
  function visit(relative){
    if(found.has(relative))return;found.add(relative);
    const text=fs.readFileSync(path.join(directory,relative),'utf8');
    for(const match of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)){
      if(match[1].startsWith('.'))visit(path.normalize(path.join(path.dirname(relative),match[1])));
    }
  }
  entries.forEach(visit);
  const files=Object.fromEntries([...found].sort().map(p=>[p,sha(fs.readFileSync(path.join(directory,p)))]));
  const require=createRequire(path.join(directory,'package.json'));
  const rapierEntry=require.resolve('@dimforge/rapier3d-compat');
  const rapierRoot=path.dirname(rapierEntry);
  const rapierPackage=JSON.parse(fs.readFileSync(path.join(rapierRoot,'package.json'),'utf8'));
  return {files,sourceDigest:sha(JSON.stringify(files)),rapierVersion:rapierPackage.version,rapierWasmSha256:sha(fs.readFileSync(path.join(rapierRoot,'rapier_wasm3d_bg.wasm')))};
}

function inputAt(id,t){
  switch(id){
    case 'electric-straight-20s':return {drive:1};
    case 'electric-steer-brake-reverse':return t<6?{drive:1}:t<7.5?{drive:1,steer:1}:t<9?{drive:.5,steer:-1}:t<11?{brake:1}:{drive:-1,steer:.35};
    case 'jet-boost-and-continuous-refill':return t<1.5?{drive:1,boost:true}:t<3?{drive:1}:{};
    case 'manual-attitude-finite-gas':return {lift:t<1?1:0,pitch:.7*Math.sin(t*.9),roll:.5*Math.sin(t*.6),yaw:t<3?.5:t<6?-.4:0};
    case 'chaos-infinite-double-thrust':return {boost:true,lift:t%6<3?1:0,pitch:Math.sin(t*.8),roll:.8,yaw:Math.cos(t*.6)};
    case 'assisted-takeoff-and-landing':return t>=9?{drive:1,steer:.5}:{};
    case 'natural-touchdown-control-release':return t>=6?{drive:1,steer:1}:{};
    default:return {};
  }
}

async function worker(directory){
  const before=sourceManifest(directory);
  const importSource=p=>import(pathToFileURL(path.join(directory,p)).href);
  const [{createWorld},{VehiclePhysics},{ThrusterSystem},{config:C}]=await Promise.all(entries.concat('src/vehicle/VehicleConfig.js').map(importSource));
  if(C.dt!==1/120)throw new Error('Roadster timestep changed: fixed 120 Hz required');
  const fields=[];
  function snapshot(car,jets){
    const values=[],names=[];
    const push=(name,value)=>{if(typeof value==='boolean')value=Number(value);if(!Number.isFinite(value))throw new Error(`Nonfinite state ${name}=${value}`);names.push(name);values.push(value);};
    const vector=(name,value,axes)=>axes.forEach(k=>push(`${name}.${k}`,value[k]));
    const b=car.body,{p,q}=car.rootPose();
    vector('body.position',b.translation(),['x','y','z']);vector('body.rootPosition',p,['x','y','z']);vector('body.rotation',q,['x','y','z','w']);
    vector('body.velocity',b.linvel(),['x','y','z']);vector('body.angularVelocity',b.angvel(),['x','y','z']);
    push('body.mass',b.mass());push('body.currentMass',car.currentMass);push('body.steer',car.steer);push('body.gear',{N:0,D:1,R:-1}[car.gear]);push('body.error',!!car.error);push('body.time',car.time);push('body.steps',car.steps);
    let contacts=0;for(let i=0;i<b.numColliders();i++)car.world.contactPairsWith(b.collider(i),()=>contacts++);push('body.collisionPairs',contacts);
    for(const w of car.wheels){for(const key of ['omega','angle','compression','previousCompression','steer','contact','load','fx','fy','slip','lateralSlip'])push(`wheel.${w.id}.${key}`,w[key]);push(`wheel.${w.id}.surface`,{dry:0,wet:1,gravel:2,ice:3}[w.surface]);}
    const f=jets.fuel;for(const key of ['mass','massFlow','consumed','refillFlow','refilled','refillEnabled'])push(`fuel.${key}`,f[key]);push('fuel.pressureMPa',f.pressure());push('fuel.availableScale',f.availableScale(jets.mode==='Chaos'&&jets.infiniteGas));
    for(const key of ['enabled','hover','landing','flightArmed','groundedSeconds','targetHeight','thrustNewtons','rearBoostRequested','infiniteGas','highThrust','stabilizeInChaos'])push(`thruster.${key}`,jets[key]);
    push('thruster.mode',{Stabilized:0,Manual:1,Chaos:2}[jets.mode]);
    for(const key of ['height','worldGroundY','detected'])push(`thruster.ground.${key}`,jets.ground[key]);
    for(const [key,arr] of [['desiredWrench',jets.desiredWrench],['achievedWrench',jets.achievedWrench],['allocation.last',jets.allocation.last]])for(let i=0;i<(key==='allocation.last'?10:6);i++)push(`thruster.${key}.${i}`,arr?.[i]??0);
    push('thruster.allocation.residualNorm',jets.allocation.residualNorm??0);
    for(const n of jets.nozzles)for(const key of ['enabled','valve','thrust','massFlow'])push(`thruster.nozzle.${n.id}.${key}`,n[key]);
    if(!fields.length)fields.push(...names);else if(JSON.stringify(fields)!==JSON.stringify(names))throw new Error('Snapshot schema changed during run');
    return values;
  }
  const traces=[];
  for(const definition of suite){
    const {world}=await createWorld(),car=new VehiclePhysics(world),jets=new ThrusterSystem(car);
    try{
      jets.setMode(definition.mode??'Stabilized');jets.infiniteGas=!!definition.infinite;jets.highThrust=!!definition.highThrust;jets.enabled=false;car.reset(definition.pose);jets.fuel.refillEnabled=true;
      const rows=[snapshot(car,jets)],inputDigest=crypto.createHash('sha256');
      for(let i=0;i<Math.round(definition.warmupSeconds/C.dt);i++){const input={};inputDigest.update(JSON.stringify({phase:'warmup',i,input}));car.step(input);rows.push(snapshot(car,jets));}
      jets.enabled=definition.jets;
      if(definition.id==='natural-touchdown-control-release'){jets.arm();jets.stabilizer.targetYaw=-.4;}
      if(definition.id==='wall-impact-150mps'){car.body.setLinvel({x:0,y:0,z:150},true);car.wheels.forEach(w=>w.omega=150/w.radius);}
      if(definition.id==='hard-nose-landing'){car.body.setRotation({x:Math.sin(.4),y:0,z:0,w:Math.cos(.4)},true);car.body.setLinvel({x:0,y:-80,z:30},true);}
      const driveStartRow=rows.length;
      for(let i=0;i<Math.round(definition.seconds/C.dt);i++){
        const t=i*C.dt,input=inputAt(definition.id,t),events=[];
        if(i===0&&['stabilized-hover-disturbance','assisted-takeoff-and-landing'].includes(definition.id)){jets.takeoff();events.push('takeoff');}
        if(i===240&&definition.id==='stabilized-hover-disturbance'){car.body.applyTorqueImpulse({x:0,y:0,z:100},true);events.push('physical-roll-impulse-100Nms');}
        if(i===240&&definition.id==='assisted-takeoff-and-landing'){jets.land();events.push('land');}
        inputDigest.update(JSON.stringify({phase:'drive',i,input,events}));car.step(input);rows.push(snapshot(car,jets));
      }
      const index=name=>fields.indexOf(name),column=name=>rows.map(r=>r[index(name)]);
      const operating=rows.slice(driveStartRow),speed=r=>Math.hypot(...['x','y','z'].map(k=>r[index(`body.velocity.${k}`)]))*3.6;
      let crossing100=null,lastSpeed=0;for(let i=0;i<operating.length;i++){const s=speed(operating[i]);if(crossing100===null&&s>=100){crossing100=(i+(100-lastSpeed)/(s-lastSpeed))*C.dt;break;}lastSpeed=s;}
      traces.push({id:definition.id,steps:rows.length-1,driveStartRow,inputSha256:inputDigest.digest('hex'),traceSha256:sha(JSON.stringify(rows)),summary:{zeroTo100KmhSeconds:definition.id.includes('straight')||definition.id.startsWith('jet-boost')?crossing100:null,finalSpeedKmh:speed(rows.at(-1)),minRootHeightM:Math.min(...column('body.rootPosition.y')),maxRootHeightM:Math.max(...column('body.rootPosition.y')),peakThrustN:Math.max(...column('thruster.thrustNewtons')),minimumFuelKg:Math.min(...column('fuel.mass')),finalFuelKg:rows.at(-1)[index('fuel.mass')],totalRefilledKg:rows.at(-1)[index('fuel.refilled')],maxCollisionPairs:Math.max(...column('body.collisionPairs')),everHover:column('thruster.hover').some(Boolean),everFlightArmed:column('thruster.flightArmed').some(Boolean),finalFlightArmed:!!rows.at(-1)[index('thruster.flightArmed')]},rows});
    }finally{world.free();}
  }
  const after=sourceManifest(directory);
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Source or Rapier WASM changed during trace capture; rerun after edits finish');
  return {runtime:runtime(),source:before,dt:C.dt,suite,fields,traces,totalRecordedSteps:traces.reduce((s,t)=>s+t.steps,0)};
}

function executeWorker(directory){
  const result=spawnSync(process.execPath,[scriptPath,'--worker',directory],{cwd:root,encoding:'utf8',maxBuffer:256*1024*1024});
  if(result.status!==0)throw new Error(`Trace worker failed for ${directory}: ${result.stderr||result.stdout}`);
  return {...JSON.parse(result.stdout),workerWarnings:result.stderr.trim()};
}

function compare(expected,actual){
  const mismatches=[],groups={body:{maxAbs:0},wheel:{maxAbs:0},fuel:{maxAbs:0},thruster:{maxAbs:0}};
  const shapeEqual=JSON.stringify(expected.fields)===JSON.stringify(actual.fields)&&JSON.stringify(expected.suite)===JSON.stringify(actual.suite);
  if(!shapeEqual)mismatches.push({type:'schema-or-input-suite-changed'});
  if(expected.source.rapierVersion!==actual.source.rapierVersion||expected.source.rapierWasmSha256!==actual.source.rapierWasmSha256)mismatches.push({type:'rapier-runtime-different'});
  const scenarios=[];let totalComparedScalars=0,nonzeroScalars=0;
  for(let s=0;s<expected.traces.length;s++){
    const a=expected.traces[s],b=actual.traces[s];let maxAbs=0,maxField=null,maxRow=null,different=0;
    if(!b||a.id!==b.id||a.inputSha256!==b.inputSha256||a.rows.length!==b.rows.length){mismatches.push({type:'scenario-input-or-length-changed',id:a.id});continue;}
    if(shapeEqual)for(let row=0;row<a.rows.length;row++)for(let c=0;c<expected.fields.length;c++){
      const delta=Math.abs(a.rows[row][c]-b.rows[row][c]);totalComparedScalars++;
      if(delta!==0){different++;nonzeroScalars++;const group=groups[expected.fields[c].split('.')[0]];if(delta>group.maxAbs)Object.assign(group,{maxAbs:delta,field:expected.fields[c],scenario:a.id,row});if(delta>maxAbs){maxAbs=delta;maxField=expected.fields[c];maxRow=row;}}
    }
    scenarios.push({id:a.id,passed:shapeEqual&&different===0,recordedSteps:a.steps,scalarComparisons:a.rows.length*expected.fields.length,nonzeroScalars:different,maxAbsoluteDifference:maxAbs,maxDifferenceField:maxField,maxDifferenceRow:maxRow,baselineTraceSha256:a.traceSha256,currentTraceSha256:b.traceSha256,baselineSummary:a.summary,currentSummary:b.summary});
  }
  return {passed:shapeEqual&&mismatches.length===0&&nonzeroScalars===0&&scenarios.length===suite.length,acceptance:{absoluteTolerance:0,relativeTolerance:0,rule:'Every captured finite scalar must be numerically identical; no baseline rewrite on ordinary runs'},schemaEqual:shapeEqual,totalComparedScalars,nonzeroScalars,maxByGroup:groups,mismatches,scenarios};
}

async function main(){
  if(process.argv[2]==='--worker'){process.stdout.write(JSON.stringify(await worker(path.resolve(process.argv[3]))));return;}
  const captureIndex=process.argv.indexOf('--capture-baseline'),sourceIndex=process.argv.indexOf('--baseline-root');
  let fixture,liveStable=null;
  if(captureIndex!==-1){
    if(fs.existsSync(fixturePath))throw new Error('Stable fixture already exists. Refusing to overwrite it. Run without --capture-baseline, or use --baseline-root for a read-only recheck.');
    const baselineRoot=path.resolve(process.argv[captureIndex+1]??'');
    const commit=run(['rev-parse','HEAD'],baselineRoot);if(commit.status!==0||commit.stdout.trim()!==stableCommit)throw new Error('Baseline HEAD must be exactly '+stableCommit);
    const manifest=sourceManifest(baselineRoot),dirty=run(['diff','--quiet','HEAD','--',...Object.keys(manifest.files)],baselineRoot);if(dirty.status!==0)throw new Error('Stable physics dependency graph has uncommitted changes');
    liveStable=executeWorker(baselineRoot);
    if(JSON.stringify(manifest)!==JSON.stringify(liveStable.source))throw new Error('Baseline sources changed before worker capture');
    fixture={schemaVersion:1,description:'Frozen 120 Hz full scalar trajectories captured from clean Roadster v0.5.1 stable source. Never updated by regular validation.',generatedAt:new Date().toISOString(),baselineCommit:stableCommit,...liveStable};
    fs.mkdirSync(path.dirname(fixturePath),{recursive:true});fs.writeFileSync(fixturePath,JSON.stringify(fixture)+'\n',{flag:'wx'});
  }else{
    fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
    if(fixture.baselineCommit!==stableCommit)throw new Error('Unexpected fixture baseline commit');
    if(sourceIndex!==-1)liveStable=executeWorker(path.resolve(process.argv[sourceIndex+1]??''));
  }
  const current=executeWorker(root),comparison=compare(fixture,current),stableRecheck=liveStable?compare(fixture,liveStable):null;
  const report={generatedAt:new Date().toISOString(),passed:comparison.passed&&(!stableRecheck||stableRecheck.passed),mode:captureIndex!==-1?'direct stable source capture + current comparison':liveStable?'frozen fixture + direct stable source + current comparison':'frozen fixture + current comparison; no external baseline directory needed',baselineCommit:fixture.baselineCommit,fixture:{path:path.relative(root,fixturePath),bytes:fs.statSync(fixturePath).size,sha256:sha(fs.readFileSync(fixturePath))},baselineRuntime:fixture.runtime,currentRuntime:current.runtime,baselineSource:fixture.source,currentSource:current.source,fixedStepSeconds:fixture.dt,recordedFields:fixture.fields.length,totalRecordedSteps:fixture.totalRecordedSteps,coverage:{full120HzTraces:true,driving:true,electricAcceleration:true,jetAcceleration:true,continuousRefill:true,hover:true,manualAttitude:true,chaos:true,assistedLanding:true,naturalTouchdown:true,collision:true,scope:'Core default VehiclePhysics + ThrusterSystem and shared world. Does not validate Garage UI, VehicleFactory selection wiring, input routing, renderer, native desktop behavior or real hardware.'},comparison,stableRecheck,workerWarnings:{baseline:fixture.workerWarnings??'',current:current.workerWarnings??''},immutableSourceGuard:'Dependency source and Rapier WASM hashes captured before and after each worker run; any in-run change aborts.'};
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  const rows=comparison.scenarios.map(s=>`| ${s.id} | ${s.recordedSteps} | ${s.nonzeroScalars} | ${s.maxAbsoluteDifference} | ${s.passed?'PASS':'FAIL'} |`).join('\n');
  const markdown=`# Roadster v0.5.1 → v0.6 数值轨迹回归\n\n生成时间：${report.generatedAt}。稳定提交：\`${stableCommit}\`。\n\n**结果：${report.passed?'PASS':'FAIL'}**。固定 120 Hz，${suite.length} 个独立世界情景，${fixture.totalRecordedSteps} 个物理步，每个状态 ${fixture.fields.length} 项数值，比较 ${comparison.totalComparedScalars} 项，非零差异 ${comparison.nonzeroScalars} 项。\n\n| 情景 | 记录物理步 | 非零标量差异 | 最大绝对差异 | 结果 |\n| --- | ---: | ---: | ---: | --- |\n${rows}\n\n每个物理步均保存刚体位置、根节点位置、四元数、线速度、角速度、质量、转向、档位、Rapier 接触候选对数（不等于有效撞击次数）；逐轮角速度/角度/压缩/接触/载荷/纵横向力/滑移；气罐质量、压力、耗气、始终自动补气；喷气模式、悬浮/着陆/姿态状态、目标/实现力矩与每个喷嘴状态。采样没有降频。\n\n## 执行方法与冻结夹具\n\n本次模式：${report.mode}。基线夹具：\`${path.relative(root,fixturePath)}\`，SHA-256 \`${report.fixture.sha256}\`。夹具含所有基线数值，后续运行无需外部稳定项目目录。\n\n运行 \`node scripts/roadster-trace-regression.mjs\` 只读取冻结夹具并验证当前实现；\`--baseline-root ../roadster-handling-fix\` 另做原稳定代码只读重跑，仍不改夹具。\`--capture-baseline\` 只允许从指定稳定提交且依赖图无改动的目录首次创建夹具，已存在时拒绝覆盖。\n\n所有情景的定义和逐步输入摘要均校验；Rapier 版本和 WASM 哈希必须一致。绝对和相对容差均固定为 0，未放宽期望。原项目只读；每个工作进程采样前后比对依赖源码和 WASM 哈希，文件中途改变会中止。\n\n墙撞和高速落地情景明确设置了相同的初始速度/姿态，这是受控碰撞初始条件；纯电、喷气加速情景从真实静止用物理力起步，没有直接设置速度制造成绩。\n\n## 范围与限制\n\n该结果直接证明默认 Roadster 核心 VehiclePhysics、ThrusterSystem 与相同实体场景在这组输入下是否保持逐步数值一致。它不替代车库切换、VehicleFactory 配置选择、输入映射、HUD/相机、渲染、Mac 原生运行、Windows 实机或长时间稳定性测试，也不是所有可能轨迹的数学等价证明。不同 Rapier/WASM 版本不可与本冻结夹具混比。\n\n详细差异、模块哈希、运行环境和每个情景的加速/气量/高度/碰撞摘要见 \`reports/roadster-trace-regression-results.json\`。\n`;
  fs.writeFileSync(markdownPath,markdown);console.log(JSON.stringify({passed:report.passed,scenarios:suite.length,totalRecordedSteps:report.totalRecordedSteps,recordedFields:report.recordedFields,totalComparedScalars:comparison.totalComparedScalars,nonzeroScalars:comparison.nonzeroScalars,maxByGroup:comparison.maxByGroup,fixtureSha256:report.fixture.sha256,reports:[path.relative(root,reportPath),path.relative(root,markdownPath)]},null,2));
  if(!report.passed)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
