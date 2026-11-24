import {config as C} from '../vehicle/VehicleConfig.js';
import {v,cross,mul,clamp} from '../physics/math.js';
// Bounded nonnegative least squares. Every column is an actual nozzle wrench;
// infeasible requests leave a residual instead of manufacturing a torque.
export class ThrusterAllocation{
  constructor(nozzles){this.nozzles=nozzles;this.last=nozzles.map(()=>0);this.weights=[1/10000,2/32000,1/33000,1/12000,1/6000,1/8000];}
  columns(scale){return this.nozzles.map(n=>{const f=mul(v(...n.forceDirection),n.maxThrust*scale*Number(n.enabled));const t=cross(v(n.position[0],n.position[1]-C.comHeight,n.position[2]),f);return [f.x,f.y,f.z,t.x,t.y,t.z];});}
  solve(desired,scale){
    if(desired.every(n=>Math.abs(n)<1e-7)||scale<=0){this.last.fill(0);this.residualNorm=0;return this.last;}
    const columns=this.columns(scale),a=columns.map(c=>c.map((n,j)=>n*this.weights[j])),target=desired.map((n,j)=>n*this.weights[j]);
    const u=this.last.map((n,i)=>this.nozzles[i].enabled?n:0),residual=target.slice();
    for(let i=0;i<u.length;i++)for(let j=0;j<6;j++)residual[j]-=a[i][j]*u[i];
    for(let iteration=0;iteration<48;iteration++)for(let i=0;i<u.length;i++){
      const col=a[i],den=col.reduce((sum,x)=>sum+x*x,0);if(den<1e-15){u[i]=0;continue;}
      const gradient=col.reduce((sum,x,j)=>sum+x*residual[j],0);const next=clamp(u[i]+gradient/den,0,1),delta=next-u[i];u[i]=next;
      for(let j=0;j<6;j++)residual[j]-=col[j]*delta;
    }
    // Remove exactly opposing nozzle pairs without changing the achieved wrench.
    // Otherwise coordinate descent can leave both valves open in a null space.
    for(let i=0;i<a.length;i++)for(let k=i+1;k<a.length;k++){
      const den=a[i].reduce((s,x)=>s+x*x,0);if(den<1e-12)continue;
      const ratio=-a[i].reduce((s,x,j)=>s+x*a[k][j],0)/den;
      if(ratio>0&&a[i].every((x,j)=>Math.abs(a[k][j]+ratio*x)<1e-9)){const d=Math.min(u[i],ratio*u[k]);u[i]-=d;u[k]-=d/ratio;}
    }
    this.last=u;this.desired=desired;this.residualNorm=Math.hypot(...residual);return u;
  }
}
