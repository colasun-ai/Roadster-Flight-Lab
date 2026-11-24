// Opt-in packaged-app regression for the city HUD covering the garage.
export async function auditGarageView({fsd,trackScene,switcher,root,getPaused}){
 const el=id=>document.getElementById(id);
 const frame=()=>new Promise(requestAnimationFrame);
 const check=(value,message)=>{if(!value)throw Error(message);};
 const click=id=>el(id).click();
 const escape=()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
 async function waitFor(test,label){
  const end=performance.now()+20000;
  while(!test()&&performance.now()<end)await frame();
  check(test(),label);await frame();
 }
 const cards=[...document.querySelectorAll('[data-garage-vehicle]')];
 const checkpoints=[];
 function garage(label){
  check(getPaused()&&!el('garage').hidden,label+' garage must be paused');
  check(!fsd.inView&&el('fsd-panel').hidden&&el('fsd-speed').hidden&&!fsd.map.el.open,label+' city overlays visible');
  check(trackScene.root.visible&&!document.body.matches('.fsd-city,.fsd-split'),label+' wrong scene');
  check(Math.abs(el('scene').getBoundingClientRect().left)<1,label+' split canvas offset');
  check(cards.length===3&&cards.every(card=>{
   const r=card.getBoundingClientRect();return card.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
  }),label+' car picker covered');
  const spawn=switcher.active.vehicle.config.spawn;
  check(Math.hypot(root().position.x-spawn.x,root().position.z-spawn.z)<.001,label+' wrong preview position');
  checkpoints.push(label);
 }
 garage('启动进入车库');
 cards[1].click();await waitFor(()=>switcher.active?.id===cards[1].dataset.garageVehicle&&!switcher.busy,'Model 3');
 click('garage-city');await waitFor(()=>fsd.inView&&!fsd.loading,'city entry');
 click('fsd-layout');click('fsd-theme');click('fsd-engage');
 const traffic=fsd.traffic,goal=fsd.autopilot.destination;
 click('garage-open');await frame();garage('城市分屏和夜间模式下返回车库');
 const p=switcher.active.vehicle.body.translation(),steps=switcher.active.vehicle.steps;
 await frame();await frame();
 check(switcher.active.vehicle.steps===steps&&!fsd.autopilot.enabled,'city still driving');
 window.roadsterAudit.report({event:'garage-city-return',checkpoints:[...checkpoints],vehicle:switcher.active.id});
 await new Promise(r=>setTimeout(r,350));
 click('garage-city');
 check(fsd.inView&&!getPaused()&&fsd.traffic===traffic&&fsd.autopilot.destination===goal,'city trip lost');
 check(document.body.classList.contains('fsd-split')&&fsd.night&&!fsd.autopilot.enabled,'city view incorrectly restored');
 const q=switcher.active.vehicle.body.translation();check(Math.hypot(p.x-q.x,p.z-q.z)<.001,'vehicle moved during garage');
 checkpoints.push('原车返回同一城市行程');
 escape();await frame();garage('Esc 打开车库');
 cards[2].click();await waitFor(()=>switcher.active?.id===cards[2].dataset.garageVehicle&&!switcher.busy,'Model Y');garage('车库切换至 Model Y');
 click('garage-city');check(fsd.inView&&fsd.traffic===traffic&&!fsd.autopilot.enabled,'changed car failed to return');
 checkpoints.push('换车后返回城市');
 click('garage-open');await frame();click('garage-start');await frame();
 check(!getPaused()&&el('garage').hidden&&!fsd.active&&fsd.traffic===null&&trackScene.root.visible,'track drive failed');
 check(el('fsd-panel').hidden&&el('fsd-speed').hidden,'city HUD on track');
 checkpoints.push('从车库开始试车场驾驶');
 click('garage-open');await frame();garage('试车场返回车库');
 click('garage-city');await waitFor(()=>fsd.inView&&!fsd.loading,'fresh city entry');check(fsd.traffic!==traffic,'new session missing');
 click('city-exit');check(!fsd.active&&!getPaused()&&trackScene.root.visible,'exit city to track');
 checkpoints.push('重新进城后直接返回试车场');
 window.roadsterAudit.report({event:'garage-view-complete',passed:true,checkpoints});
}
