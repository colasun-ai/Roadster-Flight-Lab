// Force producers share the existing chassis body and fixed-step force phase.
export class VehicleForceInterface{
  constructor(vehicle){this.vehicle=vehicle;}
  forceAtPoint(newtons,worldPoint){this.vehicle.applyForce(newtons,worldPoint);}
  torque(newtonMeters){this.vehicle.applyTorque(newtonMeters);}
}
export {ThrusterController,ThrusterConfig} from './ThrusterController.js';
