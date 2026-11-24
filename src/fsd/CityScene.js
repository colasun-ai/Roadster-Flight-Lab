import {maskVehicleForPath} from './PredictionRibbon.js';
// Visual recipe adapted from the MIT/CC BY4 DriveScene Studio ba307215
// daylight/night palettes. Navigation and physical city geometry are new.
import {buildCorridor,buildJunction,addDirectionSigns} from './MetroStreets.js';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {CITY_ORIGIN,at,distance} from './RoadNetwork.js';
export class CityScene{
 constructor(scene,world,network,{active=true}={}){
  Object.assign(this,{scene,world,network,colliders:[],recoveryObstacles:[],trafficViews:[],night:false,signals:[],modelFeatures:[],trackColliders:[]});
  world.forEachCollider(c=>{if(!c.parent()&&c.isEnabled())this.trackColliders.push(c);});
  this.root=new THREE.Group();this.root.name='DriveSceneCity';scene.add(this.root);
  try{
   this.build();addDirectionSigns(this);this.batch();
   this.fill=new THREE.DirectionalLight('#cbdde9',.5);this.fill.position.set(24,16,-12);this.root.add(this.fill);
   this.root.visible=active;
   if(active)this.activate();
   else for(const c of this.colliders)c.setEnabled(false);
  }catch(error){this.dispose();throw error;}
 }
 activate(){
  if(this.active)return;
  this.active=true;
  for(const c of this.trackColliders)if(c.isValid())c.setEnabled(false);
  for(const c of this.colliders)c.setEnabled(true);
  this.root.visible=true;
 }
 box(x,y,z,w,h,l,material,solid=false,yaw=0){const footing=Math.abs(y-h/2)<.001?.055:0;
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h+footing,l),material);mesh.position.set(x,y-footing/2,z);mesh.rotation.y=yaw;mesh.receiveShadow=true;mesh.castShadow=h>.3;this.root.add(mesh);if(solid&&y+h/2>.10&&y-h/2<1.5)this.recoveryObstacles.push({x,z,yaw,width:w,length:l});if(solid)this.colliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(w/2,h/2,l/2).setTranslation(x,y,z).setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)}).setFriction(.8)));return mesh;}
 build(){
  const mat=(color,roughness=.9)=>new THREE.MeshStandardMaterial({color,roughness});
  this.materials={ground:mat('#c4cfdd'),road:mat('#59616c'),pavement:mat('#d3dce4'),curb:mat('#d6e1ef'),building:mat('#d3d7dd'),glass:mat('#a6bed0',.3),paint:mat('#d6e0e9'),yellow:mat('#bbaa6f'),grass:mat('#809c68'),dark:mat('#4e5964')};const M=this.materials,{x:ox,z:oz}=CITY_ORIGIN;
  // Top is exactly y=0 for both road and sidewalk supports; no overlapping
  // physical seams beneath the tires. Curbs/buildings alone add obstacles.
  this.materials.sign=mat('#187864');
  this.materials.lamp=new THREE.MeshBasicMaterial({color:'#fff0bb'});
  const xs=this.network.nodes.map(n=>n.x),zs=this.network.nodes.map(n=>n.z);
  const x0=Math.min(...xs)-150,x1=Math.max(...xs)+150,z0=Math.min(...zs)-150,z1=Math.max(...zs)+150;
  this.box((x0+x1)/2,-.30,(z0+z1)/2,x1-x0,.50,z1-z0,M.ground);
  this.colliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid((x1-x0)/2,.25,(z1-z0)/2).setTranslation((x0+x1)/2,-.25,(z0+z1)/2).setFriction(.8)));
  for(const link of this.network.links)buildCorridor(this,link);
  for(const node of this.network.nodes){
   buildJunction(this,node);
   if(node.kind!=='junction'||node.neighbors.length<3)continue;
   for(const road of this.network.roads.filter(l=>l.to===node&&l.index===0)){
    const p=at(road,road.length-2),yaw=p.yaw;
    const setback=(node.trim??14)+2.3;const crossCentre={x:node.x-Math.sin(yaw)*setback,z:node.z-Math.cos(yaw)*setback},corners=[[-6.8,-1.55],[6.8,-1.55],[6.8,1.55],[-6.8,1.55],[-6.8,-1.55]].map(([side,forward])=>[crossCentre.x+Math.cos(yaw)*side+Math.sin(yaw)*forward,crossCentre.z-Math.sin(yaw)*side+Math.cos(yaw)*forward]);
    this.modelFeatures.push({id:`crosswalk:${node.id}:${road.from.id}`,type:1,points:corners,speedLimit:0,headingValid:false});
    for(let i=0;i<7;i++){const offset=(i-3)*1.8;this.box(crossCentre.x+Math.cos(yaw)*offset,.015,crossCentre.z-Math.sin(yaw)*offset,1,.016,3.1,M.paint,false,yaw);}
    if(node.neighbors.length<3)continue;
    const sx=p.x-Math.cos(yaw)*7.8,sz=p.z+Math.sin(yaw)*7.8;
    this.box(sx,2.3,sz,.13,4.6,.13,M.dark);const signal=new THREE.Group();signal.position.set(sx,4.2,sz);signal.rotation.y=yaw+Math.PI;this.root.add(signal);
    const housing=new THREE.Mesh(new THREE.BoxGeometry(.48,1.25,.3),M.dark);signal.add(housing);const lamps=[];
    for(let i=0;i<3;i++){const lamp=new THREE.Mesh(new THREE.CircleGeometry(.13,14),new THREE.MeshBasicMaterial({color:0x26333c}));lamp.position.set(0,.38-i*.38,.16);signal.add(lamp);lamps.push(lamp);}this.signals.push({road,lamps,signal});
   }
  }
  // Pale capped blocks and broad windows reproduce the licensed studio's
  // restrained solid architecture rather than a photographic race circuit.
  for(const x of [-60,60])for(const z of [-60,60]){
   for(let i=0;i<6;i++){
    const px=ox+x+(i%3-1)*23,pz=oz+z+(Math.floor(i/3)-.5)*43,h=9+(i*7+Math.abs(x-z))%24,w=15+(i%2)*3,l=22;
    this.box(px,h/2,pz,w,h,l,M.building,true);this.box(px,h+.25,pz,w+1,.5,l+1,M.curb);
    this.modelFeatures.push({id:`building:${px}:${pz}`,type:3,points:[[px-w/2,pz-l/2],[px+w/2,pz-l/2],[px+w/2,pz+l/2],[px-w/2,pz+l/2],[px-w/2,pz-l/2]],speedLimit:0,headingValid:false});
    for(let floor=3;floor<h-1;floor+=3.4){for(const side of [-1,1]){this.box(px+side*(w/2+.015),floor,pz,.03,1.2,l*.7,M.glass);this.box(px,floor,pz+side*(l/2+.015),w*.7,1.2,.03,M.glass);}}
   }
  }
  // Build street walls on surveyed parcels. Keep entire building footprints
  // away from all road mouths including the diagonal avenue.
  const facades=['#98a9b4','#c5afa0','#9caeab','#c7c4b7'].map(c=>mat(c));
  for(let ix=0;ix<6;ix++)for(let iz=0;iz<7;iz++){
   const cx=ox+1025+ix*450,cz=oz-510+iz*300;
   for(const along of [-1,1])for(let bay=0;bay<4;bay++){
    const x=cx+(bay-1.5)*92,z=cz+along*91,seed=ix*41+iz*17+bay*7+along;
    const w=44+(seed&3)*6,l=42+(seed&1)*13,h=11+(Math.abs(seed*13)%41);
    if(this.network.nearest({x,z}).distance<Math.hypot(w,l)/2+12)continue;
    this.box(x,h/2,z,w,h,l,facades[Math.abs(seed)%4],true);
    this.box(x,h+.27,z,w+.55,.54,l+.55,M.curb);
    // The street fronts and side elevations meet at a common grounded plinth.
    this.box(x,1.05,z,w+.16,2.1,l+.16,M.curb);
    for(let y=4;y<h-2;y+=5){
     for(const side of [-1,1]){
      this.box(x,y,z+side*(l/2+.04),w*.80,1.65,.08,M.glass);
      this.box(x+side*(w/2+.04),y,z,.08,1.65,l*.74,M.glass);
     }
    }
   }
  }

 }
 batch(){
  this.staticMeshes=[];this.root.updateMatrixWorld(true);const groups=new Map();for(const mesh of [...this.root.children]){if(!mesh.isMesh)continue;const key=[Math.floor(mesh.position.x/260),Math.floor(mesh.position.z/260),mesh.material.uuid,mesh.castShadow,Boolean(mesh.geometry.index),Object.keys(mesh.geometry.attributes).sort().join(',')].join(':');let group=groups.get(key);if(!group){group={material:mesh.material,castShadow:mesh.castShadow,geometries:[]};groups.set(key,group);}group.geometries.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));mesh.removeFromParent();mesh.geometry.dispose();}
  for(const group of groups.values()){const geometry=mergeGeometries(group.geometries,false);group.geometries.forEach(g=>g.dispose());if(!geometry)throw Error('Static city batching failed');const mesh=new THREE.Mesh(geometry,group.material);mesh.castShadow=group.castShadow;mesh.receiveShadow=true;geometry.computeBoundingBox();this.staticMeshes.push(mesh);this.root.add(mesh);}
 }
 prepareTraffic(){
  if(!this.trafficAssets){
   const loader=new GLTFLoader();
   this.trafficAssets=Promise.allSettled(['near','mid','far'].map(level=>loader.loadAsync('/models/traffic/bmw-x6m-'+level+'.glb'))).then(results=>{
    this.templates=results.filter(r=>r.status==='fulfilled').map(r=>r.value.scene);
    const failed=results.find(r=>r.status==='rejected');
    if(failed||this.disposed){
     disposeMeshes(this.templates);this.templates=[];this.trafficAssets=null;
     if(failed)throw failed.reason;
    }
    for(const root of this.templates)maskVehicleForPath(root,2);
    return this.templates;
   });
  }
  return this.trafficAssets;
 }
 setTraffic(actors){
  const levels=this.templates;
  if(!levels?.length||this.disposed)throw Error('交通车资源尚未就绪');
  this.clearTrafficViews();
  const colors=['#db493b','#327ea8','#e4e5e2','#e1b148','#3b4d63','#6d917c','#8b6596','#b3bbc2'];
  this.trafficViews=actors.map((actor,i)=>{
   const lod=new THREE.LOD(),views=[],lenses=[];levels.forEach((g,index)=>{const root=g.clone(true);root.traverse(o=>{if(o.isMesh){o.castShadow=index===0;o.receiveShadow=false;if(o.material.name==='tail_lens'){
     o.material=o.material.clone();const flash={value:0},braking={value:0};
     o.material.onBeforeCompile=shader=>{
      shader.uniforms.turnSide=flash;shader.uniforms.braking=braking;
      shader.vertexShader='varying float lensSide;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nlensSide=position.x;');
      shader.fragmentShader='varying float lensSide; uniform float turnSide; uniform float braking;\n'+shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(.80,.018,.01)*braking+vec3(1.,.32,.015)*step(.4,lensSide*turnSide);');
     };lenses.push({flash,braking});
    }if(o.material.name==='body'){o.material=o.material.clone();o.material.color.set(colors[i%colors.length]);o.material.metalness=.42;o.material.roughness=.27;}}});lod.addLevel(root,[0,36,90][index]);views.push(root);});
   this.root.add(lod);
   const rigs=views.map(root=>['FL','FR','RL','RR'].map(id=>({
    spin:root.getObjectByName('Wheel_'+id+'_Rotation'),
    steer:id[0]==='F'?root.getObjectByName('Wheel_'+id+'_Steering'):null
   })));
   return{actor,lod,views,rigs,lenses};
  });
 }
 update(time,camera){
  for(const mesh of this.staticMeshes){
   const b=mesh.geometry.boundingBox,p=camera.position,dx=Math.max(0,b.min.x-p.x,p.x-b.max.x),dz=Math.max(0,b.min.z-p.z,p.z-b.max.z);
   mesh.visible=dx*dx+dz*dz<320*320;
  }
  for(const{road,lamps,signal:group}of this.signals){group.visible=Math.hypot(camera.position.x-group.position.x,camera.position.z-group.position.z)<265;if(!group.visible)continue;const signal=this.network.light(road,time);lamps.forEach((lamp,i)=>lamp.material.color.setHex(signal===[2,1,0][i]?[0xee635d,0xffd36f,0x64d6a1][i]:0x26333c));}
  for(const view of this.trafficViews){const a=view.actor;
   view.lod.visible=Math.hypot(camera.position.x-a.x,camera.position.z-a.z)<280;if(!view.lod.visible)continue;
   view.lod.position.set(a.x,0,a.z);view.lod.rotation.y=a.yaw;view.lod.update(camera);for(const {spin,steer} of view.rigs[view.lod.getCurrentLevel()]){
    if(spin)spin.rotation.x=a.wheelAngle;if(steer)steer.rotation.y=a.steer;
   }
   for(const lens of view.lenses){lens.braking.value=a.braking?1:0;lens.flash.value=Math.floor(time*2.7)%2?(a.indicator==='left'?1:a.indicator==='right'?-1:0):0;}
  }
 }
 setTheme(night){this.night=night;const dark={ground:'#373a3e',road:'#303031',pavement:'#3c4045',curb:'#5a6068',building:'#817d7d',glass:'#606a72',paint:'#a7adb2'},light={ground:'#c4cfdd',road:'#59616c',pavement:'#d3dce4',curb:'#d6e1ef',building:'#d3d7dd',glass:'#a6bed0',paint:'#d6e0e9'};for(const[key,color]of Object.entries(night?dark:light))this.materials[key].color.set(color);}
 clearTrafficViews(){
  for(const v of this.trafficViews){
   v.lod.removeFromParent();
   for(const r of v.views)r.traverse(o=>{if(o.isMesh&&['body','tail_lens'].includes(o.material?.name))o.material.dispose();});
   for(const o of v.lod.children)if(o.isMesh){o.geometry.dispose();o.material.dispose();}
  }
  this.trafficViews=[];
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;this.root.removeFromParent();
  for(const c of this.colliders)this.world.removeCollider(c,true);
  if(this.active)for(const c of this.trackColliders)if(c.isValid())c.setEnabled(true);
  disposeMeshes([this.root,...(this.templates??[])]);
  this.root.clear();this.colliders=[];this.trackColliders=[];this.trafficViews=[];this.templates=[];this.trafficAssets=null;
 }
}

function disposeMeshes(roots){
 const geometries=new Set(),materials=new Set(),textures=new Set();
 for(const root of roots)root.traverse(o=>{
  if(o.geometry)geometries.add(o.geometry);
  for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m){
   materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);
  }
 });
 geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
}
