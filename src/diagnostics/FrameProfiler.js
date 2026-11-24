const percentile=(sorted,q)=>sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(q*sorted.length)-1))]??null;
const describe=values=>{if(!values.length)return {count:0,mean:null,p95:null,p99:null,max:null};const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p95:percentile(sorted,.95),p99:percentile(sorted,.99),max:sorted.at(-1)};};
// The same recorder is used before and after optimization. Frame times come
// from consecutive RAF timestamps; CPU submission is not labelled GPU time.
export class FrameProfiler {
 constructor(renderer){this.renderer=renderer;this.gl=renderer.getContext();this.ext=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');this.pending=[];this.active=null;this.results=[];this.query=null;}
 begin(label,metadata={}){if(this.active)throw Error('A profile is already recording');this.active={label,metadata,startedAt:new Date().toISOString(),start:performance.now(),frames:[],steps:[],gpu:[],heaps:[],calls:[],triangles:[],speeds:[],resourceStart:{...this.renderer.info.memory}};}
 physics(ms){if(this.active)this.active.steps.push(ms);}
 renderBegin(){if(!this.ext||this.pending.length>=6||!this.active)return;this.query=this.gl.createQuery();this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT,this.query);}
 renderEnd(){if(this.query){this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.pending.push({query:this.query,owner:this.active});this.query=null;}}
 frame(dt,cpuMs,vehicle){
  if(this.ext){const disjoint=this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);for(let i=this.pending.length-1;i>=0;i--){const item=this.pending[i];if(!this.gl.getQueryParameter(item.query,this.gl.QUERY_RESULT_AVAILABLE))continue;if(!disjoint)item.owner?.gpu.push(this.gl.getQueryParameter(item.query,this.gl.QUERY_RESULT)/1e6);this.gl.deleteQuery(item.query);this.pending.splice(i,1);}}
  const s=this.active;if(!s)return;s.frames.push([dt,cpuMs]);s.calls.push(this.renderer.info.render.calls);s.triangles.push(this.renderer.info.render.triangles);s.speeds.push(Math.abs(vehicle.forwardSpeed())*3.6);if(performance.memory)s.heaps.push(performance.memory.usedJSHeapSize);
 }
 end(){const s=this.active;if(!s)return null;this.active=null;const times=s.frames.map(f=>f[0]),sorted=[...times].sort((a,b)=>b-a),slow=sorted.slice(0,Math.max(1,Math.ceil(sorted.length*.01))),total=times.reduce((a,b)=>a+b,0);
  const result={label:s.label,...s.metadata,startedAt:s.startedAt,wallSeconds:(performance.now()-s.start)/1000,frames:times.length,averageFps:times.length*1000/total,onePercentLowFps:1000/(slow.reduce((a,b)=>a+b,0)/slow.length),frameMs:describe(times),cpuFrameMs:describe(s.frames.map(f=>f[1])),physicsStepMs:describe(s.steps),gpuRenderMs:this.ext?describe(s.gpu):null,gpuUnavailableReason:this.ext?null:'EXT_disjoint_timer_query_webgl2 unavailable',heapBytes:describe(s.heaps),drawCalls:describe(s.calls),triangles:describe(s.triangles),speedKmh:describe(s.speeds),resourceStart:s.resourceStart,resourceEnd:{...this.renderer.info.memory,programs:this.renderer.info.programs?.length},renderSize:[this.renderer.domElement.width,this.renderer.domElement.height],vramBytes:null,vramUnavailableReason:'WebGL does not expose reliable VRAM usage',rawFrameMs:times,rawCpuFrameMs:s.frames.map(f=>f[1]),rawPhysicsStepMs:s.steps};this.results.push(result);return result;
 }
 summary(){return this.results.map(({rawFrameMs,rawCpuFrameMs,rawPhysicsStepMs,...r})=>r);}
}
