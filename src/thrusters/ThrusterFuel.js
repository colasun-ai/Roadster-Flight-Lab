import {clamp} from '../physics/math.js';
export class ThrusterFuel{
  constructor(config){this.config=config;this.refillEnabled=config.compressor?.enabled??true;this.reset();}
  reset(){this.mass=this.config.gasCapacityKg;this.massFlow=0;this.consumed=0;this.refillFlow=0;this.refilled=0;}
  pressure(){return this.config.initialPressureMPa*Math.pow(Math.max(0,this.mass/this.config.gasCapacityKg),this.config.polytropicExponent);}
  availableScale(infinite=false){if(infinite)return 1;return this.pressure()<this.config.minPressureMPa?0:clamp(this.pressure()/this.config.regulatorPressureMPa,0,1);}
  consume(totalForce,dt,infinite){
    if(infinite){this.massFlow=0;return 1;}
    const requested=totalForce/this.config.exhaustVelocityMps*dt;
    const used=Math.min(this.mass,requested);this.mass=Math.max(0,this.mass-used);this.consumed+=used;this.massFlow=used/dt;
    return requested>0?used/requested:1;
  }
  refill(dt,infinite=false){
    this.refillFlow=0;
    if(infinite||!this.refillEnabled||dt<=0)return;
    // The onboard compressor runs during both discharge and idle. Its rate is
    // a gameplay assumption, not a Tesla specification or thermodynamic model.
    const rate=this.config.compressor?.massFlowKgPerSecond??4;
    const added=Math.min(Math.max(0,this.config.gasCapacityKg-this.mass),Math.max(0,rate)*dt);
    this.mass+=added;this.refilled+=added;this.refillFlow=added/dt;
  }
  telemetry(infinite=false){const residual=this.config.gasCapacityKg*Math.pow(this.config.minPressureMPa/this.config.initialPressureMPa,1/this.config.polytropicExponent);const rate=this.config.compressor?.massFlowKgPerSecond??4;return {remainingKg:this.mass,capacityKg:this.config.gasCapacityKg,remainingPercent:this.mass/this.config.gasCapacityKg*100,pressureMPa:this.pressure(),massFlowKgPerSecond:this.massFlow,consumedKg:this.consumed,infinite,availableScale:this.availableScale(infinite),estimatedRemainingSeconds:infinite?null:this.massFlow>.001?Math.max(0,this.mass-residual)/this.massFlow:null,autoRefillEnabled:this.refillEnabled,refillFlowKgPerSecond:this.refillFlow,refilledKg:this.refilled,netFlowKgPerSecond:this.refillFlow-this.massFlow,secondsToFull:this.refillEnabled&&rate>0?Math.max(0,this.config.gasCapacityKg-this.mass)/rate:null};}
}
