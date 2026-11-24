import * as THREE from 'three';
import {FollowCamera} from './FollowCamera.js';
export class FlightCamera extends FollowCamera{
  constructor(camera,canvas){super(camera,canvas);this.horizonLock=true;this.distance=10;this.smoothing=4;this.speedFov=1;this.heading=new THREE.Vector3(0,0,1);}
  cycle(){this.mode=(this.mode+1)%4;this.ready=false;return ['跟随视角','车头视角','自由视角','飞行视角'][this.mode];}
  update(root,speed,dt,flight){
    const airborne=flight?.flightArmed&&flight.altitudeAGL>.25;
    if(this.mode!==3&&!(this.mode===0&&airborne)){super.update(root,speed,dt);this.camera.fov=48;this.camera.updateProjectionMatrix();return;}
    this.controls.enabled=false;const cam=this.camera,p=root.position;
    const forward=this.scratch[0].set(0,0,1).applyQuaternion(root.quaternion);forward.y=0;
    if(forward.lengthSq()>.1){forward.normalize();this.heading.lerp(forward,1-Math.exp(-1.8*dt)).normalize();}
    const distance=this.distance+Math.min(Math.abs(speed)*.08,12),target=this.scratch[1].copy(p);target.y+=.7;
    const desired=this.scratch[2].copy(target).addScaledVector(this.heading,-distance);desired.y+=3.5+Math.min(Math.abs(speed)*.025,3);
    desired.y=Math.max(desired.y,(flight?.worldAltitude-flight?.altitudeAGL||0)+2);
    if(!this.ready)cam.position.copy(desired);else cam.position.lerp(desired,1-Math.exp(-this.smoothing*dt));
    const up=this.horizonLock?this.scratch[3].set(0,1,0):this.scratch[3].set(0,1,0).applyQuaternion(root.quaternion);
    cam.up.lerp(up,1-Math.exp(-3*dt)).normalize();cam.lookAt(target.addScaledVector(this.heading,2));
    const fov=48+Math.min(Math.abs(speed)*.15,20)*this.speedFov;cam.fov+=(fov-cam.fov)*(1-Math.exp(-3*dt));cam.updateProjectionMatrix();this.last.copy(p);this.ready=true;
  }
}
