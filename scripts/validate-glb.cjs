#!/usr/bin/env node
// Optional diagnostic dependency: npm install --no-save gltf-validator
// NODE_PATH may point at an existing independent validator installation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const validator=require('gltf-validator');
(async()=>{
 const model=path.resolve(process.argv[2]||'public/models/model-y-performance-drive-ready.glb');
 const output=path.resolve(process.argv[3]||'reports/model-y-format-revalidation.json');
 const bytes=fs.readFileSync(model);
 const result=await validator.validateBytes(new Uint8Array(bytes),{uri:path.basename(model),maxIssues:0});
 const report={at:new Date().toISOString(),file:model,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),validatorVersion:validator.version(),passed:result.issues.numErrors===0&&result.issues.numWarnings===0,result};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,errors:result.issues.numErrors,warnings:result.issues.numWarnings,infos:result.issues.numInfos,output}));
 if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
