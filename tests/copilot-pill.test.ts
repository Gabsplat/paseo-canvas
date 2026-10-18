import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./fixtures/react-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native') return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === '../ui' && context.parentURL?.includes('/plugin/client/copilot/')) return { url: new URL('./fixtures/ui-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === '@getpaseo/plugin/client/react-native') return { url: new URL('./fixtures/plugin-native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const model = require('../plugin/client/copilot/model') as typeof import('../plugin/client/copilot/model');
const intent = require('../plugin/client/copilot/intent') as typeof import('../plugin/client/copilot/intent');
const { CopilotPanel, CopilotPopover } = require('../plugin/client/copilot/CopilotPopover');
const { registerCopilotPills } = require('../plugin/client/copilot/register');

type Node = { type: unknown; props: Record<string, any> } | string | number | null | undefined | boolean | Node[];
/** Every string and label in a shallow element tree: what a person would read in the popover. */
function words(node: Node): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(words);
  const own = ['label', 'placeholder', 'hint'].flatMap(key => typeof node.props?.[key] === 'string' ? [node.props[key]] : []);
  return [...own, ...words(node.props?.children)];
}
function find(node: Node, match: (element: { type: unknown; props: Record<string, any> }) => boolean): { type: unknown; props: Record<string, any> }[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => find(child, match));
  return [...(match(node) ? [node] : []), ...find(node.props?.children, match)];
}
const colors = { surface0: '#000', surface1: '#111', surface2: '#222', border: '#333', foreground: '#fff', foregroundMuted: '#999', accent: '#36f', accentForeground: '#fff', statusSuccess: '#0a0', statusWarning: '#fa0', statusDanger: '#f00' };
const view = (over: Record<string, any> = {}) => ({ agentId: 'a', copilot: { enabled: true, cadence: 'step', rule: '', remind: false, documentId: 'doc1' }, hasTools: true, drawing: false, lastToolAt: null, document: { id: 'doc1', title: 'Lienzo · Auth' }, latest: { documentId: 'doc1', transactionId: 'txn_1', revision: 3, at: '2026-10-12T10:00:00.000Z', label: 'Draw', kind: 'edit', ids: ['n1', 'n2', 'n3', 'n4'], removed: [], titles: ['Token', 'Bridge', 'Owner'] }, ...over });
const noop = () => {};
const panel = (over: Record<string, any> = {}) => CopilotPanel({ colors, view: view(), documents: [], now: Date.parse('2026-10-12T10:05:00.000Z'), loading: false, busy: false, error: '', created: '', onToggle: noop, onCadence: noop, onRule: noop, onRemind: noop, onLatest: noop, onOpen: noop, onAttach: noop, onNewAgent: noop, ...over });

test('pill status, cadence hints, latest preview and recent Lienzos', () => {
  assert.deepEqual([model.pillStatus(undefined), model.pillStatus({ enabled: false, drawing: true, hasTools: true }), model.pillStatus({ enabled: true, drawing: false, hasTools: true }), model.pillStatus({ enabled: true, drawing: true, hasTools: true })], ['off', 'off', 'on', 'drawing']);
  assert.deepEqual(model.CADENCE_OPTIONS.map(option => option.value), ['thinking', 'step', 'task', 'custom']);
  assert.deepEqual(['thinking', 'step', 'task', 'custom'].map(c => model.remindApplies(c as never)), [false, true, true, false]);
  const now = Date.parse('2026-10-12T10:05:00.000Z');
  assert.deepEqual(model.latestPreview(view().latest as never, now), { title: '4 things · 5 min ago', detail: '“Token”, “Bridge”, “Owner” and 1 more' });
  assert.equal(model.latestPreview(null, now), null);
  assert.equal(model.relativeTime('2026-10-12T10:04:50.000Z', now), 'just now');
  const docs = [{ id: 'old', title: 'Old', updatedAt: '2026-10-01T00:00:00.000Z' }, { id: 'ex', title: 'Example', updatedAt: '2026-10-12T00:00:00.000Z', example: true }, { id: 'doc1', title: 'Attached', updatedAt: '2026-10-12T00:00:00.000Z' }, { id: 'new', title: 'New', updatedAt: '2026-10-11T00:00:00.000Z' }];
  assert.deepEqual(model.recentLienzos(docs, 'doc1').map(d => d.id), ['new', 'old', 'ex']);
  assert.equal(model.providerModel({ provider: 'claude', model: 'opus' }), 'claude/opus');
  assert.ok(model.POPOVER_SIZE.width <= 320 && model.POPOVER_SIZE.maxHeight <= 360);
});

