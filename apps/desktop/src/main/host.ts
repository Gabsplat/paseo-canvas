import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { RpcContract, RpcInput, SettingsDefinition } from '../../../../plugin/shared/contract';
import { CanvasError } from '../../../../plugin/shared/errors';
import type { HandlerContext, ServerHost } from '../../../../plugin/server/host';
import { atomicWrite } from '../../../../plugin/server/store';
import { settingsRpc, type InvokeResult } from '../shared/rpc';

type Entry = { contract: RpcContract; handler: (input: never, context: HandlerContext) => unknown };
const settingsFileSchema = z.record(z.string(), z.object({ version: z.number().int(), revision: z.number().int().nonnegative(), values: z.unknown() }));

/**
 * The desktop implementation of the server host boundary. It runs no agents: there is no agent API, no lifecycle
 * hooks. Agents connect over MCP; they draw and read the selection and block state with the canvas tools.
 * Handlers are called through `invoke`, from Electron IPC or the local preview server, with input validated here.
 */
export class DesktopHost implements ServerHost {
  readonly kind = 'desktop';
  readonly runsAgents = false;
  private readonly handlers = new Map<string, Entry>();
  private settingsQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly settingsFile: string) {}

  handle<C extends RpcContract>(contract: C, handler: (input: RpcInput<C>, context: HandlerContext) => unknown) {
    if (this.handlers.has(contract.name)) throw new Error(`RPC ${contract.name} is registered twice.`);
    this.handlers.set(contract.name, { contract, handler: handler as Entry['handler'] });
  }
  has(name: string) { return this.handlers.has(name); }

  async invoke(name: string, input: unknown): Promise<unknown> {
    const entry = this.handlers.has(name) ? this.handlers.get(name)! : undefined;
    if (!entry) throw new CanvasError('NOT_FOUND', `Unknown method ${name}.`);
    const parsed = entry.contract.input.parse(input);
    return entry.contract.output.parse(await entry.handler(parsed as never, {}));
  }
  /** Never throws: errors become their message. Unexpected errors lose their detail, which may hold private paths. */
  async settle(name: unknown, input: unknown): Promise<InvokeResult> {
    try {
      if (typeof name !== 'string') throw new CanvasError('VALIDATION', 'Method name must be a string.');
      return { ok: true, value: await this.invoke(name, input) };
    } catch (error) {
      if (error instanceof CanvasError || error instanceof z.ZodError) return { ok: false, message: error.message };
      console.error('Lienzo request failed', name, error);
      return { ok: false, message: 'UNAVAILABLE: Canvas operation failed. Check the app log.' };
    }
  }

  /** Host settings live in one JSON file next to the canvas state, with Paseo's revision semantics. */
  registerSettings(definition: SettingsDefinition) {
    const contracts = settingsRpc(definition.id);
    const current = async () => {
      const all = await this.readSettings(), stored = Object.hasOwn(all, definition.id) ? all[definition.id] : undefined;
      let values: unknown = stored?.values ?? {};
      if (stored && stored.version !== definition.version && definition.migrate) values = await definition.migrate(values, stored.version);
      return { all, revision: String(stored?.revision ?? 0), values };
    };
    this.handle(contracts.read, async () => {
      const { revision, values } = await current(), parsed = definition.schema.safeParse(values);
      return parsed.success ? { status: 'ready' as const, revision, values: parsed.data } : { status: 'invalid' as const, revision, error: 'Stored settings do not match this version.' };
    });
    const write = (input: { revision: string; values: unknown }) => this.serial(async () => {
      const { all, revision } = await current();
      if (input.revision !== revision) return { status: 'conflict' as const, error: 'Settings changed elsewhere. Reload and try again.' };
      const parsed = definition.schema.safeParse(input.values);
      if (!parsed.success) return { status: 'invalid' as const, error: 'Settings do not match their schema.' };
      const next = Number(revision) + 1;
      all[definition.id] = { version: definition.version, revision: next, values: parsed.data };
      await atomicWrite(this.settingsFile, JSON.stringify(all, null, 2));
      return { status: 'saved' as const, revision: String(next), values: parsed.data };
    });
    this.handle(contracts.write, input => write(input));
    this.handle(contracts.reset, input => write({ revision: input.revision, values: {} }));
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.settingsQueue.then(run); this.settingsQueue = next.catch(() => {}); return next;
  }
  private async readSettings(): Promise<z.infer<typeof settingsFileSchema>> {
    try { return settingsFileSchema.parse(JSON.parse(await readFile(this.settingsFile, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      // A damaged file is replaced on the next save rather than blocking the app.
      console.error('Lienzo settings are unreadable; using defaults.');
      return {};
    }
  }
}
