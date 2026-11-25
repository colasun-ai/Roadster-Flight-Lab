import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

if (process.platform !== 'darwin') throw Error('Build the Mac app on macOS.');
const arch = process.env.ROADSTER_MAC_ARCH || process.arch;
if (!['x64', 'arm64'].includes(arch) || arch !== process.arch) {
  throw Error('Use a native Mac build process for the requested architecture.');
}

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const output = path.join(root, 'desktop-build');
const archive = path.join(output, `Roadster-Flight-Lab-${pkg.version}-Mac-${arch}.zip`);
if (fs.existsSync(archive)) throw Error('Archive already exists: ' + archive);
const runtime = arch === 'x64' ? path.join(output, 'runtime-mac-x64') : path.join(root, 'fsd-runtime');
const slice = arch === 'x64' ? 'x86_64' : 'arm64';
function verifySlice(file) {
  execFileSync('lipo', [file, '-verify_arch', slice], {stdio: 'inherit'});
}
verifySlice(path.join(runtime, 'python/bin/python3.10'));
verifySlice(path.join(runtime, 'site-packages/torch/lib/libtorch_cpu.dylib'));

// Sign outside cloud-managed folders where Finder metadata can reappear.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'roadster-build-'));
const temporary = path.join(scratch, 'output.noindex');
const args = [path.join(root, 'node_modules/electron-builder/cli.js'), '--config',
  'electron-builder.config.cjs', '--mac', '--' + arch, '-c.directories.output=' + temporary];
if (process.env.ROADSTER_ELECTRON_DIST) args.push('-c.electronDist=' + process.env.ROADSTER_ELECTRON_DIST);
execFileSync(process.execPath, args, {
  cwd: root, stdio: 'inherit', env: {...process.env, ROADSTER_MAC_ARCH: arch}
});
const app = path.join(temporary, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Roadster Flight Lab.app');
verifySlice(path.join(app, 'Contents/MacOS/Roadster Flight Lab'));
execFileSync('codesign', ['--verify', '--deep', '--strict', app], {stdio: 'inherit'});
fs.mkdirSync(output, {recursive: true});
execFileSync('ditto', ['-c', '-k', '--keepParent', '--norsrc', '--qtn', app, archive], {stdio: 'inherit'});
fs.writeFileSync(path.join(output, 'mac-build-path.json'),
  JSON.stringify({arch, app, archive, adHocSigned: true, notarized: false}, null, 2));
console.log(archive);
