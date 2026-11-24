// Speed and distance crossings are interpolated from actual rigid-body samples.
// The 2018 C/D convention used a 3 mph starting threshold, distinct from 1 ft.
export class AccelerationMetrics{
  constructor(vehicle){this.vehicle=vehicle;vehicle.postStepProducers.push((_v,dt)=>this.update(dt));vehicle.resetHooks.push(()=>this.reset());this.reset();}
  reset(){this.state='ready';this.elapsed=0;this.crossings={};this.rolloutOneFootSeconds=null;this.legacyThreeMphSeconds=null;this.quarter=null;this.samples=[];this.previousSpeed=0;this.previousDistance=0;this.distance=0;this.peakKmh=0;this.start=null;this.previousPosition={...this.vehicle.rootPose().p};}
  update(dt){
    const car=this.vehicle,p=car.rootPose().p,vel=car.body.linvel(),speed=Math.hypot(vel.x,vel.z),input=car.currentInput;
    if(this.state==='ready'&&input.drive>0&&this.previousSpeed<.5/3.6){this.state='running';this.start={...this.previousPosition};const q=car.body.rotation();this.direction={x:2*(q.x*q.z+q.w*q.y),z:1-2*(q.x*q.x+q.y*q.y)};}
    if(this.state==='running'||this.state==='complete'){
      this.distance=Math.max(0,(p.x-this.start.x)*this.direction.x+(p.z-this.start.z)*this.direction.z);this.peakKmh=Math.max(this.peakKmh,speed*3.6);
      const timeAt=(value,a,b)=>this.elapsed+dt*Math.max(0,Math.min(1,(value-a)/Math.max(b-a,1e-12)));
      if(this.legacyThreeMphSeconds===null&&speed>=1.34112)this.legacyThreeMphSeconds=timeAt(1.34112,this.previousSpeed,speed);
      if(this.rolloutOneFootSeconds===null&&this.distance>=.3048)this.rolloutOneFootSeconds=timeAt(.3048,this.previousDistance,this.distance);
      for(const [key,target]of Object.entries({'60mph':26.8224,'100kmh':100/3.6,'160kmh':160/3.6,'100mph':44.704}))if(this.crossings[key]===undefined&&speed>=target)this.crossings[key]=timeAt(target,this.previousSpeed,speed);
      if(!this.quarter&&this.distance>=402.336){const fraction=(402.336-this.previousDistance)/Math.max(this.distance-this.previousDistance,1e-12);this.quarter={strictSeconds:this.elapsed+dt*fraction,trapSpeedKmh:(this.previousSpeed+(speed-this.previousSpeed)*fraction)*3.6,distanceM:402.336};this.state='complete';}
      if(Math.floor((this.elapsed+dt)*2)>Math.floor(this.elapsed*2)&&this.samples.length<180)this.samples.push({seconds:this.elapsed+dt,distanceM:this.distance,actualHorizontalKmh:speed*3.6,wheelOmega:car.wheels.map(w=>w.omega),massKg:car.currentMass,powertrain:car.drivetrain.telemetry()});
      this.elapsed+=dt;
    }
    this.previousSpeed=speed;this.previousDistance=this.distance;this.previousPosition={...p};
  }
  telemetry(){const subtract=t=>Object.fromEntries(Object.entries(this.crossings).map(([k,v])=>[k,t===null?null:v-t]));return {state:this.state,elapsedSeconds:this.elapsed,strictFromRestSeconds:{...this.crossings},oneFootRolloutSeconds:subtract(this.rolloutOneFootSeconds),legacyThreeMphSeconds:subtract(this.legacyThreeMphSeconds),excludedOneFootSeconds:this.rolloutOneFootSeconds,excludedLegacyThreeMphSeconds:this.legacyThreeMphSeconds,quarter:this.quarter?{...this.quarter,oneFootRolloutSeconds:this.quarter.strictSeconds-this.rolloutOneFootSeconds,legacyThreeMphSeconds:this.quarter.strictSeconds-this.legacyThreeMphSeconds}:null,distanceM:this.distance,maximumActualKmh:this.peakKmh,sampleCount:this.samples.length,measurement:'120 Hz; actual horizontal rigid-body speed; interpolated speed and longitudinal distance crossings; strict rest, exact 0.3048 m rollout, and legacy 3 mph reported separately'};}
}
