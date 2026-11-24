import RAPIER from '@dimforge/rapier3d-compat';
import {config as C} from '../vehicle/VehicleConfig.js';
import {ThrusterConfig} from './ThrusterConfig.js';
import {ThrusterFuel} from './ThrusterFuel.js';
import {ThrusterAllocation} from './ThrusterAllocation.js';
import {FlightStabilizer} from './FlightStabilizer.js';
import {v,rotate,add,sub,mul,cross,clamp} from '../physics/math.js';
const inverse=q=>({x:-q.x,y:-q.y,z:-q.z,w:q.w});
export class ThrusterSystem{
  constructor(vehicle,config=ThrusterConfig){
    this.vehicle=vehicle;this.config={...config};this.nozzles=config.nozzles.map(n=>({...n,forceDirection:[...n.forceDirection],position:[...n.position],thrust:0,valve:0,massFlow:0}));
    if(config.rearTotalThrust)for(const n of this.nozzles)if(n.type==='rear')n.maxThrust=config.rearTotalThrust/2;
    this.fuel=new ThrusterFuel(this.config);this.allocation=new ThrusterAllocation(this.nozzles);this.stabilizer=new FlightStabilizer();
    this.enabled=true;this.stabilizeInChaos=false;this.mode='Stabilized';this.infiniteGas=false;this.highThrust=false;vehicle.thrusters=this;
    vehicle.preStepProducers.push((v,dt)=>this.prepare(v.currentInput,dt));vehicle.forceProducers.push(()=>this.apply());vehicle.resetHooks.push(()=>this.reset());this.reset();
  }
  reset(){
    this.emergencyStabilization=false;this.emergencyActive=false;this.emergencyStableSeconds=0;this.emergencyTorqueLimit=[0,0,0];
    this.fuel.reset();this.hover=false;this.landing=false;this.flightArmed=false;this.groundedSeconds=0;this.targetHeight=this.config.hoverHeight;this.thrustNewtons=0;this.rearBoostRequested=false;this.ground={height:0,worldGroundY:0,detected:false};
    for(const n of this.nozzles){n.thrust=0;n.valve=0;n.massFlow=0;}this.allocation.last.fill(0);this.vehicle.setMass(C.mass);this.stabilizer.reset(this.vehicle.body);
  }
  setMode(mode){if(!['Stabilized','Manual','Chaos'].includes(mode))return;this.mode=mode;if(mode!=='Chaos'){this.infiniteGas=false;this.highThrust=false;}this.stabilizer.reset(this.vehicle.body);}
  toggleEmergency(){this.emergencyStabilization=!this.emergencyStabilization;this.emergencyStableSeconds=0;if(this.emergencyStabilization){this.enabled=true;this.arm();}}
  toggleHover(){this.hover=!this.hover;this.landing=false;this.targetHeight=Math.max(this.config.hoverHeight,this.ground.height);this.arm();}
  takeoff(){this.enabled=true;this.hover=true;this.landing=false;this.targetHeight=this.config.hoverHeight;this.arm();}
  land(){this.hover=true;this.landing=true;this.targetHeight=Math.max(0,this.ground.height);this.arm();}
  arm(){if(!this.flightArmed)this.stabilizer.reset(this.vehicle.body);this.flightArmed=true;}
  senseGround(){
    const body=this.vehicle.body,p=body.translation(),q=body.rotation();let highest=-Infinity,centerHeight=null;
    const points=[[0,0],[.55,.9],[-.55,.9],[.55,-.9],[-.55,-.9]];
    for(let i=0;i<points.length;i++){
      const origin=add(p,rotate(v(points[i][0],0,points[i][1]),q));
      const hit=this.vehicle.world.castRay(new RAPIER.Ray(origin,v(0,-1,0)),1e7,true,undefined,undefined,undefined,body);
      if(hit){const y=origin.y-hit.timeOfImpact;highest=Math.max(highest,y);if(i===0)centerHeight=p.y-y-C.comHeight;}
    }
    if(highest>-Infinity)this.ground={height:p.y-highest-C.comHeight,centerHeight,worldGroundY:highest,detected:true};
    else this.ground={...this.ground,height:p.y-this.ground.worldGroundY-C.comHeight,detected:false};
  }
  prepare(input,dt){
    this.senseGround();const vehicle=this.vehicle,q=vehicle.body.rotation(),vel=vehicle.body.linvel(),up=rotate(v(0,1,0),q);
    const infinite=this.mode==='Chaos'&&this.infiniteGas,multiplier=this.mode==='Chaos'&&this.highThrust?this.config.chaosMultiplier:1;
    const scale=this.enabled?this.fuel.availableScale(infinite)*multiplier:0;
    // A natural touchdown must return control to the tires. Otherwise an old
    // flight yaw target keeps firing attitude jets against A/D on the ground.
    const attitudeCommand=!!(input.pitch||input.roll||input.yaw||input.lift);
    const grounded=this.ground.detected&&this.ground.height<.10&&Math.abs(vel.y)<.8&&vehicle.wheels.filter(w=>w.contact).length>=2;
    this.groundedSeconds=grounded&&!this.hover&&!attitudeCommand?this.groundedSeconds+dt:0;
    if(this.groundedSeconds>=.2&&this.flightArmed){this.flightArmed=false;this.stabilizer.reset(vehicle.body);}
    if((input.lift||0)>0||input.pitch||input.roll||input.yaw)this.arm();
    this.rearBoostRequested=!!(this.enabled&&input.boost&&!vehicle.jetInhibited&&scale>0);
    let lift=0;const maxLift=this.nozzles.filter(n=>n.type==='lift'&&n.enabled).reduce((s,n)=>s+n.maxThrust,0)*scale;
    if(this.hover&&this.enabled){
      if(this.landing)this.targetHeight=Math.max(-.08,this.targetHeight-.8*dt);
      else this.targetHeight=Math.max(.05,this.targetHeight+((input.lift||0)-(input.descend||0))*1.5*dt);
      const forceWorldY=vehicle.currentMass*C.gravity+this.config.altitudeKp*(this.targetHeight-this.ground.height)-this.config.altitudeKd*vel.y;
      lift=up.y>.15?clamp(forceWorldY/up.y,0,maxLift):0;
      if(this.landing&&this.ground.height<.055&&Math.abs(vel.y)<.8&&vehicle.wheels.filter(w=>w.contact).length>=2){this.hover=false;this.landing=false;this.flightArmed=false;lift=0;}
    }else if(input.lift&&!input.descend)lift=maxLift*clamp(input.lift,0,1);
    const torque=this.stabilizer.torque(vehicle,input,this.mode==='Chaos'&&this.stabilizeInChaos?'Stabilized':this.mode,dt,this.flightArmed&&this.enabled);
    this.emergencyActive=!!(this.emergencyStabilization&&this.flightArmed&&this.enabled&&this.ground.height>.15&&scale>0);
    if(this.emergencyActive){
      // Request damping through the original bounded nozzle allocator. No
      // angular velocity or quaternion is assigned by the recovery controller.
      const angular=rotate(vehicle.body.angvel(),inverse(q)),inertia=vehicle.config.inertia;
      const columns=this.allocation.columns(scale);
      this.emergencyTorqueLimit=[3,4,5].map(axis=>Math.min(columns.reduce((s,c)=>s+Math.max(0,c[axis]),0),-columns.reduce((s,c)=>s+Math.min(0,c[axis]),0)));
      [torque.x,torque.y,torque.z]=[angular.x,angular.y,angular.z].map((w,i)=>clamp(-w*[inertia.x,inertia.y,inertia.z][i]/.7,-this.emergencyTorqueLimit[i],this.emergencyTorqueLimit[i]));
      this.rearBoostRequested=false;
      this.emergencyStableSeconds=Math.hypot(angular.x,angular.y,angular.z)<.2?this.emergencyStableSeconds+dt:0;
      if(this.emergencyStableSeconds>.8)this.emergencyStabilization=false;
    }
    let horizontal=v();
    if(input.drive<0&&this.flightArmed&&this.ground.height>.2){const localVelocity=rotate(vel,inverse(q));horizontal=v(clamp(-localVelocity.x*1800,-4500,4500),0,clamp(-localVelocity.z*1800,-12000,12000));}
    if(this.rearBoostRequested&&!this.flightArmed)torque.y+=(input.steer||0)*1000;
    const rearMax=this.nozzles.filter(n=>n.type==='rear'&&n.enabled).reduce((s,n)=>s+n.maxThrust,0)*scale;
    this.desiredWrench=[horizontal.x,lift,horizontal.z+(this.rearBoostRequested?rearMax:0),torque.x,torque.y,torque.z];
    const normalWeights=this.allocation.weights;
    if(this.emergencyActive)this.allocation.weights=normalWeights.map((w,i)=>w*(i<3?.35:3));
    let throttles;try{throttles=this.allocation.solve(this.desiredWrench,scale);}finally{this.allocation.weights=normalWeights;}let sum=0;
    for(let i=0;i<this.nozzles.length;i++){
      const n=this.nozzles[i],target=scale>0&&n.enabled?throttles[i]:0;
      const tau=this.mode==='Chaos' && this.highThrust ? .008 : target>n.valve ? n.responseSeconds : n.releaseSeconds;
      n.valve+=(target-n.valve)*(1-Math.exp(-dt/tau));if(!this.enabled||scale===0||!n.enabled)n.valve=0;
      n.thrust=n.valve*n.maxThrust*scale;sum+=n.thrust;
    }
    const fuelScale=this.fuel.consume(sum,dt,infinite);this.thrustNewtons=0;
    for(const n of this.nozzles){n.thrust*=fuelScale;n.massFlow=infinite?0:n.thrust/this.config.exhaustVelocityMps;this.thrustNewtons+=n.thrust;}
    this.fuel.refill(dt,infinite);
    const mass=C.mass-this.config.gasCapacityKg+this.fuel.mass;if(Math.abs(mass-vehicle.currentMass)>1e-8)vehicle.setMass(mass);
  }
  apply(){
    const body=this.vehicle.body,q=body.rotation(),p=body.translation();this.achievedWrench=[0,0,0,0,0,0];
    for(const n of this.nozzles){
      const local=v(n.position[0],n.position[1]-C.comHeight,n.position[2]),f=mul(v(...n.forceDirection),n.thrust),t=cross(local,f);
      this.vehicle.applyForce(rotate(f,q),add(p,rotate(local,q)));
      [f.x,f.y,f.z,t.x,t.y,t.z].forEach((n,i)=>this.achievedWrench[i]+=n);
    }
  }
  telemetry(){const f=this.fuel.telemetry(this.mode==='Chaos'&&this.infiniteGas);return {emergencyStabilization:this.emergencyStabilization,emergencyActive:this.emergencyActive,emergencyTorqueLimitNm:this.emergencyTorqueLimit,enabled:this.enabled,mode:this.mode,stabilizeInChaos:this.stabilizeInChaos,hover:this.hover,landing:this.landing,targetHeight:this.targetHeight,flightArmed:this.flightArmed,altitudeAGL:this.ground.height,groundDetected:this.ground.detected,worldAltitude:this.vehicle.rootPose().p.y,verticalSpeed:this.vehicle.body.linvel().y,thrustNewtons:this.thrustNewtons,availableThrustScale:f.availableScale,highThrust:this.highThrust,fuel:f,vehicleMassKg:this.vehicle.currentMass,desiredWrench:this.desiredWrench,achievedWrench:this.achievedWrench,allocationResidual:this.allocation.residualNorm,nozzles:this.nozzles.map(n=>({id:n.id,type:n.type,position:n.position,forceDirection:n.forceDirection,exhaustDirection:n.forceDirection.map(x=>-x),maxThrustNewtons:n.maxThrust,thrustNewtons:n.thrust,throttle:n.valve,enabled:n.enabled,massFlowKgPerSecond:n.massFlow}))};}
}
