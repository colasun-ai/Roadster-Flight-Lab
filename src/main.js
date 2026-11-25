import {t as uiText, localizedMarkup, initializeLanguage} from './i18n/index.js';
import {maskVehicleForPath} from './fsd/PredictionRibbon.js';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createWorld} from './physics/PhysicsWorld.js';
import {config as C} from './vehicle/VehicleConfig.js';
import {InputController} from './input/InputController.js';
import {CameraObstruction} from './camera/CameraObstruction.js';
import {FlightCamera} from './camera/FlightCamera.js';
import {ThrusterEffects} from './thrusters/ThrusterEffects.js';
import {ThrusterHUD} from './ui/ThrusterHUD.js';
import {RenderingSystem} from './rendering/RenderingSystem.js';
import {buildTrackScene} from './rendering/TrackScene.js';
import {VehicleRegistry} from './vehicles/VehicleRegistry.js';
import {VehicleSwitcher} from './vehicles/VehicleSwitcher.js';
import {Model3Visual} from './vehicles/model3/Model3Visual.js';
import {AccelerationMetrics} from './vehicles/model3/AccelerationMetrics.js';
import {batchStaticVehicle} from './rendering/VehicleBatching.js';
import {FrameProfiler} from './diagnostics/FrameProfiler.js';
import {slopeStart} from './world/SlopePark.js';
import {bindSlopeSelector} from './ui/SlopeSelector.js';
import {FSDSystem} from './fsd/FSDSystem.js';
import './style.css';
initializeLanguage();
const $=id=>document.getElementById(id),started=performance.now();
let paused=false,scenario=null,soak=null,accumulator=0,last=performance.now(),samples=[],frameTimes=[],stepTimes=[],errors=[],ready=false,nativeFsdAudit=null;
function recordError(message){errors.push({at:Date.now(),message});if(errors.length>50)errors.shift();}
window.addEventListener('error',e=>{paused=true;recordError(e.message);});window.addEventListener('unhandledrejection',e=>recordError(String(e.reason)));
try{
const renderer=new THREE.WebGLRenderer({canvas:$('scene'),antialias:true,stencil:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.setClearColor(0xb9cbd4);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
const profiler=new FrameProfiler(renderer);let profileSuite=null;
const scene=new THREE.Scene();scene.fog=new THREE.Fog(0xb9cbd4,130,410);
const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,6000);scene.add(new THREE.HemisphereLight(0xe6f3ff,0x595b56,1.3));
const sun=new THREE.DirectionalLight(0xffefda,2.6);sun.position.set(-30,55,25);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:1,far:100});sun.shadow.bias=-.0002;scene.add(sun);scene.add(sun.target);
const rendering=new RenderingSystem(renderer,scene,camera,sun);
const drivingOnly = window.planR1?.available === false;
if (drivingOnly) {
  rendering.setQuality('low');
  $('quality').value='low';
}
const {world,track}=await createWorld();const cameraObstruction=new CameraObstruction(world);const baseColliderCount=world.colliders.len();
let vehicle,thrusters,launchTimer,root,nodes,effects,jetHUD,model3Visual,performanceMetrics,previous,current,modelLoadMs=0,garageOpen=true;
let modelMetadata,fsd=null;
let indicator='off',headlights=false,switchAudit=null,loadError=null;
const preferencesKey='roadster-preferences-v07';let preferences={};try{preferences=JSON.parse(localStorage.getItem(preferencesKey)||'{}');}catch{}
function savePreferences(){try{localStorage.setItem(preferencesKey,JSON.stringify({quality:$('quality').value,horizon:$('horizon').checked,distance:Number($('camera-distance').value),smoothing:Number($('camera-smoothing').value),fov:Number($('camera-fov').value),effects:$('effects').value,pbr:$('pbr-rendering').checked}));}catch{}}
const renderPosition=new THREE.Vector3(),renderQuaternion=new THREE.Quaternion(),sunOffset=new THREE.Vector3(-30,55,25),cockpitEye=new THREE.Vector3(),cockpitTarget=new THREE.Vector3();
const modelCache=new Map(),loadingTimes={},rig=new FlightCamera(camera,renderer.domElement);
$('notice').textContent=uiText('加载赛道材质…');
const trackScene=await buildTrackScene(scene,renderer,track);
async function loadVehicle(id){
  if(!modelCache.has(id))modelCache.set(id,(async()=>{
    const definition=VehicleRegistry[id],start=performance.now();
    $('notice').textContent=uiText('加载 '+definition.name+'…');
    const [gltf,metadata]=await Promise.all([new GLTFLoader().loadAsync(definition.model),definition.metadata?fetch(definition.metadata).then(r=>{if(!r.ok)throw Error('Model metadata unavailable');return r.json();}):null]);
    gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=false;}});
    if(id==='roadster')rendering.enhanceModel(gltf.scene);
    else if(!new URLSearchParams(location.search).has('render-baseline'))batchStaticVehicle(gltf.scene,metadata);
    gltf.scene.userData.frontExtent=new THREE.Box3().setFromObject(gltf.scene,true).max.z;
    // Sedans and SUVs have mirrors outside the painted body. The Roadster's
    // Body node contains both rear fenders and is separate from its wheels.
    const bodyWidth=metadata?.dimensions?.bodyWidth;
    if(Number.isFinite(bodyWidth)&&bodyWidth>0)gltf.scene.userData.bodyWidth=bodyWidth;
    else{
     const chassis=gltf.scene.getObjectByName('Body')??gltf.scene;
     const bounds=new THREE.Box3().setFromObject(chassis,true);
     gltf.scene.userData.bodyWidth=bounds.max.x-bounds.min.x;
    }
    maskVehicleForPath(gltf.scene,1);
    loadingTimes[id]=performance.now()-start;return{root:gltf.scene,metadata};
  })().catch(error=>{modelCache.delete(id);throw error;}));
  return modelCache.get(id);
}
const switcher=new VehicleSwitcher(world,{
  prepare:loadVehicle,
  onPhase(phase,id,error){
    if(phase==='loading'){fsd?.autopilot.reset('车辆正在切换');$('garage-start').disabled=true;loadError=null;paused=true;scenario=null;if(!soak?.switching)soak=null;accumulator=0;input.setEnabled(false);$('notice').textContent=uiText('切换车辆…');document.body.classList.add('switching');}
    if(phase==='ready'){$('garage-start').disabled=false;document.body.classList.remove('switching');$('notice').textContent='';input.setCapabilities(VehicleRegistry[id].capabilities);input.setEnabled(!garageOpen);}
    if(phase==='error'){fsd?.parkForGarage();loadError=error.message;document.body.classList.remove('switching');$('notice').textContent=uiText('车辆加载失败，请在车库重试：'+error.message);garageOpen=true;paused=true;input.setEnabled(false);document.body.classList.add('garage-open');$('garage').hidden=false;}
  },
  unmount(){if(nodes&&!model3Visual)nodes.forEach(n=>{n.suspension.position.y=n.homeY;n.rotation.rotation.x=0;if(n.steering)n.steering.rotation.y=0;});effects?.dispose();model3Visual?.dispose();root?.removeFromParent();effects=jetHUD=model3Visual=performanceMetrics=null;},
  mount(session,visual){
    vehicle=session.vehicle;thrusters=session.thrusters;launchTimer=session.launchTimer;root=visual.root;modelMetadata=visual.metadata;rendering.prepareModel(root);scene.add(root);modelLoadMs=loadingTimes[session.id];
    nodes=vehicle.wheels.map(w=>({suspension:root.getObjectByName(`Wheel_${w.id}_Suspension`),rotation:root.getObjectByName(`Wheel_${w.id}_Rotation`),steering:root.getObjectByName(`Wheel_${w.id}_Steering`)}));
    if(nodes.some(n=>!n.suspension||!n.rotation))throw Error('Incomplete wheel rig');
    nodes.forEach(n=>n.homeY=n.suspension.position.y);
    if(thrusters){effects=new ThrusterEffects(scene,root,thrusters);effects.quality=Number($('effects').value);jetHUD=new ThrusterHUD(thrusters);}
    else{model3Visual=new Model3Visual(root,visual.metadata);performanceMetrics=new AccelerationMetrics(vehicle);}
    indicator='off';headlights=false;rig.ready=false;rig.last.set(0,0,0);rig.heading.set(0,0,1);rig.controls.minDistance=2.8;rig.controls.maxPolarAngle=Math.PI/2-.035;camera.up.set(0,1,0);camera.fov=48;camera.updateProjectionMatrix();
    previous=current=vehicle.rootPose();root.position.set(current.p.x,current.p.y,current.p.z);root.quaternion.set(current.q.x,current.q.y,current.q.z,current.q.w);samples=[];
    fsd?.vehicleChanged();updateVehicleUI(session);if(garageOpen)frameGarage();else rig.update(root,0,0,null);sun.position.copy(root.position).add(sunOffset);sun.target.position.copy(root.position);sun.target.updateMatrixWorld();rendering.update();renderer.render(scene,camera);
  }
});
function updateVehicleUI(session){
  const flight=!!session.thrusters;document.body.dataset.vehicle=session.id;
  $('flight-hud').hidden=!flight;$('jet-panel').hidden=!flight;$('model3-panel').hidden=flight;$('model3-hud').hidden=flight;
  $('vehicle-title').textContent=uiText(session.definition.name);
  document.querySelectorAll('[data-flight-only]').forEach(el=>el.hidden=!flight);
  document.querySelectorAll('[data-garage-vehicle]').forEach(el=>{el.classList.toggle('selected',el.dataset.garageVehicle===session.id);el.setAttribute('aria-pressed',String(el.dataset.garageVehicle===session.id));});
  $('garage-name').textContent=uiText(session.definition.name);$('garage-year').textContent=uiText(session.definition.year);$('garage-drive').textContent=uiText(session.definition.drive);$('garage-power').textContent=uiText(session.definition.power);$('garage-performance').textContent=uiText(session.definition.performance);$('garage-description').textContent=uiText(session.definition.description);
  $('key-help').innerHTML=localizedMarkup(flight?'<span>Shift 后喷 · J / K 升降 · 方向键俯仰/横滚 · Q / E 偏航</span><span>H 悬浮 · T 飞行模式 · G 无限气体（Chaos）</span>':'<span>L 车灯 · Z / V 转向灯 · X 双闪 · T 驾驶模式</span><span>松开油门再生制动 · C 驾驶舱 / 相机 · Esc 车库</span>');
  if(!flight&&session.definition.capabilities.indicators===false)$('key-help').innerHTML=localizedMarkup('<span>L 车灯 · T 动力模式 · C 相机 · Esc 车库</span><span>双电机 AWD · 松开油门再生制动</span>');
  $('surface').value=vehicle.surface;for(const option of $('surface').options)if(option.value!=='auto')option.textContent=uiText(({dry:'干燥',wet:'湿滑',gravel:'砂石',ice:'冰面'}[option.value]||option.value)+' μ '+vehicle.config.friction[option.value].toFixed(2));$('handling-result').textContent='';$('pause').textContent=uiText('暂停');document.querySelectorAll('[data-interaction]').forEach(b=>b.setAttribute('aria-pressed','false'));
  $('model3-panel').querySelector('summary').textContent=uiText(session.definition.name+' · 驾驶');
  if(!flight){$('m3-mode').innerHTML=(session.id==='model-y-performance-2026'?['Chill','Standard','Insane']:['Standard','Performance','Track']).map(m=>`<option>${m}</option>`).join('');$('y-controls').hidden=session.id!=='model-y-performance-2026';$('m3-mode-note').textContent=uiText(session.id==='model-y-performance-2026'?'美国 2026 款：独立动力响应与自适应减振工程模型；没有旧款 Track Mode。':'Track 调整扭矩分配与稳定控制，峰值动力相同。');$('ev-history').textContent=uiText(session.id==='model-y-performance-2026'?'美国厂方 3.3 s 扣除 rollout；此处独立测量。':'2018 C/D 实测 3.5 s · 计时口径不同');$('ev-model-note').textContent=uiText(session.id==='model-y-performance-2026'?'高精度原模型，车轮形状与胎宽有素材差异；参数为独立美国市场工程标定。':'原素材保留普通版轮毂外观，性能参数独立标定。');$('ev-driving-note').textContent=uiText(session.definition.capabilities.doors?'松开油门再生制动；高 SOC、低速时减弱。车门在行驶时自动关闭。':'松开油门再生制动；高 SOC、低速时减弱。');$('m3-cockpit').hidden=!session.definition.capabilities.cockpit;document.querySelector('.body-controls').hidden=!session.definition.capabilities.doors;for(const id of ['m3-indicator-left','m3-indicator-right','m3-hazards'])$(id).hidden=session.definition.capabilities.indicators===false;$('m3-mode').value=vehicle.drivetrain.mode;$('m3-soc').value=vehicle.drivetrain.soc*100;$('m3-payload').value=vehicle.drivetrain.payloadKg;$('m3-abs').checked=vehicle.drivetrain.absEnabled;$('m3-tcs').checked=vehicle.drivetrain.tcsEnabled;}
}
function frameGarage(){
  const damping=rig.controls.enableDamping;rig.controls.enableDamping=false;rig.controls.update();rig.controls.enableDamping=damping;camera.up.set(0,1,0);
  const p=vehicle.config.spawn;root.position.set(p.x,p.y,p.z);root.quaternion.identity();rig.mode=2;rig.ready=true;rig.last.set(p.x,p.y,p.z);camera.position.set(p.x+5.7,p.y+2.4,p.z+5.9);rig.controls.target.set(p.x,p.y+.65,p.z);rig.controls.update();
}
async function selectGarage(id){if(fsd?.loading)return;try{await switcher.switchTo(id);paused=true;frameGarage();}catch(error){errors.push({message:error.message});}}
function openGarage(){if(garageOpen||fsd?.loading||switcher.busy||switchAudit?.running||profileSuite?.running)return;fsd?.parkForGarage();garageOpen=true;
  $('scene-label').textContent='FLIGHT LAB · TESLA GARAGE';
  if(fsd)$('garage-city').textContent=uiText(fsd.active?'返回 FSD 城市':'进入 FSD 城市');
  document.body.classList.add('garage-open');$('garage').hidden=false;input.setEnabled(false);paused=true;scenario=soak=null;if(thrusters){thrusters.hover=false;thrusters.landing=false;thrusters.flightArmed=false;}frameGarage();}
