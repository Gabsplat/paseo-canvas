// Builds the installers for the platform it runs on, the way the release workflow does: signed and notarized when
// the signing secrets are in the environment, unsigned otherwise. Output goes to release/.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args, env = {}) => execFileSync(command, args, { cwd: app, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
const builder = (args, env) => run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'electron-builder', ...args, '--publish', 'never'], env);

run(process.execPath, ['scripts/bundle.mjs', '--production']);
if (process.platform === 'darwin') {
  run('tiffutil', ['-cathidpicheck', 'build/background.png', 'build/background@2x.png', '-out', 'build/background.tiff']);
  // A Developer ID certificate (CSC_LINK + CSC_KEY_PASSWORD) signs; the Apple ID trio notarizes. Without them: unsigned.
  const sign = !!process.env.CSC_LINK, notarize = sign && !!(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);
  builder(['--mac', 'dmg', 'zip', '--arm64', '--x64', ...(sign ? ['-c.mac.hardenedRuntime=true', `-c.mac.notarize=${notarize}`] : ['-c.mac.identity=null'])], sign ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
} else if (process.platform === 'win32') {
  // WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (a .pfx) sign; without them the installer is unsigned and SmartScreen warns.
  builder(['--win', 'nsis'], process.env.WIN_CSC_LINK ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
} else {
  builder(['--linux', 'AppImage', 'deb', '--x64']);
}
