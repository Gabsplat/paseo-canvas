import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeSvg } from '../plugin/shared/svg';
import { interfacePreferences } from '../plugin/shared/preferences';
import {
  ICONIFY_PAGE, ICONIFY_SETS, ICON_CATEGORIES, ICON_PAGE, iconLabel, iconifySearchUrl, iconifySvgs, insertMeta, offlineIcon, offlineIcons, parseIconifySearch,
  recentEntries, rememberIcon, searchIconify, searchIcons, visibleIcons, type FetchLike,
} from '../plugin/client/icon-library';

test('the offline set: a few hundred Lucide icons, every one in a category and accepted by the static SVG dialect', () => {
  const all = offlineIcons();
  assert.ok(all.length >= 250, `${all.length} icons`);
  assert.equal(new Set(all.map(e => e.id)).size, all.length, 'unique ids');
  for (const entry of all) {
    assert.ok(ICON_CATEGORIES.includes(entry.category as never), entry.id);
    assert.equal(sanitizeSvg(entry.svg).viewBox.join(' '), '0 0 24 24', entry.id);
    assert.equal(entry.license, 'ISC · Lucide'); assert.equal(entry.source, entry.id); assert.equal(entry.online, false);
  }
  for (const category of ICON_CATEGORIES) assert.ok(all.some(e => e.category === category), category);
  const source = JSON.parse(readFileSync(join(__dirname, '../plugin/client/assets/lucide-source.json'), 'utf8'));
  assert.equal(source.license, 'ISC'); assert.equal(source.icons.length, all.length);
  assert.match(readFileSync(join(__dirname, '../plugin/client/assets/lucide-LICENSE'), 'utf8'), /ISC License/);
});

test('search: every word must start a word of the name, keywords or category; name matches first', () => {
  const all = offlineIcons();
  assert.equal(searchIcons(all, 'database')[0].id, 'lucide:database');
  assert.equal(searchIcons(all, 'DATA')[0].name.startsWith('database'), true);
  assert.ok(searchIcons(all, 'docker').some(e => e.id === 'lucide:container'), 'extra keywords');
  assert.ok(searchIcons(all, 'agent').some(e => e.id === 'lucide:bot'));
  assert.deepEqual(searchIcons(all, 'cloud upload').map(e => e.id), ['lucide:cloud-upload']);
  assert.deepEqual(searchIcons(all, 'zzzz'), []);
  assert.ok(searchIcons(all, '', 'Security').every(e => e.category === 'Security'));
  assert.ok(searchIcons(all, 'lock', 'Security').length >= 2);
  assert.equal(searchIcons(all, '').length, all.length);
  assert.equal(iconLabel('git-pull-request'), 'Git pull request'); assert.equal(iconLabel('layers-2'), 'Layers');
});

