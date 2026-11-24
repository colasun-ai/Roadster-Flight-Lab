import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
export class FollowCamera{
  constructor(camera,canvas){this.camera=camera;this.controls=new OrbitControls(camera,canvas);this.controls.enableDamping=true;this.controls.maxDistance=70;this.controls.minDistance=2;this.mode=0;this.ready=false;this.last=new THREE.Vector3();this.scratch=Array.from({length:6},()=>new THREE.Vector3());}
  cycle(){this.mode=(this.mode+1)%3;this.ready=false;return ['跟随视角','车头视角','自由视角'][this.mode];}
  update(root,speed,dt){const cam=this.camera,p=root.position,q=root.quaternion;this.controls.enabled=this.mode===2;
    const forward=this.scratch[0].set(0,0,1).applyQuaternion(q);forward.y=0;if(forward.lengthSq()<.02)forward.set(0,0,1);forward.normalize();
    const target=this.scratch[1].copy(p);target.y+=.65;
    if(this.mode===2){if(!this.ready){cam.position.copy(p).add(this.scratch[2].set(6,3,6));this.controls.target.copy(target);}else{const d=this.scratch[2].copy(p).sub(this.last);cam.position.add(d);this.controls.target.add(d);}this.controls.update();}
    else if(this.mode===0){const desired=this.scratch[2].copy(p).addScaledVector(forward,-(7+(this.distance??10)-10)-Math.min(Math.abs(speed)*.1,5));desired.y+=this.showBumperPath?4.7:3.1;if(!this.ready)cam.position.copy(desired);else cam.position.lerp(desired,1-Math.exp(-(5*(this.smoothing??4)/4)*dt));cam.up.set(0,1,0);cam.lookAt(target.addScaledVector(forward,2));}
    else{const desired=this.scratch[2].set(0,1.05,1.7).applyQuaternion(q).add(p);cam.position.copy(desired);cam.up.set(0,1,0);cam.lookAt(this.scratch[3].set(0,1.05,30).applyQuaternion(q).add(p));}
    this.last.copy(p);this.ready=true;
  }
}
