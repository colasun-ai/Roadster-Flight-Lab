import {t as uiText} from '../i18n/index.js';
import {slopeCourses,slopeGroups} from '../world/SlopePark.js';
import './slope-selector.css';

function drawProfile(canvas,course){
 const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
 const floor=h-22,left=14,scaleX=(w-2*left)/course.length;
 let peak=0;
 for(const [a,b] of course.parts)for(let s=a;s<=b;s+=.25)peak=Math.max(peak,course.height(s,-6),course.height(s,6));
 const scaleY=(floor-18)/Math.max(.3,peak);
 ctx.clearRect(0,0,w,h);ctx.strokeStyle='#52626b';ctx.beginPath();ctx.moveTo(left,floor);ctx.lineTo(w-left,floor);ctx.stroke();
 for(const [a,b] of course.parts){
  const n=Math.ceil((b-a)*2);
  for(const u of [-6,6,0]){
   ctx.beginPath();
   for(let j=0;j<=n;j++){
    const s=a+(b-a)*j/n,x=left+s*scaleX,y=floor-course.height(s,u)*scaleY;
    if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
   }
   if(u===0){ctx.strokeStyle='#a6ede0';ctx.lineWidth=2.5;ctx.stroke();}
   else{ctx.lineTo(left+b*scaleX,floor);ctx.lineTo(left+a*scaleX,floor);ctx.closePath();ctx.fillStyle='#7aaea945';ctx.fill();}
  }
 }
 return peak;
}

export function bindSlopeSelector({canOpen,onOpen,onCancel,onDrive}){
 const dialog=document.getElementById('slope-selector'),groups=dialog.querySelector('.slope-groups');
 const lanes=dialog.querySelector('.slope-lanes'),canvas=dialog.querySelector('canvas');
 let selected=slopeCourses[0],driving=false;
 function show(c){
  selected=c;
  for(const [i,b] of [...groups.children].entries())b.setAttribute('aria-pressed',String(i===c.group));
  lanes.replaceChildren(...slopeCourses.filter(v=>v.group===c.group).map(v=>{
   const b=document.createElement('button');b.type='button';b.dataset.course=v.id;
   const id=document.createElement('small');id.textContent=uiText(v.id);b.append(id,uiText(v.name));
   b.setAttribute('aria-pressed',String(c===v));b.onclick=()=>show(v);return b;
  }));
  dialog.querySelector('.slope-name').textContent=uiText(c.name);
  dialog.querySelector('.slope-purpose').textContent=uiText(c.purpose);
  const peak=drawProfile(canvas,c);
  dialog.querySelector('.slope-values').textContent=uiText(c.length+' m 长　 /　 '+peak.toFixed(2)+' m 最高　 /　 建议 '+c.speed+' km/h');
 }
 for(const [i,g] of slopeGroups.entries()){
  const b=document.createElement('button');b.type='button';b.textContent=uiText(g.name);
  b.onclick=()=>show(slopeCourses.find(c=>c.group===i));groups.append(b);
 }
 document.getElementById('slopes-open').onclick=()=>{
  if(!canOpen()||dialog.open)return;
  driving=false;onOpen();show(selected);dialog.showModal();
 };
 dialog.querySelector('.slope-close').onclick=()=>dialog.close();
 dialog.onkeydown=e=>e.stopPropagation();
 dialog.onclose=()=>{if(!driving)onCancel();};
 dialog.querySelector('.slope-drive').onclick=()=>{driving=true;dialog.close();onDrive(selected);};
}
