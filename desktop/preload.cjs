const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('planR1',{predict:state=>ipcRenderer.invoke('plan-r1-predict',state)});
// Optional QA reporting remains a separate, bounded capability.
if(process.argv.includes('--roadster-audit-enabled'))contextBridge.exposeInMainWorld('roadsterAudit',{report:value=>ipcRenderer.send('roadster-audit',value)});