test('the popover shows switch, cadence, remind, latest preview, recent Lienzos and Open; English copy', () => {
  const pressed: string[] = [];
  const tree = panel({ documents: [{ id: 'd2', title: 'Payments', updatedAt: '2026-10-11T00:00:00.000Z' }], onLatest: () => pressed.push('latest'), onAttach: (id: string) => pressed.push(`attach:${id}`), onToggle: (on: boolean) => pressed.push(`toggle:${on}`) });
  const text = words(tree).join(' | ');
  for (const expected of ['Lienzo copilot', 'On', 'Go to latest', '4 things · 5 min ago', 'Remind the agent when it forgets', 'Attach a recent Lienzo', 'Payments', 'Open Lienzo · Auth', 'Draws after each step worth showing.']) assert.ok(text.includes(expected), expected);
  assert.equal(tree.props.style.width, 320); assert.equal(tree.props.style.maxHeight, 360);
  const segments = find(tree, element => Array.isArray(element.props?.options))[0];
  assert.deepEqual(segments.props.options.map((option: { label: string }) => option.label), ['Thinking', 'Step', 'Task', 'Custom']);
  find(tree, element => element.props?.label === 'Go to latest')[0].props.onPress();
  find(tree, element => element.props?.label === 'Payments')[0].props.onPress();
  find(tree, element => element.props?.label === 'Copilot on')[0].props.onChange(false);
  assert.deepEqual(pressed, ['latest', 'attach:d2', 'toggle:false']);
  // Custom shows the rule field instead of the hint; thinking hides the reminder.
  const custom = panel({ view: view({ copilot: { enabled: true, cadence: 'custom', rule: 'x', remind: false, documentId: 'doc1' } }) });
  assert.equal(find(custom, element => typeof element.type === 'function' && element.type.name === 'RuleField').length, 1);
  assert.ok(!words(custom).includes('Remind the agent when it forgets'));
  assert.ok(!words(panel({ view: view({ copilot: { enabled: true, cadence: 'thinking', rule: '', remind: false, documentId: 'doc1' } }) })).includes('Remind the agent when it forgets'));
  // Off: an explanation with the glossary word, no cadence.
  const off = words(panel({ view: view({ copilot: { enabled: false, cadence: 'step', rule: '', remind: false, documentId: null }, latest: null, document: null }) })).join(' ');
  assert.match(off, /Sheet \(a chapter of the canvas\)/); assert.match(off, /Open Lienzo/); assert.ok(!off.includes('Go to latest'));
});

test('an agent without Lienzo tools is told so and offered a new agent', () => {
  let asked = 0;
  const tree = panel({ view: view({ hasTools: false }), onNewAgent: () => { asked++; } });
  const text = words(tree).join(' ');
  assert.match(text, /created before it had Lienzo tools/); assert.ok(!text.includes('Go to latest'));
  assert.equal(find(tree, element => element.props?.label === 'Copilot on').length, 0, 'no switch that would do nothing');
  find(tree, element => element.props?.label === 'New agent with Lienzo')[0].props.onPress(); assert.equal(asked, 1);
});

