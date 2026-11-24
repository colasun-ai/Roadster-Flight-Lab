import * as THREE from 'three';

// Called only by the native visual regression. Capture all three passes at
// one fixed pose, including the normal transparent glass materials.
export function measurePathPixels(renderer,scene,camera,vehicle,path){
 const gl=renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
 const read=()=>{renderer.render(scene,camera);const rgba=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return rgba;};
 const normal=read(),bg=scene.background,override=scene.overrideMaterial;
 const shown=scene.children.filter(o=>o.visible&&o!==vehicle);
 const mask=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,toneMapped:false,fog:false});
 try{
  path.visible=false;const without=read();
  for(const o of shown)o.visible=false;
  scene.background=new THREE.Color(0);scene.overrideMaterial=mask;
  const silhouette=read();let visiblePixels=0,onCar=0;
  for(let i=0;i<normal.length;i+=4){
   if(Math.max(Math.abs(normal[i]-without[i]),Math.abs(normal[i+1]-without[i+1]),Math.abs(normal[i+2]-without[i+2]))<12)continue;
   visiblePixels++;
   if(silhouette[i]>250&&silhouette[i+1]>250&&silhouette[i+2]>250)onCar++;
  }
  return {visiblePixels,onCar,stencilBits:gl.getParameter(gl.STENCIL_BITS)};
 }finally{
  scene.background=bg;scene.overrideMaterial=override;
  for(const o of shown)o.visible=true;
  path.visible=true;mask.dispose();renderer.render(scene,camera);
 }
}
