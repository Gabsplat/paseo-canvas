import test from 'node:test';
import assert from 'node:assert/strict';
import { fileTreeDataSchema, fileTreeRows, visibleFileTreeRows } from '../plugin/shared/renderers/file-tree';
import { getRendererSpec } from '../plugin/shared/renderers';
import { setup, mutation } from './helpers';

const data = () => fileTreeDataSchema.parse({ root: 'brain/', entries: [
  { path: 'lib/', note: 'toda la lógica' }, { path: 'lib/db.mjs', highlight: true }, { path: 'bin/brain.mjs', note: 'comandos' },
  { path: 'node_modules/', muted: true }, { path: 'node_modules/zod/index.js' }, { path: 'README.md' },
], collapsed: ['node_modules/'] });

test('file tree rows keep authored order, imply parents and pass muting down', () => {
  const rows = fileTreeRows(data());
  assert.deepEqual(rows.map(r => `${'  '.repeat(r.depth)}${r.name}${r.dir ? '/' : ''}`), ['lib/', '  db.mjs', 'bin/', '  brain.mjs', 'node_modules/', '  zod/', '    index.js', 'README.md']);
  const by = (path: string) => rows.find(r => r.path === path)!;
  assert.equal(by('bin').dir, true); assert.equal(by('bin').children, 1); assert.equal(by('lib').note, 'toda la lógica');
  assert.equal(by('lib/db.mjs').highlight, true); assert.equal(by('node_modules/zod/index.js').muted, true); assert.equal(by('README.md').muted, false);
});
test('closed directories hide everything beneath them and nothing else', () => {
  const rows = fileTreeRows(data());
  assert.deepEqual(visibleFileTreeRows(rows, new Set(['node_modules'])).map(r => r.path), ['lib', 'lib/db.mjs', 'bin', 'bin/brain.mjs', 'node_modules', 'README.md']);
  assert.deepEqual(visibleFileTreeRows(rows, new Set(['lib', 'bin', 'node_modules/zod'])).map(r => r.path), ['lib', 'bin', 'node_modules', 'node_modules/zod', 'README.md']);
});
test('file tree data rejects absolute, parent-relative, duplicate and too-deep paths', () => {
  for (const path of ['/etc/passwd', '../secret', 'a//b', 'a/./b', 'a/b/c/d/e/f/g/h/i']) assert.equal(fileTreeDataSchema.safeParse({ entries: [{ path }] }).success, false, path);
  assert.equal(fileTreeDataSchema.safeParse({ entries: [{ path: 'src/' }, { path: 'src' }] }).success, false);
  assert.equal(fileTreeDataSchema.safeParse({ entries: [] }).success, false);
  assert.equal(fileTreeDataSchema.safeParse({ entries: [{ path: 'a', extra: 1 }] }).success, false);
});
test('a file tree block is created and patched through the real service, and bad data rolls back', async t => {
  const { service } = await setup(t), spec = getRendererSpec('file-tree')!;
  assert.equal(spec.blockType.name, 'Árbol de archivos'); assert.match(spec.guidance, /never draw a tree with ASCII/);
  const created = await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'tree', typeId: 'file-tree', title: 'El repo', data: { entries: [{ path: 'lib/' }, { path: 'lib/db.mjs' }] } } }]));
  assert.equal(created.document.blocks.find(b => b.id === 'tree')!.typeId, 'file-tree');
  await assert.rejects(service.mutate(mutation(1, [{ type: 'block.update', id: 'tree', patch: { data: { entries: [{ path: '../x' }] } } }])));
  assert.equal((await service.read({ workspaceId: 'workspace-a', documentId: 'd' })).document.revision, 1);
});
test('entries pair with the cards that explain them: explicit ref first, then a title that is the path', async () => {
  const { fileTreeTargets, fileTreeSpec } = await import('../plugin/shared/renderers/file-tree');
  const tree = fileTreeDataSchema.parse({ entries: [{ path: 'lib/', ref: 'engine' }, { path: 'bin/' }, { path: 'db/migrations/' }, { path: 'spine/' }, { path: 'bases/' }, { path: 'ui/', ref: 'gone' }, { path: 'docs/' }] });
  const document = { blocks: [{ id: 'self', title: 'docs/' }, { id: 'engine', title: 'Motor' }, { id: 'door', title: 'bin/' }, { id: 'sql', title: 'db/migrations/' }, { id: 'rules', title: 'spine/ · bases/' }, { id: 'screen', title: 'UI/' }], groups: [{ id: 'g', title: 'Entradas' }] };
  assert.deepEqual(Object.fromEntries(fileTreeTargets(fileTreeRows(tree), document, 'self')), { lib: 'engine', bin: 'door', 'db/migrations': 'sql', spine: 'rules', bases: 'rules', ui: 'screen' });
  const copied = fileTreeSpec.remapReferences!(tree as never, new Map([['engine', 'copy-engine']])) as typeof tree;
  assert.equal(copied.entries[0].ref, 'copy-engine'); assert.equal(copied.entries[5].ref, 'gone');
  assert.equal(fileTreeDataSchema.safeParse({ entries: [{ path: 'a', ref: '../x y' }] }).success, false);
});
