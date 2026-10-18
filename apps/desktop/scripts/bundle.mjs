// Bundles the desktop app with esbuild: main process, preload, browser preview server and the renderer.
// The renderer is the plugin's panel under react-native-web, with plugin/client/host swapped for the desktop host.
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginHost = resolve(app, '../../plugin/client/host');
const desktopHost = join(app, 'src/renderer/host.tsx');
const production = process.argv.includes('--production');
const require = createRequire(join(app, 'package.json'));
const out = join(app, 'dist');

/** One copy of React and react-native-web for the panel and the shell, resolved from this app. */
const renderer = {
  name: 'lienzo-renderer',
  setup(b) {
    const packages = { 'react-native': 'react-native-web' };
    b.onResolve({ filter: /^(react|react-dom|react-native)(\/.*)?$/ }, args => {
      const [, name, rest = ''] = args.path.match(/^(react|react-dom|react-native)(\/.*)?$/);
      return { path: require.resolve((packages[name] ?? name) + rest) };
    });
    b.onResolve({ filter: /(^|\/)host$/ }, args => resolve(args.resolveDir, args.path) === pluginHost ? { path: desktopHost } : undefined);
  },
};

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'renderer'), { recursive: true });
const common = { bundle: true, minify: production, sourcemap: production ? false : 'linked', logLevel: 'warning', legalComments: 'none' };
const node = { ...common, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] };
await Promise.all([
  build({ ...node, entryPoints: [join(app, 'src/main/main.ts')], outfile: join(out, 'main.cjs') }),
  build({ ...node, entryPoints: [join(app, 'src/main/preload.ts')], outfile: join(out, 'preload.cjs') }),
  build({ ...node, entryPoints: [join(app, 'src/main/preview.ts')], outfile: join(out, 'preview.cjs') }),
  build({
    ...common, entryPoints: [join(app, 'src/renderer/main.tsx')], outfile: join(out, 'renderer/renderer.js'),
    platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic', plugins: [renderer],
    define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"', __DEV__: String(!production), global: 'globalThis' },
  }),
]);
await copyFile(join(app, 'src/renderer/index.html'), join(out, 'renderer/index.html'));
console.log(`Bundled into ${out}${production ? ' (production)' : ''}`);
