import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{execFileSync}from 'node:child_process';
if(process.platform!=='darwin')throw Error('Build the Mac app on macOS.');
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'roadster-build-'))+'.noindex';
fs.mkdirSync(temporary,{recursive:true});
// Keep signing outside cloud-managed Documents folders, where synthesized
// FinderInfo can reappear after removal and cause codesign to reject helpers.
const builderArgs=[path.join(root,'node_modules/electron-builder/cli.js'),'--config','electron-builder.config.cjs','--mac','--arm64','-c.directories.output='+temporary];
if(process.env.ROADSTER_ELECTRON_DIST)builderArgs.push('-c.electronDist='+process.env.ROADSTER_ELECTRON_DIST);
execFileSync(process.execPath,builderArgs,{cwd:root,stdio:'inherit'});
const app=path.join(temporary,'mac-arm64','Roadster Flight Lab.app');execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
const output=path.join(root,'desktop-build');fs.mkdirSync(output,{recursive:true});const archive=path.join(output,`Roadster-Flight-Lab-${pkg.version}-Mac-arm64.zip`);
if(fs.existsSync(archive))throw Error('Archive already exists; preserve it or choose a new version before rebuilding: '+archive);
execFileSync('ditto',['-c','-k','--keepParent','--norsrc','--qtn',app,archive],{stdio:'inherit'});fs.writeFileSync(path.join(output,'mac-build-path.json'),JSON.stringify({app,archive,adHocSigned:true,notarized:false},null,2));console.log(archive);
