import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {circuitSamples,terrainHeight} from '../world/TrackGeometry.js';
import {drawSlopePark} from './SlopeParkScene.js';
import {onSlopeGround} from '../world/SlopePark.js';
import {zones} from '../world/TestTrack.js';

// CC0 photographs are bundled locally; none of these requests leave the app.
export async function buildTrackScene(scene,renderer,track){
 const root=new THREE.Group();root.name='ProvingGround';scene.add(root);
 const loader=new THREE.TextureLoader(),anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const load=async(asset,slot,color=false)=>{const t=await loader.loadAsync(`/textures/${asset}_${slot}_1k.jpg`);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=anisotropy;if(color)t.colorSpace=THREE.SRGBColorSpace;return t;};
 const [roadMap,roadNormal,roadRough,grassMap,grassNormal,grassRough]=await Promise.all([load('asphalt_02','diff',true),load('asphalt_02','nor_gl'),load('asphalt_02','rough'),load('aerial_grass_rock','diff',true),load('aerial_grass_rock','nor_gl'),load('aerial_grass_rock','rough')]);
 const road=new THREE.MeshStandardMaterial({map:roadMap,normalMap:roadNormal,roughnessMap:roadRough,normalScale:new THREE.Vector2(.28,.28),color:0xb5b9b6,roughness:.98,envMapIntensity:.25});
 const grass=new THREE.MeshStandardMaterial({map:grassMap,normalMap:grassNormal,roughnessMap:grassRough,normalScale:new THREE.Vector2(.3,.3),color:0xb4b99b,roughness:1,vertexColors:true});
 const concrete=new THREE.MeshStandardMaterial({color:0x9a9f98,roughness:.95});
 const shoulder=new THREE.MeshStandardMaterial({map:grassMap,normalMap:grassNormal,color:0x8e856b,roughness:1,normalScale:new THREE.Vector2(.14,.14)});
 const antiTileChunk=THREE.ShaderChunk.map_fragment.replace('vec4 sampledDiffuseColor = texture2D( map, vMapUv );','vec4 sampledDiffuseColor = mix(texture2D(map,vMapUv),texture2D(map,vMapUv*.537+vec2(.31,.71)),.43);');
 grass.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',antiTileChunk);};grass.customProgramCacheKey=()=> 'terrain-dual-scale-v1';
 const colorBatch=[];
 function geometry(vertices,indices,scale=3){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.setAttribute('uv',new THREE.Float32BufferAttribute(vertices.flatMap((_,i)=>i%3?[]:[vertices[i]/scale,vertices[i+2]/scale]),2));g.computeVertexNormals();return g;}
 function mesh(g,material,cast=false){const m=new THREE.Mesh(g,material);m.receiveShadow=true;m.castShadow=cast;root.add(m);return m;}
 function colored(g,color){const c=new THREE.Color(color),n=g.attributes.position.count;g.setAttribute('color',new THREE.Float32BufferAttribute(Array.from({length:n},()=>[c.r,c.g,c.b]).flat(),3));colorBatch.push(g);}
 function box(x,y,z,w,h,l,color,rotation=0){const g=new THREE.BoxGeometry(w,h,l);g.rotateY(rotation);g.translate(x,y,z);colored(g,color);}
 function paint(x,z,w,l,color,angle=0,y=.021){const g=new THREE.PlaneGeometry(w,l);g.rotateX(-Math.PI/2);g.rotateY(angle);g.translate(x,y,z);colored(g,color);}
 function ribbon(points,width,y,material,offset=0){
  const vertices=[],indices=[];for(let i=0;i<points.length;i++){const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],d=Math.hypot(b.x-a.x,b.z-a.z)||1,nx=(b.z-a.z)/d,nz=-(b.x-a.x)/d;for(const side of [-1,1])vertices.push(points[i].x+nx*(offset+side*width/2),y,points[i].z+nz*(offset+side*width/2));if(i<points.length-1){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}}
  return mesh(geometry(vertices,indices),material);
 }
 // Large-scale variation is independent of the repeat frequency of the asphalt.
 road.onBeforeCompile=s=>{s.vertexShader='varying vec3 vRoadWorld;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvRoadWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');s.fragmentShader='varying vec3 vRoadWorld;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',antiTileChunk+'\nfloat macroWear=sin(vRoadWorld.x*.16+sin(vRoadWorld.z*.08))*sin(vRoadWorld.z*.11);diffuseColor.rgb*=.92+.08*macroWear;');};road.customProgramCacheKey=()=> 'road-macro-wear-dual-scale-v2';
 for(const p of track){
  if(p.kind==='foundation'||p.kind==='slope')continue;
  if(p.kind==='box'){box(p.x,p.y,p.z,p.hx*2,p.hy*2,p.hz*2,p.color,p.yaw||0);continue;}
  if(p.kind==='terrain'){
   const g=geometry(p.vertices,p.indices,10),colors=[];
   for(let i=0;i<p.vertices.length;i+=3){const x=p.vertices[i],z=p.vertices[i+2],h=p.vertices[i+1],variation=.84+.16*Math.sin(x*.009)*Math.sin(z*.011),c=new THREE.Color(0xffffff).multiplyScalar(variation);if(h>25)c.lerp(new THREE.Color(0x8d9385),Math.min(.5,(h-25)/100));colors.push(c.r,c.g,c.b);}
   g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));mesh(g,grass);continue;
  }
  let g=geometry(p.vertices,p.indices);
  if(p.kind==='curb'){colored(g,p.color);continue;}
  if(p.kind==='ramp'){g=g.toNonIndexed();g.clearGroups();g.addGroup(0,p.topIndexCount,0);g.addGroup(p.topIndexCount,p.indices.length-p.topIndexCount,1);g.computeVertexNormals();const m=mesh(g,[road,concrete],true);m.name=p.id;
   // Height-following edge paint follows the same sampled ramp profile.
   for(const side of [-1,1]){const pts=p.profile.map(([dz,h])=>({x:p.x+side*(p.w/2-.28),z:p.z+dz,h})),vs=[],is=[];for(let i=0;i<pts.length;i++){const a=pts[i];vs.push(a.x-.1,a.h+.012,a.z,a.x+.1,a.h+.012,a.z);if(i<pts.length-1){const j=i*2;is.push(j,j+2,j+1,j+1,j+2,j+3);}}const pg=geometry(vs,is);colored(pg,0xe9e6ce);}
  }else mesh(g,road);
 }
 const circuit=circuitSamples();ribbon(circuit,20,.001,shoulder);ribbon(circuit,16,.005,road);
 const line=new THREE.MeshStandardMaterial({color:0xe9e7d7,roughness:.93,polygonOffset:true,polygonOffsetFactor:-1});
 for(const offset of [-7.6,7.6])ribbon(circuit,.13,.012,line,offset);
 const straight=[{x:-110,z:-260},{x:-110,z:2000}];ribbon(straight,29,.001,shoulder);ribbon(straight,24,.006,road);
 for(const x of [-121,-99])paint(x,870,.15,2240,0xece7d8);
 for(let z=-200;z<1950;z+=24)paint(-110,z,.18,7,0xe9e3cb);
 // An actual test apron, access road, pit lane and separate stunt run-up.
 ribbon([{x:-125,z:-190},{x:-285,z:-190},{x:-285,z:0},{x:-250,z:100},{x:-250,z:510}],23,.004,road);
 ribbon([{x:-90,z:-160},{x:-68,z:-90},{x:-68,z:200},{x:-92,z:260}],10,.01,road);
 mesh(geometry([-85,0,-125,100,0,-125,-85,0,180,100,0,180],[0,2,1,1,2,3]),road);
 ribbon([{x:-160,z:-30},{x:-160,z:30}],38,.009,road);
 for(const z of zones){const material=road.clone();material.color.set({wet:0x60706a,gravel:0xb5a67e,ice:0xa9c8cf}[z.type]);material.roughness=z.type==='ice'?.12:z.type==='wet'?.24:1;mesh(geometry([z.x-z.w/2,.017,z.z-z.l/2,z.x+z.w/2,.017,z.z-z.l/2,z.x-z.w/2,.017,z.z+z.l/2,z.x+z.w/2,.017,z.z+z.l/2],[0,2,1,1,2,3]),material);}
 for(let row=0;row<3;row++)for(let col=0;col<16;col++)paint(-121.25+col*1.5,-137+row*.8,1.5,.8,(row+col)%2?0x292d2b:0xe7e8db);
 for(let z=-100;z<140;z+=16){paint(-77,z,11,.12,0xe3dcc0);paint(-64,z,.13,9,0xe3dcc0);}
 paint(-160,0,1,18,0xd8dcbd);paint(-160,0,18,1,0xd8dcbd);
 // Rubber braking marks, subtle and confined to the approach to corners.
 const rubber=new THREE.MeshStandardMaterial({color:0x151a17,transparent:true,opacity:.2,roughness:.96,depthWrite:false});
 for(const side of [-.8,.8])ribbon(circuit.slice(48,74),.25,.015,rubber,side);
 // Guardrail posts match the physical rail positions and sit on the ground.
 for(const x of [-123.5,-96.5])for(let z=-126;z<190;z+=4){if(Math.min(...[-90,30,150].map(c=>Math.abs(z-c)))<38)box(x,.32,z,.09,.64,.09,0x60696a);}
 function sign(text,x,y,z,width=10){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=160;const c=canvas.getContext('2d');c.fillStyle='#1d3439';c.fillRect(0,0,1024,160);c.fillStyle='#b9d2a1';c.fillRect(0,0,12,160);c.font='600 59px sans-serif';c.textAlign='center';c.fillStyle='#f0eee1';c.fillText(text,512,101);const m=mesh(new THREE.PlaneGeometry(width,width*160/1024),new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(canvas),roughness:.9,side:THREE.DoubleSide}));m.position.set(x,y,z);m.rotation.y=Math.PI;return m;}
 sign('ROADSTER  /  PROVING GROUND',-110,5.5,-118.36,25);sign('ELECTRIC  •  850 kW',-92,2.2,-150,9);sign('STUNT  /  SOLID RAMP',-238,2.2,180,10);sign('PIT LANE',-69,3,-110,7);sign('VERTICAL PAD',-160,1.6,-25,8);
 for(const [x,z,text] of [[9,90,'JUMP / 01'],[38,-75,'WET'],[70,-4,'GRAVEL'],[-70,-75,'ICE']]){box(x,1,z,.1,2,.1,0x697478);sign(text,x,2,z,5);}
 drawSlopePark(track,{geometry,mesh,road,concrete,colored,paint,sign,box});
 // Instanced trees avoid hundreds of separate draw calls. Kept outside roads.
 const count=260,trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.2,.32,4,6),new THREE.MeshStandardMaterial({color:0x635a45,roughness:1}),count),canopies=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:0x526844,roughness:1}),count),dummy=new THREE.Object3D();
 let seed=31;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<count;i++){const angle=random()*Math.PI*2,rad=650+random()*900,x=70+Math.cos(angle)*rad,z=500+Math.sin(angle)*rad*1.2,y=terrainHeight(x,z),s=3+random()*3;if(onSlopeGround(x,z)){i--;continue;}dummy.position.set(x,y+2,z);dummy.scale.set(1,1,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);dummy.position.y=y+4.2;dummy.scale.set(s,s*1.3,s);dummy.updateMatrix();canopies.setMatrixAt(i,dummy.matrix);canopies.setColorAt(i,new THREE.Color().setHSL(.20+random()*.06,.18+random()*.18,.24+random()*.12));}
 trunks.receiveShadow=canopies.receiveShadow=true;root.add(trunks,canopies);
 // Physical boxes, buildings and markings share one batched standard material.
 const combined=mergeGeometries(colorBatch);mesh(combined,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9}),true);colorBatch.forEach(g=>g.dispose());
 return{root,telemetry:()=>({photographicPBR:true,textureSets:2,terrainTriangles:33000,closedRamps:track.filter(p=>p.kind==='ramp').map(p=>p.id),curbColliders:track.filter(p=>p.role==='curb').length,circuitSamples:circuit.length,trees:count,stuntRampPosition:[-250,250]})};
}
