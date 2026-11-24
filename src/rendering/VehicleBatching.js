import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Merge only opaque, static leaf meshes with identical material/render state.
// Door hinges, lamps, and every suspension descendant remain independently
// controllable. Original triangles, UVs, normals and textures are retained.
export function batchStaticVehicle(root,metadata={}){
 const protectedNames=new Set([...Object.values(metadata.interactions||{}).map(x=>x.node),...Object.values(metadata.lights||{}).flat(),...(metadata.wheels||[]).map(w=>w.suspensionNode||`Wheel_${w.id}_Suspension`)]);
 const groups=new Map(),inverse=new THREE.Matrix4(),transform=new THREE.Matrix4();root.updateMatrixWorld(true);inverse.copy(root.matrixWorld).invert();
 let beforeMeshes=0,beforeTriangles=0;
 root.traverse(mesh=>{
  if(!mesh.isMesh)return;beforeMeshes++;beforeTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
  if(mesh.children.length||mesh.isSkinnedMesh||mesh.morphTargetInfluences||Array.isArray(mesh.material)||mesh.material.transparent||mesh.material.opacity<1||mesh.material.transmission>0||mesh.geometry.groups.length>1)return;
  for(let p=mesh;p&&p!==root;p=p.parent)if(protectedNames.has(p.name)||/^Wheel_/.test(p.name))return;
  transform.multiplyMatrices(inverse,mesh.matrixWorld);if(transform.determinant()<0)return;
  const attributes=Object.entries(mesh.geometry.attributes).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join(',');
  const key=[mesh.material.uuid,attributes,!!mesh.geometry.index,mesh.castShadow,mesh.receiveShadow,mesh.renderOrder,mesh.layers.mask,mesh.frustumCulled].join('|');
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(mesh);
 });
 let mergedGroups=0,removedMeshes=0;const removedGeometries=new Set();
 for(const meshes of groups.values()){
  if(meshes.length<2)continue;
  const geometries=meshes.map(mesh=>{transform.multiplyMatrices(inverse,mesh.matrixWorld);return mesh.geometry.clone().applyMatrix4(transform);});
  const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!geometry)continue;
  geometry.computeBoundingBox();geometry.computeBoundingSphere();const first=meshes[0],batch=new THREE.Mesh(geometry,first.material);batch.name=`StaticBatch_${mergedGroups++}_${first.material.name}`;batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;batch.renderOrder=first.renderOrder;batch.layers.mask=first.layers.mask;batch.frustumCulled=first.frustumCulled;root.add(batch);
  meshes.forEach(mesh=>{removedGeometries.add(mesh.geometry);mesh.removeFromParent();});removedMeshes+=meshes.length-1;
 }
 const live=new Set();let afterMeshes=0,afterTriangles=0;root.traverse(mesh=>{if(mesh.isMesh){live.add(mesh.geometry);afterMeshes++;afterTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;}});for(const g of removedGeometries)if(!live.has(g))g.dispose();
 if(afterTriangles!==beforeTriangles)throw Error('Static batching changed triangle count');
 root.userData.batching={beforeMeshes,afterMeshes,beforeTriangles,afterTriangles,mergedGroups,removedMeshes,originalDetailPreserved:true};return root.userData.batching;
}
