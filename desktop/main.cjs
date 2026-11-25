const {app,BrowserWindow,protocol,session,Menu,dialog,screen,ipcMain}=require('electron');
const path=require('node:path');const fs=require('node:fs/promises');
app.setName('Roadster Flight Lab');
// Keep the preserved v0.5.1 app's data and single-instance lock independent.
app.setPath('userData',path.join(app.getPath('appData'),'Roadster Flight Lab FSD V14'));
const auditArg=process.argv.find(a=>a.startsWith('--audit-output='));
const auditFile=auditArg?path.resolve(auditArg.slice('--audit-output='.length)):null;
const auditMode=process.argv.find(a=>a.startsWith('--audit-mode='))?.split('=')[1]||'fsd';
if(auditFile)app.setPath('userData',path.join(app.getPath('temp'),'roadster-metro-native-audit.noindex'));
const auditStarted=Date.now();let auditWrites=Promise.resolve(),captureStarted=false;
function appendAudit(value){if(auditFile)auditWrites=auditWrites.then(()=>fs.appendFile(auditFile,JSON.stringify(value)+'\n')).catch(error=>console.error('Audit output:',error.message));}
if(auditFile){ipcMain.on('roadster-audit', (event,value)=>{
 if(!win||win.isDestroyed()||event.sender!==win.webContents||!event.senderFrame?.url.startsWith('roadster://app/')||!value||typeof value!=='object')return;
 const text=JSON.stringify(value);if(text.length>2000000)return;
 if((auditMode==='slope-park'&&['slopes-picker','slopes-A5-climb','slopes-D5-climb'].includes(value.event))||(auditMode==='garage-view'&&value.event==='garage-city-return')||(['metropolis','highway-stability'].includes(auditMode)&&['metropolis-map','metropolis-drive'].includes(value.event))||(auditMode==='bumper-preview'&&['nose-straight','nose-turn'].includes(value.event))){
  win.webContents.capturePage().then(frame=>fs.writeFile(auditFile+'.'+value.event+'.jpg',frame.toJPEG(90))).catch(error=>appendAudit({event:'capture-error',message:error.message}));
 }
 if(!captureStarted&&((auditMode==='recovery-map'&&value.event==='map-pin-selected')||(auditMode==='metro-tunnel'&&Date.now()-auditStarted>16000&&value.fsd?.autopilot?.rawPoints?.length===16&&value.fsd.autopilot.enabled))){
  captureStarted=true;
  win.webContents.capturePage().then(frame=>fs.writeFile(auditFile+'.jpg',frame.toJPEG(88)))
    .catch(error=>appendAudit({event:'capture-error',message:error.message}));
 }
 appendAudit({receivedAt:Date.now(),elapsedWallSeconds:(Date.now()-auditStarted)/1000,version:app.getVersion(),arch:process.arch,processes:app.getAppMetrics().map(p=>({type:p.type,pid:p.pid,cpu:p.cpu,memory:p.memory})),sample:value});
});}