test('the intent channel hands "go to latest" to the panel once, and stale intents expire', () => {
  const seen: string[] = []; const stop = intent.onCanvasIntent(next => seen.push(next.documentId));
  intent.requestCanvasIntent({ workspaceId: 'w', documentId: 'doc1', kind: 'latest', ids: ['n1'] }, 1000);
  stop(); intent.requestCanvasIntent({ workspaceId: 'w2', documentId: 'doc2', kind: 'open', ids: [] }, 1000);
  assert.deepEqual(seen, ['doc1']);
  assert.deepEqual(intent.takeCanvasIntent('w', 2000)?.ids, ['n1']); assert.equal(intent.takeCanvasIntent('w', 2000), null, 'taken once');
  assert.equal(intent.takeCanvasIntent('w2', 1000 + intent.INTENT_TTL_MS + 1), null);
});

test('one pill per live agent from the agent subscription; status upserts update the icon without re-registering', async t => {
  const added: { id: string; agentId: string; workspaceId: string; button: any; updates: any[]; removed: boolean }[] = [];
  const rpcCalls: { name: string; input: any }[] = [], opened: any[] = [];
  let observer: any;
  const client = {
    paseo: { agents: { list: async (options: any) => { assert.deepEqual(options.subscribe, {}); return { subscription: { subscribe: (o: any) => { observer = o; return () => {}; } } }; } } },
    rpc: async (contract: { name: string }, input: any) => { rpcCalls.push({ name: contract.name, input }); return contract.name === 'canvas.copilot.list' ? { agents: Object.fromEntries(input.agentIds.map((id: string) => [id, { enabled: id === 'a', drawing: id === 'a', hasTools: true }])) } : {}; },
    addComposerPill: (contribution: any) => { const entry = { ...contribution, updates: [] as any[], removed: false }; added.push(entry); return { update: (patch: any) => entry.updates.push(patch), remove: () => { entry.removed = true; } }; },
    openPanel: (id: string, options: any) => opened.push([id, options]),
  };
  const cleanup = registerCopilotPills(client); t.after(cleanup);
  await new Promise(resolve => setImmediate(resolve));
  observer.snapshot({ entries: [{ agent: { id: 'a', workspaceId: 'w', status: 'running', title: 'Auth' } }, { agent: { id: 'b', workspaceId: 'w', status: 'idle' } }, { agent: { id: 'gone', workspaceId: 'w', archivedAt: '2026-10-01T00:00:00.000Z' } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(added.map(pill => [pill.id, pill.agentId, pill.workspaceId, pill.button.label, pill.button.behavior.kind]), [['lienzo-copilot', 'a', 'w', 'Lienzo', 'popover'], ['lienzo-copilot', 'b', 'w', 'Lienzo', 'popover']]);
  assert.match(added[0].button.title, /Spanish for canvas/);
  assert.deepEqual(rpcCalls.find(call => call.name === 'canvas.copilot.list')?.input, { agentIds: ['a', 'b'] });
  assert.equal(added[0].updates.length, 1, 'the dot turned to drawing'); assert.equal(added[1].updates.length, 0);
  observer.update({ type: 'agent_update', payload: { kind: 'upsert', agent: { id: 'a', workspaceId: 'w', status: 'idle' } } });
  assert.equal(added.length, 2, 'a status change does not re-register (an open popover stays open)');
  observer.update({ type: 'agent_update', payload: { kind: 'remove', agentId: 'b' } });
  assert.equal(added[1].removed, true);
  // The popover content is bound to its agent and hands "go to latest" to the panel.
  const element = added[0].button.behavior.Content({ theme: { colors }, layout: { compact: false, platform: 'web' }, host: { id: 'h', label: 'H' }, context: 'agent', workspaceId: 'w', agentId: 'a', close: noop });
  assert.equal(element.type, CopilotPopover);
  element.props.api.goToLatest(view());
  assert.deepEqual(opened, [['canvas', { workspaceId: 'w' }]]);
  assert.deepEqual(intent.takeCanvasIntent('w')?.ids, ['n1', 'n2', 'n3', 'n4']);
  await element.props.api.set({ enabled: true });
  assert.deepEqual(rpcCalls.at(-1), { name: 'canvas.copilot.set', input: { workspaceId: 'w', agentId: 'a', patch: { enabled: true }, title: 'Lienzo · Auth' } });
  cleanup();
  assert.ok(added.every(pill => pill.removed));
});
