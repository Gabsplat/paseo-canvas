import { z } from 'zod';
import { defineRpc, defineSettings } from '../../../../plugin/shared/contract';

/** The one workspace every desktop document lives in. Documents copied in from Paseo are moved into it. */
export const DESKTOP_WORKSPACE = 'desktop';
/** Default MCP port. Override with LIENZO_MCP_PORT or `mcpPort` in desktop.json in the app's data folder. */
export const DEFAULT_MCP_PORT = 7421;
/** An agent counts as connected recently when it made an MCP request within this window. */
export const RECENT_MS = 10 * 60 * 1000;

export const mcpClientSchema = z.object({
  agentId: z.string(), name: z.string(), version: z.string(),
  firstSeenAt: z.iso.datetime(), lastSeenAt: z.iso.datetime(), toolCalls: z.number().int().nonnegative(),
});
export type McpClient = z.infer<typeof mcpClientSchema>;

/** Desktop-only RPCs: they exist in the app's main process, never in the Paseo plugin. */
export const desktopStatus = defineRpc({
  name: 'desktop.status',
  input: z.object({}).strict(),
  output: z.object({
    version: z.string(),
    dataDirectory: z.string(),
    mcp: z.object({ url: z.string(), port: z.number().int(), listening: z.boolean(), error: z.string().nullable(), clients: z.array(mcpClientSchema) }),
  }),
});
export const openExternal = defineRpc({ name: 'desktop.open-external', input: z.object({ url: z.string().url().max(4000) }).strict(), output: z.object({ opened: z.boolean() }) });
export const writeClipboard = defineRpc({ name: 'desktop.clipboard.write', input: z.object({ text: z.string().max(1024 * 1024) }).strict(), output: z.object({ written: z.boolean() }) });

/** Settings documents, the same shape Paseo uses for plugin settings. */
export const settingsReadResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), revision: z.string(), values: z.unknown() }),
  z.object({ status: z.literal('invalid'), revision: z.string(), error: z.string() }),
]);
export const settingsWriteResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), revision: z.string(), values: z.unknown() }),
  z.object({ status: z.literal('conflict'), error: z.string() }),
  z.object({ status: z.literal('invalid'), error: z.string() }),
]);
export function settingsRpc(id: string) {
  return {
    read: defineRpc({ name: `settings.${id}.read`, input: z.object({}).strict(), output: settingsReadResult }),
    write: defineRpc({ name: `settings.${id}.write`, input: z.object({ revision: z.string(), values: z.unknown() }).strict(), output: settingsWriteResult }),
    reset: defineRpc({ name: `settings.${id}.reset`, input: z.object({ revision: z.string() }).strict(), output: settingsWriteResult }),
  };
}

/** Invoke results across IPC and the preview HTTP bridge: errors travel as their message, which carries the code. */
export type InvokeResult = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * App updates (desktop only; the Paseo plugin has none). The main process owns the state; the renderer polls it.
 * `off` covers development builds, the browser preview and copies that cannot update themselves; `blocked` is a
 * copy that could update if it were moved (a Mac app run from a disk image, say).
 */
export const updateStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('off'), reason: z.string() }),
  z.object({ kind: z.literal('blocked'), reason: z.string() }),
  z.object({ kind: z.literal('idle'), checkedAt: z.iso.datetime().nullable() }),
  z.object({ kind: z.literal('checking') }),
  z.object({ kind: z.literal('downloading'), version: z.string(), percent: z.number().min(0).max(100) }),
  z.object({ kind: z.literal('ready'), version: z.string() }),
  z.object({ kind: z.literal('error'), message: z.string(), checkedAt: z.iso.datetime().nullable() }),
]);
export type UpdateState = z.infer<typeof updateStateSchema>;
export const updateStatus = defineRpc({ name: 'desktop.updates.status', input: z.object({}).strict(), output: z.object({ version: z.string(), state: updateStateSchema }) });
export const checkForUpdates = defineRpc({ name: 'desktop.updates.check', input: z.object({}).strict(), output: z.object({ version: z.string(), state: updateStateSchema }) });
export const restartToUpdate = defineRpc({ name: 'desktop.updates.restart', input: z.object({}).strict(), output: z.object({ restarting: z.boolean(), state: updateStateSchema }) });
/** Preview only: shows a made-up state so the pill and Settings → About can be checked without a release. */
export const fakeUpdateState = defineRpc({ name: 'desktop.updates.fake', input: z.object({ state: updateStateSchema }).strict(), output: z.object({ ok: z.boolean() }) });
/** "Automatically check for updates", kept in settings.json with the other host settings. */
export const updateSettings = defineSettings({ id: 'desktop-updates', scope: 'host', version: 1, schema: z.object({ autoCheck: z.boolean().default(true) }) });