test('optimised arcs with touching flags are read, and bad flags still refused', () => {
  assert.doesNotThrow(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M18 12a6 6 0 00-6-6a.5.5 0 01.471.666"/></svg>'));
  assert.throws(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M18 12a6 6 0 2 0-6-6"/></svg>'), /arc/);
});

test('the grid is paged', () => {
  const list = Array.from({ length: 300 }, (_, i) => i);
  assert.equal(visibleIcons(list, 1).length, ICON_PAGE); assert.equal(visibleIcons(list, 2).length, 2 * ICON_PAGE); assert.equal(visibleIcons(list, 9).length, 300);
});

test('inserting carries the set and licence on the block', () => {
  assert.deepEqual(insertMeta(offlineIcon('lucide:server')!), { caption: 'Server', source: 'lucide:server', license: 'ISC · Lucide' });
});

test('recent icons: newest first, no duplicates, at most 16, offline ones by id, online ones with their SVG', () => {
  const all = offlineIcons();
  let list = rememberIcon([], all[0]); list = rememberIcon(list, all[1]); list = rememberIcon(list, all[0]);
  assert.deepEqual(list, [{ id: all[0].id, label: all[0].label }, { id: all[1].id, label: all[1].label }]);
  for (const entry of all.slice(0, 30)) list = rememberIcon(list, entry);
  assert.equal(list.length, 16); assert.equal(list[0].id, all[29].id);
  const online = { ...all[2], id: 'iconify:logos:postgresql', source: 'iconify:logos:postgresql', license: 'CC0-1.0 · SVG Logos', set: 'SVG Logos', online: true };
  list = rememberIcon(list, online);
  assert.deepEqual(list[0], { id: online.id, label: online.label, svg: online.svg, source: online.source, license: online.license });
  assert.equal(rememberIcon([], { ...online, svg: '<svg>' + 'x'.repeat(5000) }).length, 0, 'too large to keep');
  // Stored lists come back as entries; unknown or unsafe ones are dropped.
  const back = recentEntries([...list.slice(0, 2), { id: 'iconify:x:bad', label: 'Bad', svg: '<svg><script/></svg>' }, { id: 'lucide:nope', label: 'Gone' }]);
  assert.deepEqual(back.map(e => e.id), ['iconify:logos:postgresql', all[29].id]);
  assert.equal(back[0].online, true); assert.equal(back[0].set, 'SVG Logos');
  // The settings schema accepts what is stored.
  assert.ok(interfacePreferences.schema.safeParse({ pinned: [], shortcuts: {}, recentIcons: list }).success);
  assert.deepEqual(interfacePreferences.schema.parse({}).recentIcons, []);
});

test('Iconify search URL: open-licence sets only, windowed paging, at least two letters', () => {
  assert.equal(iconifySearchUrl('a'), null);
  const url = new URL(iconifySearchUrl(' kubernetes ', 2)!);
  assert.equal(url.origin + url.pathname, 'https://api.iconify.design/search');
  assert.equal(url.searchParams.get('query'), 'kubernetes');
  assert.equal(url.searchParams.get('start'), String(2 * ICONIFY_PAGE)); assert.equal(url.searchParams.get('limit'), String(3 * ICONIFY_PAGE));
  assert.deepEqual(url.searchParams.get('prefixes')!.split(','), Object.keys(ICONIFY_SETS));
  for (const set of Object.values(ICONIFY_SETS)) assert.match(set.license, /^(MIT|ISC|Apache-2\.0|CC0-1\.0)$/);
});

test('Iconify answers are parsed defensively and licences are put in words', () => {
  const parsed = parseIconifySearch({ icons: ['logos:postgresql', 'mdi:home', 'evil:thing', 'mdi:../x', 'mdi', 3], collections: { logos: { name: 'SVG Logos', author: { name: 'Gil Barbara' }, license: { title: 'CC0', spdx: 'CC0-1.0' } } } });
  assert.deepEqual(parsed.hits, [
    { prefix: 'logos', name: 'postgresql', set: 'SVG Logos', license: 'CC0-1.0 · SVG Logos (Gil Barbara)' },
    { prefix: 'mdi', name: 'home', set: 'Material Design Icons', license: 'Apache-2.0 · Material Design Icons' },
  ]);
  assert.equal(parsed.more, false);
  assert.throws(() => parseIconifySearch({ nope: 1 }), /unexpected/);
  // Icon bodies become static SVG in their own frame; aliases resolve; animated ones are left out.
  const svgs = iconifySvgs({ prefix: 'x', width: 24, height: 24, icons: { a: { body: '<path d="M0 0h24v24H0z" fill="currentColor"/>' }, wide: { body: '<rect width="32" height="16"/>', width: 32, height: 16 }, anim: { body: '<circle r="4"><animate attributeName="r"/></circle>' } }, aliases: { b: { parent: 'a' } } }, ['a', 'b', 'wide', 'anim', 'missing']);
  assert.deepEqual([...svgs.keys()], ['a', 'b', 'wide']);
  assert.deepEqual(sanitizeSvg(svgs.get('wide')!).viewBox, [0, 0, 32, 16]);
});

test('online search: one search request, then one request per set; a set that fails stays out', async () => {
  const urls: string[] = [];
  const fetcher: FetchLike = async url => {
    urls.push(url);
    const json = url.includes('/search') ? { icons: ['logos:kubernetes', 'mdi:kubernetes', 'tabler:brand-kubernetes'], collections: {} }
      : url.includes('/logos.json') ? { width: 256, height: 249, icons: { kubernetes: { body: '<path fill="#326CE5" d="M0 0h10v10H0z"/>' } } }
      : url.includes('/tabler.json') ? { width: 24, height: 24, icons: { 'brand-kubernetes': { body: '<path d="M1 1h2" stroke="currentColor"/>' } } } : null;
    return json ? { ok: true, json: async () => json } : { ok: false, status: 500, json: async () => ({}) };
  };
  const result = await searchIconify('kubernetes', 0, fetcher);
  assert.deepEqual(result.entries.map(e => e.id), ['iconify:logos:kubernetes', 'iconify:tabler:brand-kubernetes']);
  assert.equal(result.entries[0].license, 'CC0-1.0 · SVG Logos'); assert.equal(result.entries[0].label, 'Kubernetes'); assert.equal(result.entries[0].online, true);
  assert.equal(urls.length, 4); assert.ok(urls.slice(1).every(u => /^https:\/\/api\.iconify\.design\/[a-z-]+\.json\?icons=/.test(u)));
  assert.deepEqual(await searchIconify('k', 0, fetcher), { entries: [], more: false });
  await assert.rejects(searchIconify('kubernetes', 0, async () => ({ ok: false, status: 503, json: async () => ({}) })), /503/);
  await assert.rejects(searchIconify('kubernetes', 0, null), /reach the internet/);
});
