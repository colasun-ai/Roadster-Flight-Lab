import * as THREE from 'three';
// Fixed-size particle pools. Exhaust follows the opposite of the actual force.
export class ThrusterEffects{
  constructor(scene,root,system){
    this.root=root;this.system=system;this.quality=1;this.cursor=0;this.maxParticles=900;this.particles=Array.from({length:this.maxParticles},()=>({life:0,total:1,p:new THREE.Vector3(),v:new THREE.Vector3(),dust:false}));
    this.positions=new Float32Array(this.maxParticles*3);this.colors=new Float32Array(this.maxParticles*3);
    this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3));this.geometry.setAttribute('color',new THREE.BufferAttribute(this.colors,3));
    this.points=new THREE.Points(this.geometry,new THREE.PointsMaterial({size:.11,vertexColors:true,transparent:true,opacity:.5,depthWrite:false,blending:THREE.NormalBlending}));this.points.frustumCulled=false;scene.add(this.points);
    const cone=new THREE.ConeGeometry(1,1,12,1,true),housing=new THREE.CylinderGeometry(.047,.065,.09,12,1,true),y=new THREE.Vector3(0,1,0);
    this.emitters=system.nozzles.map(n=>{
      const group=new THREE.Group();group.position.fromArray(n.position);const exhaust=new THREE.Vector3(...n.forceDirection).negate(),force=exhaust.clone().negate();
      const metal=new THREE.Mesh(housing,new THREE.MeshStandardMaterial({color:0x687b88,metalness:.75,roughness:.35,side:THREE.DoubleSide}));metal.quaternion.setFromUnitVectors(y,exhaust);group.add(metal);
      const plume=new THREE.Mesh(cone,new THREE.MeshBasicMaterial({color:0xd5edff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));plume.quaternion.setFromUnitVectors(y,force);group.add(plume);root.add(group);return {n,group,plume,exhaust,carry:0};
    });
  }
  emit(p,v,dust=false){const a=this.particles[this.cursor++%this.maxParticles];a.p.copy(p);a.v.copy(v);a.life=a.total=dust?.7:.26+Math.random()*.2;a.dust=dust;}
  update(dt,vehicle){
    dt=Math.min(dt,.05);this.root.updateMatrixWorld(true);const rootq=this.root.quaternion,velocity=vehicle.body.linvel();
    for(const e of this.emitters){const intensity=e.n.thrust/e.n.maxThrust,len=.45+2.4*Math.sqrt(Math.max(0,intensity));e.plume.visible=e.n.thrust>1&&this.quality>0;e.plume.scale.set(.05+.09*intensity,len,.05+.09*intensity);e.plume.position.copy(e.exhaust).multiplyScalar(len/2+.055);e.plume.material.opacity=Math.min(.21,.13*intensity);
      if(e.n.thrust>1){e.carry+=dt*(35+90*intensity)*this.quality;const p=e.group.getWorldPosition(new THREE.Vector3()),d=e.exhaust.clone().applyQuaternion(rootq);
        while(e.carry>=1){e.carry--;const v=d.clone().multiplyScalar(14+25*Math.sqrt(intensity)).add(new THREE.Vector3(velocity.x,velocity.y,velocity.z));v.add(new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).multiplyScalar(1.4));this.emit(p,v);}
        const ground=this.system.ground.worldGroundY;if(d.y<-.4&&p.y-ground<3.5&&Math.random()<dt*45*intensity*this.quality){const hit=p.clone().addScaledVector(d,(ground+.08-p.y)/d.y);this.emit(hit,new THREE.Vector3((Math.random()-.5)*6,.8,(Math.random()-.5)*6),true);}
      }else e.carry=0;
    }
    for(let i=0;i<this.maxParticles;i++){const a=this.particles[i];a.life=Math.max(0,a.life-dt);if(a.life>0){a.p.addScaledVector(a.v,dt);a.v.multiplyScalar(a.dust?.96:1);const j=i*3;this.positions[j]=a.p.x;this.positions[j+1]=a.p.y;this.positions[j+2]=a.p.z;const f=(a.life/a.total)*(a.dust?.4:.8);this.colors[j]=f*(a.dust?.75:.85);this.colors[j+1]=f*(a.dust?.7:.95);this.colors[j+2]=f*(a.dust?.59:1);}else{this.positions[i*3]=0;this.positions[i*3+1]=-10000;this.positions[i*3+2]=0;this.colors.fill(0,i*3,i*3+3);}}
    this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.color.needsUpdate=true;
  }
  telemetry(){return {poolCapacity:this.maxParticles,activeParticles:this.particles.filter(p=>p.life>0).length,quality:this.quality};}
  dispose(){
    this.points.removeFromParent();this.geometry.dispose();this.points.material.dispose();
    const geometries=new Set(),materials=new Set();
    for(const e of this.emitters){e.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});e.group.removeFromParent();}
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.emitters.length=0;this.particles.length=0;
  }
}
