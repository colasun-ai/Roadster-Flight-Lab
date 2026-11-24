// Packaged Mac check through the course picker and the normal keyboard path.
import {slopeCourses} from '../world/SlopePark.js';
export async function auditSlopePark(vehicle){
 const el=id=>document.getElementById(id),frame=()=>new Promise(requestAnimationFrame);
 const dialog=el('slope-selector'),report=data=>window.roadsterAudit.report(data);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const press=(down)=>el('scene').dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code:'KeyW',key:'w',bubbles:true}));
 const check=(ok,msg)=>{if(!ok)throw Error(msg);};
 el('garage-start').click();
 const runs=[];
 for(const id of ['A5','D5']){
  const c=slopeCourses.find(v=>v.id===id);
  el('slopes-open').click();check(dialog.open,'坡道面板未打开');
  dialog.querySelector('.slope-groups').children[c.group].click();
  const b=dialog.querySelector('[data-course="'+id+'"]'),r=b.getBoundingClientRect();
  check(b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),'选择按钮被遮挡');
  b.click();
  if(id==='D5'){
   await frame();await frame();await wait(300);
   report({event:'slopes-picker'});await wait(1000);
  }
  dialog.querySelector('.slope-drive').click();await frame();
  check(!dialog.open&&Math.abs(vehicle.rootPose().p.x-c.x)<.1,'未到达所选车道');
  let held=false,air=false,landed=false,peak=0,crest=false,done=false;
  const start=performance.now();
  try{
   while(performance.now()-start<55000){
    await frame();
    const {p}=vehicle.rootPose(),s=p.z-c.z,speed=vehicle.forwardSpeed()*3.6;
    if(!held&&speed<c.speed-1){press(true);held=true;}
    else if(held&&speed>c.speed+1){press(false);held=false;}
    peak=Math.max(peak,p.y);
    if(!crest&&p.y>(id==='A5'?6:3)){crest=true;report({event:'slopes-'+id+'-climb',height:p.y,kmh:speed});}
    if(s>40&&!vehicle.wheels.some(w=>w.contact))air=true;
    if(air&&vehicle.wheels.some(w=>w.contact))landed=true;
    if(s>c.length+10){done=true;break;}
   }
  }finally{press(false);}
  const result={id,finished:done,peak,air,landed};runs.push(result);
  check(done&&crest&&(id!=='D5'||(air&&landed)),JSON.stringify(result));
 }
 el('pause').click();report({event:'slopes-complete',passed:true,runs});
}
