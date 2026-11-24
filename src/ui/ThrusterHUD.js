export class ThrusterHUD{
  constructor(system){this.system=system;this.$=id=>document.getElementById(id);this.$('nozzle-status').innerHTML=system.nozzles.map(n=>`<div title="${n.id}" class="nozzle" id="nozzle-${n.id}"><span>${n.id.replace('Attitude','A').replace('Rear','R').replace('Lift','L')}</span><b>0%</b></div>`).join('');}
  update(launch,vehicle){const t=this.system.telemetry(),f=t.fuel,$=this.$;
    $('auto-refill').checked=f.autoRefillEnabled;$('refill-status').textContent=f.infinite?'压缩机待机（无限气体）':!f.autoRefillEnabled?'自动补气关闭':f.refillFlowKgPerSecond>.001?`补气中 +${f.refillFlowKgPerSecond.toFixed(1)} kg/s · ${f.netFlowKgPerSecond<0?'边喷边补':'恢复压力'}`:'气罐已充满';
    $('altitude').textContent=t.altitudeAGL.toFixed(2);$('vertical').textContent=`${t.verticalSpeed>=0?'+':''}${t.verticalSpeed.toFixed(2)}`;
    $('jet-state').textContent=!t.enabled?'系统关闭':t.thrustNewtons>1?`${(t.thrustNewtons/1000).toFixed(1)} kN · ${Math.round(100*t.thrustNewtons/(t.nozzles.reduce((s,n)=>s+n.maxThrustNewtons,0)*(t.mode==='Chaos'&&t.highThrust?2:1)))}%`:'待命';
    $('flight-mode').textContent=t.mode;$('gas-value').textContent=f.infinite?'∞ 无限':`${f.remainingKg.toFixed(1)} kg · ${f.remainingPercent.toFixed(0)}%`;$('gas-bar').style.width=f.remainingPercent+'%';$('pressure').textContent=`${f.pressureMPa.toFixed(1)} MPa · ${f.massFlowKgPerSecond.toFixed(1)} kg/s`;
    $('hover-state').textContent=t.landing?'降落辅助':t.hover?`悬浮 → ${t.targetHeight.toFixed(1)} m`:'悬浮关闭';$('hover').classList.toggle('active',t.hover);$('jet-toggle').textContent=t.enabled?'喷气系统：开':'喷气系统：关';
    $('chaos-stabilize').checked=this.system.stabilizeInChaos;$('flight-select').value=t.mode;$('infinite').checked=t.mode==='Chaos'&&this.system.infiniteGas;$('high-thrust').checked=t.mode==='Chaos'&&this.system.highThrust;
    $('fuel-time').textContent=f.infinite?'无限气体 · 实时物理':f.availableScale===0?'压力不足，喷气已停止':f.estimatedRemainingSeconds!==null?`按当前流量约 ${f.estimatedRemainingSeconds.toFixed(1)} s`:'有限气体 · 冷气工程模型';
    const timer=launch.telemetry();$('launch-time').textContent=timer.resultSeconds!==null?`${timer.resultSeconds.toFixed(3)} s`:timer.state==='running'?`${timer.elapsedSeconds.toFixed(2)} s`:'—';
    $('launch-caption').textContent=timer.state==='ready'?'纯电 850 kW / 喷气 · 无 rollout':timer.boostUsed?'联合喷气 · 目标 1.04 s':'纯电 850 kW · 未喷气';
    $('attitude').textContent=`横滚 ${vehicle.rollDegrees.toFixed(1)}° · 世界高度 ${t.worldAltitude.toFixed(1)} m`;
    for(const n of t.nozzles){const el=$('nozzle-'+n.id);el.classList.toggle('firing',n.thrustNewtons>1);el.classList.toggle('disabled',!n.enabled);el.querySelector('b').textContent=n.enabled?Math.round(n.throttle*100)+'%':'OFF';}
  }
}
