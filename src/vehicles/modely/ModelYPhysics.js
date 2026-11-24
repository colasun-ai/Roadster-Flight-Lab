import {VehiclePhysics} from '../../vehicle/VehiclePhysics.js';
import {Model3Powertrain} from '../model3/Model3Powertrain.js';
import {makeModelYConfig} from './ModelYConfig.js';
export const ModelYModes=Object.freeze({
 Chill:{powerScale:.60,torqueScale:.58,response:.28,rearShare:.65,tcsSlip:.06,escGain:1},
 Standard:{powerScale:.88,torqueScale:.85,response:.17,rearShare:.67,tcsSlip:.07,escGain:.9},
 Insane:{powerScale:1,torqueScale:1,response:.1,rearShare:480/700,tcsSlip:.085,escGain:.75}
});
export class ModelYPhysics extends VehiclePhysics{
 constructor(world,options={}){super(world,makeModelYConfig(options));this.drivetrain=new Model3Powertrain(this,{...options,mode:options.mode||'Insane',modes:ModelYModes});this.dampingMode='Standard';this.stabilityMode='Normal';this.resetHooks.push(()=>this.drivetrain.reset());}
 setDampingMode(mode){if(!['Standard','Sport'].includes(mode))return;this.dampingMode=mode;this.wheels.forEach((w,i)=>w.damper=(i<2?5500:6200)*(mode==='Sport'?1.25:1));}
 setStabilityMode(mode){if(!['Normal','Reduced'].includes(mode))return;this.stabilityMode=mode;this.drivetrain.modes=Object.fromEntries(Object.entries(ModelYModes).map(([id,m])=>[id,{...m,tcsSlip:m.tcsSlip*(mode==='Reduced'?1.4:1),escGain:m.escGain*(mode==='Reduced'?.35:1)}]));}
 step(input={}){super.step({drive:input.drive||0,brake:input.brake||0,steer:input.steer||0,handbrake:!!input.handbrake});}
 telemetry(){return {...super.telemetry(),vehicleId:'model-y-performance-2026',dampingMode:this.dampingMode,stabilityMode:this.stabilityMode,powertrain:this.drivetrain.telemetry()};}
}
