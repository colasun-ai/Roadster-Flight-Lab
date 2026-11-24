async page=>{
 const qa=()=>page.locator('#qa-data').evaluate(el=>JSON.parse(el.textContent));
 await page.waitForFunction(()=>JSON.parse(document.querySelector('#qa-data').textContent).ready);
 const base=await qa();
 let requestReceived;
 const requested=new Promise(resolve=>{requestReceived=resolve;});
 let unblock;const gate=new Promise(resolve=>{unblock=resolve;});
 const pattern='**/textures/fsd/studio-environment.bin';
 await page.route(pattern,async route=>{requestReceived();await gate;await route.fulfill({status:503,body:'QA test'});});
 await page.getByRole('button',{name:'进入 FSD 城市'}).click();
 await requested;const pending=await qa();
 unblock();const retry=page.getByRole('button',{name:'重试加载城市'}).filter({visible:true});
 await retry.waitFor({timeout:45000});
 await page.waitForFunction(base=>{const q=JSON.parse(document.querySelector('#qa-data').textContent);return !q.fsd.active&&q.lifecycle.worldBodies===base.bodies&&q.lifecycle.worldColliders===base.colliders;},{bodies:base.lifecycle.worldBodies,colliders:base.lifecycle.worldColliders},{timeout:12000});
 const rolledBack=await qa();await page.unroute(pattern);await retry.click();
 const exit=page.getByRole('button',{name:'返回试车场'});
 await exit.waitFor({timeout:45000});
 await page.getByRole('button',{name:'分屏视图'}).click();
 await exit.click();await page.getByRole('button',{name:'FSD 城市',exact:true}).click();
 await exit.waitFor({timeout:45000});await page.getByRole('button',{name:'分屏视图'}).waitFor();
 await page.getByRole('button',{name:'启用 FSD'}).click();
 await page.waitForFunction(()=>JSON.parse(document.querySelector('#qa-data').textContent).fsd.autopilot.rawPoints.length===16,null,{timeout:60000});
 const second=await qa();
 return {baseBodies:base.lifecycle.worldBodies,baseColliders:base.lifecycle.worldColliders,pendingActive:pending.fsd.active,
 afterFailureBodies:rolledBack.lifecycle.worldBodies,afterFailureColliders:rolledBack.lifecycle.worldColliders,
 resumed:second.fsd.autopilot.enabled,rawPoints:second.fsd.autopilot.rawPoints.length,traffic:second.fsd.traffic.length,split:second.fsd.split,appErrors:second.errors};
}
