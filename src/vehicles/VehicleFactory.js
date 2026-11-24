import {VehiclePhysics} from '../vehicle/VehiclePhysics.js';
import {config as RoadsterConfig} from '../vehicle/VehicleConfig.js';
import {ThrusterSystem} from '../thrusters/ThrusterSystem.js';
import {LaunchTimer} from '../vehicle/LaunchTimer.js';
import {Model3Physics} from './model3/Model3Physics.js';
import {ModelYPhysics} from './modely/ModelYPhysics.js';
import {getVehicleDefinition} from './VehicleRegistry.js';
export function createVehicle(world,id,options={}){
  const definition=getVehicleDefinition(id),vehicle=id==='roadster'?new VehiclePhysics(world,structuredClone(RoadsterConfig)):id==='model-y-performance-2026'?new ModelYPhysics(world,options):new Model3Physics(world,options);
  const thrusters=definition.capabilities.flight?new ThrusterSystem(vehicle):null;
  const launchTimer=new LaunchTimer(vehicle);
  return {id,definition,vehicle,thrusters,launchTimer,disposed:false,halt(){
    vehicle.currentInput={};vehicle.body.setLinvel({x:0,y:0,z:0},true);vehicle.body.setAngvel({x:0,y:0,z:0},true);vehicle.body.resetForces(true);vehicle.body.resetTorques(true);
    if(thrusters){thrusters.enabled=false;thrusters.hover=false;thrusters.landing=false;thrusters.flightArmed=false;thrusters.infiniteGas=false;thrusters.highThrust=false;thrusters.thrustNewtons=0;thrusters.nozzles.forEach(n=>{n.thrust=0;n.valve=0;});}
  },dispose(){if(this.disposed)return;this.halt();vehicle.dispose();this.disposed=true;}};
}
