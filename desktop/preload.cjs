const {contextBridge,ipcRenderer}=require('electron');
const drivingOnly = process.platform === 'win32' && process.arch === 'ia32';
contextBridge.exposeInMainWorld('planR1', drivingOnly
  ? {available:false}
  : {available:true, predict:state=>ipcRenderer.invoke('plan-r1-predict',state)});
// Optional QA reporting remains a separate, bounded capability.
if(process.argv.includes('--roadster-audit-enabled'))contextBridge.exposeInMainWorld('roadsterAudit',{report:value=>ipcRenderer.send('roadster-audit',value)});

contextBridge.exposeInMainWorld('roadsterLanguage',{select:code=>ipcRenderer.send('roadster-language',code)});
