export class LaunchTimer{
  constructor(vehicle){this.vehicle=vehicle;vehicle.launchTimer=this;vehicle.resetHooks.push(()=>this.reset());vehicle.postStepProducers.push((v,dt)=>this.update(v.currentInput,dt));this.reset();}
  reset(){this.state='ready';this.elapsed=0;this.resultSeconds=null;this.previousSpeed=0;this.boostUsed=false;}
  update(input,dt){
    const vel=this.vehicle.body.linvel(),speed=Math.hypot(vel.x,vel.z)*3.6;
    if(this.state==='ready'&&(input.drive>0||input.boost)&&this.previousSpeed<.5){this.state='running';this.elapsed=0;}
    if(this.state==='running'){
      this.boostUsed ||= this.vehicle.thrusters?.thrustNewtons>1;
      if(speed>=100&&this.previousSpeed<100){
        this.resultSeconds=this.elapsed+dt*(100-this.previousSpeed)/(speed-this.previousSpeed);this.state='complete';
      }
      this.elapsed+=dt;
    }
    this.previousSpeed=speed;
  }
  telemetry(){return {state:this.state,elapsedSeconds:this.elapsed,resultSeconds:this.resultSeconds,boostUsed:this.boostUsed,measurement:'Actual horizontal rigid-body speed, 0–100 km/h, no rollout; interpolated crossing at fixed 120Hz'};}
}
