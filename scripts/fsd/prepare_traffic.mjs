// CC BY 4.0 derivative of vecarz/heynic BMW X6M, prepared from the
// MIT/CC BY DriveScene snapshot ba307215. Original downloads remain intact.
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dequantize,transformMesh,weld,simplify,prune,dedup,join} from '@gltf-transform/functions';
import {MeshoptDecoder,MeshoptSimplifier} from 'meshoptimizer';
import {Matrix4,BufferGeometry,BufferAttribute} from 'three';
import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
await Promise.all([MeshoptDecoder.ready,MeshoptSimplifier.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const source='assets/originals';
const bytes=gunzipSync(await fs.readFile(source+'/ego-vehicle-startup.glb.gz'));
const pivots={FL:[.880106,.343534,1.546879],FR:[-.880106,.343534,1.546879],RL:[.887549,.352523,-1.360449],RR:[-.887549,.352523,-1.360449]};
const wheelNames=new Set(['Object_14','Object_47','Object_48','Object_49','Object_50','Object_51']);
const results=[];
await fs.mkdir('public/models/traffic',{recursive:true});
for(const [level,ratio,error] of [['near',.28,.015],['mid',.075,.035],['far',.018,.08]]){
 const doc=await io.readBinary(bytes);await doc.transform(dequantize());
 for(const extension of [...doc.getRoot().listExtensionsUsed()])if(['EXT_meshopt_compression','KHR_mesh_quantization'].includes(extension.extensionName))extension.dispose();
 const buffer=doc.getRoot().listBuffers()[0],scene=doc.getRoot().getDefaultScene();
 const root=doc.createNode('TrafficVehicle'),body=doc.createNode('Body').setMesh(doc.createMesh('Body'));
 const groups={};root.addChild(body);
 for(const [id,pivot]of Object.entries(pivots)){
  const steer=doc.createNode(`Wheel_${id}_Steering`).setTranslation(pivot),spin=doc.createNode(`Wheel_${id}_Rotation`).setMesh(doc.createMesh(`Wheel_${id}`));
  root.addChild(steer);steer.addChild(spin);groups[id]={steer,spin};
 }
 const oldNodes=doc.getRoot().listNodes().filter(n=>n.getMesh()&&n!==body&&!Object.values(groups).some(g=>g.spin===n));
 let crossing=0;
 for(const node of oldNodes){
  const mesh=node.getMesh(),matrix=new Matrix4().makeRotationY(Math.PI).multiply(new Matrix4().fromArray(node.getWorldMatrix())).toArray();
  transformMesh(mesh,matrix);
  for(const prim of [...mesh.listPrimitives()]){
   if(!wheelNames.has(node.getName())){body.getMesh().addPrimitive(prim);continue;}
   const pos=prim.getAttribute('POSITION'),indices=prim.getIndices()?.getArray()||Uint32Array.from({length:pos.getCount()},(_,i)=>i),quadrants={FL:[],FR:[],RL:[],RR:[]};
   for(let i=0;i<indices.length;i+=3){
    const ids=[...indices.slice(i,i+3)],keys=ids.map(index=>{const p=pos.getElement(index,[]);return (p[2]>0?'F':'R')+(p[0]>0?'L':'R');});
    if(!keys.every(k=>k===keys[0]))throw Error('Wheel face crosses quadrants; refusing destructive split');
    quadrants[keys[0]].push(...ids);
   }
   for(const[id,selected]of Object.entries(quadrants)){
    if(!selected.length)continue;const used=[...new Set(selected)],lookup=new Map(used.map((v,i)=>[v,i])),copy=doc.createPrimitive().setMaterial(prim.getMaterial());
    for(const semantic of prim.listSemantics()){
     const original=prim.getAttribute(semantic),size=original.getElementSize(),array=new Float32Array(used.length*size);
     used.forEach((index,i)=>{const value=original.getElement(index,[]);if(semantic==='POSITION')for(let j=0;j<3;j++)value[j]-=pivots[id][j];array.set(value,i*size);});
     copy.setAttribute(semantic,doc.createAccessor().setType(original.getType()).setArray(array).setBuffer(buffer));
    }
    copy.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(selected,index=>lookup.get(index))).setBuffer(buffer));
    if(node.getName()==='Object_14'){
     const caliper=doc.createNode('Caliper_'+id).setMesh(doc.createMesh().addPrimitive(copy));groups[id].steer.addChild(caliper);
    }else groups[id].spin.getMesh().addPrimitive(copy);
   }
  }
 }
 for(const node of [...scene.listChildren()])scene.removeChild(node);scene.addChild(root);
 if(level!=='near')for(const mesh of doc.getRoot().listMeshes())for(const prim of mesh.listPrimitives()){
  const pos=prim.getAttribute('POSITION'),indices=prim.getIndices();if(!pos||!indices)continue;
  // Traffic-only distant LOD: weld positional seams before simplification.
  // The original high-detail UV/normal streams remain in the near LOD.
  const representative=new Map(),remap=new Uint32Array(pos.getCount());
  for(let i=0;i<pos.getCount();i++){const key=pos.getElement(i,[]).map(v=>Math.round(v*100000)).join(',');if(!representative.has(key))representative.set(key,i);remap[i]=representative.get(key);}
  indices.setArray(Uint32Array.from(indices.getArray(),i=>remap[i]));
 }
 await doc.transform(prune(),dedup(),weld(),simplify({simplifier:MeshoptSimplifier,ratio,error}),join(),prune(),dedup());
 if(level!=='near')for(const mesh of doc.getRoot().listMeshes())for(const prim of mesh.listPrimitives()){
  const oldNormals=prim.getAttribute('NORMAL'),geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(prim.getAttribute('POSITION').getArray(),3));geometry.setIndex(new BufferAttribute(prim.getIndices().getArray(),1));geometry.computeVertexNormals();const normals=geometry.attributes.normal.array;for(let i=0;i<normals.length;i+=3)if(Math.hypot(...normals.slice(i,i+3))<.5){const fallback=oldNormals?.getElement(i/3,[])??[0,1,0];const length=Math.hypot(...fallback);normals.set(length>.001?fallback.map(v=>v/length):[0,1,0],i);}prim.setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer));prim.setAttribute('TANGENT',null);prim.getMaterial()?.setNormalTexture(null);geometry.dispose();
 }
 // Do not re-enable quantization: ordinary embedded GLB works in GLTFLoader.
 const output=await io.writeBinary(doc),path=`public/models/traffic/bmw-x6m-${level}.glb`;await fs.writeFile(path,output);
 const triangles=doc.getRoot().listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3,0),0);
 results.push({level,triangles,bytes:output.length,wheelFacesCrossingQuadrants:crossing,pivots,sourceTriangles:80842});
}
await fs.mkdir('public/textures/fsd',{recursive:true});await fs.writeFile('public/textures/fsd/studio-environment.bin',gunzipSync(await fs.readFile(source+'/assets/studio-environment.bin.gz')));
await fs.writeFile('reports/fsd/traffic-model-preparation.json',JSON.stringify({sourceCommit:'ba307215f5ce67289a9cacea8ae6fb54870d5307',originalPreserved:true,coordinates:'+Z forward, +X left, +Y up; metres',results},null,2));
console.log(results);
