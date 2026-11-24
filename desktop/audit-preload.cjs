const {contextBridge,ipcRenderer}=require('electron');
// Explicit opt-in QA build path. No filesystem, generic IPC or Node API is
// exposed to the sandboxed renderer; only bounded telemetry can be submitted.
let last=0;
contextBridge.exposeInMainWorld('roadsterAudit',{report(value){
 const now=Date.now();if(now-last<500)return;last=now;
 if(value&&typeof value==='object'&&JSON.stringify(value).length<2000000)ipcRenderer.send('roadster-audit',value);
}});
