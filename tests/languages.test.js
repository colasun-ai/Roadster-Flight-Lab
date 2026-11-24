import assert from 'node:assert/strict';
import fs from 'node:fs';
import {languages, locale, supported, translator} from '../src/i18n/index.js';

const catalog = lang => JSON.parse(fs.readFileSync(new URL('../src/i18n/catalogs/'+lang+'.json',import.meta.url),'utf8'));
const english = catalog('en');
assert.equal(locale,'en');
assert.equal(supported('invalid'),'en');
assert.equal(Object.keys(languages).length,8);
for (const code of Object.keys(languages)) {
  const t = translator(code);
  assert.equal(t('120 Hz'), '120 Hz');
  assert.equal(t(35), 35);
  assert.ok(t('开始驾驶'));
  assert.ok(t('目的地距离 217 m · 32 辆交通车').includes('217'));
  assert.ok(t('目的地距离 217 m · 32 辆交通车').includes('32'));
  if(code==='zh-CN') continue;
  const table = catalog(code);
  assert.deepEqual(Object.keys(table).sort(),Object.keys(english).sort());
  for (const [key,value] of Object.entries(table)) {
    assert.ok(value.trim().length,code+' '+key);
    assert.deepEqual((key.match(/\{\d+\}/g)||[]).sort(),(value.match(/\{\d+\}/g)||[]).sort(),code+' '+key);
  }
}
console.log('Eight languages, English default, identical catalog coverage and intact telemetry fields.');