function startDriving(){if(switcher.busy||!switcher.active)return;garageOpen=false;document.body.classList.remove('garage-open');$('garage').hidden=true;
  $('scene-label').textContent=uiText(fsd?.inView?'FLIGHT LAB · 本地 FSD 城市':'FLIGHT LAB · 实体试车场');
  paused=false;input.setEnabled(true);rig.mode=0;rig.ready=false;last=performance.now();accumulator=0;$('camera').textContent=uiText('跟随视角');$('pause').textContent=uiText('暂停');$('scene').focus();}
function cycleCamera(){if(!vehicle)return;if(thrusters)$('camera').textContent=uiText(rig.cycle());else{rig.mode=(rig.mode+1)%3;rig.ready=false;$('camera').textContent=uiText(['跟随视角',modelMetadata.cockpit?'驾驶舱':'车头视角','自由视角'][rig.mode]);}}
function toggleIndicator(value){if(!model3Visual||switcher.active?.definition.capabilities.indicators===false)return;indicator=indicator===value?'off':value;}
function reset(){if(!vehicle)return;fsd?.autopilot.reset();input.clear();vehicle.reset();if(fsd?.active)fsd.vehicleChanged();scenario=null;soak=null;paused=false;accumulator=0;rig.ready=false;previous=current=vehicle.rootPose();$('pause').textContent=uiText('暂停');}
function toggle(){input.clear();if(paused&&scenario?.completed)scenario=null;paused=!paused;$('pause').textContent=uiText(paused?'恢复':'暂停');}
function cycleMode(){if(!thrusters){const modes=switcher.active.id==='model-y-performance-2026'?['Chill','Standard','Insane']:['Standard','Performance','Track'];vehicle.drivetrain.setMode(modes[(modes.indexOf(vehicle.drivetrain.mode)+1)%3]);$('m3-mode').value=vehicle.drivetrain.mode;return;}const modes=['Stabilized','Manual','Chaos'];thrusters.setMode(modes[(modes.indexOf(thrusters.mode)+1)%3]);}
function toggleInfinite(){if(thrusters?.mode==='Chaos')thrusters.infiniteGas=!thrusters.infiniteGas;}
const input=new InputController(renderer.domElement,{reset,camera:cycleCamera,pause:toggle,hover:()=>thrusters?.toggleHover(),mode:cycleMode,infinite:toggleInfinite,garage:()=>{$('vehicle-info').open?$('vehicle-info').close():openGarage();},headlights:()=>{if(model3Visual)headlights=!headlights;},leftIndicator:()=>toggleIndicator('left'),rightIndicator:()=>toggleIndicator('right'),hazards:()=>toggleIndicator('hazard')});
input.setEnabled(false);
$('emergency-toggle').onclick=()=>thrusters?.toggleEmergency();
$('takeoff').onclick=()=>{scenario=null;thrusters.takeoff();};$('hover').onclick=()=>{scenario=null;thrusters.toggleHover();};$('land').onclick=()=>{scenario=null;thrusters.land();};
$('jet-toggle').onclick=()=>{thrusters.enabled=!thrusters.enabled;};$('flight-select').onchange=e=>thrusters.setMode(e.target.value);
$('auto-refill').onchange=e=>thrusters.fuel.refillEnabled=e.target.checked;
$('pbr-rendering').onchange=e=>rendering.setEnhanced(e.target.checked);
$('chaos-stabilize').onchange=e=>thrusters.stabilizeInChaos=e.target.checked;
$('infinite').onchange=e=>{thrusters.infiniteGas=thrusters.mode==='Chaos'&&e.target.checked;};$('high-thrust').onchange=e=>{thrusters.highThrust=thrusters.mode==='Chaos'&&e.target.checked;};
$('horizon').onchange=e=>rig.horizonLock=e.target.checked;$('camera-distance').oninput=e=>rig.distance=Number(e.target.value);$('camera-smoothing').oninput=e=>rig.smoothing=Number(e.target.value);$('camera-fov').oninput=e=>rig.speedFov=Number(e.target.value);$('effects').onchange=e=>effects&&(effects.quality=Number(e.target.value));$('quality').onchange=e=>{rendering.setQuality(e.target.value);resize();};
$('launch').onclick=()=>runScenario('launch');$('electric-launch').onclick=()=>runScenario('electric-launch');$('stunt').onclick=()=>{reset();vehicle.reset({x:-250,z:165});previous=current=vehicle.rootPose();};$('pad').onclick=()=>{reset();vehicle.reset({x:-160,z:0});previous=current=vehicle.rootPose();};
$('ramp-view').onclick=()=>{reset();vehicle.reset({x:-250,z:165});previous=current=vehicle.rootPose();rig.mode=2;rig.ready=true;rig.last.set(current.p.x,current.p.y,current.p.z);camera.position.set(-180,24,205);rig.controls.target.set(-250,2,205);rig.controls.update();paused=true;$('pause').textContent=uiText('恢复');$('camera').textContent=uiText('自由视角');};
let pausedBeforeSlopes=false;
bindSlopeSelector({
 canOpen:()=>!garageOpen&&!fsd?.active&&!switcher.busy&&!profileSuite?.running&&!switchAudit?.running,
 onOpen(){pausedBeforeSlopes=paused;paused=true;input.setEnabled(false);},
 onCancel(){paused=pausedBeforeSlopes;input.setEnabled(true);$('scene').focus();},
 onDrive(course){
  vehicle.reset(slopeStart(course));previous=current=vehicle.rootPose();scenario=soak=null;
  startDriving();
 }
});
// Return keyboard focus after changing a control, preserving simultaneous keys.
document.querySelectorAll('button,select,input').forEach(el=>el.addEventListener('change',()=>renderer.domElement.focus()));
document.querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>renderer.domElement.focus()));
// One expanded panel at a time keeps driving controls clear.
for(const id of ['panel','jet-panel','model3-panel','settings-panel'])$(id).addEventListener('toggle',()=>{if($(id).open&&!$(id).hidden)for(const other of ['panel','jet-panel','model3-panel','settings-panel'])if(other!==id)$(other).open=false;});
$('reset').onclick=reset;$('pause').onclick=toggle;$('camera').onclick=cycleCamera;$('surface').onchange=e=>vehicle.surface=e.target.value;
const scenarioStarts={static:{x:0,z:-110},acceleration:{x:0,z:-110},braking:{x:0,z:-110},steering:{x:-25,z:-100},suspension:{x:0,z:-66},jump:{x:0,z:78},collision:{x:0,z:130},rollover:{x:-30,z:-100}};
function runScenario(name){
  if(fsd?.active)fsd.exit();
  const flight=['takeoff','hover','roll','landing','chaos'].includes(name);
  if(flight&&!thrusters)return;
  vehicle.reset(flight?{x:-160,z:0}:scenarioStarts[name]||C.spawn);if(thrusters){thrusters.enabled=true;thrusters.setMode(flight&&name!=='takeoff'?'Chaos':'Stabilized');
  thrusters.stabilizeInChaos=flight;thrusters.infiniteGas=flight&&name!=='takeoff';thrusters.highThrust=name==='chaos';}
  scenario={name,time:0,applied:false};$('handling-result').textContent='';soak=null;paused=false;rig.ready=false;accumulator=0;previous=current=vehicle.rootPose();$('pause').textContent=uiText('暂停');
}
document.querySelectorAll('[data-test]').forEach(b=>b.onclick=()=>runScenario(b.dataset.test));
$('soak').onclick=()=>{vehicle.reset({x:75,z:-105});scenario=null;soak={start:performance.now(),startSteps:vehicle.steps,startFrames:frames,simulatedSteps:0,vehicleIndex:0,vehicles:[switcher.active.id,...Object.keys(VehicleRegistry).filter(id=>id!==switcher.active.id)],events:[],samples:[],complete:false,minimumFPS:Infinity,maxHeap:0,invalidStates:0};paused=false;};
function autoInput(){
  if(profileSuite?.input)return profileSuite.input();
  if(soak){const t=(performance.now()-soak.start)/1000,speed=vehicle.forwardSpeed();return {drive:speed<8? .30:0,steer:.24+.015*Math.sin(t*.12)};}
  if(!scenario)return input.read();const t=scenario.time,n=scenario.name;
  if(n==='launch'||n==='electric-launch'||n==='model3-performance')return t<1?{}:{drive:1,boost:n==='launch'};
  if(n==='high-speed-straight')return t<1?{}:{drive:1};
  if(n==='high-speed-turn'){
    if(t<1)return {};
    if(!scenario.turnStart&&vehicle.forwardSpeed()*3.6>=150){scenario.turnStart=t;scenario.startHeading=Math.atan2(current.q.y,current.q.w)*2;}
    return scenario.turnStart?{drive:.1,steer:1}:{drive:1};
  }
  if(['takeoff','hover','roll','landing','chaos'].includes(n)){
    if(t>=1&&!scenario.applied){thrusters.takeoff();if(n==='roll'||n==='chaos')thrusters.targetHeight=20;scenario.applied=true;}
    if(n==='landing'&&t>5&&!scenario.landing){thrusters.land();scenario.landing=true;}
    if((n==='roll'||n==='chaos')&&t>5){thrusters.hover=false;thrusters.stabilizeInChaos=false;return {roll:.9,lift:.5,boost:n==='chaos',pitch:n==='chaos'?.3:0,yaw:n==='chaos'?.2:0};}
    return {};
  }
  if(n==='static')return {brake:1};
  if(n==='braking')return t<5?{drive:1}:{brake:1};
  if(n==='steering')return {drive:t<3?.45:.12,steer:t>2?.65:0};
  if(n==='rollover'){if(t>2&&!scenario.applied){vehicle.body.applyTorqueImpulse({x:0,y:0,z:10000},true);scenario.applied=true;}return {drive:t<1?.2:0};}
  return {drive:n==='suspension'?.4:n==='jump'?.8:.8};
}
$('export').onclick=()=>{const data=JSON.stringify({date:new Date().toISOString(),userAgent:navigator.userAgent,config:vehicle.config,thrusters:thrusters?.telemetry()??null,model3Performance:performanceMetrics?.telemetry()??null,launch:launchTimer.telemetry(),performance:perf,soak:sanitizedSoak(),samples,errors},null,2),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.download='roadster-browser-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
function updateModel3HUD(t){
 const p=vehicle.drivetrain.telemetry(),m=performanceMetrics.telemetry(),timer=launchTimer.telemetry();
 $('m3-soc-value').textContent=uiText((p.soc*100).toFixed(1)+'%');$('m3-soc-bar').style.width=(p.soc*100)+'%';
 $('m3-power').textContent=uiText((p.combinedMotorPowerW/1000).toFixed(0)+' kW');$('m3-regen').textContent=uiText((p.regenMechanicalPowerW/1000).toFixed(0)+' kW');
 $('m3-axles').textContent=uiText(`前 ${(p.frontMotorPowerW/1000).toFixed(0)} / 后 ${(p.rearMotorPowerW/1000).toFixed(0)} kW`);
 $('m3-controls').textContent=uiText(`ABS ${p.absActive.some(Boolean)?'调压':p.absEnabled?'待命':'关闭'} · TCS ${p.tcsActive?'限矩':p.tcsEnabled?'待命':'关闭'} · ESC ${p.escActive?'介入':'待命'}`);
 $('m3-mass').textContent=uiText(p.totalMassKg.toFixed(0)+' kg · '+p.mode);
 $('m3-60mph').textContent=uiText(m.strictFromRestSeconds['60mph']?.toFixed(3)+' s');if(!m.strictFromRestSeconds['60mph'])$('m3-60mph').textContent='—';
 const rollout=switcher.active.id==='model-y-performance-2026'?m.oneFootRolloutSeconds:m.legacyThreeMphSeconds;$('m3-rollout-label').textContent=uiText(switcher.active.id==='model-y-performance-2026'?'1-foot rollout · 独立测量':'历史 3 mph 排除段口径');$('m3-rollout').textContent=uiText(rollout['60mph']?rollout['60mph'].toFixed(3)+' s':'—');
 $('m3-quarter').textContent=uiText(m.quarter?`${m.quarter.strictSeconds.toFixed(3)} s · ${m.quarter.trapSpeedKmh.toFixed(1)} km/h`:'—');
 $('launch-time').textContent=uiText(timer.resultSeconds!==null?timer.resultSeconds.toFixed(3)+' s':timer.state==='running'?timer.elapsedSeconds.toFixed(2)+' s':'—');
 $('launch-caption').textContent=uiText(switcher.active.definition.name+' · 严格静止 / 无 rollout');
 $('m3-headlights').setAttribute('aria-pressed',String(headlights));for(const [id,value] of [['m3-indicator-left','left'],['m3-indicator-right','right'],['m3-hazards','hazard']])$(id).setAttribute('aria-pressed',String(indicator===value));
 const interactions=model3Visual?.interactions;document.querySelectorAll('[data-interaction]').forEach(b=>b.setAttribute('aria-pressed',String((interactions?.get(b.dataset.interaction)?.target??0)!==0)));
 if(switcher.active.id==='model-y-performance-2026'){$('y-damping').value=vehicle.dampingMode;$('y-stability').value=vehicle.stabilityMode;}
 document.querySelectorAll('[data-interaction]').forEach(b=>b.disabled=t.speedKmh>1.8);
}
$('garage-open').onclick=openGarage;$('garage-start').onclick=()=>{
 if(switcher.busy||fsd?.loading||!switcher.active)return;
 if(fsd?.active)fsd.exit();
 startDriving();
};
document.querySelectorAll('[data-garage-vehicle]').forEach(b=>b.onclick=()=>{if(!switcher.busy&&b.dataset.garageVehicle!==switcher.active?.id)selectGarage(b.dataset.garageVehicle);});
$('m3-launch').onclick=()=>runScenario('electric-launch');$('m3-performance').onclick=()=>runScenario('model3-performance');
$('m3-mode').onchange=e=>vehicle.drivetrain?.setMode(e.target.value);
$('y-damping').onchange=e=>vehicle.setDampingMode?.(e.target.value);$('y-stability').onchange=e=>vehicle.setStabilityMode?.(e.target.value);
$('m3-soc').oninput=e=>vehicle.drivetrain?.setSOC(Number(e.target.value)/100);
$('m3-payload').onchange=e=>vehicle.drivetrain?.setPayload(Number(e.target.value));
$('m3-abs').onchange=e=>{if(vehicle.drivetrain)vehicle.drivetrain.absEnabled=e.target.checked;};
$('m3-tcs').onchange=e=>{if(vehicle.drivetrain)vehicle.drivetrain.tcsEnabled=e.target.checked;};
$('m3-headlights').onclick=()=>headlights=!headlights;
$('m3-indicator-left').onclick=()=>toggleIndicator('left');$('m3-indicator-right').onclick=()=>toggleIndicator('right');$('m3-hazards').onclick=()=>toggleIndicator('hazard');
$('m3-cockpit').onclick=()=>{rig.mode=1;rig.ready=false;$('camera').textContent=uiText('驾驶舱');};
document.querySelectorAll('[data-interaction]').forEach(b=>b.onclick=()=>{const id=b.dataset.interaction,open=b.getAttribute('aria-pressed')!=='true';if(model3Visual?.setInteraction(id,open)!==false){b.setAttribute('aria-pressed',String(open));}});
$('garage-info').onclick=()=>$('vehicle-info').showModal();$('info-close').onclick=()=>$('vehicle-info').close();
$('switch-test').onclick=async()=>{
 if(switchAudit?.running||switcher.busy)return;switchAudit={running:true,startedAt:new Date().toISOString(),records:[],errors:[]};input.setEnabled(false);paused=true;
 try{for(let i=0;i<54;i++){
  const from=switcher.active.id;
  let scenarioName='parked',sourceEvidence={};
  if(thrusters){thrusters.setMode(i%4===0?'Chaos':'Stabilized');thrusters.infiniteGas=thrusters.mode==='Chaos';thrusters.highThrust=thrusters.mode==='Chaos';thrusters.takeoff();for(let j=0;j<180;j++)vehicle.step({lift:1});scenarioName=thrusters.mode+' airborne';}
  else if(i%6===3){vehicle.reset({x:0,z:130});let contacts=0,maxSpeed=0;for(let j=0;j<720;j++){vehicle.step({drive:1});maxSpeed=Math.max(maxSpeed,vehicle.telemetry().speedKmh);world.contactPairsWith(vehicle.body.collider(0),()=>contacts++);}scenarioName='after physical wall collision';sourceEvidence={contacts,maxSpeedKmh:maxSpeed,position:vehicle.rootPose().p};}
  else if(i%6===5){vehicle.reset();for(let j=0;j<1200&&launchTimer.state!=='complete';j++)vehicle.step({drive:1});scenarioName='after completed acceleration diagnostic';sourceEvidence={launch:launchTimer.telemetry()};}
  else{vehicle.drivetrain.setMode(switcher.active.id==='model-y-performance-2026'?'Insane':'Track');vehicle.setStabilityMode?.('Reduced');for(let j=0;j<120;j++)vehicle.step({drive:1,steer:.2});scenarioName=switcher.active.id==='model-y-performance-2026'?'Insane / Reduced moving':'Track moving';}

  const ids=['roadster','model3-performance-2018','model-y-performance-2026'];let target=i<30?ids[(ids.indexOf(from)+1)%3]:ids[(Math.imul(i+17,1103515245)>>>16)%3];if(target===from)target=ids[(ids.indexOf(from)+1)%3];await switcher.switchTo(target);
  paused=true;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  const record={iteration:i+1,from,to:switcher.active.id,scenario:scenarioName,sourceEvidence,bodies:world.bodies.len(),colliders:world.colliders.len(),oldHandleRemoved:switcher.switches.at(-1).oldHandleRemoved,initialSpeedKmh:vehicle.telemetry().speedKmh,initialSteer:vehicle.steer,inputLifecycle:input.telemetry(),rafLoops:1,thrustersPresent:!!thrusters,gasKg:thrusters?.fuel.mass??null,resources:{...renderer.info.memory,programs:renderer.info.programs?.length},heapBytes:performance.memory?.usedJSHeapSize??null,switchMs:switcher.switches.at(-1).milliseconds};
  switchAudit.records.push(record);
  if(record.bodies!==1||record.colliders!==baseColliderCount+7||!record.oldHandleRemoved||record.initialSpeedKmh>.001||record.initialSteer!==0||record.thrustersPresent!==(record.to==='roadster'))throw Error('Switch lifecycle invariant failed');
  $('handling-result').textContent=uiText(`切换检查 ${i+1}/54`);
 }switchAudit.passed=true;}catch(error){switchAudit.passed=false;switchAudit.errors.push(error.message);}finally{switchAudit.running=false;switchAudit.completedAt=new Date().toISOString();paused=true;$('pause').textContent=uiText('恢复');input.setEnabled(!garageOpen);$('handling-result').textContent=uiText(switchAudit.passed?'54 次切换检查通过':'切换检查失败，请导出记录');}
};
function fitHUD(){const a=thrusters?$('flight-hud'):$('model3-hud'),b=$('dashboard'),scale=Math.min(1,Math.max(.45,(innerHeight-212)/(a.offsetHeight+b.offsetHeight)));a.style.transform=`scale(${scale})`;a.style.transformOrigin='top left';b.style.transform=`scale(${scale})`;b.style.transformOrigin='bottom left';}
const hudObserver=new ResizeObserver(fitHUD);hudObserver.observe($('flight-hud'));hudObserver.observe($('model3-hud'));hudObserver.observe($('dashboard'));
function resize(){fitHUD();const fixed=new URLSearchParams(location.search).get('fixed-render');const dimensions=fixed?.match(/^(\d{3,4})x(\d{3,4})$/);if(dimensions){const [w,h]=dimensions.slice(1).map(Number);renderer.setSize(w/renderer.getPixelRatio(),h/renderer.getPixelRatio(),false);camera.aspect=w/h;}else{const width=innerWidth-(fsd?.inView&&fsd.split?360:0);renderer.setSize(width,innerHeight);camera.aspect=width/innerHeight;}camera.updateProjectionMatrix();}window.addEventListener('resize',resize);resize();
let frames=0,hudAt=0,sampleAt=0,renderLoopPending=0,renderLoopPeak=0,renderCallbacks=0;
function scheduleRenderFrame(){renderLoopPending++;renderLoopPeak=Math.max(renderLoopPeak,renderLoopPending);requestAnimationFrame(now=>{renderLoopPending--;renderCallbacks++;tick(now);});}
let perf={modelLoadMs,startupMs:performance.now()-started,fps:0,physicsHz:0,frameTimeMs:0,physicsStepMs:0,drawCalls:0,triangles:0,jsHeapBytes:null,renderSize:[]};
let measuredSteps=0,measuredFrames=0,measureAt=performance.now();
function sanitizedSoak(){if(!soak)return null;const {samples,...state}=soak;return {...state,elapsedSeconds:(performance.now()-soak.start)/1000,sampleCount:soak.samples.length,samples:soak.samples.slice(-2),simulatedSeconds:(soak.simulatedSteps||0)*C.dt,frames:frames-soak.startFrames};}
function tick(now){
  const cpuFrameStart=performance.now();
  if(nativeFsdAudit&&!nativeFsdAudit.drivingSince&&fsd.autopilot.prediction)nativeFsdAudit.drivingSince=now;
  if(nativeFsdAudit?.cityPhoto&&!nativeFsdAudit.photoTaken&&fsd.path.visible&&fsd.path.stats.visibleMetres>9&&vehicle.forwardSpeed()>5){
   nativeFsdAudit.photoTaken=true;window.roadsterAudit.report({event:'metropolis-drive',ribbon:fsd.path.stats,position:vehicle.rootPose().p});
  }
  if(nativeFsdAudit?.highway&&vehicle.forwardSpeed()>15&&fsd.path.visible){
   const audit=nativeFsdAudit,pose=vehicle.rootPose().p;
   audit.samples=(audit.samples??0)+1;
   audit.maxLaneError=Math.max(audit.maxLaneError??0,Math.abs(pose.x-5394.6));
   audit.maxSpeed=Math.max(audit.maxSpeed??0,vehicle.forwardSpeed()*3.6);
  }
  if(nativeFsdAudit?.noseTest&&fsd.path.visible&&vehicle.forwardSpeed()>3&&fsd.path.stats.visibleMetres>2){
   const heading=2*Math.atan2(root.quaternion.y,root.quaternion.w);
   const name=Math.abs(heading)<.04&&vehicle.forwardSpeed()>6?'straight':(heading>.25&&heading<1.25?'turn':null);
   if(name&&!nativeFsdAudit.shots.has(name)){
    const stats=fsd.path.stats;
    const pixels=nativeFsdAudit.measure(renderer,scene,camera,root,fsd.path);
    window.roadsterAudit.report({event:'nose-'+name,pixels,ribbon:stats,heading,kmh:vehicle.forwardSpeed()*3.6});
    nativeFsdAudit.shots.add(name);
   }
  }
  const auditComplete=nativeFsdAudit?.noseTest
    ? nativeFsdAudit.shots.size===2||now-nativeFsdAudit.started>85000
    : nativeFsdAudit?.waitForPin
    ? fsd.autopilot.status==='已到达目的地'||now-nativeFsdAudit.started>150000
    : nativeFsdAudit&&((nativeFsdAudit.drivingSince&&now-nativeFsdAudit.drivingSince>30000)||now-nativeFsdAudit.started>100000);
  if(nativeFsdAudit&&!nativeFsdAudit.completed&&auditComplete){nativeFsdAudit.completed=true;const driving=fsd.telemetry();fsd.autopilot.disengage('原生核验已结束');paused=true;$('pause').textContent=uiText('恢复');window.roadsterAudit?.report({event:'fsd-native-complete',durationSeconds:nativeFsdAudit.drivingSince?(now-nativeFsdAudit.drivingSince)/1000:0,performance:perf,vehiclePosition:vehicle.rootPose().p,stability:nativeFsdAudit.highway?{samples:nativeFsdAudit.samples,laneErrorMaxM:nativeFsdAudit.maxLaneError,peakKmh:nativeFsdAudit.maxSpeed}:undefined,fsd:driving,errors});}
  scheduleRenderFrame();if(!switcher.active){renderer.render(scene,camera);return;}const elapsed=Math.max(0,(now-last)/1000);last=now;frameTimes.push(elapsed*1000);if(frameTimes.length>300)frameTimes.shift();
  if(!paused&&!vehicle.error){accumulator+=Math.min(elapsed,.1);let substeps=0;while(accumulator>=C.dt&&substeps<12){previous=current;const a=performance.now();vehicle.step(fsd?.active?fsd.beforeStep(C.dt,input.read()):autoInput());if(soak)soak.simulatedSteps++;const stepMs=performance.now()-a;profiler.physics(stepMs);stepTimes.push(stepMs);if(stepTimes.length>300)stepTimes.shift();current=vehicle.rootPose();if(scenario)scenario.time+=C.dt;accumulator-=C.dt;substeps++;measuredSteps++;
    if(scenario){const n=scenario.name,t=scenario.time;
      if((n==='high-speed-turn'||n==='high-speed-straight')&&t>=1){
        const p=vehicle.rootPose(),y=p.p.y;scenario.minY=Math.min(scenario.minY??y,y);scenario.maxY=Math.max(scenario.maxY??y,y);
        if(!vehicle.wheels.some(w=>w.contact))scenario.airSteps=(scenario.airSteps||0)+1;
        if(n==='high-speed-straight'&&t>=21||n==='high-speed-turn'&&scenario.turnStart&&t-scenario.turnStart>=1){
          const yaw=Math.atan2(p.q.y,p.q.w)*2,turn=scenario.turnStart?(yaw-scenario.startHeading)*180/Math.PI:0;
          scenario.result={speedKmh:vehicle.forwardSpeed()*3.6,headingChangeDegrees:turn,verticalRangeMm:(scenario.maxY-scenario.minY)*1000,airSeconds:(scenario.airSteps||0)*C.dt};
          $('handling-result').textContent=uiText(n==='high-speed-turn'?`150 km/h 起转，1 秒改变方向 ${turn.toFixed(1)}°；车身起伏 ${scenario.result.verticalRangeMm.toFixed(1)} mm。`:`高速直行至 ${scenario.result.speedKmh.toFixed(0)} km/h；车身起伏 ${scenario.result.verticalRangeMm.toFixed(1)} mm，离地 ${scenario.result.airSeconds.toFixed(2)} 秒。`);
          scenario.completed=true;paused=true;$('pause').textContent=uiText('恢复');accumulator=0;break;
        }
      }
      if((n==='launch'||n==='electric-launch')&&launchTimer.state==='complete'||n==='model3-performance'&&performanceMetrics?.state==='complete'||n==='takeoff'&&t>=2.5||n==='hover'&&t>=7||n==='roll'&&t>=6||n==='landing'&&(t>=11||t>=7.5&&!scenario.photoTaken)){scenario.completed=n!=='landing'||t>=11;if(n==='landing')scenario.photoTaken=true;paused=true;$('pause').textContent=uiText('恢复');accumulator=0;break;}
    }
  }}
  if(garageOpen){
   // The showroom uses the test track display position. The paused city
   // chassis and traffic retain their physical positions until the driver returns.
   const p=vehicle.config.spawn;root.position.set(p.x,p.y,p.z);root.quaternion.identity();
  }else{
   const alpha=paused?1:Math.min(accumulator/C.dt,1);
   root.position.set(previous.p.x,previous.p.y,previous.p.z).lerp(renderPosition.set(current.p.x,current.p.y,current.p.z),alpha);
   root.quaternion.set(previous.q.x,previous.q.y,previous.q.z,previous.q.w).slerp(renderQuaternion.set(current.q.x,current.q.y,current.q.z,current.q.w),alpha);
  }
  fsd?.update(paused?0:Math.min(elapsed,.1),{p:root.position,q:root.quaternion,front:root.userData.frontExtent,bodyWidth:root.userData.bodyWidth,cockpit:rig.mode===1});
  if(model3Visual){model3Visual.setLights({headlights,brake:vehicle.drivetrain.brakeLights,reverse:vehicle.gear==='R',indicator});model3Visual.update(vehicle,paused?0:Math.min(elapsed,.1));}
  else nodes.forEach((n,i)=>{const w=vehicle.wheels[i];n.suspension.position.y=n.homeY+w.compression;n.rotation.rotation.x=w.angle;if(n.steering)n.steering.rotation.y=w.steer;});
  rig.showBumperPath=fsd?.active&&fsd.autopilot.enabled;
  const flight=thrusters?{flightArmed:thrusters.flightArmed,altitudeAGL:thrusters.ground.height,worldAltitude:current.p.y}:null;if(!thrusters&&rig.mode===1&&modelMetadata.cockpit){const eye=cockpitEye.fromArray(modelMetadata.cockpit.position).applyQuaternion(root.quaternion).add(root.position),target=cockpitTarget.fromArray(modelMetadata.cockpit.target).applyQuaternion(root.quaternion).add(root.position);camera.position.copy(eye);camera.up.set(0,1,0).applyQuaternion(root.quaternion);camera.lookAt(target);camera.fov=modelMetadata.cockpit.fov;camera.updateProjectionMatrix();rig.controls.enabled=false;rig.ready=true;}else rig.update(root,vehicle.forwardSpeed(),Math.min(elapsed,.1),flight);if(!paused)effects?.update(Math.min(elapsed,.1),vehicle);sun.position.copy(root.position).add(sunOffset);sun.target.position.copy(root.position);sun.target.updateMatrixWorld();
  if(!garageOpen&&rig.mode!==1)cameraObstruction.update(camera,root,vehicle.body);rendering.update();profiler.renderBegin();if(!paused||rig.mode===2||frames%15===0){renderer.render(scene,camera);measuredFrames++;}profiler.renderEnd();profiler.frame(elapsed*1000,performance.now()-cpuFrameStart,vehicle);frames++;profileTick(now);
  if(now-measureAt>1000){perf={...perf,modelLoadMs,fps:measuredFrames*1000/(now-measureAt),physicsHz:measuredSteps*1000/(now-measureAt),frameTimeMs:frameTimes.reduce((a,b)=>a+b,0)/frameTimes.length,physicsStepMs:stepTimes.reduce((a,b)=>a+b,0)/Math.max(1,stepTimes.length),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,jsHeapBytes:performance.memory?.usedJSHeapSize??null,renderSize:[renderer.domElement.width,renderer.domElement.height]};measuredFrames=0;measuredSteps=0;measureAt=now;}
  if(now-hudAt>100){const t=vehicle.telemetry();if(jetHUD)jetHUD.update(launchTimer,t);else updateModel3HUD(t);$('speed').textContent=uiText(Math.round(t.speedKmh));$('gear').textContent=uiText(t.gear);$('mode').textContent=`${vehicle.drivetrain?vehicle.drivetrain.mode:'AWD'} · ${vehicle.wheels[0].surface.toUpperCase()}`;$('steer').textContent=uiText(`转向 ${(t.wheels[0].steerDegrees).toFixed(1)}°`);$('perf').textContent=`${perf.fps.toFixed(0)} FPS · ${perf.physicsHz.toFixed(0)} Hz`;
    $('wheels').innerHTML=t.wheels.map(w=>`<div class="wheel ${w.contact?'':'off'}">${w.id} ${uiText(w.contact?'接地':'离地')}<span>${w.compressionMm.toFixed(1)} mm</span></div>`).join('');
    $('metrics').textContent=uiText(`帧耗时 ${perf.frameTimeMs.toFixed(2)} ms\n物理步 ${perf.physicsStepMs.toFixed(3)} ms\n绘制 ${perf.drawCalls} · 三角面 ${perf.triangles.toLocaleString()}\nJS Heap ${perf.jsHeapBytes?(perf.jsHeapBytes/1048576).toFixed(1)+' MB':'浏览器未开放'}\n模型加载 ${modelLoadMs.toFixed(0)} ms\n横向滑速 ${vehicle.wheels[0].lateralSlip.toFixed(2)} m/s\n车身滚转 ${t.rollDegrees.toFixed(1)}°`);
    if(thrusters){$('emergency-toggle').setAttribute('aria-pressed',String(thrusters.emergencyStabilization));$('emergency-toggle').textContent=uiText(thrusters.emergencyStabilization?'紧急抑制旋转：尝试中':'紧急抑制旋转');}
    $('status').textContent=uiText(profileSuite?.running?`性能测试 ${profileSuite.index+1}/${profileSuite.jobs.length} · 自动驾驶`:soak?`持续测试 ${Math.floor((now-soak.start)/60000)} / 30 分钟`:vehicle.error?'物理已安全暂停':garageOpen?'选车中':paused?'已暂停':scenario?`测试 / ${scenario.name}`:'120 Hz PHYSICS · 实时驾驶');
    $('notice').textContent=uiText(loadError?'车辆加载失败，可在车库重试：'+loadError:vehicle.error?'物理状态异常，按 R 恢复':switcher.busy?'正在加载车辆…':fsd?.loadError??'');
    if(soak){const seconds=(now-soak.start)/1000;$('soak-status').textContent=uiText(`连续运行 ${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')} / 30:00 · ${soak.complete?'已完成':'自动驾驶中'}`);if(seconds>=1800)soak.complete=true;
      const nextIndex=Math.min(2,Math.floor(seconds/600));if(!soak.switching&&nextIndex!==soak.vehicleIndex&&!switcher.busy){const owner=soak;owner.switching=true;owner.vehicleIndex=nextIndex;owner.events.push({seconds,event:'vehicle-switch',to:owner.vehicles[nextIndex]});switcher.switchTo(owner.vehicles[nextIndex]).then(()=>{if(soak!==owner)return;owner.switching=false;paused=false;rig.mode=0;rig.ready=false;vehicle.reset({x:75,z:-105});previous=current=vehicle.rootPose();input.setEnabled(true);accumulator=0;}).catch(error=>{owner.invalidStates++;owner.switching=false;owner.events.push({seconds,event:'switch-error',message:error.message});});}
      const quality=Math.floor(seconds/180)%2?'high':'medium';if(rendering.quality!==quality&&!soak.switching){rendering.setQuality(quality);$('quality').value=quality;resize();soak.events.push({seconds,event:'quality',quality});}}
    const qa={fsd:fsd?.telemetry(),renderLoop:{pending:renderLoopPending,peak:renderLoopPeak,callbacks:renderCallbacks},inputLifecycle:input.telemetry(),batching:root.userData.batching??null,profiles:profiler.summary(),profileSuite:profileSuite?{running:profileSuite.running,index:profileSuite.index,total:profileSuite.jobs.length}:null,ready:true,version:import.meta.env.ROADSTER_VERSION,vehicleId:switcher.active.id,garageOpen,switching:switcher.busy,capabilities:switcher.active.definition.capabilities,lifecycle:{switches:switcher.switches,worldBodies:world.bodies.len(),worldColliders:world.colliders.len(),baseColliderCount,cacheModels:modelCache.size,architectureExpected:{inputControllers:1,inputWindowListeners:4,inputDocumentListeners:2,rafLoops:1}},resources:{geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length},model3:vehicle.drivetrain?.telemetry()??null,model3Performance:performanceMetrics?.telemetry()??null,interactions:model3Visual?.telemetry?.()??null,switchAudit,userAgent:navigator.userAgent,paused,scenario:scenario?.name,scenarioTime:scenario?.time,handlingResult:scenario?.result,input:vehicle.currentInput,vehicle:t,thrusters:thrusters?.telemetry()??null,launch:launchTimer.telemetry(),effects:effects?.telemetry()??null,visualRoot:{position:root.position.toArray(),quaternion:root.quaternion.toArray()},performance:perf,rendering:rendering.telemetry(),track:trackScene.telemetry(),soak:sanitizedSoak(),errors,visualNodes:nodes.map((n,i)=>({id:vehicle.wheels[i].id,suspensionMm:(n.suspension.position.y-n.homeY)*1000,roll:n.rotation.rotation.x,steer:n.steering?.rotation.y||0})),samples:samples.slice(-2)};$('qa-data').textContent=JSON.stringify(qa);hudAt=now;}
  if(now-sampleAt>5000){const record={wallTime:Date.now(),...vehicle.telemetry(),thrusters:thrusters?.telemetry()??null,launch:launchTimer.telemetry(),performance:{...perf}};samples.push(record);if(samples.length>450)samples.shift();if(soak){if(soak.samples.length>=720)soak.samples.shift();soak.samples.push({elapsedSeconds:(now-soak.start)/1000,...perf,speed:record.speedKmh,error:record.error});soak.minimumFPS=Math.min(soak.minimumFPS,perf.fps);soak.maxHeap=Math.max(soak.maxHeap,perf.jsHeapBytes||0);if(record.error)soak.invalidStates++;}window.roadsterAudit?.report({profiles:profiler.summary(),profileSuite:profileSuite?{running:profileSuite.running,index:profileSuite.index,total:profileSuite.jobs.length}:null,fsd:fsd?.telemetry(),documentVisibility:document.visibilityState,documentHasFocus:document.hasFocus(),inputLifecycle:input.telemetry(),renderLoop:{pending:renderLoopPending,peak:renderLoopPeak,callbacks:renderCallbacks},wallTime:Date.now(),vehicleId:switcher.active.id,garageOpen,paused,frames,steps:vehicle.steps,performance:{...perf},resources:{...renderer.info.memory,programs:renderer.info.programs?.length},worldBodies:world.bodies.len(),worldColliders:world.colliders.len(),model3:vehicle.drivetrain?.telemetry()??null,switchCount:switcher.switches.length,soak:sanitizedSoak(),switchAudit,model3Performance:performanceMetrics?.telemetry()??null,errors:errors.slice(-10)});sampleAt=now;}
}
// Visible diagnostic suite: every acceleration and collision uses the normal
// force controller and actual RAF clock. Warmup/sample windows are explicit.
function profileTick(now){
 const p=profileSuite;if(!p?.running||p.transitioning)return;const job=p.jobs[p.index],t=(now-p.jobStart)/1000;
 if(t>=job.warmup&&!profiler.active)profiler.begin(`${job.id}/${job.quality}/${job.name}`,{vehicleId:job.id,quality:job.quality,scenario:job.name,warmupSeconds:job.warmup});
 if(t>=job.warmup+8){profiler.end();p.index++;p.transitioning=true;nextProfile();}
}
async function nextProfile(){
 const p=profileSuite;if(p.index>=p.jobs.length){p.running=false;p.input=null;paused=true;setTimeout(()=>window.roadsterAudit?.report({event:'profile-complete',profiles:profiler.results,errors}),750);input.setEnabled(!garageOpen);$('profile-status').textContent=uiText('帧时间采样完成，可下载记录');return;}
 const job=p.jobs[p.index];await switcher.switchTo(job.id);garageOpen=false;$('garage').hidden=true;document.body.classList.remove('garage-open');rendering.setQuality(job.quality);resize();vehicle.reset({x:job.name==='collision'?0:-110,z:job.name==='collision'?130:-150});vehicle.surface='dry';previous=current=vehicle.rootPose();scenario=soak=null;paused=false;rig.mode=0;rig.ready=false;accumulator=0;
 if(job.name==='flight'){thrusters.takeoff();}
 let impulse=false;const start=performance.now();p.input=()=>{const t=(performance.now()-start)/1000;if(job.name==='static')return {brake:1};if(job.name==='normal')return {drive:vehicle.forwardSpeed()<15?.25:0};if(job.name==='high-speed')return {drive:1};if(job.name==='turn')return {drive:1,steer:t>8?.20:0};if(job.name==='rollover'){if(t>2&&!impulse){vehicle.body.applyTorqueImpulse({x:0,y:0,z:10000},true);impulse=true;}return {drive:t<2?.3:0};}if(job.name==='flight')return {};return {drive:.8};};p.jobStart=performance.now();p.transitioning=false;$('profile-status').textContent=uiText(`帧时间采样 ${p.index+1}/${p.jobs.length} · ${job.id} · ${job.name} · ${job.quality}`);
}
$('profile-suite').onclick=()=>{if(profileSuite?.running||switcher.busy)return;profiler.results=[];const jobs=[];for(const id of Object.keys(VehicleRegistry))for(const quality of ['medium','high'])for(const name of ['static','normal','high-speed','turn','collision','rollover',...(id==='roadster'?['flight']:[])])jobs.push({id,quality,name,warmup:['high-speed','turn'].includes(name)?8:3});profileSuite={running:true,index:0,jobs,transitioning:true};input.setEnabled(false);nextProfile();};
$('profile-export').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({date:new Date().toISOString(),profiles:profiler.results},null,2)],{type:'application/json'}));a.download='frame-profiles.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
if(!window.roadsterAudit){if(['low','medium','high'].includes(preferences.quality)){$('quality').value=preferences.quality;rendering.setQuality(preferences.quality);}for(const [id,key,min,max]of [['camera-distance','distance',6,24],['camera-smoothing','smoothing',1,10],['camera-fov','fov',0,1.5]])if(Number.isFinite(preferences[key]))$(id).value=Math.max(min,Math.min(max,preferences[key]));if(typeof preferences.horizon==='boolean')$('horizon').checked=preferences.horizon;if(typeof preferences.pbr==='boolean')$('pbr-rendering').checked=preferences.pbr;if(['0','.5','1'].includes(preferences.effects))$('effects').value=preferences.effects;rig.distance=Number($('camera-distance').value);rig.smoothing=Number($('camera-smoothing').value);rig.speedFov=Number($('camera-fov').value);rig.horizonLock=$('horizon').checked;rendering.setEnhanced($('pbr-rendering').checked);resize();}
for(const id of ['quality','horizon','camera-distance','camera-smoothing','camera-fov','effects','pbr-rendering'])$(id).addEventListener('change',savePreferences);
if(drivingOnly){
  const notice=document.createElement('small');
  notice.id='driving-edition';
  notice.textContent=uiText('32 位驾驶版 · 包含试车场和喷气飞行，城市自动驾驶需要 64 位完整版。');
  $('garage-start').after(notice);
}else{
  fsd=new FSDSystem({scene,world,renderer,camera,sun,rendering,trackScene,getVehicle:()=>vehicle,getThrusters:()=>thrusters,
    spawn:options=>{vehicle.reset(options);scenario=soak=null;accumulator=0;previous=current=vehicle.rootPose();rig.ready=false;},
    stopInput:()=>input.clear(),freeCamera:()=>{rig.mode=2;rig.ready=false;$('camera').textContent=uiText('自由视角');},startDriving});
  const garageCity=document.createElement('button');garageCity.id='garage-city';garageCity.className='primary';garageCity.textContent=uiText('进入 FSD 城市');garageCity.onclick=()=>{if(!switcher.busy&&switcher.active)fsd.enter();};$('garage-start').after(garageCity);
}
await switcher.switchTo('roadster');garageOpen=true;document.body.classList.add('garage-open');$('garage').hidden=false;paused=true;frameGarage();$('notice').textContent='';ready=true;perf.startupMs=performance.now()-started;perf.modelLoadMs=modelLoadMs;last=performance.now();scheduleRenderFrame();
// Opt-in native QA uses the same visible controls and real RAF/120 Hz loop.
// No accelerated wall clock and no body speed injection.
if(window.roadsterAudit&&new URLSearchParams(location.search).has('native-audit')){
 const nativeMode=new URLSearchParams(location.search).get('audit-mode');
 if(nativeMode==='driving-edition'){
  const {auditDrivingEdition}=await import('./diagnostics/DrivingEditionAudit.js');
  try{await auditDrivingEdition(switcher,()=>thrusters,()=>({paused,errors:errors.slice(-3),input:input.telemetry()}));}
  catch(error){window.roadsterAudit.report({event:'driving-edition-complete',passed:false,error:String(error.stack??error)});}
 }
 else if(nativeMode==='slope-park'){
  const {auditSlopePark}=await import('./diagnostics/SlopeParkAudit.js');
  try{await auditSlopePark(vehicle);}catch(e){window.roadsterAudit.report({event:'slopes-complete',passed:false,error:String(e.stack??e)});}
 }
 else if(nativeMode==='garage-view'){
  const {auditGarageView}=await import('./fsd/GarageViewAudit.js');
  try{await auditGarageView({fsd,trackScene,switcher,root:()=>root,getPaused:()=>paused});}
  catch(error){window.roadsterAudit.report({event:'garage-view-complete',passed:false,error:String(error.stack??error)});}
 }
 else if(['fsd','fsd-switch','metro-tunnel','recovery-map','metropolis','highway-stability','bumper-preview'].includes(nativeMode)){
  await selectGarage(['highway-stability','bumper-preview'].includes(nativeMode)?'model-y-performance-2026':'model3-performance-2018');if(nativeMode==='recovery-map')$('fsd-traffic-count').value='32';await fsd.enter();
  if(nativeMode==='fsd-switch'){
   paused=true;const records=[],baseBodies=world.bodies.len(),baseColliders=world.colliders.len(),ids=Object.keys(VehicleRegistry);
   for(let i=0;i<20;i++){
    fsd.autopilot.engage(vehicle);if(thrusters&&i%2===0){thrusters.takeoff();for(let j=0;j<120;j++)vehicle.step({lift:.5});}
    const from=switcher.active.id;await switcher.switchTo(ids[(ids.indexOf(from)+1)%ids.length]);paused=true;
    await new Promise(requestAnimationFrame);const r={iteration:i+1,from,to:switcher.active.id,bodies:world.bodies.len(),colliders:world.colliders.len(),fsdEnabled:fsd.autopilot.enabled,oldPredictionCleared:!fsd.autopilot.prediction,speedKmh:vehicle.telemetry().speedKmh,rafPeak:renderLoopPeak,input:input.telemetry(),oldHandleRemoved:switcher.switches.at(-1).oldHandleRemoved};
    r.passed=r.bodies===baseBodies&&r.colliders===baseColliders&&!r.fsdEnabled&&r.oldPredictionCleared&&r.speedKmh<.001&&r.rafPeak===1&&r.oldHandleRemoved;records.push(r);window.roadsterAudit.report({event:'fsd-switch-record',record:r});
   }
   window.roadsterAudit.report({event:'fsd-switch-complete',passed:records.every(r=>r.passed),records,errors});
  }else if(nativeMode==='bumper-preview'){
   const {measurePathPixels}=await import('./fsd/PathVisualAudit.js');
   const lane=fsd.network.lanes.get('0:-120>0:0/0');
   fsd.spawnCity(lane,40);
   fsd.autopilot.setDestination(vehicle,'0:0>120:0/0');
   fsd.autopilot.engage(vehicle);
   nativeFsdAudit={started:performance.now(),noseTest:true,shots:new Set(),measure:measurePathPixels};
  }else if(nativeMode==='highway-stability'){
   const spawnPoint={x:5394.56,z:1199.15,yaw:.01};
   fsd.replaceTraffic(32,[{...spawnPoint,width:2,length:5}]);fsd.spawn({...spawnPoint,y:0});
   $('fsd-destination').value='580:560>580:1030/1';fsd.chooseDestination();fsd.autopilot.engage(vehicle);
   nativeFsdAudit={started:performance.now(),completed:false,cityPhoto:true,highway:true};
  }else if(nativeMode==='metropolis'){
   $('fsd-start').value='midtown';await $('fsd-relocate').onclick();
   $('fsd-map-open').click();await new Promise(resolve=>setTimeout(resolve,1200));
   await new Promise(requestAnimationFrame);
   window.roadsterAudit.report({event:'metropolis-map',nodes:fsd.network.nodes.length,traffic:fsd.traffic.actors.length});
   await new Promise(resolve=>setTimeout(resolve,600));fsd.map.close();
   fsd.autopilot.engage(vehicle);nativeFsdAudit={started:performance.now(),completed:false,cityPhoto:true};
  }else if(nativeMode==='recovery-map'){
   $('fsd-map-open').click();
   await new Promise(requestAnimationFrame);
   const map=fsd.map,lane=fsd.network.lanes.get('0:-120>0:0/0'),base=lane.points[0];
   // Native QA drives the same map pointer handler used by mouse and trackpad.
   const requested={x:base.x,z:base.z+53.5},rect=map.canvas.getBoundingClientRect();
   const [sx,sy]=map.screen(requested);
   const event={button:0,bubbles:true,clientX:rect.left+sx,clientY:rect.top+sy,pointerId:1};
   // Programmatically generated events lack pointer capture ownership.
   map.canvas.dispatchEvent(new PointerEvent('pointerdown',event));
   map.canvas.dispatchEvent(new PointerEvent('pointerup',event));
   await new Promise(requestAnimationFrame);
   window.roadsterAudit.report({event:'map-pin-selected',requested,pin:fsd.autopilot.pin,traffic:fsd.traffic.actors.length,visible:map.el.open});
   await new Promise(resolve=>setTimeout(resolve,650));
   map.el.querySelector('[data-action="drive"]').click();nativeFsdAudit={started:performance.now(),completed:false,waitForPin:true};
  }else{if(nativeMode==='metro-tunnel'){$('fsd-start').value='tunnel';$('fsd-relocate').click();}fsd.autopilot.engage(vehicle);nativeFsdAudit={started:performance.now(),completed:false};}
 }
 else if(new URLSearchParams(location.search).get('audit-mode')?.startsWith('profile')){$('profile-suite').onclick();}else{
 paused=true;window.roadsterAudit.report({event:'unknown-native-audit-mode',mode:nativeMode});
 }
}

}catch(e){$('notice').textContent=uiText('加载失败：'+e.message);$('status').textContent=uiText('未启动');errors.push({message:e.stack});$('qa-data').textContent=JSON.stringify({ready:false,errors});console.error(e);}
