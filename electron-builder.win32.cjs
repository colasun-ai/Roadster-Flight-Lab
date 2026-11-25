// Electron 43 is the last series with a 32-bit Windows binary.
const full = require('./electron-builder.config.cjs');
module.exports = {
  ...full,
  electronVersion: '43.8.13',
  win: {...full.win, extraResources: [], target: [{target: 'portable', arch: ['ia32']}]},
  portable: {...full.portable, artifactName: 'Roadster-Flight-Lab-${version}-Windows-x86-Driving.exe'},
  beforePack(context) {
    if (context.electronPlatformName !== 'win32' || context.arch !== require('builder-util').Arch.ia32) {
      throw Error('This configuration builds the 32-bit Windows driving edition only.');
    }
  }
};
