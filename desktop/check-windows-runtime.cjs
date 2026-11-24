const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = function checkWindowsRuntime(context) {
  if (context.electronPlatformName !== 'win32') return;
  const root = path.join(context.packager.projectDir, 'fsd-runtime-win');
  const read = name => fs.readFileSync(path.join(root, name));
  const manifest = JSON.parse(read('runtime-manifest.json'));
  const python = read('python/python.exe');
  const pe = python.readUInt32LE(0x3c);
  if (manifest.platform !== 'win32-x64' || python.toString('ascii', pe, pe + 2) !== 'PE' || python.readUInt16LE(pe + 4) !== 0x8664)
    throw Error('Expected Windows x64 embedded CPython. Run python scripts/fsd/prepare_windows_runtime.py first.');
  for (const file of ['worker.py','planr1/tokens/tokens_1024.pt','python/msvcp140.dll','site-packages/torch/lib/torch_cpu.dll']) {
    if (!fs.statSync(path.join(root, file)).isFile()) throw Error('Missing runtime file: ' + file);
  }
  if (crypto.createHash('sha256').update(read('weights/fine-tuning.ckpt')).digest('hex') !== 'c5f590b3ae2b1bda0a684f3a826289c8b4336a9ce7424fea18be3f1bce0b9259')
    throw Error('Unexpected Plan-R1 checkpoint');
};
