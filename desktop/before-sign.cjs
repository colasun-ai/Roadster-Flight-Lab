const {spawnSync}=require('node:child_process');const path=require('node:path');const fs=require('node:fs');
module.exports=async context=>{
 if(context.electronPlatformName!=='darwin')return;
 const target=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app');
 // Remove only the two Finder metadata attributes forbidden by codesign from
 // the newly generated bundle; never remove quarantine or other attributes.
 for(const attribute of ['com.apple.FinderInfo','com.apple.ResourceFork']){
  const result=spawnSync('/usr/bin/xattr',['-dr',attribute,target],{encoding:'utf8'});
  if(result.error)throw result.error;
  const unexpected=(result.stderr||'').split('\n').filter(Boolean).filter(s=>!s.includes('No such xattr:'));
  if(result.status!==0&&unexpected.length)throw new Error(unexpected.join('\n'));
 }
 const runtime=path.join(target,'Contents','Resources','fsd-runtime');
 let signed=0;
 const sign=folder=>{if(!fs.existsSync(folder))return;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){sign(file);continue;}if(!entry.isFile())continue;const fd=fs.openSync(file,'r'),header=Buffer.alloc(4);fs.readSync(fd,header,0,4,0);fs.closeSync(fd);if(!['cffaedfe','cefaedfe','cafebabe','bebafeca'].includes(header.toString('hex')))continue;
  const result=spawnSync('/usr/bin/codesign',['--force','--sign','-','--options','runtime','--entitlements',path.join(context.packager.projectDir,'build-assets/entitlements.mac.plist'),file],{encoding:'utf8'});if(result.status!==0)throw Error('Embedded runtime signing failed: '+file+'\n'+result.stderr);signed++;}};
 sign(runtime);console.log('Signed embedded runtime Mach-O files:',signed);
 console.log('Checked build-bundle Finder metadata before local code signing.');
};