protocol.registerSchemesAsPrivileged([{scheme:'roadster',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const ORIGIN='roadster://app';const ROOT=path.join(__dirname,'..','dist');
const CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.glb':'model/gltf-binary','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.wasm':'application/wasm'};
async function serve(request){
 try{
  const url=new URL(request.url);if(url.host!=='app'||!['GET','HEAD'].includes(request.method))return new Response('Forbidden',{status:403});
  const pathname=decodeURIComponent(url.pathname),file=path.resolve(ROOT,'.'+(pathname==='/'?'/index.html':pathname)),relative=path.relative(ROOT,file);
  if(relative.startsWith('..')||path.isAbsolute(relative))return new Response('Forbidden',{status:403});
  if(!(relative==='index.html'||relative==='favicon.svg'||relative.startsWith('assets'+path.sep)||relative.startsWith('models'+path.sep)||relative.startsWith('textures'+path.sep)))return new Response('Not found',{status:404});
  const bytes=await fs.readFile(file);return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('Not found',{status:404});}
}
const {Planner}=require('./plan-r1.cjs');
const drivingOnly=process.platform==='win32'&&process.arch==='ia32';
const planner=drivingOnly?null:new Planner(app.isPackaged?path.join(process.resourcesPath,'fsd-runtime'):path.join(__dirname,'..',process.platform==='win32'?'fsd-runtime-win':'fsd-runtime'));
if(planner)ipcMain.handle('plan-r1-predict',(event,state)=>{if(!win||event.sender!==win.webContents||!event.senderFrame?.url.startsWith('roadster://app/'))throw Error('Untrusted planner request');return planner.predict(state);});
app.on('before-quit',()=>planner?.stop());
let win;
let language='en';
function nativeText(text) {
 if(language==='zh-CN') return text;
 return require('../src/i18n/catalogs/'+language+'.json')[text] ?? text;
}
ipcMain.on('roadster-language',(event,code)=>{
 if(!win || event.sender!==win.webContents || !event.senderFrame?.url.startsWith('roadster://app/')) return;
 if(!['en','zh-CN','zh-TW','ja','ko','de','fr','es','pt-BR'].includes(code) || code===language) return;
 language=code;updateMenu();
});
function updateMenu(){
 const template=[...(process.platform==='darwin'?[{label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]}]:[]),{label:nativeText('游戏'),submenu:[{label:nativeText('重新载入场景'),accelerator:'CmdOrCtrl+Shift+R',click:()=>{if(win&&!win.isDestroyed())win.webContents.reload();}},{role:'togglefullscreen',label:nativeText('全屏')},{type:'separator'},process.platform==='darwin'?{role:'close',label:nativeText('关闭窗口')}:{role:'quit',label:nativeText('退出')}]},{label:nativeText('帮助'),submenu:[{label:nativeText('操作与版本'),click:()=>dialog.showMessageBox(win,{type:'info',title:app.name,message:'Roadster Flight Lab '+app.getVersion(),detail:nativeText('WASD 驾驶 · Esc 车库 · Model 3：L 车灯 / T 驾驶模式 · Roadster：Shift 后喷 · J/K 升降 · 方向键翻滚 · H 悬浮 · T 模式 · R 重置 · C 相机。\n始终自动补气可在飞行控制中关闭。标准画质适合集成显卡。\n本模拟器的推进和补气参数均为工程假设，并非 Tesla 官方规格。')})}]}];
 Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function createWindow(){
 const area=screen.getPrimaryDisplay().workAreaSize;
 win=new BrowserWindow({width:Math.min(1440,area.width),height:Math.min(900,area.height),minWidth:Math.min(1024,area.width),minHeight:Math.min(680,area.height),title:'Roadster Flight Lab',backgroundColor:'#b9cbd4',show:false,icon:path.join(__dirname,'..','build-assets','icon.png'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false,backgroundThrottling:false,preload:path.join(__dirname,'preload.cjs'),additionalArguments:auditFile?['--roadster-audit-enabled']:[]}});
 win.once('ready-to-show',()=>win?.show());
 win.on('closed',()=>{win=null;});
 if(auditFile)win.webContents.on('console-message',details=>appendAudit({event:'renderer-console',at:Date.now(),level:details.level,message:details.message,sourceId:details.sourceId,lineNumber:details.lineNumber}));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(e,url)=>{const target=new URL(url);if(target.protocol!=='roadster:'||target.hostname!=='app')e.preventDefault();});
 win.webContents.on('render-process-gone',(_e,details)=>{if(details.reason!=='clean-exit')dialog.showErrorBox(nativeText('场景停止运行'),nativeText('请关闭应用后重新打开。原因：')+details.reason);});
 win.loadURL(ORIGIN+'/'+(auditFile?'?native-audit=1&audit-mode='+encodeURIComponent(auditMode)+(['garage-view','driving-edition'].includes(auditMode)?'':'&fixed-render=1920x1080')+(auditMode==='profile-before'?'&render-baseline=1':''):''));
 updateMenu();
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.focus();}});
 app.whenReady().then(()=>{protocol.handle('roadster',serve);
  session.defaultSession.on('will-download',(_event,item,contents)=>{
   if(!win||contents!==win.webContents||!item.getURL().startsWith('blob:roadster://app/'))return;
   const photo=item.getMimeType()==='image/png';
   item.setSaveDialogOptions({title:photo?'保存场景照片':'保存驾驶记录',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()||(photo?'Roadster-FSD.png':'fsd-driving-record.json')))});
  });
  if(auditFile)session.defaultSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{const external=/^https?:|^wss?:|^ftp:/.test(details.url);appendAudit({event:'network-request',at:Date.now(),url:details.url,externalBlocked:external});callback({cancel:external});});session.defaultSession.setPermissionRequestHandler((_c,_p,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);createWindow();});
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
}

if(auditFile)app.on('before-quit',()=>appendAudit({event:'app-before-quit',at:Date.now(),elapsedWallSeconds:(Date.now()-auditStarted)/1000}));
