import {clamp,v,rotate,dot} from '../../physics/math.js';

export const model3Modes={
  Standard:{powerScale:.82,torqueScale:.80,response:.22,rearShare:.58,tcsSlip:.065,escGain:1},
  Performance:{powerScale:1,torqueScale:1,response:.12,rearShare:.60,tcsSlip:.085,escGain:.75},
  Track:{powerScale:1,torqueScale:1,response:.12,rearShare:.68,tcsSlip:.15,escGain:.18}
};
export class Model3Powertrain{
  constructor(vehicle,{mode='Performance',soc=.90,payloadKg=75,modes=model3Modes}={}){
    this.modes=modes;this.vehicle=vehicle;this.config=vehicle.config.powertrain;this.payloadKg=payloadKg;this.initialSOC=soc;this.mode=mode;this.absEnabled=true;this.tcsEnabled=true;this.reset();
  }
  reset(){this.soc=this.initialSOC;this.throttle=0;this.pressures=[1,1,1,1];this.requests=Array.from({length:4},()=>({motorTorque:0,brakeTorque:0}));this.absActive=[false,false,false,false];this.escActive=false;this.tcsActive=false;this.energyUsedWh=0;this.recoveredWh=0;this.mechanicalPowerW=0;this.regenPowerW=0;this.frontPowerW=0;this.rearPowerW=0;this.motorTorqueNm=0;this.brakeLights=false;this.maximumObservedPowerW=0;this.maximumObservedMotorTorqueNm=0;this.regenAvailableScale=1;}
  setMode(mode){if(this.modes[mode])this.mode=mode;}
  setSOC(fraction){this.soc=this.initialSOC=clamp(fraction,0,1);}
  setPayload(kg){this.payloadKg=clamp(kg,0,250);this.vehicle.setMass(this.vehicle.config.curbMassKg+this.payloadKg);}
  prepare({input,drive,brake,speed,dt}){
    const car=this.vehicle,C=car.config,P=this.config,M=this.modes[this.mode],absSpeed=Math.abs(speed),wheels=car.wheels;
    this.omegaStart=wheels.map(w=>w.omega);this.absActive.fill(false);this.escActive=false;this.tcsActive=false;
    this.throttle+=(drive-this.throttle)*(1-Math.exp(-dt/M.response));
    if(brake>0||input.handbrake)this.throttle=0;
    if(!drive&&Math.abs(this.throttle)<.00001)this.throttle=0;
    const body=car.body,q=body.rotation(),forward=rotate(v(0,0,1),q),left=rotate(v(1,0,0),q),up=rotate(v(0,1,0),q);
    const lateral=dot(body.linvel(),left),yaw=dot(body.angvel(),up),sideAngle=Math.atan2(lateral,Math.max(absSpeed,2));
    const grip=C.friction[wheels[0].surface]||C.friction.dry;
    const desiredYaw=clamp(speed*Math.tan(car.steer)/C.wheelbase,-grip*C.gravity/Math.max(absSpeed,1),grip*C.gravity/Math.max(absSpeed,1));
    const yawError=desiredYaw-yaw;
    const escDemand=absSpeed>5&&(Math.abs(sideAngle)>.10||Math.abs(yawError)>.22)?clamp(Math.abs(yawError)*M.escGain*800,0,750):0;
    this.escActive=escDemand>5;
    const rearShare=this.mode==='Track'?clamp(M.rearShare+Math.abs(car.steer)*.15-Math.abs(wheels[2].slip+wheels[3].slip)*.08,.5,.72):M.rearShare;
    this.rearShare=rearShare;
    const socDrive=clamp(this.soc/.08,0,1),governor=speed>=0?clamp((P.governedKmh-speed*3.6)/4,0,1):clamp((25-absSpeed*3.6)/3,0,1);
    const maxPower=P.combinedPowerW*M.powerScale*socDrive;
    this.allowedPowerW=maxPower;this.allowedMotorTorqueNm=P.combinedMotorTorqueNm*M.torqueScale*socDrive;
    this.regenAvailableScale=clamp((1-this.soc)/.05,0,1)*clamp((absSpeed-.35)/1.6,0,1);
    const regenDemand=brake>0?Math.min(1,brake*2):drive===0?1:0;
    const regenPower=P.regenPowerW*this.regenAvailableScale*regenDemand;
    const regenSign=Math.sign(speed);
    const candidates=wheels.map((w,i)=>{
      const axleShare=i<2?1-rearShare:rearShare,omega=Math.abs(w.omega),motorOmega=omega*P.nominalReduction;
      const rpm=motorOmega*60/(2*Math.PI);
      const taper=1-.18*clamp((rpm-P.highSpeedTaperStartRpm)/(P.highSpeedTaperEndRpm-P.highSpeedTaperStartRpm),0,1);
      let motor=this.throttle*this.allowedMotorTorqueNm*axleShare/2*P.nominalReduction*P.driveEfficiency*taper*governor;
      if(P.axleTorqueNm){const axle=i<2?0:1;motor=this.throttle*P.axleTorqueNm[axle]*M.torqueScale*socDrive/2*P.nominalReduction*P.driveEfficiency*taper*governor;const axleCap=P.axlePowerW[axle]*M.powerScale*socDrive/2*P.driveEfficiency/Math.max(omega,.1);motor=clamp(motor,-axleCap,axleCap);}
      // Independent induction-front / PM-reluctance-rear engineering curves.
      if(i<2)motor*=1-.015*clamp(rpm/17000,0,1);
      if(this.tcsEnabled&&w.contact&&Math.sign(motor)===Math.sign(speed||motor)){
        const excess=Math.max(0,Math.abs(w.slip)-M.tcsSlip);
        const scale=clamp(1-excess*3.5,.02,1);motor*=scale;if(scale<.99)this.tcsActive=true;
      }
      if(escDemand>5)motor*=1-M.escGain*.18;
      if(Math.abs(motor)>0&&Math.sign(motor)!==Math.sign(drive||this.throttle))motor=0;
      const regenShare=(i<2?.35:.65)/2;
      let regen=regenSign*Math.min(P.regenMotorTorqueNm*P.nominalReduction*P.driveEfficiency*regenShare,regenPower*regenShare/Math.max(omega,.1));
      if(!w.contact||regenSign===0)regen=0;
      if(this.absEnabled&&absSpeed>2&&w.contact&&(brake>0||regenDemand>0)){
        const brakingSlip=w.slip*Math.sign(speed||1);
        if(brakingSlip<-.13)this.pressures[i]=Math.max(0,this.pressures[i]-dt*13);
        else if(brakingSlip>-.065)this.pressures[i]=Math.min(1,this.pressures[i]+dt*3);
        this.absActive[i]=this.pressures[i]<.98;
      }else this.pressures[i]=1;
      const frontBrakeBias=i<2?.60:.40;
      const requestedMechanical=Math.max(0,brake*C.brakeTorque*frontBrakeBias*2-Math.abs(regen));
      // Blend before ABS modulation: regen and its hydraulic complement
      // receive the same pressure once, avoiding excess torque during release.
      regen*=this.pressures[i];
      const escSide=yawError>0?1:-1;
      const esc=escDemand&&Math.sign(w.center[0])===escSide&&(Math.abs(yaw)>Math.abs(desiredYaw)?i<2:i>=2)?escDemand:0;
      const mechanical=(requestedMechanical+esc)*this.pressures[i]+(input.handbrake&&i>1?C.handbrakeTorque:0);
      return {motorTorque:motor-regen,driveTorque:motor,regenTorque:regen,brakeTorque:mechanical,rpm,motorOmega};
    });
    const required=candidates.reduce((s,r,i)=>s+Math.max(0,r.driveTorque*this.omegaStart[i])/P.driveEfficiency,0);
    const powerScale=required>maxPower?maxPower/required:1;
    this.requests=candidates.map(r=>({...r,motorTorque:r.driveTorque*powerScale-r.regenTorque,driveTorque:r.driveTorque*powerScale}));
    this.brakeRequested=brake>.025||!!input.handbrake;
    this.brakeLights=this.brakeRequested;
  }
  wheelRequest(i){return this.requests[i];}
  afterWheelForces(dt){
    const P=this.config,wheels=this.vehicle.wheels;
    const actual=wheels.map((w,i)=>w.driveTorque*this.omegaStart[i]);
    this.frontPowerW=actual.slice(0,2).reduce((s,p)=>s+Math.max(0,p),0)/P.driveEfficiency;
    this.rearPowerW=actual.slice(2).reduce((s,p)=>s+Math.max(0,p),0)/P.driveEfficiency;
    this.mechanicalPowerW=this.frontPowerW+this.rearPowerW;
    this.regenPowerW=actual.reduce((s,p)=>s+Math.max(0,-p),0);
    this.brakeLights=this.brakeRequested||this.regenPowerW/Math.max(Math.abs(this.vehicle.forwardSpeed()),1)/this.vehicle.currentMass>1.3;
    this.motorTorqueNm=wheels.reduce((s,w)=>s+Math.max(0,w.driveTorque*Math.sign(this.throttle||1)),0)/(P.nominalReduction*P.driveEfficiency);
    const efficiency=clamp(P.nominalEfficiency-.025*Math.abs(.5-this.throttle),.82,.96);
    const used=(this.mechanicalPowerW/efficiency+P.auxiliaryW)*dt/3600;
    const recovered=this.regenPowerW*P.regenEfficiency*dt/3600;
    this.energyUsedWh+=used;this.recoveredWh+=recovered;this.soc=clamp(this.soc-(used-recovered)/(P.batteryKWh*1000),0,1);
    this.maximumObservedPowerW=Math.max(this.maximumObservedPowerW,this.mechanicalPowerW);
    this.maximumObservedMotorTorqueNm=Math.max(this.maximumObservedMotorTorqueNm,this.motorTorqueNm);
  }
  telemetry(){return {mode:this.mode,soc:this.soc,batteryKWh:this.config.batteryKWh,curbMassKg:this.vehicle.config.curbMassKg,payloadKg:this.payloadKg,totalMassKg:this.vehicle.currentMass,frontMotor:this.config.frontMotorLabel||'AC induction (engineering curve)',rearMotor:this.config.rearMotorLabel||'PM-assisted synchronous reluctance (engineering curve)',combinedPowerLimitW:this.allowedPowerW??this.config.combinedPowerW,combinedMotorTorqueLimitNm:this.allowedMotorTorqueNm??this.config.combinedMotorTorqueNm,frontMotorPowerW:this.frontPowerW,rearMotorPowerW:this.rearPowerW,combinedMotorPowerW:this.mechanicalPowerW,motorTorqueNm:this.motorTorqueNm,regenMechanicalPowerW:this.regenPowerW,regenAvailableScale:this.regenAvailableScale,rearTorqueShare:this.rearShare??.6,energyUsedWh:this.energyUsedWh,recoveredWh:this.recoveredWh,absEnabled:this.absEnabled,absActive:[...this.absActive],absPressure:[...this.pressures],tcsEnabled:this.tcsEnabled,tcsActive:this.tcsActive,escActive:this.escActive,brakeLights:this.brakeLights,maximumObservedPowerW:this.maximumObservedPowerW,maximumObservedMotorTorqueNm:this.maximumObservedMotorTorqueNm,axles:this.requests.map(r=>({rotorRpm:r.rpm||0,driveTorqueNm:r.driveTorque||0,regenTorqueNm:r.regenTorque||0,mechanicalBrakeTorqueNm:r.brakeTorque||0})),parametersAreEngineeringApproximations:true};}
}
