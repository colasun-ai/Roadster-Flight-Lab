import {VehiclePhysics} from '../../vehicle/VehiclePhysics.js';
import {makeModel3Config} from './Model3Config.js';
import {Model3Powertrain} from './Model3Powertrain.js';
export class Model3Physics extends VehiclePhysics{
  constructor(world,options={}){super(world,makeModel3Config(options));this.drivetrain=new Model3Powertrain(this,options);this.resetHooks.push(()=>this.drivetrain.reset());}
  step(input={}){super.step({drive:input.drive||0,brake:input.brake||0,steer:input.steer||0,handbrake:!!input.handbrake});}
  telemetry(){return {...super.telemetry(),vehicleId:'model3-performance-2018',powertrain:this.drivetrain.telemetry()};}
}
