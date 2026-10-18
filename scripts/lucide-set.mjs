// Builds plugin/client/icon-set.ts: the curated Lucide icons Lienzo ships offline (ISC, see plugin/client/assets/lucide-LICENSE).
// Run from the repository root: node scripts/lucide-set.mjs. It reads the lucide-react package already installed for the
// desktop app; nothing is downloaded. Missing names are reported and skipped.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pnpm = join(root, 'node_modules/.pnpm');
const dir = readdirSync(pnpm).find(d => d.startsWith('lucide-react@'));
if (!dir) throw new Error('lucide-react is not installed; run pnpm install first.');
const pkg = join(pnpm, dir, 'node_modules/lucide-react');
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;

/** Category → icons, as `name` or `name:extra+search+words`. Order is the order shown. */
const CATEGORIES = {
  'Systems': 'server server-cog server-crash server-off database database-zap database-backup hard-drive hard-drive-download cpu memory-stick microchip cloud cloud-cog cloud-upload cloud-download cloud-off container:docker box:package boxes package layers:stack layers-2 network:topology router wifi wifi-off globe:web+internet earth radio-tower satellite satellite-dish cable plug unplug power zap:lambda+function+serverless gauge activity:monitoring+metrics terminal square-terminal code code-xml braces binary git-branch git-merge git-commit-horizontal git-pull-request git-fork git-compare webhook workflow:pipeline cog settings wrench bug puzzle:plugin+extension blocks component app-window:browser panels-top-left layout-dashboard monitor:desktop laptop smartphone:mobile phone tablet tv printer keyboard mouse watch headphones camera scan qr-code scan-barcode',
  'Data': 'file file-text file-code file-json file-spreadsheet files folder folder-open folder-tree folder-git-2 archive sheet table table-2 chart-bar chart-line chart-pie chart-area chart-scatter chart-network trending-up trending-down list list-tree list-checks list-ordered kanban filter search sliders-horizontal hash calendar clock timer hourglass history inbox mail send message-square message-circle messages-square bell rss link link-2 share-2 bookmark tag tags notebook-tabs',
  'People & places': 'user users user-round user-plus user-check user-cog contact id-card bot:agent+ai brain:ai+thinking hand thumbs-up thumbs-down smile heart star award graduation-cap briefcase building building-2:company+office factory store school hospital house:home landmark:bank+government warehouse hotel castle tent',
  'Security': 'lock lock-open lock-keyhole key key-round shield shield-check shield-alert shield-off shield-user fingerprint-pattern eye eye-off scan-face badge-check siren user-lock file-lock',
  'Flow': 'arrow-right arrow-left arrow-up arrow-down arrow-left-right arrow-up-down arrow-right-left arrow-up-right arrow-down-right move-right redo undo repeat refresh-cw rotate-cw shuffle split merge route signpost milestone corner-down-right chevron-right chevrons-right circle-arrow-right iteration-cw infinity waypoints spline share log-in log-out download upload import external-link git-graph',
  'Status & shapes': 'check circle-check x circle-x circle-alert triangle-alert info circle-help ban loader circle-dot circle square triangle diamond hexagon octagon pentagon star flag target crosshair lightbulb:idea sparkles flame rocket trophy plus minus equal percent badge thumbs-up',
  'Everyday': 'shopping-cart credit-card wallet banknote receipt dollar-sign euro coins truck:delivery plane car bike ship train-front map map-pin navigation compass sun moon cloud-rain snowflake leaf tree-pine mountain coffee pizza music video image mic phone-call book book-open notebook-pen pen pencil eraser scissors paperclip clipboard calendar-days gift umbrella palette brush hammer',
};

const known = new Set(readdirSync(join(pkg, 'dist/esm/icons')).filter(f => f.endsWith('.mjs')).map(f => f.slice(0, -4)));
const attr = (key, value) => `${key}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`;
const node = ([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => attr(k, v)).join(' ')}/>`;
function body(name) {
  const source = readFileSync(join(pkg, 'dist/esm/icons', name + '.mjs'), 'utf8');
  const alias = /export \{ default \} from '\.\/([\w-]+)\.mjs'/.exec(source);
  if (alias) return body(alias[1]);
  const literal = /const __iconData = (\{[\s\S]*?\n\});/.exec(source) ?? /const __iconNode = (\[[\s\S]*?\n\]);/.exec(source);
  if (!literal) throw new Error('Unreadable icon module: ' + name);
  const data = Function('"use strict"; return (' + literal[1] + ');')();
  return (Array.isArray(data) ? data : data.node).map(node).join('');
}
const seen = new Set(), rows = [], missing = [];
for (const [category, list] of Object.entries(CATEGORIES)) {
  for (const item of list.split(/\s+/).filter(Boolean)) {
    const [name, extra = ''] = item.split(':');
    if (seen.has(name)) continue;
    if (!known.has(name)) { missing.push(name); continue; }
    seen.add(name);
    rows.push([name, category, extra.replaceAll('+', ' ').trim(), body(name)]);
  }
}
const header = `// Generated by scripts/lucide-set.mjs from lucide-react ${version}. Do not edit by hand.
// Lucide, ISC licence (some icons MIT, from Feather): plugin/client/assets/lucide-LICENSE. No runtime network.
// Each row: [name, category, extra search words, inner SVG]. icon-library.ts wraps the inner SVG in Lucide's 24 × 24 frame.
export const LUCIDE_VERSION = ${JSON.stringify(version)};
export const LUCIDE_CATEGORIES = ${JSON.stringify(Object.keys(CATEGORIES))} as const;
export const LUCIDE_ICONS: readonly (readonly [string, string, string, string])[] = [\n`;
writeFileSync(join(root, 'plugin/client/icon-set.ts'), header + rows.map(r => '  ' + JSON.stringify(r) + ',').join('\n') + '\n];\n');
writeFileSync(join(root, 'plugin/client/assets/lucide-LICENSE'), readFileSync(join(pkg, 'LICENSE'), 'utf8'));
writeFileSync(join(root, 'plugin/client/assets/lucide-source.json'), JSON.stringify({ repository: 'https://github.com/lucide-icons/lucide', package: 'lucide-react', version, license: 'ISC', icons: rows.map(r => r[0]) }, null, 2) + '\n');
console.log(`${rows.length} icons written${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
