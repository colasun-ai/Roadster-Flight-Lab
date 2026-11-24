import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'reports/fsd/release-tests');
const cases=[
 ['straight-raw','straight',12,35,true,20261122],
 ['straight-protected','straight',12,35,false,20261122],
 ['left','left',0,35],['right','right',0,35],
 ['front-brake','front-brake',1,25],['cut-in','cut-in',1,25],
 ['overtake-raw','overtake',1,25,true],['unprotected-left','unprotected-left',1,25],
 ['model-y-unseen','straight',20,25,false,902384,'model-y-performance-2026'],
 ['roadster-unseen','straight',10,25,false,713299,'roadster'],
];
await fs.mkdir(output,{recursive:true});const records=[];
for(const [name,scenario,traffic,seconds,raw=false,seed=20261122,vehicle='model3-performance-2018'] of cases){
 const directory=path.join(output,name);await fs.mkdir(directory,{recursive:true});
 const env={...process.env,FSD_TEST_OUTPUT:directory,FSD_TEST_SCENARIO:scenario,FSD_TEST_TRAFFIC:String(traffic),FSD_TEST_SECONDS:String(seconds),FSD_TEST_RAW:raw?'1':'0',FSD_TEST_SEED:String(seed),FSD_TEST_VEHICLE:vehicle};
 const log=await fs.open(path.join(directory,'run.log'),'w');
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/fsd/closed_loop.mjs'],{cwd:root,env,stdio:['ignore',log.fd,log.fd]});child.on('error',reject);child.on('exit',resolve);});await log.close();
 if(code!==0)throw Error(`${name} failed; see run.log`);
 const file=`closed-loop-${scenario}-${raw?'raw':'protected'}-${traffic}.json`,result=JSON.parse(await fs.readFile(path.join(directory,file),'utf8'))[0];
 records.push({case:name,...result});await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(records,null,2));
 console.log(JSON.stringify({case:name,collisions:result.collisionSamples,redStopLineCrossings:result.redStopLineCrossings,status:result.lastStatus,overtaking:result.overtaking??null}));
}
