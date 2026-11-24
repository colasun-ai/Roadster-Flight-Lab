import {at} from './RoadNetwork.js';
import {roadPin,routeSections,sectionPoints} from './PointNavigation.js';

const palette={street:'#f9faf6',service:'#f7f4e4',ramp:'#edbb72',boulevard:'#faedc9',tunnel:'#647b8c',highway:'#e9ac5d'};
export class CityMap{
 constructor(network,select,start){
  this.net=network;this.select=select;
  const el=this.el=document.createElement('dialog');
  el.className='city-map';el.setAttribute('aria-labelledby','city-map-title');
  el.innerHTML='<header><div><small>FSD 城市</small><h2 id="city-map-title">导航地图</h2></div><button aria-label="关闭地图" data-action="close">关闭</button></header><div class="map-stage"><canvas aria-label="城市实时地图，点击任意位置设置目的地"></canvas><div class="map-tools"><button aria-label="放大地图" data-action="in">＋</button><button aria-label="缩小地图" data-action="out">−</button><button data-action="fit">全图</button><button data-action="locate">定位</button></div></div><div class="map-footer"><div><strong data-name></strong><small data-hint>点击设定终点 · 滚轮缩放 · 拖动平移</small></div><button data-action="drive">开始导航</button></div>';
  document.body.append(el);this.canvas=el.querySelector('canvas');this.ctx=this.canvas.getContext('2d');
  const xs=network.nodes.map(n=>n.x),zs=network.nodes.map(n=>n.z);
  this.bounds={x:(Math.min(...xs)+Math.max(...xs))/2,z:(Math.min(...zs)+Math.max(...zs))/2,
   w:Math.max(...xs)-Math.min(...xs),h:Math.max(...zs)-Math.min(...zs)};
  this.fit();const action=(id,fn)=>el.querySelector('[data-action="'+id+'"]').onclick=fn;
  action('close',()=>this.close());action('drive',()=>{start();this.close();});
  action('fit',()=>{this.fit();this.draw();});action('locate',()=>{if(this.ego){this.center={...this.ego};this.zoom=4;this.draw();}});
  action('in',()=>this.scale(1.6));action('out',()=>this.scale(1/1.6));
  const point=e=>{const r=this.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  this.canvas.onwheel=e=>{e.preventDefault();this.scale(Math.exp(-e.deltaY*.0018),point(e));};
  this.canvas.onpointerdown=e=>{if(e.button!==0)return;const p=point(e);this.drag={start:p,last:p,moved:false};if(e.isTrusted)this.canvas.setPointerCapture(e.pointerId);};
  this.canvas.onpointermove=e=>{
   if(!this.drag)return;const p=point(e),d=this.drag;
   if(Math.hypot(p.x-d.start.x,p.y-d.start.y)>4)d.moved=true;
   if(d.moved){this.center.x-=(p.x-d.last.x)/this.factor;this.center.z+=(p.y-d.last.y)/this.factor;this.draw();}
   d.last=p;
  };
  this.canvas.onpointerup=e=>{
   if(!this.drag)return;const click=!this.drag.moved;this.drag=null;
   if(click){const pin=roadPin(this.net,this.world(point(e)));this.select(pin);this.draw();}
  };
  this.canvas.onpointercancel=()=>{this.drag=null;};
  el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.close();}});
  el.onclose=()=>{this.drag=null;};new ResizeObserver(()=>{if(el.open)this.draw();}).observe(this.canvas);
 }
 fit(){this.center={x:this.bounds.x,z:this.bounds.z};this.zoom=1;}
 open(){if(!this.el.open)this.el.showModal();this.draw();}
 close(){if(this.el.open)this.el.close();}
 world(p){return{x:this.center.x+(p.x-this.width/2)/this.factor,z:this.center.z-(p.y-this.height/2)/this.factor};}
 screen(p){return[this.width/2+(p.x-this.center.x)*this.factor,this.height/2-(p.z-this.center.z)*this.factor];}
 scale(mult,p={x:this.width/2,y:this.height/2}){
  const before=this.world(p),oldZoom=this.zoom;this.zoom=Math.max(.75,Math.min(24,this.zoom*mult));this.factor*=this.zoom/oldZoom;
  const after=this.world(p);this.center.x+=before.x-after.x;this.center.z+=before.z-after.z;this.draw();
 }
 update(ego,traffic,pilot){this.ego=ego;this.traffic=traffic;this.pilot=pilot;if(this.el.open)this.draw();}
 draw(){
  if(!this.el.open)return;
  const {canvas,ctx:c}=this,w=this.width=canvas.clientWidth,h=this.height=canvas.clientHeight;if(!w||!h)return;
  const dpr=Math.min(devicePixelRatio,2);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  this.factor=Math.min((w-58)/this.bounds.w,(h-55)/this.bounds.h)*this.zoom;
  c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#dce5da';c.fillRect(0,0,w,h);
  const line=(points,color,width,dash=[])=>{
   if(points.length<2)return;c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.setLineDash(dash);c.beginPath();
   points.forEach((p,i)=>i?c.lineTo(...this.screen(p)):c.moveTo(...this.screen(p)));c.stroke();c.setLineDash([]);
  };
  const dot=(p,color,r,edge)=>{const [x,y]=this.screen(p);c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();if(edge){c.lineWidth=2;c.strokeStyle=edge;c.stroke();}};
  for(const link of this.net.links){
   const sw=Math.max(3,(14.4+2*(link.median??0))*this.factor);line([link.a,link.b],'#9aa9a0',sw+1.4);
   line([link.a,link.b],palette[link.kind],sw);
   if(link.kind==='tunnel')line([link.a,link.b],'#ecf1ec',1.4,[4,4]);
  }
  for(const [name,x,z] of [['中央城区',1000,628],['滨河辅路',1190,925],['环城高速',1040,1018],['环城隧道',1549,1400],['北环',1200,1730],['中城',3160,800],['东港快速路',5280,2000],['南环',3530,-480],['北港',3150,3130]]){
   if(this.factor<.22&&['滨河辅路','环城隧道','北环'].includes(name))continue;
   const [u,v]=this.screen({x,z});c.font='600 12px system-ui';c.textAlign='center';c.lineWidth=3;c.strokeStyle='#eaf0e9';c.strokeText(name,u,v);c.fillStyle='#4d625b';c.fillText(name,u,v);
  }
  const pilot=this.pilot;if(!pilot)return;
  const pin=pilot.pin,route=pilot.route;
  for(const section of routeSections(this.net,this.ego,route,pin)){
   line(sectionPoints(section),'#2078cd',Math.max(2.4,2.1*this.factor));
  }
  for(const a of this.traffic?.actors??[])dot(a,a.braking?'#a36b43':'#526975',Math.max(1.9,Math.min(4.4,this.factor*1.3)));
  const lane=this.net.lanes.get(pilot.destination),end=pin??(lane&&at(lane,lane.length));
  if(end){if(pin&&pin.offset>2){line([pin.requested,pin],'#a94e3d',1.7,[3,4]);dot(pin.requested,'#fff',3.5,'#a94e3d');}
   dot(end,'#c44f42',5,'white');}
  if(this.ego){const [x,y]=this.screen(this.ego);c.save();c.translate(x,y);c.rotate(this.ego.yaw);c.beginPath();c.moveTo(0,-9);c.lineTo(6,6);c.lineTo(0,3);c.lineTo(-6,6);c.closePath();c.fillStyle='#176acf';c.fill();c.strokeStyle='white';c.lineWidth=2;c.stroke();c.restore();}
  this.el.querySelector('[data-name]').textContent=pin?(pin.offset>2?'已选停车点 · 距落点 '+Math.round(pin.offset)+' 米':'已选道路停车点'):'点击地图选择目的地';
  this.el.querySelector('[data-action=drive]').textContent=pilot.enabled?'返回驾驶':'开始导航';
 }
}
