const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
class Planner{
 constructor(root){this.root=root;this.child=null;this.pending=new Map();this.startPromise=null;this.ready=false;this.logs=[];}
 start(){
  if(this.ready)return Promise.resolve();if(this.startPromise)return this.startPromise;
  this.startPromise=new Promise((resolve,reject)=>{
   const python=path.join(this.root,process.platform==='win32'?'python/python.exe':'python/bin/python3.10'),worker=path.join(this.root,'worker.py');
   if(!fs.existsSync(python)){reject(Error('内置 Plan-R1 运行环境缺失'));return;}
   this.child=spawn(python,['-X','utf8','-B','-u',worker],{windowsHide:true,cwd:this.root,env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:path.join(this.root,'site-packages'),OMP_NUM_THREADS:'1',VECLIB_MAXIMUM_THREADS:'1'},stdio:['pipe','pipe','pipe']});
   const workerProcess=this.child;let buffer='';const timeout=setTimeout(()=>{reject(Error('模型启动超时'));this.stop();},90000);
   this.child.stdout.on('data',chunk=>{buffer+=chunk;let split;while((split=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,split);buffer=buffer.slice(split+1);try{const value=JSON.parse(line);if(value.event==='ready'){clearTimeout(timeout);this.ready=true;resolve();}else{const pending=this.pending.get(value.requestId);if(pending){clearTimeout(pending.timeout);this.pending.delete(value.requestId);pending.resolve(value);}}}catch{this.logs.push(line);}}});
   this.child.stderr.on('data',chunk=>{this.logs.push(String(chunk));this.logs=this.logs.slice(-30);});
   const fail=error=>{clearTimeout(timeout);if(this.child&&this.child!==workerProcess){reject(error);return;}this.ready=false;this.startPromise=null;reject(error);for(const pending of this.pending.values()){clearTimeout(pending.timeout);pending.reject(error);}this.pending.clear();};
   this.child.on('error',fail);this.child.on('exit',code=>fail(Error('模型进程已停止 ('+code+')')));
  });return this.startPromise;
 }
 async predict(state){await this.start();if(this.pending.size)throw Error('模型繁忙');if(!state||!Number.isInteger(state.requestId)||!Array.isArray(state.lanes)||state.lanes.length>400||!Array.isArray(state.agents)||state.agents.length>20||JSON.stringify(state).length>2000000)throw Error('无效驾驶状态');
  return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.pending.delete(state.requestId);reject(Error('推理超时'));this.stop();},6000);this.pending.set(state.requestId,{resolve,reject,timeout});this.child.stdin.write(JSON.stringify(state)+'\n');});
 }
 stop(){this.child?.kill();this.child=null;this.ready=false;this.startPromise=null;}
}
module.exports={Planner};
