import * as THREE from 'three';import RAPIER from '@dimforge/rapier3d-compat';
// Query the same collision world as the car; never move the physical vehicle.
export class CameraObstruction{
 constructor(world){this.world=world;this.ray=new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:0,z:1});this.target=new THREE.Vector3();this.direction=new THREE.Vector3();this.lookAt=new THREE.Vector3();this.adjustments=0;}
 update(camera,root,body){
  this.target.copy(root.position);this.target.y+=.7;this.direction.copy(camera.position).sub(this.target);const distance=this.direction.length();if(distance<.1)return false;this.direction.multiplyScalar(1/distance);this.ray.origin=this.target;this.ray.dir=this.direction;
  const hit=this.world.castRay(this.ray,distance,false,undefined,undefined,undefined,body);if(!hit||hit.timeOfImpact>=distance-.15)return false;
  camera.getWorldDirection(this.lookAt).multiplyScalar(distance).add(camera.position);
  const allowed=hit.timeOfImpact-.2;
  if(allowed>2.8)camera.position.copy(this.target).addScaledVector(this.direction,allowed);
  else{this.direction.set(0,1,0);this.ray.dir=this.direction;const above=this.world.castRay(this.ray,3.1,false,undefined,undefined,undefined,body);camera.position.copy(this.target);camera.position.y+=above?Math.max(.25,above.timeOfImpact-.2):3.1;}
  camera.lookAt(this.lookAt);this.adjustments++;return true;
 }
}
