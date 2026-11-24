import RAPIER from '@dimforge/rapier3d-compat';
import {config as DefaultConfig} from './VehicleConfig.js';
import {v,add,sub,mul,dot,cross,length,norm,rotate,clamp} from '../physics/math.js';
import {surfaceAt} from '../world/TestTrack.js';

// Wheels have angular inertia; tire reaction torque, rather than chassis speed,
// integrates their speed. RaycastVehicleController's speed-derived rotation cannot
// represent this module's locked/spinning wheels, so its ray suspension is replaced.
export class VehiclePhysics{
  constructor(world,config=DefaultConfig){
    const C=this.config=config;
    this.world=world;this.time=0;this.steps=0;this.errors=[];this.steer=0;this.gear='N';this.surface='auto';this.tractionControl=C.tractionControl!==false;this.adaptiveSteering=C.adaptiveSteering!==false;
    this.body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,C.comHeight+.006,-110).setCcdEnabled(true).setSoftCcdPrediction(.003).setCanSleep(false).setLinearDamping(C.linearDamping??.015).setAngularDamping(.12).setAdditionalMassProperties(C.mass,C.massCenter?v(...C.massCenter):v(),C.inertia,{x:0,y:0,z:0,w:1}));
    // Two boxes plus cabin convex hull. No dynamic triangle mesh.
    const collider=(d,friction=.55,restitution=.01)=>world.createCollider(d.setDensity(0).setFriction(friction).setRestitution(restitution),this.body);
    const chassis=C.chassis||{boxes:[{half:[.74,.19,2.08],position:[0,.06,0]},{half:[.9,.08,1.1],position:[0,-.16,-.1]}],cabin:[-.78,.18,-1,.78,.18,-1,-.78,.18,1,.78,.18,1,-.57,.73,-.72,.57,.73,-.72,-.57,.73,.35,.57,.73,.35]};
    for(const box of chassis.boxes)collider(RAPIER.ColliderDesc.cuboid(...box.half).setTranslation(...box.position));
    const cabin=new Float32Array(chassis.cabin);
    collider(RAPIER.ColliderDesc.convexHull(cabin));
    this.wheels=C.wheels.map(w=>({...w,center:[...w.center],omega:0,angle:0,compression:0,previousCompression:0,steer:0,contact:false,load:0,slip:0,lateralSlip:0,surface:'dry',fx:0,fy:0}));
    // Physical full-compression hard stops: normally 18mm above the road. These
    // cylinders become real collision supports at end travel, including landings.
    this.hardStops=this.wheels.map(w=>collider(RAPIER.ColliderDesc.roundCylinder(C.hardStopHalfWidth??.115,w.radius-.028,.025).setRotation({x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2}).setTranslation(w.center[0],w.center[1]-C.comHeight+C.travel,w.center[2]).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),0,0));
    this.rollCompression=new Float64Array(4);this.wheelRays=this.wheels.map(()=>new RAPIER.Ray(v(),v(0,-1,0)));
    this.currentMass=C.mass;this.currentInput={};this.preStepProducers=[];this.forceProducers=[];this.postStepProducers=[];this.resetHooks=[];
    this.reset();
  }
  rootPose(){const C=this.config,q=this.body.rotation(),p=sub(this.body.translation(),rotate(v(0,C.comHeight,0),q));return {p,q};}
  forwardSpeed(){return dot(this.body.linvel(),rotate(v(0,0,1),this.body.rotation()));}
  reset(options={}){
    const C=this.config,{x=C.spawn.x,z=C.spawn.z,y=C.spawn.y,yaw=0}=options;
    this.body.setTranslation(v(x,C.comHeight+y,z),true);this.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
    this.body.setLinvel(v(),true);this.body.setAngvel(v(),true);this.body.resetForces(true);this.body.resetTorques(true);
    this.steer=0;this.gear='N';this.error=null;
    this.wheels.forEach(w=>Object.assign(w,{omega:0,angle:0,compression:0,previousCompression:0,steer:0,contact:false,load:0,slip:0}));
    this.currentInput={};this.resetHooks.forEach(fn=>fn());
  }
  setMass(mass){
    const C=this.config;
    this.currentMass=mass;const ratio=mass/C.mass;
    this.body.setAdditionalMassProperties(mass,C.massCenter?v(...C.massCenter):v(),mul(C.inertia,ratio),{x:0,y:0,z:0,w:1},true);
    this.body.recomputeMassPropertiesFromColliders();
  }
  applyForce(force,point){this.body.addForceAtPoint(force,point,true);}
  applyTorque(torque){this.body.addTorque(torque,true);}
  step(input={}){
    if(this.error)return;
    this.currentInput=input;
    const C=this.config,dt=C.dt,b=this.body,q=b.rotation(),pos=b.translation(),vel=b.linvel(),av=b.angvel();
    const up=rotate(v(0,1,0),q),forward=rotate(v(0,0,1),q),speed=dot(vel,forward);
    const velocityReference=C.massCenter?add(pos,rotate(v(...C.massCenter),q)):pos;
    const demand=clamp(input.drive||0,-1,1);
    let drive=0,brake=clamp(input.brake||0,0,1);
    if(demand){if(speed*demand<-.45){brake=Math.max(brake,Math.abs(demand));this.gear=speed>0?'D':'R';}else{drive=demand;this.gear=drive>0?'D':'R';}}
    else if(Math.abs(speed)<.15)this.gear='N';
    const centreMax=Math.atan(C.wheelbase/(C.wheelbase/Math.tan(C.maxInnerSteer)+C.frontTrack/2));
    const reduced=centreMax/(1+C.speedSteerReduction*speed*speed);
    // Keyboard steering retains useful tire slip angle at speed. A geometric
    // mu*g/v^2 cap alone assumes infinitely stiff tires and previously removed
    // most high-speed authority. Only wheel angles change; yaw stays physical.
    const grip=C.friction[this.wheels[0].surface]||C.friction.dry;
    const assisted=centreMax/(1+Math.abs(speed)/10+speed*speed/1800)*Math.sqrt(Math.max(.25,grip/C.friction.dry));
    const target=clamp(input.steer||0,-1,1)*(this.adaptiveSteering?assisted:reduced);
    this.steer+=(target-this.steer)*(1-Math.exp(-C.steerResponse*dt));
    b.resetForces(true);b.resetTorques(true);
    this.jetInhibited=brake>0||demand<0||input.handbrake;
    for(const producer of this.preStepProducers)producer(this,dt);
    this.drivetrain?.prepare({input,drive,brake,speed,dt});
    if(C.antiRollStiffness)for(let i=0;i<4;i++)this.rollCompression[i]=this.wheels[i].compression;
    for(let i=0;i<4;i++){
      const w=this.wheels[i];w.steer=0;
      if(i<2&&Math.abs(this.steer)>1e-7){const turnRadius=C.wheelbase/Math.tan(this.steer);w.steer=Math.atan(C.wheelbase/(turnRadius-w.center[0]));}
      // qY(steer) * qZ(90deg): cylinder axle remains the visual wheel's local X.
      const s=Math.sin(w.steer/2),c=Math.cos(w.steer/2);
      this.hardStops[i].setRotationWrtParent({x:s*Math.SQRT1_2,y:s*Math.SQRT1_2,z:c*Math.SQRT1_2,w:c*Math.SQRT1_2});
      const home=v(w.center[0],w.center[1]-C.comHeight,w.center[2]);
      const origin=add(pos,rotate(add(home,v(0,.06,0)),q));
      const ray=this.wheelRays[i];ray.origin=origin;ray.dir=mul(up,-1);
      const hit=this.world.castRayAndGetNormal(ray,w.radius+.06+C.droop,true,undefined,undefined,undefined,b);
      w.contact=!!hit&&dot(hit.normal,up)>.25;w.load=0;w.fx=0;w.fy=0;w.previousCompression=w.compression;
      const power=this.thrusters?.rearBoostRequested?C.boostPower:C;
      const request=this.drivetrain?.wheelRequest(i);
      let motor=request?request.motorTorque:drive*Math.min(power.driveTorque,power.totalPower/4/Math.max(Math.abs(w.omega),1));
      const brakeMax=request?request.brakeTorque:brake*C.brakeTorque+(input.handbrake&&i>1?C.handbrakeTorque:0);
      if(w.contact){
        const raw=w.radius+.06-hit.timeOfImpact;
        w.compression=clamp(raw,-C.droop,C.travel);
        const contact=add(origin,mul(up,-hit.timeOfImpact)),normal=norm(hit.normal);
        const pv=add(vel,cross(av,sub(contact,velocityReference)));
        // Damper uses relative hub velocity, avoiding a discontinuity on reacquisition.
        const hubVelocity=add(vel,cross(av,rotate(home,q)));
        // End travel is already constrained by the real wheel hard-stop
        // collider. A second 1.8 MN/m penalty spring used to fight that solver
        // and launch the chassis when the ray reacquired a compressed wheel.
        const antiRoll=C.antiRollStiffness?(C.antiRollStiffness[i<2?0:1]||0)*(this.rollCompression[i]-this.rollCompression[i^1]):0;
        const spring=this.currentMass*C.gravity/4+(w.spring??C.spring)*w.compression-(w.damper??C.damper)*dot(hubVelocity,normal)+antiRoll;
        w.load=clamp(spring,0,this.currentMass*C.gravity*C.maxWheelLoadG/4);
        const heading=rotate(v(Math.sin(w.steer),0,Math.cos(w.steer)),q);
        const tireForward=norm(sub(heading,mul(normal,dot(heading,normal))));
        const left=norm(cross(normal,tireForward));const vx=dot(pv,tireForward),vy=dot(pv,left);
        w.surface=this.surface==='auto'?surfaceAt(contact):this.surface;
        const limit=C.friction[w.surface]*w.load;
        const slipAngle=Math.atan2(vy,Math.max(Math.abs(vx),1));
        // Smooth brush-like lateral saturation and load-sensitive stiffness
        // avoid a hard force cliff when an inside wheel unloads in a turn.
        const loadFactor=Math.pow(w.load/(this.currentMass*C.gravity/4),.8);
        let fy=-limit*Math.tanh(C.corneringStiffness*loadFactor*slipAngle/Math.max(limit,1));
        // Electric traction control limits axle torque to the current tire load.
        // Wheel angular velocity still integrates reaction torque; no wheel or
        // chassis speed is forced. The calibrated jet-assisted mode is separate.
        const cornering=Math.abs(this.steer)>.005||Math.abs(vy)>1;
        if(this.tractionControl&&(!this.thrusters?.rearBoostRequested||cornering)){
          const longitudinalBudget=cornering?Math.sqrt(Math.max(0,limit*limit-fy*fy)):limit;
          motor=clamp(motor,-longitudinalBudget*w.radius*.97,longitudinalBudget*w.radius*.97);
        }
        w.driveTorque=motor;w.brakeTorque=brakeMax;
        const brakeSign=Math.abs(w.omega)>.1?Math.sign(w.omega):Math.sign(vx||motor);
        const appliedBrake=brakeSign*brakeMax;
        // Implicit linear tire solve for angular stiffness; friction-circle clamp
        // then explicit conservation of axle torque. This remains stable at 120Hz.
        const wt=(C.wheelInertia/dt*w.omega+motor-appliedBrake+C.longitudinalStiffness*w.radius*vx)/(C.wheelInertia/dt+C.longitudinalStiffness*w.radius*w.radius);
        let fx=C.longitudinalStiffness*(w.radius*wt-vx);
        // At a locked wheel near rest, static friction removes the remaining
        // momentum within the available braking torque rather than oscillating.
        if(brakeMax>0&&Math.abs(vx)<.3&&Math.abs(w.omega)<1){fx=clamp(-vx*this.currentMass/(4*dt),-brakeMax/w.radius,brakeMax/w.radius);}
        const magnitude=Math.hypot(fx,fy);if(magnitude>limit&&magnitude>0){fx*=limit/magnitude;fy*=limit/magnitude;}
        let axleTorque=motor-appliedBrake-fx*w.radius;
        const next=w.omega+dt*axleTorque/C.wheelInertia;
        if(brakeMax>0&&w.omega*next<=0&&Math.abs(motor-fx*w.radius)<=brakeMax)w.omega=0;else w.omega=next;
        w.slip=(w.omega*w.radius-vx)/Math.max(Math.abs(vx),1);w.lateralSlip=vy;w.fx=fx;w.fy=fy;
        const rolling=-Math.sign(vx)*Math.min(C.rollingResistance*w.load,Math.abs(vx)*this.currentMass/(4*dt));
        this.applyForce(add(mul(normal,w.load),add(mul(tireForward,fx+rolling),mul(left,fy))),contact);
      }else{
        w.driveTorque=motor;w.brakeTorque=brakeMax;
        w.compression=-C.droop;w.slip=0;w.lateralSlip=0;
        const resistance=Math.sign(w.omega)*Math.min(brakeMax+1.5,Math.abs(w.omega)*C.wheelInertia/dt);
        w.omega+=dt*(motor-resistance)/C.wheelInertia;
      }
      w.angle=(w.angle+w.omega*dt)%(Math.PI*2);
    }
    this.drivetrain?.afterWheelForces(dt);
    this.applyForce(mul(vel,-.5*C.airDensity*C.dragArea*length(vel)),pos);
    for(const producer of this.forceProducers)producer(this,dt);
    this.world.step();this.time+=dt;this.steps++;
    for(const producer of this.postStepProducers)producer(this,dt);
    const state=[...Object.values(b.translation()),...Object.values(b.linvel()),...Object.values(b.angvel()),...Object.values(b.rotation()),...this.wheels.flatMap(w=>[w.omega,w.compression,w.load])];
    if(!state.every(Number.isFinite)){
      this.error={time:this.time,message:'Physics safety stop: nonfinite state',state};this.errors.push(this.error);
    }
  }
  dispose(){
    if(this.disposed)return;
    this.body.setLinvel(v(),true);this.body.setAngvel(v(),true);this.body.resetForces(true);this.body.resetTorques(true);
    this.preStepProducers.length=0;this.forceProducers.length=0;this.postStepProducers.length=0;this.resetHooks.length=0;
    this.world.removeRigidBody(this.body);this.disposed=true;
  }
  telemetry(){const {p,q}=this.rootPose();return {time:this.time,steps:this.steps,position:p,rotation:q,velocity:this.body.linvel(),angularVelocity:this.body.angvel(),speedKmh:length(this.body.linvel())*3.6,forwardSpeed:this.forwardSpeed(),gear:this.gear,steeringRadians:this.steer,rollDegrees:Math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.z*q.z+q.x*q.x))*180/Math.PI,error:this.error,wheels:this.wheels.map(w=>({id:w.id,contact:w.contact,compressionMm:w.compression*1000,omega:w.omega,angle:w.angle,steerDegrees:w.steer*180/Math.PI,load:w.load,slip:w.slip,lateralSlip:w.lateralSlip,surface:w.surface}))};}
}
