import * as THREE from 'three';
import {RoadNetwork,at,distance,CITY_ORIGIN} from './RoadNetwork.js';
import {TrafficSystem,clearRoadPose} from './TrafficSystem.js';
import {CityScene} from './CityScene.js';
import {Autopilot,rearAxleState,trafficVehicleState} from './Autopilot.js';
import {PredictionRibbon} from './PredictionRibbon.js';
import {CityMap} from './CityMap.js';
import {remainingDistance} from './PointNavigation.js';
import './fsd.css';
const $=id=>document.getElementById(id);
export class FSDSystem{
 constructor({scene,world,renderer,camera,sun,rendering,trackScene,getVehicle,getThrusters,spawn,stopInput,freeCamera,startDriving}){
  Object.assign(this,{scene,world,renderer,camera,sun,rendering,trackScene,getVehicle,getThrusters,spawn,stopInput,freeCamera,startDriving,active:false,loading:false,split:false,night:false,frames:0,frameTimes:[],historyReady:false});
  this.network=new RoadNetwork();const bridge=window.planR1??{predict:async state=>{const response=await fetch('/__plan-r1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});return response.json();}};
  this.autopilot=new Autopilot(this.network,bridge);this.path=new PredictionRibbon(scene);this.path.visible=false;this.makeUI();
  this.takeover=e=>{if(this.active&&this.autopilot.enabled&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!['INPUT','SELECT','TEXTAREA'].includes(e.target?.tagName)&&['KeyW','KeyS','KeyA','KeyD','Space','KeyJ','KeyK','KeyH','KeyQ','KeyE','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))this.autopilot.disengage('驾驶员已接管');};window.addEventListener('keydown',this.takeover,true);
 }
 makeUI(){
  const button=document.createElement('button');button.id='city-enter';button.textContent='FSD 城市';document.querySelector('footer').prepend(button);button.onclick=()=>this.enter();
  const section=document.createElement('section');section.id='fsd-panel';section.hidden=true;section.innerHTML=`<div class="fsd-top"><span class="fsd-brand">FSD <b>V14</b></span><button id="city-exit">返回试车场</button></div><div class="fsd-status-line"><i id="fsd-dot"></i><span id="fsd-status">手动驾驶</span></div><h2>都会路网</h2><label for="fsd-destination">导航目的地</label><select id="fsd-destination"></select><button id="fsd-map-open">地图选点</button><div class="fsd-navigation"><span id="fsd-intention">选择目的地，启用自动驾驶</span><small id="fsd-route"></small></div><button class="fsd-primary" id="fsd-engage">启用 FSD</button><p class="fsd-takeover">WASD 或空格可随时接管</p><div class="fsd-options"><button id="fsd-layout">分屏视图</button><button id="fsd-camera">自由镜头</button><button id="fsd-photo">拍照</button><button id="fsd-theme">夜间主题</button></div><details id="fsd-details"><summary>运行状态与记录</summary><label for="fsd-style">驾驶风格</label><select id="fsd-style"><option value="sport">积极 · 提前变道</option><option value="standard">标准 · 原始模型</option></select><label for="fsd-start">试驾起点</label><select id="fsd-start"><option value="city">中央城区</option><option value="ramp">东侧入口匝道</option><option value="highway">环城高速</option><option value="tunnel">环城隧道南口</option><option value="midtown">中城斜向大道</option><option value="harbor">东港快速路</option><option value="uturn">滨河掉头区</option></select><button id="fsd-relocate">从此处出发</button><p id="fsd-model-status">官方 Plan-R1 · 本地 CPU</p><label>交通数量 <select id="fsd-traffic-count"><option>10</option><option>12</option><option>20</option><option selected>32</option></select></label><label><input id="fsd-safety" type="checkbox" checked> 制动安全保护</label><button id="fsd-export">导出预测与驾驶记录</button><small>积极模式按模型预测的前进距离和停车节奏，沿选定车道、转弯或变道轨迹行驶。蓝线显示实际跟踪路径，记录保留模型原始预测。</small><small id="fsd-diagnostics"></small></details><div class="fsd-credit">DriveScene Studio 旧版视觉 · Peixin<br>BMW X6M · vecarz / heynic · CC BY 4.0</div>`;
  document.body.append(section);const speed=document.createElement('div');speed.id='fsd-speed';speed.hidden=true;speed.innerHTML='<strong id="fsd-speed-value">0</strong><span>km/h</span><b id="fsd-limit">50</b><small id="fsd-signal">●</small>';document.body.append(speed);
  const destinations=[['中央广场',this.network.roads.find(l=>l.to.x===1000&&l.to.z===600&&l.from.z===480&&l.index===1)],['北部工作室',this.network.roads.find(l=>l.to.x===1000&&l.to.z===720&&l.from.z===600&&l.index===0)],['东侧花园',this.network.roads.find(l=>l.to.x===1120&&l.to.z===600&&l.from.x===1000&&l.index===0)],['南部车库',this.network.roads.find(l=>l.to.x===1000&&l.to.z===480&&l.from.z===600&&l.index===0)],['西侧公园',this.network.roads.find(l=>l.to.x===880&&l.to.z===600&&l.from.x===1000&&l.index===1)]];
  this.starts={
   midtown:['1700:240>2150:540/0',30,'2150:540>2600:840/0'],
   harbor:['4400:1500>4400:-780/1',35,'4400:-780>2600:-1200/1'],
   city:['0:-120>0:0/0',10,'0:0>0:120/0'],
   ramp:['320:300>430:390/1',10,'580:560>580:1030/1'],
   highway:['-280:390>430:390/1',14,'430:390>580:560/1'],
   tunnel:['580:560>580:1030/1',8,'580:1030>390:1200/1'],
   uturn:['320:300>550:300/0',174,'550:300>320:300/0'],
  };
  for(const [name,id] of [['中城斜向大道','2150:540>2600:840/0'],['东港快速路','4400:1500>4400:-780/1'],['南环枢纽','2600:-660>2600:-1200/1'],['环城高速东段','430:390>580:560/1'],['环城隧道','580:560>580:1030/1'],['北环出口','580:1030>390:1200/1'],['滨河掉头返回辅路','550:300>320:300/0']]){
   destinations.push([name,this.network.lanes.get(id)]);
  }
  $('fsd-relocate').onclick=()=>{
   const [id,s,goal]=this.starts[$('fsd-start').value];
   if(!this.active)return;
   this.stopInput();this.autopilot.reset('已到试驾起点');
   const lane=this.network.lanes.get(id),start=at(lane,s);
   if(distance(start,rearAxleState(this.getVehicle()))>600){
    this.replaceTraffic(this.traffic.actors.length,[{...start,width:2,length:5}]);
   }
   this.spawnCity(lane,s);$('fsd-destination').value=goal;
   this.autopilot.setDestination(this.getVehicle(),goal);
  };
  $('fsd-style').onchange=e=>{
   this.autopilot.reset('驾驶风格已更换');
   this.autopilot.assertive=e.target.value==='sport';
  };
  $('fsd-destination').innerHTML=destinations.map(([name,lane])=>`<option value="${lane.id}">${name}</option>`).join('');$('fsd-destination').selectedIndex=1;
  this.map=new CityMap(this.network,pin=>{
   this.mapPin=pin;
   if(!$('fsd-destination').querySelector('[value="map-pin"]'))$('fsd-destination').add(new Option('地图选点','map-pin'));
   $('fsd-destination').value='map-pin';this.chooseDestination();
  },()=>{if(!this.autopilot.enabled){this.stopInput();this.autopilot.engage(this.getVehicle());}});
  $('fsd-map-open').onclick=()=>{this.map.open();this.map.update(rearAxleState(this.getVehicle()),this.traffic,this.autopilot);};
  $('fsd-destination').onchange=()=>this.chooseDestination();
  $('fsd-engage').onclick=()=>{this.stopInput();this.autopilot.enabled?this.autopilot.disengage('已恢复手动驾驶'):this.autopilot.engage(this.getVehicle());};
  $('city-exit').onclick=()=>this.exit();$('fsd-layout').onclick=()=>{this.split=!this.split;document.body.classList.toggle('fsd-split',this.split);$('fsd-layout').textContent=this.split?'全屏视图':'分屏视图';window.dispatchEvent(new Event('resize'));};
  $('fsd-camera').onclick=()=>this.freeCamera();$('fsd-photo').onclick=()=>{
   this.renderer.render(this.scene,this.camera);
   this.renderer.domElement.toBlob(blob=>{if(blob)this.download(URL.createObjectURL(blob),`Roadster-FSD-${new Date().toISOString().replace(/[:.]/g,'-')}.png`);},'image/png');
  };
  $('fsd-theme').onclick=()=>this.theme(!this.night);$('fsd-safety').onchange=e=>this.autopilot.safetyEnabled=e.target.checked;
  const savedDensity=localStorage.getItem('fsd-city-traffic-count');
  if(['10','12','20','32'].includes(savedDensity))$('fsd-traffic-count').value=savedDensity;
  $('fsd-traffic-count').onchange=e=>{
   localStorage.setItem('fsd-city-traffic-count',e.target.value);
   if(!this.active)return;
   this.autopilot.reset('交通已重置 · 手动驾驶');
   this.replaceTraffic(Number(e.target.value),[trafficVehicleState(this.getVehicle())]);
  };
  $('fsd-export').onclick=()=>this.download(URL.createObjectURL(new Blob([JSON.stringify({version:import.meta.env.ROADSTER_VERSION,model:'official Plan-R1 fine-tuning',events:this.autopilot.events,predictions:this.autopilot.records,traffic:this.traffic?.events,telemetry:this.telemetry()},null,2)],{type:'application/json'})),'fsd-driving-record.json');
 }
 chooseDestination(){
  const id=$('fsd-destination').value,pin=id==='map-pin'?this.mapPin:null;
  this.autopilot.setDestination(this.getVehicle(),pin?.lane??id,pin);
 }
 download(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();if(url.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(url),60000);}
 replaceTraffic(count,avoid=[]){
  const next=new TrafficSystem(this.network,this.world,count,20261122,avoid);
  try{this.city.setTraffic(next.actors);}catch(error){next.dispose();throw error;}
  next.time=this.autopilot.time;this.traffic?.dispose();this.traffic=next;
 }
 releaseCity(){
  this.traffic?.dispose();this.traffic=null;this.city?.dispose();this.city=null;
  this.environment?.dispose();this.environment=null;
  this.autopilot.obstacles=[];this.autopilot.mapFeatures=null;this.autopilot.staticSource=null;this.autopilot.staticNearby=[];
  this.map.update(null,null,null);
 }
 get inView(){return !!(this.active&&this.city?.root.visible);}
 setCityView(visible){
  this.city.root.visible=visible;
  if(this.trackScene?.root)this.trackScene.root.visible=visible?false:this.trackVisible;
  this.rendering.sky.visible=visible?false:this.saved.skyVisible;
  if(visible){
   this.scene.environment=this.environment;
   this.theme(this.night);
  }else{
   this.map.close();this.path.reset();
   const s=this.saved;
   Object.assign(this.scene,{environment:s.environment,environmentIntensity:s.environmentIntensity,fog:s.fog,background:s.background});
   this.renderer.toneMappingExposure=s.exposure;this.sun.color.copy(s.sunColor);this.sun.intensity=s.sunIntensity;
   for(const h of s.hemispheres){h.light.color.copy(h.color);h.light.groundColor.copy(h.ground);h.light.intensity=h.intensity;}
  }
  document.body.classList.toggle('fsd-city',visible);
  document.body.classList.toggle('fsd-split',visible&&this.split);
  $('fsd-panel').hidden=$('fsd-speed').hidden=!visible;
  $('scene-label').textContent=visible?'FLIGHT LAB · 本地 FSD 城市':'FLIGHT LAB · 实体试车场';
  window.dispatchEvent(new Event('resize'));
 }
 parkForGarage(){
  if(!this.inView)return;
  this.autopilot.disengage('车库已暂停自动驾驶');
  this.setCityView(false);
 }
 async enter(){
  if(this.loading)return;
  if(this.active){
   if(!this.inView){this.setCityView(true);this.startDriving();this.stopInput();}
   return;
  }
  this.loading=true;this.loadError=null;
  const buttons=[$('city-enter'),$('garage-city')].filter(Boolean);
  for(const b of buttons){b.disabled=true;b.textContent='加载城市…';}
  try{
   this.city=new CityScene(this.scene,this.world,this.network,{active:false});
   await this.city.prepareTraffic();
   const response=await fetch('/textures/fsd/studio-environment.bin');
   if(!response.ok)throw Error('城市环境贴图读取失败');
   const decoded=await response.arrayBuffer(),view=new DataView(decoded);
   const width=view.getUint32(0,true),height=view.getUint32(4,true);
   if(!width||!height||decoded.byteLength!==8+width*height*8)throw Error('城市环境贴图尺寸不匹配');
   this.environment=new THREE.DataTexture(new Uint16Array(decoded,8),width,height,THREE.RGBAFormat,THREE.HalfFloatType);
   Object.assign(this.environment,{mapping:THREE.CubeUVReflectionMapping,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,flipY:false,colorSpace:THREE.LinearSRGBColorSpace,needsUpdate:true});
   this.autopilot.startSession();
   this.replaceTraffic(Number($('fsd-traffic-count').value));
   this.saved={skyVisible:this.rendering.sky.visible,environment:this.scene.environment,environmentIntensity:this.scene.environmentIntensity,fog:this.scene.fog,background:this.scene.background,exposure:this.renderer.toneMappingExposure,sunColor:this.sun.color.clone(),sunIntensity:this.sun.intensity,hemispheres:[]};
   this.scene.traverse(o=>{if(o.isHemisphereLight)this.saved.hemispheres.push({light:o,color:o.color.clone(),ground:o.groundColor.clone(),intensity:o.intensity});});
   this.trackVisible=this.trackScene?.root?.visible;this.active=true;this.city.activate();this.night=false;this.setCityView(true);
   this.autopilot.obstacles=this.city.recoveryObstacles;this.autopilot.mapFeatures=this.city.modelFeatures;
   this.spawnCity();this.startDriving();this.stopInput();
   const thrusters=this.getThrusters();if(thrusters){thrusters.hover=false;thrusters.landing=false;thrusters.flightArmed=false;}
   this.chooseDestination();
  }catch(error){
   if(this.active)this.exit();else this.releaseCity();
   this.loadError='城市加载失败：'+error.message;$('notice').textContent=this.loadError;console.error(error);
  }finally{
   this.loading=false;
   for(const b of buttons){b.disabled=false;b.textContent=this.loadError?'重试加载城市':b.id==='garage-city'?'进入 FSD 城市':'FSD 城市';}
  }
 }
 exit(){
  if(!this.active)return;
  this.autopilot.reset();this.split=false;$('fsd-layout').textContent='分屏视图';
  this.setCityView(false);this.active=false;this.releaseCity();
  this.spawn({x:0,z:-110});
 }
 theme(night){this.night=night;if(!this.active)return;this.city.setTheme(night);this.scene.background=new THREE.Color(night?'#262a2e':'#dce5ee');this.scene.fog=new THREE.Fog(night?'#373a3e':'#dce5ee',85,260);this.scene.environmentIntensity=night?.30:.38;this.renderer.toneMappingExposure=1;this.sun.color.set(night?'#ebebeb':'#fff5e8');this.sun.intensity=night?1.65:3;
  for(const h of this.saved.hemispheres){h.light.color.set(night?'#d5d5d5':'#cedded');h.light.groundColor.set(night?'#717171':'#8b959d');h.light.intensity=night?.95:1.05;}$('fsd-theme').textContent=night?'日间主题':'夜间主题';
 }
 beforeStep(dt,manual){
  if(!this.active)return manual;const v=this.getVehicle();this.traffic.step(dt,trafficVehicleState(v));this.autopilot.sample(dt,v,this.traffic);this.autopilot.update(v,this.traffic);return this.autopilot.control(v,this.traffic,manual)??manual;
 }
 spawnCity(lane=this.network.lanes.get('0:-120>0:0/0'),s=10){
  const ego=trafficVehicleState(this.getVehicle());
  const p=clearRoadPose(this.network,lane,s,this.traffic.actors,ego);
  this.spawn({x:p.x,z:p.z,yaw:p.yaw,y:0});
 }
 vehicleChanged(){if(!this.active)return;this.autopilot.reset('车型已切换 · 手动驾驶');this.spawnCity();this.chooseDestination();}
 update(dt,visual){
  if(!this.inView)return;this.city.update(this.autopilot.time,this.camera);this.path.update((this.autopilot.recovery.committed||!this.autopilot.enabled)?null:this.autopilot.prediction,this.getVehicle(),this.autopilot.time,dt,visual);
  const ego=rearAxleState(this.getVehicle());
  if(++this.frames%6===0){const t=this.autopilot.telemetry(),near=this.autopilot.locate(ego),signal=near?this.network.light(near.lane,this.autopilot.time):4;
   $('fsd-status').textContent=(t.enabled&&ego.speed<.45&&t.safetyReason==='红灯保护'?'等待绿灯':t.safetyReason??t.status);$('fsd-dot').classList.toggle('engaged',t.enabled);$('fsd-engage').textContent=t.enabled?'退出 FSD':'启用 FSD';$('fsd-speed-value').textContent=Math.round(ego.speed*3.6);$('fsd-limit').textContent=near?Math.round(near.lane.speedLimit*3.6):50;$('fsd-signal').style.color=['#52c394','#deb55a','#e25e5f','#71808d','#71808d'][signal];
   this.map.update(ego,this.traffic,this.autopilot);
   const goal=this.network.lanes.get(t.destination);
   const remaining=near&&t.route.length?remainingDistance(this.network,ego,t.route,t.pin):0;
   $('fsd-route').textContent=goal?`目的地距离 ${Math.round(remaining)} m · ${this.traffic.actors.length} 辆交通车`:'';
   const turn=this.network.lanes.get(t.route.find(id=>this.network.lanes.get(id).connector));$('fsd-intention').textContent=t.enabled?(t.recovery??(t.detour?'已改道':null)??this.autopilot.maneuver??this.autopilot.followReason??(turn?.turn>.3?'前方左转':turn?.turn<-.3?'前方右转':'沿当前道路行驶')):'手动驾驶 · FSD 待命';
   $('fsd-model-status').textContent=t.inferences?`Plan-R1 · ${this.autopilot.assertive?'导航引导':'原始预测'} · ${t.latencyMs.toFixed(0)} ms`:'官方 Plan-R1 · 等待本地推理';$('fsd-diagnostics').textContent=`预测 ${t.rawPoints.length}/16 点 · 年龄 ${t.age?.toFixed(2)??'—'} s · ${t.error??'完整 8 秒模型预测，按速度显示前缀'}`;
  }
 }
 telemetry(){return{active:this.active,inView:this.inView,split:this.split,predictionRibbon:this.path.stats,traffic:this.traffic?.actors.map(({id,x,z,yaw,speed,style,destination,indicator,braking,lane})=>({id,x,z,yaw,speed,style,destination,indicator,braking,lane:lane.id})),autopilot:this.autopilot.telemetry(),trafficEvents:this.traffic?.events};}
}
