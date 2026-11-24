import * as THREE from 'three';
import {Sky} from 'three/addons/objects/Sky.js';
export class RenderingSystem{
  constructor(renderer,scene,camera,sun){
    Object.assign(this,{renderer,scene,camera,sun});this.materials=[];this.enhanced=true;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    scene.fog=new THREE.Fog(0xc3d4df,900,3300);
    this.sky=new Sky();this.sky.material.fragmentShader=this.sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );','gl_FragColor = vec4( texColor * 0.25, 1.0 );');this.sky.scale.setScalar(4500);const u=this.sky.material.uniforms;
    u.turbidity.value=6;u.rayleigh.value=1.8;u.mieCoefficient.value=.005;u.mieDirectionalG.value=.8;u.sunPosition.value.set(-.45,.75,.3).normalize();scene.add(this.sky);
    const pmrem=new THREE.PMREMGenerator(renderer),environmentScene=new THREE.Scene();environmentScene.add(this.sky.clone());const floor=new THREE.Mesh(new THREE.PlaneGeometry(1000,1000),new THREE.MeshBasicMaterial({color:0x505b67}));floor.rotation.x=-Math.PI/2;floor.position.y=-1;environmentScene.add(floor);this.environment=pmrem.fromScene(environmentScene,.04);scene.environment=this.environment.texture;scene.environmentIntensity=.7;floor.geometry.dispose();floor.material.dispose();pmrem.dispose();
    sun.intensity=3;sun.shadow.normalBias=.025;sun.shadow.bias=-.00008;sun.shadow.camera.left=-10;sun.shadow.camera.right=10;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-10;sun.shadow.camera.updateProjectionMatrix();
    this.setQuality('medium');
  }
  enhanceModel(root){root.traverse(mesh=>{if(!mesh.isMesh)return;mesh.castShadow=true;const original=mesh.material;
    if(!original?.emissiveMap||original.name!=='model')return;
    let ancestor=mesh,wheel=false;while(ancestor){if(/^Wheel_/.test(ancestor.name))wheel=true;ancestor=ancestor.parent;}
    const material=new THREE.MeshPhysicalMaterial({name:wheel?'Wheel_PBR':'Body_PBR',map:original.emissiveMap,color:0xffffff,emissiveMap:original.emissiveMap,emissive:0xffffff,emissiveIntensity:.035,metalness:wheel?.55:.04,roughness:wheel?.57:.29,clearcoat:wheel?.05:.85,clearcoatRoughness:.19,envMapIntensity:wheel?.65:1,side:original.side});
    material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nfloat roadsterLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));roughnessFactor=mix(.72,.29,smoothstep(.04,.6,roadsterLuma));');shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor*=smoothstep(.04,.55,roadsterLuma);');};material.customProgramCacheKey=()=>wheel?'roadster-wheel-pbr-v1':'roadster-body-pbr-v1';
    this.materials.push({mesh,original,material});mesh.material=material;
  });}
  prepareModel(root){root.traverse(object=>{for(const material of (Array.isArray(object.material)?object.material:[object.material]))if(material)material.needsUpdate=true;});}
  setEnhanced(enabled){this.enhanced=enabled;for(const item of this.materials)item.mesh.material=enabled?item.material:item.original;}
  setQuality(quality){
    this.quality=quality;this.renderer.transmissionResolutionScale=quality==='high'?1:quality==='medium'?.5:.25;const r=this.renderer,shadows=quality!=='low',changed=r.shadowMap.enabled!==shadows;
    r.setPixelRatio(quality==='low'?.8:quality==='medium'?1:Math.min(devicePixelRatio,1.5));r.shadowMap.enabled=shadows;
    const mapSize=quality==='high'?2048:1024;
    if(this.sun.shadow.mapSize.x!==mapSize){this.sun.shadow.mapSize.set(mapSize,mapSize);if(this.sun.shadow.map){this.sun.shadow.map.dispose();this.sun.shadow.map=null;}}
    // Enabling/disabling shadows changes USE_SHADOWMAP. Three's automatic
    // light-version check does not invalidate cached materials for this flag.
    // Invalidate all active materials before the next draw; otherwise a PCF
    // sampler2DShadow can receive a non-shadow fallback texture on the low tier.
    if(changed)this.scene.traverse(object=>{for(const material of (Array.isArray(object.material)?object.material:[object.material]))if(material)material.needsUpdate=true;});
  }
  update(){this.sky.position.copy(this.camera.position);}
  telemetry(){return{quality:this.quality,pbrEnabled:this.enhanced,environmentReflections:true,proceduralSky:true,shadowMapSize:this.sun.shadow.mapSize.x,pixelRatio:this.renderer.getPixelRatio(),transmissionResolutionScale:this.renderer.transmissionResolutionScale};}
}
