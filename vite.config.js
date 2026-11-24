import {defineConfig} from 'vite';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url),{Planner}=require('./desktop/plan-r1.cjs');
const version=require('./package.json').version;
const badge='R / '+version.split('.').slice(1).join('.').padStart(4,'0');
export default defineConfig({define:{'import.meta.env.ROADSTER_VERSION':JSON.stringify(version)},plugins:[{
 name:'roadster-release-labels',
 transformIndexHtml:html=>html.replaceAll('__ROADSTER_VERSION__',version).replaceAll('__ROADSTER_BADGE__',badge)
},{name:'local-plan-r1-development',configureServer(server){
 const planner=new Planner(path.resolve(process.platform==='win32'?'fsd-runtime-win':'fsd-runtime'));server.httpServer?.on('close',()=>planner.stop());
 server.middlewares.use('/__plan-r1',async(req,res)=>{if(req.method!=='POST'){res.writeHead(405);res.end();return;}let body='';try{for await(const chunk of req){body+=chunk;if(body.length>2000000)throw Error('Request too large');}const result=await planner.predict(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}catch(error){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
 }}]});
