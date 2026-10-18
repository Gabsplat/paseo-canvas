// Builds the installers for the platform it runs on, the way the release workflow does: signed and notarized when
// the signing secrets are in the environment, unsigned otherwise. Output goes to release/, with the update feed
// files the app reads (latest.yml, latest-mac.yml or latest-linux.yml, and .blockmap files where the format has them).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump, load } from 'js-yaml';

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
  // One installer per architecture: a combined one would carry both and be twice the size. Each run writes its own
  // latest.yml, so the files of both are merged into one; electron-updater picks the .exe whose name has its arch.
  const runs = [];
  for (const arch of ['--x64', '--arm64']) {
    builder(['--win', 'nsis', arch], process.env.WIN_CSC_LINK ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
    runs.push(load(readFileSync(join(app, 'release', 'latest.yml'), 'utf8')));
  }
  const merged = { ...runs[0], files: runs.flatMap(run => run.files) };
  writeFileSync(join(app, 'release', 'latest.yml'), dump(merged, { lineWidth: -1 }));
} else {
  // LIENZO_LINUX_TARGETS=AppImage builds only the AppImage (the .deb needs fpm's bundled Ruby, which wants
  // libcrypt.so.1, missing on some distributions). The release workflow builds both.
  builder(['--linux', ...(process.env.LIENZO_LINUX_TARGETS?.split(/[\s,]+/).filter(Boolean) ?? ['AppImage', 'deb']), '--x64']);
}

// The app updates from these files: a release without them would leave everyone on this version.
const feed = { darwin: 'latest-mac.yml', win32: 'latest.yml' }[process.platform] ?? 'latest-linux.yml';
if (!existsSync(join(app, 'release', feed))) throw new Error(`electron-builder did not write release/${feed}; check the publish setting in electron-builder.yml.`);
const info = load(readFileSync(join(app, 'release', feed), 'utf8'));
const version = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version;
if (info.version !== version) throw new Error(`release/${feed} is for ${info.version}, not ${version}.`);
console.log(`Update feed release/${feed}: version ${info.version}, ${info.files.map(file => file.url).join(', ')}`);
console.log(`Block maps: ${readdirSync(join(app, 'release')).filter(name => name.endsWith('.blockmap')).join(', ') || 'none (an AppImage carries its block map inside)'}`);
