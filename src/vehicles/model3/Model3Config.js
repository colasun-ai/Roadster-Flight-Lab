import geometry from '../../../public/models/model3-chassis-geometry.json' with {type:'json'};

// Historical curb mass and combined motor figures are references, not a private
// Tesla motor map. The remaining chassis/controller values are engineering fits.
export const Model3Specification=Object.freeze({year:2018,curbMassKg:1854,combinedPowerW:335565,combinedMotorTorqueNm:638.6,batteryKWh:80.5,governedKmh:249.44832,nominalReduction:9,theoreticalTireRadiusM:.33625});
export function makeModel3Config({payloadKg=75}={}){
  const S=Model3Specification;
  return {
    id:'model3-performance-2018',mass:S.curbMassKg+payloadKg,curbMassKg:S.curbMassKg,payloadKg,
    gravity:9.81,comHeight:.50,dt:1/120,inertia:{x:3100,y:3600,z:760},
    wheelbase:geometry.wheelbase,frontTrack:geometry.frontTrack,rearTrack:geometry.rearTrack,
    maxInnerSteer:35*Math.PI/180,steerResponse:5.5,speedSteerReduction:.0025,adaptiveSteering:true,
    spring:100000,damper:6500,travel:.020,droop:.09,maxWheelLoadG:3,
    wheelInertia:2.2,driveTorque:0,totalPower:S.combinedPowerW,brakeTorque:2300,handbrakeTorque:2400,
    tractionControl:false,longitudinalStiffness:11000,corneringStiffness:42000,rollingResistance:.0105,
    airDensity:1.225,dragArea:.51,hardStopHalfWidth:.099,
    friction:{dry:1.10,wet:.69,gravel:.55,ice:.09},spawn:{x:-110,z:-150,y:.006,yaw:0},
    chassis:{boxes:[{half:[.80,.18,2.16],position:[0,-.17,0]},{half:[.88,.07,1.50],position:[0,-.29,0]}],cabin:[-.78,.10,-1.05,.78,.10,-1.05,-.78,.10,.93,.78,.10,.93,-.61,.85,-.8,.61,.85,-.8,-.59,.83,.36,.59,.83,.36]},
    wheels:geometry.wheels.map(w=>({id:w.id,center:[...w.center],radius:w.radius-.005,visualRadius:w.radius,width:w.width})),
    powertrain:{...S,driveEfficiency:.955,regenEfficiency:.76,nominalEfficiency:.91,regenPowerW:60000,regenMotorTorqueNm:190,auxiliaryW:350,torqueResponseSeconds:.12,highSpeedTaperStartRpm:11200,highSpeedTaperEndRpm:19000}
  };
}
export {geometry as model3Geometry};
