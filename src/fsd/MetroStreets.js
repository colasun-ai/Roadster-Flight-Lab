import {t as uiText} from '../i18n/index.js';
import * as THREE from 'three';
import {at,distance} from './RoadNetwork.js';

export function buildCorridor(city,link) {
  const {a,b,kind}=link, length=distance(a,b), yaw=Math.atan2(b.x-a.x,b.z-a.z);
  const dx=Math.sin(yaw), dz=Math.cos(yaw), M=city.materials;
  const width=14.4+2*(link.median??0);
  const point=(s,side)=>({x:a.x+dx*s+dz*side,z:a.z+dz*s-dx*side});
  const block=(s,side,y,w,h,l,material,solid=false)=>{
    const p=point(s,side);
    return city.box(p.x,y,p.z,w,h,l,material,solid,yaw);
  };
  const trim=n=>n.trim??(['bend','merge'].includes(n.kind)?36:14);
  const start=trim(a),end=length-trim(b),span=end-start,mid=(start+end)/2;
  block(mid,0,-.025,width,.05,span,M.road);
  const fast=kind==='highway'||kind==='tunnel'||kind==='ramp';
  const marking=fast?14:9;
  for(const side of [-1,1]){
    const offset=side*(width/2+1.4);
    if(!fast)block(mid,offset,.08,2.8,.16,span,M.pavement,true);
    else {
      block(mid,side*(width/2-.2),.014,.14,.012,span,M.paint);
      block(mid,offset,.33,.40,.66,span,M.curb,true);
    }
    for(let s=start+8;s<end-7;s+=marking)
      block(s,side*((link.median??0)+3.6),.012,.12,.012,fast?5:3,M.paint);
    for(let s=start;s<end;s+=20){
      let coords=[point(s,side*width/2),point(Math.min(end,s+20),side*width/2)].map(p=>[p.x,p.z]);
      if(side<0)coords.reverse();
      city.modelFeatures.push({id:'edge:'+a.id+'>'+b.id+'/'+side+'/'+s,type:2,points:coords,headingValid:true,speedLimit:0});
    }
  }
  if(!link.median)block(mid,0,.007,.15,.014,span,M.yellow);
  if(link.median)block(mid,0,.09,link.median*2,.18,span,M.grass,true);
  if(kind==='tunnel'){
    const tunnelLength=span-28;
    for(const side of [-1,1]){
      block(mid,side*(width/2+1.8),3.5,1,7,tunnelLength,M.dark,true);

      for(let s=start+18;s<end-14;s+=18)block(s,side*(width/2+1.25),4.4,.12,.22,3,M.lamp);
    }
    block(mid,0,7.15,width+4.6,.7,tunnelLength,M.dark,true);

    for(const s of [mid-tunnelLength/2,mid+tunnelLength/2]){
      block(s,0,7.5,width+6,1.6,2,M.curb);
      for(const side of [-1,1])block(s,side*(width/2+2),3.5,1.4,7,2,M.curb,true);
    }
  }

}

export function buildJunction(city,node){
  const approaches=city.network.roads.filter(r=>r.to===node);
  const corners=[{x:node.x,z:node.z}];
  for(const n of node.neighbors){
    const dx=n.x-node.x,dz=n.z-node.z,len=Math.hypot(dx,dz),trim=node.trim??(['merge','bend'].includes(node.kind)?36:14);
    const link=city.network.links.find(l=>(l.a===node&&l.b===n)||(l.b===node&&l.a===n));
    const half=7.2+(link.median??0);
    for(const side of [-1,1])corners.push({x:node.x+(dx*trim+dz*half*side)/len,z:node.z+(dz*trim-dx*half*side)/len});
  }
  for(const road of approaches){
    const p=at(road,road.length);
    for(const side of [-1,1]) corners.push({x:p.x+side*1.82*Math.cos(p.yaw),z:p.z-side*1.82*Math.sin(p.yaw)});
  }
  for(const road of approaches)for(const id of road.next){
    const c=city.network.lanes.get(id);
    for(let s=0;s<c.length+1;s+=2){
      const p=at(c,s);
      for(const side of [-1,1])corners.push({x:p.x+side*2*Math.cos(p.yaw),z:p.z-side*2*Math.sin(p.yaw)});
    }
  }
  // Convex pavement patch spans the approach mouths at skewed interchanges.
  corners.sort((p,q)=>p.x-q.x||p.z-q.z);
  function half(points){
    const h=[];
    for(const p of points){
      while(h.length>1){
        const a=h.at(-2),b=h.at(-1);
        if((b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x)>0)break;
        h.pop();
      }
      h.push(p);
    }
    return h.slice(0,-1);
  }
  let hull=half(corners).concat(half(corners.reverse()));
  // Trim each approach to exactly the same transverse seam as its asphalt slab.
  for(const n of node.neighbors){
   const dx=n.x-node.x,dz=n.z-node.z,len=Math.hypot(dx,dz),trim=node.trim??(['merge','bend'].includes(node.kind)?36:14);
   const side=p=>((p.x-node.x)*dx+(p.z-node.z)*dz)/len-trim,clipped=[];
   for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],u=side(a),v=side(b);
    if(u<=0)clipped.push(a);
    if((u>0)!==(v>0)){const f=u/(u-v);clipped.push({x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f});}
   }
   hull=clipped;
  }
  const shape=new THREE.Shape(hull.map(p=>new THREE.Vector2(p.x-node.x,node.z-p.z)));
  const geometry=new THREE.ShapeGeometry(shape).rotateX(-Math.PI/2);
  const mesh=new THREE.Mesh(geometry,city.materials.road);mesh.position.set(node.x,0,node.z);mesh.receiveShadow=true;city.root.add(mesh);
}

export function addDirectionSigns(city){
  if(typeof document==='undefined')return;
  const names={service:'滨河辅路',highway:'环城高速',tunnel:'环城隧道',ramp:'高速匝道',boulevard:'城市大道'};
  const textures=new Map(),materials=new Map();
  for(const lane of city.network.roads){
    if(!names[lane.kind]||lane.index!==1)continue;
    const label=lane.to.kind==='turnaround'?'前方掉头区':lane.from.x>1650&&lane.kind==='highway'?'港区快速路':names[lane.kind];
    if(!textures.has(label)){
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=144;
      const c=canvas.getContext('2d');c.fillStyle='#215b4c';c.fillRect(0,0,512,144);
      c.strokeStyle='#cde6d4';c.lineWidth=5;c.strokeRect(6,6,500,132);
      c.fillStyle='#fff';c.font='bold 56px sans-serif';c.textAlign='center';c.fillText(uiText(label),256,91);
      const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;textures.set(label,map);materials.set(label,new THREE.MeshBasicMaterial({map}));
    }
    const p=at(lane,Math.min(28,lane.length/3)),dx=Math.cos(p.yaw),dz=-Math.sin(p.yaw);
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(5.1,1.44),
      materials.get(label));
    sign.position.set(p.x-6.4*dx,4.1,p.z-6.4*dz);
    sign.rotation.y=p.yaw+Math.PI;city.root.add(sign);
    city.box(sign.position.x,1.8,sign.position.z,.16,3.6,.16,city.materials.dark);
  }
}
