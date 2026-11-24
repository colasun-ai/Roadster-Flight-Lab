import geometry from '../../../public/models/model-y-chassis-geometry.json' with {type:'json'};
// US 2026 Performance. Mass/governor are manufacturer references. Power,
// torque, battery, ratios, CoM/inertia and force curves are engineering fits
// against contemporary US instrumented tests, never a claimed Tesla motor map.
export const ModelYSpecification=Object.freeze({year:2026,market:'United States',curbMassKg:2026,combinedPowerW:380000,combinedMotorTorqueNm:700,batteryKWh:81,governedKmh:249.44832,nominalReduction:9.8});
export function makeModelYConfig({payloadKg=75}={}){
 const S=ModelYSpecification;
 return {id:'model-y-performance-2026',mass:S.curbMassKg+payloadKg,curbMassKg:S.curbMassKg,payloadKg,gravity:9.81,comHeight:.57,linearDamping:.001,massCenter:[0,0,-.0291],dt:1/120,inertia:{x:3400,y:3600,z:1050},wheelbase:geometry.wheelbase,frontTrack:geometry.frontTrack,rearTrack:geometry.rearTrack,
 maxInnerSteer:28*Math.PI/180,steerResponse:4.7,speedSteerReduction:.0027,adaptiveSteering:true,spring:56000,damper:6000,antiRollStiffness:[32000,36000],travel:.04,droop:.09,maxWheelLoadG:3,wheelInertia:2.6,driveTorque:0,totalPower:S.combinedPowerW,brakeTorque:2500,handbrakeTorque:2500,tractionControl:false,longitudinalStiffness:11500,corneringStiffness:45000,rollingResistance:.0105,airDensity:1.225,dragArea:.61,hardStopHalfWidth:.12,
 friction:{dry:1.02,wet:.62,gravel:.52,ice:.085},spawn:{x:-110,z:-150,y:.006,yaw:0},
 chassis:{boxes:[{half:[.86,.19,2.15],position:[0,-.22,0]},{half:[.91,.065,1.54],position:[0,-.36,0]}],cabin:[-.83,.14,-1.12,.83,.14,-1.12,-.83,.14,.98,.83,.14,.98,-.64,.99,-.88,.64,.99,-.88,-.62,.98,.49,.62,.98,.49]},
 wheels:geometry.wheels.map((w,i)=>({id:w.id,center:[...w.center],radius:w.radius-.006,visualRadius:w.radius,width:w.width,spring:i<2?52000:56000,damper:i<2?5500:6200})),
 powertrain:{...S,axleTorqueNm:[220,480],axlePowerW:[100000,280000],driveEfficiency:.955,regenEfficiency:.78,nominalEfficiency:.92,regenPowerW:85000,regenMotorTorqueNm:230,auxiliaryW:450,torqueResponseSeconds:.1,highSpeedTaperStartRpm:12500,highSpeedTaperEndRpm:22000,frontMotorLabel:'AC induction (engineering approximation)',rearMotorLabel:'AC permanent-magnet synchronous (engineering approximation)'}};
}
export {geometry as modelYGeometry};
