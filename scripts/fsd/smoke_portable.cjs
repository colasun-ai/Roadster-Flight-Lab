// Exercise the packaged worker through the same Node bridge used by Electron.
const path = require('node:path');
const assert = require('node:assert/strict');
const {Planner} = require('../../desktop/plan-r1.cjs');
const fixture = require('../../reports/fsd/city-model-input-fixture.json');
const planner = new Planner(path.resolve(process.argv[2] || 'fsd-runtime-win'));
(async () => {
  try {
    const state = {...fixture, requestId: 1};
    const result = await planner.predict(state);
    assert.equal(result.model, 'official-plan-r1-fine-tuning', result.error);
    assert.equal(result.points.length, 16);
    assert.equal(result.tokens.length, 16);
    assert.equal(result.horizon, 8);
    result.points.forEach((p, i) => {
      assert.equal(p.t, (i + 1) * 0.5);
      assert.ok([p.x,p.z,p.yaw].every(Number.isFinite));
    });
    console.log(JSON.stringify({platform:process.platform,arch:process.arch,model:result.model,poses:result.points.length,inferenceMs:result.inferenceMs}));
  } catch (e) {
    console.error(e, planner.logs.join('\n')); process.exitCode = 1;
  } finally { planner.stop(); }
})();
