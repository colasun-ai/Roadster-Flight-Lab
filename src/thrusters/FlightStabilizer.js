import {v,rotate,cross,dot,length,mul,clamp} from '../physics/math.js';
const inverse=q=>({x:-q.x,y:-q.y,z:-q.z,w:q.w});
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export class FlightStabilizer{
  reset(body){const f=rotate(v(0,0,1),body.rotation());this.targetYaw=Math.atan2(f.x,f.z);}
  torque(vehicle,input,mode,dt,armed){
    if(!armed)return v();const q=vehicle.body.rotation(),qi=inverse(q),av=rotate(vehicle.body.angvel(),qi);
    const p=clamp(input.pitch||0,-1,1),r=clamp(input.roll||0,-1,1),y=clamp(input.yaw||0,-1,1);
    if(mode!=='Stabilized')return v(p*7000,y*4000,r*5000);
    const up=rotate(v(0,1,0),q),vertical=v(0,1,0),axis=cross(up,vertical);let n=length(axis);
    const angle=Math.acos(clamp(dot(up,vertical),-1,1));let correction;
    if(n<1e-5&&up.y<0)correction=v(Math.PI,0,0);else correction=rotate(mul(axis,angle/Math.max(n,1e-8)),qi);
    this.targetYaw+=y*1.1*dt;const f=rotate(v(0,0,1),q),yawError=wrap(this.targetYaw-Math.atan2(f.x,f.z));
    return v(clamp(correction.x*9000-av.x*6500+p*7000,-12000,12000),clamp(yawError*6500-av.y*4500,-4500,4500),clamp(correction.z*7000-av.z*3500+r*5000,-9000,9000));
  }
}
