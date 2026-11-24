import RAPIER from '@dimforge/rapier3d-compat';
import {ramps,solidRamp,terrainGeometry,circuitSamples,facilityBoxes,curbGeometry} from './TrackGeometry.js';
import {slopeCourses,buildSlopeSolid} from './SlopePark.js';
export const zones=[{type:'wet',x:38,z:-40,w:24,l:55},{type:'gravel',x:70,z:30,w:24,l:55},{type:'ice',x:-70,z:-40,w:24,l:55}];
export const obstacles=[{x:0,y:1.1,z:160,hx:8,hy:1.1,hz:.6,color:0xd79852},{x:30,y:.5,z:60,hx:2,hy:.5,hz:2,color:0xc78255},{x:34,y:1,z:65,hx:1,hy:1,hz:1,color:0x8e9da5}];
// Same vertices are used by Rapier and the renderer. All surfaces have collision geometry.
export function makeTrack(world){
  const pieces=[];
  function box(x,y,z,hx,hy,hz,color=0x899398,yaw=0,role='structure'){
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx,hy,hz).setTranslation(x,y,z).setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)}).setFriction(.8).setRestitution(.02));
    pieces.push({kind:'box',x,y,z,hx,hy,hz,color,yaw,role});
  }
  box(0,-.3,1500,2200,.3,3000,0x3e454a);pieces[0].kind='foundation';
  const terrain=terrainGeometry();world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(terrain.vertices),new Uint32Array(terrain.collisionIndices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.8));pieces.push(terrain);
  obstacles.forEach(o=>box(o.x,o.y,o.z,o.hx,o.hy,o.hz,o.color));
  function strip(x,z,w,profile,color){
    const vertices=[];for(const [dz,h]of profile)vertices.push(x-w/2,h,z+dz,x+w/2,h,z+dz);
    const indices=[];for(let i=0;i<profile.length-1;i++){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    const vs=new Float32Array(vertices),is=new Uint32Array(indices);
    world.createCollider(RAPIER.ColliderDesc.trimesh(vs,is,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.8));pieces.push({kind:'strip',vertices,indices,color});
  }
  for(const definition of ramps){const p=solidRamp(definition);world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(p.vertices),new Uint32Array(p.indices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.8));pieces.push(p);}
  for(const c of slopeCourses){
    for(const range of c.parts){
      const piece=buildSlopeSolid(c,range);
      world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(piece.vertices),new Uint32Array(piece.indices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.8));
      pieces.push(piece);
    }
    // The entry board stands outside the lane on a tangible signpost.
    box(c.x-9,1.05,c.z-11,.12,1.05,.12,0x45575c);
    box(c.x-9,2.65,c.z-11,2.45,.65,.09,0x364b4f);
  }
  // Tangible support columns / roadside safety rails; open at junctions.
  for(const x of [-123.5,-96.5])for(const z of [-90,30,150])box(x,.48,z,.14,.18,38,0x899496);
  for(const x of [-124,-96])box(x,2.8,-118,.3,2.8,.3,0x313c42);
  box(-110,5.5,-118,14,.35,.35,0x313c42);
  for(const p of facilityBoxes())box(p.x,p.y,p.z,p.w/2,p.h/2,p.l/2,p.color,0,'facility');
  const path=circuitSamples(200);
  for(let i=0;i<path.length-1;i++){
    const a=path[i],b=path[i+1],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    if(x< -70&&z<330)continue;
    for(const side of [-1,1]){
      const cx=x+side*8.6*dz/len,cz=z-side*8.6*dx/len;
      const ex=.45*Math.abs(dz/len)+(len/2+.025)*Math.abs(dx/len);
      const ez=.45*Math.abs(dx/len)+(len/2+.025)*Math.abs(dz/len);
      // The circuit crosses the 24 m-wide acceleration runway. Leave its full
      // width and a 2 m shoulder open, including the curved circuit intersection.
      if(cx+ex> -124&&cx-ex< -96&&cz+ez> -262&&cz-ez<2002)continue;
      const curb=curbGeometry(cx,cz,Math.atan2(dx,dz),len/2+.025,i%2?0xdbe0d9:0x993a32);
      world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(curb.vertices)).setFriction(.8).setRestitution(0));pieces.push(curb);
    }
  }
  for(const z of [-50,-30]){
    const p=[];for(let i=0;i<=24;i++){const a=i/24;p.push([-1.2+2.4*a,.035*Math.sin(Math.PI*a)**2]);}
    strip(0,z,10,p,0xc9a756);
  }
  return pieces;
}
export function surfaceAt(p){return zones.find(z=>Math.abs(p.x-z.x)<z.w/2&&Math.abs(p.z-z.z)<z.l/2)?.type||'dry';}
