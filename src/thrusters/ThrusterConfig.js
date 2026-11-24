import {config as C} from '../vehicle/VehicleConfig.js';
// Engineering assumptions for a fictional test rig. Directions below are FORCES;
// exhaust and visual particle travel always use the opposite direction.
const nozzle=(id,type,position,forceDirection,maxThrust)=>({id,type,position,forceDirection,maxThrust,enabled:true,responseSeconds:.04,releaseSeconds:.02});
export const ThrusterConfig={
  rearTotalThrust:33040,gasCapacityKg:160,exhaustVelocityMps:500,
  initialPressureMPa:25,regulatorPressureMPa:8,minPressureMPa:.25,polytropicExponent:1.4,
  compressor:{enabled:true,massFlowKgPerSecond:4},
  chaosMultiplier:2,hoverHeight:2,altitudeKp:5000,altitudeKd:6200,
  manualTorque:{x:7000,y:4000,z:5000},
  nozzles:[
    nozzle('Rear_L','rear',[.38,C.comHeight,-2.3],[0,0,1],16500),
    nozzle('Rear_R','rear',[-.38,C.comHeight,-2.3],[0,0,1],16500),
    nozzle('Lift_FL','lift',[.55,.07,1.05],[0,1,0],8000),
    nozzle('Lift_FR','lift',[-.55,.07,1.05],[0,1,0],8000),
    nozzle('Lift_RL','lift',[.55,.07,-1.05],[0,1,0],8000),
    nozzle('Lift_RR','lift',[-.55,.07,-1.05],[0,1,0],8000),
    nozzle('Attitude_FL','attitude',[.82,C.comHeight,1.48],[0,0,-1],2500),
    nozzle('Attitude_FR','attitude',[-.82,C.comHeight,1.48],[0,0,-1],2500),
    nozzle('Attitude_RL','attitude',[.82,C.comHeight,-1.55],[-1,0,0],2500),
    nozzle('Attitude_RR','attitude',[-.82,C.comHeight,-1.55],[1,0,0],2500)
  ]
};
