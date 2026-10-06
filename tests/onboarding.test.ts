import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import type { SettingsState } from '@getpaseo/plugin/client';
import { canvasPreferences } from '../plugin/shared/preferences';
import { claimFirstGuide } from '../plugin/client/guide';

type Preferences = SettingsState<typeof canvasPreferences.schema>;
test('guide stays closed during loading, invalid settings, read errors and failed saves', async () => {
  let writes = 0;
  const actions = { saving: false, saveError: null, save: async () => { writes++; return false; }, reset: async () => false, reload: async () => {} };
  for (const state of [{ status: 'loading' }, { status: 'invalid', revision: 'invalid', error: 'invalid' }, { status: 'error', error: 'offline' }] as const) {
    assert.equal(await claimFirstGuide({ ...actions, ...state }), false);
  }
  assert.equal(writes, 0);
  const ready: Preferences = { ...actions, status: 'ready', revision: 'first', values: { guideSeen: false } };
  assert.equal(await claimFirstGuide({ ...ready, saving: true }), false);
  assert.equal(await claimFirstGuide({ ...ready, saveError: 'offline' }), false);
  assert.equal(await claimFirstGuide(ready), false);
  assert.equal(writes, 1);
});

test('host guide preference survives workspace/client/restart changes and concurrent clients open it once', async () => {
  assert.equal(canvasPreferences.scope, 'host');
  assert.deepEqual(canvasPreferences.schema.parse({}), { guideSeen: false });
  const directory = await mkdtemp(join(tmpdir(), 'lienzo-guide-'));
  const file = join(directory, 'settings.json');
  try {
    await writeFile(file, JSON.stringify({ revision: '0', values: canvasPreferences.schema.parse({}) }));
    // Minimal host settings adapter: optimistic revisions, atomic serialized saves, disk reads.
    // Clients hold independent snapshots; none owns the host file or a browser preference.
    let serial = Promise.resolve();
    const client = async (): Promise<Preferences> => {
      const snapshot = JSON.parse(await readFile(file, 'utf8')) as { revision: string; values: { guideSeen: boolean } };
      return { status: 'ready', ...snapshot, saving: false, saveError: null,
        save: (values, revision) => {
          let saved = false;
          const next = serial.then(async () => {
            const current = JSON.parse(await readFile(file, 'utf8'));
            if (current.revision !== revision) return;
            await writeFile(file, JSON.stringify({ revision: String(Number(revision) + 1), values: canvasPreferences.schema.parse(values) }));
            saved = true;
          });
          serial = next;
          return next.then(() => saved);
        }, reset: async () => false, reload: async () => {} };
    };
    const [webWorkspace, nativeWorkspace] = await Promise.all([client(), client()]);
    assert.deepEqual((await Promise.all([claimFirstGuide(webWorkspace), claimFirstGuide(nativeWorkspace)])).sort(), [false, true]);
    for (let reopened = 0; reopened < 3; reopened++) assert.equal(await claimFirstGuide(await client()), false);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).values.guideSeen, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
