// Temporary engineering parameters, NOT Tesla specifications. SI units throughout.
export const config = {
  mass:1800, gravity:9.81, comHeight:.45, dt:1/120,
  inertia:{x:2400,y:2900,z:850}, wheelbase:2.806147115539264, frontTrack:1.5824708299283092,
  maxInnerSteer:35*Math.PI/180, steerResponse:5, speedSteerReduction:.0025,adaptiveSteering:true,
  spring:120000, damper:6800, travel:.015, droop:.04, maxWheelLoadG:3,
  wheelInertia:3, driveTorque:1500, totalPower:850000, brakeTorque:2600, handbrakeTorque:2500,tractionControl:true,
  longitudinalStiffness:8500, corneringStiffness:34000, rollingResistance:.015,
  boostPower:{driveTorque:1800,totalPower:1050000},
  spawn:{x:-110,z:-150,y:.006,yaw:0},
  launchTargetSeconds:1.04,
  airDensity:1.225, dragArea:.60,
  friction:{dry:1.05,wet:.65,gravel:.55,ice:.08},
  wheels:[
    {id:'FL',center:[.7912354149641546,.33804292334653646,1.2788189546410051],radius:.33804292334653646},
    {id:'FR',center:[-.7912354149641546,.33804292238234573,1.2788189546410051],radius:.33804292238234573},
    {id:'RL',center:[.8040958619672747,.3551477875304204,-1.527328160898259],radius:.3551477875304204},
    {id:'RR',center:[-.7973662901938955,.35355628454511395,-1.527328160898259],radius:.35355628454511395}
  ]
};
