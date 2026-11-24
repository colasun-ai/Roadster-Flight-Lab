import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {slopeCourses,slopeGroups,slopeSpines,slopeCrossings} from '../world/SlopePark.js';

export function drawSlopePark(track,{geometry,mesh,road,concrete,colored,paint,sign,box}){
 const tops=[],walls=[],flat=[],markings=[];
 function addStrip(batch,a,b,width,y){
  const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
  if(len<.01)return;
  const g=new THREE.PlaneGeometry(width,len);g.rotateX(-Math.PI/2);g.rotateY(Math.atan2(dx,dz));
  g.translate((a.x+b.x)/2,y,(a.z+b.z)/2);batch.push(g);
 }
 function batch(geos,material,cast){
  if(!geos.length)return;
  const g=mergeGeometries(geos);const result=mesh(g,material,cast);geos.forEach(v=>v.dispose());return result;
 }
 for(const piece of track.filter(p=>p.kind==='slope')){
  const {vertices,indices,topIndexCount,rows,cols}=piece;
  // Separate surface normals from wall normals to keep curved crests smooth.
  const top=geometry(vertices.slice(0,3*(rows+1)*cols),indices.slice(0,topIndexCount));
  tops.push(top);
  // The buried underside is only needed for the closed collision hull.
  const sides=indices.slice(2*topIndexCount),wall=geometry(vertices,sides);
  walls.push(wall.toNonIndexed());wall.dispose();
  for(const left of [true,false]){
   const v=[],ids=[];
   for(let i=0;i<=rows;i++){
    const a=(i*cols+(left?0:cols-1))*3,b=(i*cols+(left?1:cols-2))*3;
    const span=Math.abs(vertices[a]-vertices[b]);
    for(const inset of [.21,.35]){
     const t=inset/span;v.push(vertices[a]+(vertices[b]-vertices[a])*t,vertices[a+1]+(vertices[b+1]-vertices[a+1])*t+.012,vertices[a+2]);
    }
    if(i<rows){const n=i*2;if(left)ids.push(n,n+2,n+1,n+1,n+2,n+3);else ids.push(n,n+1,n+2,n+1,n+3,n+2);}
   }
   // One continuous edge marking per side, including crossfall.
   markings.push(geometry(v,ids));
  }
 }
 batch(tops,road,true);const wallMesh=batch(walls,concrete,true);wallMesh.geometry.computeVertexNormals();
 const edgeMaterial=new THREE.MeshStandardMaterial({color:0xe4e2c8,roughness:.96,polygonOffset:true,polygonOffsetFactor:-1});
 batch(markings,edgeMaterial,false);
 const apron=8;
 for(const x of slopeSpines)addStrip(flat,{x,z:slopeCrossings[0]-apron},{x,z:slopeCrossings.at(-1)+apron},14,.005);
 for(const z of slopeCrossings)addStrip(flat,{x:slopeSpines[0]+7,z},{x:slopeSpines[1]-7,z},16,.006);
 addStrip(flat,{x:-250,z:510},{x:-250,z:slopeCrossings[0]-apron},16,.006);
 for(const c of slopeCourses){
  const row=c.group,start=slopeCrossings[row]+apron,end=slopeCrossings[row+1]-apron;
  const pave=(a,b)=>addStrip(flat,{x:c.x,z:a},{x:c.x,z:b},c.width,.005);
  let last=start;
  for(const [a,b] of c.parts){pave(last,c.z+a);last=c.z+b;}
  pave(last,end);
  // Start bars and threshold stripes distinguish the run-up from the crest.
  paint(c.x,c.z-37,c.width-.6,.22,0xedece2);
  for(const side of [-1,1])for(let j=0;j<3;j++)paint(c.x+side*(c.width/2-.55),c.z-7+j*1.4,.65,.7,0xe9cc71);
 }
 batch(flat,road,false);
 // One atlas for the twenty roadside signs.
 const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;
 const ctx=canvas.getContext('2d'),boards=[];
 for(const [i,c] of slopeCourses.entries()){
  const col=i%4,row=Math.floor(i/4),x=col*512,y=row*192;
  ctx.fillStyle='#1b2d34';ctx.fillRect(x,y,512,192);
  ctx.fillStyle=slopeGroups[c.group].color;ctx.fillRect(x,y,104,192);
  ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='bold 55px sans-serif';ctx.fillText(c.id,x+52,y+112);
  ctx.textAlign='left';ctx.font='600 48px sans-serif';ctx.fillText(c.name,x+123,y+84);
  ctx.font='34px sans-serif';ctx.fillStyle='#d4dfda';ctx.fillText(c.speed+' km/h   ↑',x+123,y+146);
  const g=new THREE.PlaneGeometry(4.86,1.25);g.rotateY(Math.PI);g.translate(c.x-9,2.65,c.z-11.095);
  const uv=g.attributes.uv;for(let n=0;n<uv.count;n++)uv.setXY(n,(x+2+uv.getX(n)*508)/2048,1-(y+2+(1-uv.getY(n))*188)/1024);
  boards.push(g);
 }
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
 batch(boards,new THREE.MeshStandardMaterial({map,roughness:.9}),false);
 box(-262,1.15,507,.2,2.3,.2,0x536065);sign('坡道试验区   ↑   A–D',-262,2.65,507,9);
}
