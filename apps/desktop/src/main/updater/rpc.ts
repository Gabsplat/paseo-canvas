// The update RPCs the renderer calls. No Electron here: the app registers them on its controller, the preview on
// a stand-in whose state can be set by hand.
import type { HandlerContext } from '../../../../../plugin/server/host';
import type { RpcContract, RpcInput } from '../../../../../plugin/shared/contract';
import { checkForUpdates, restartToUpdate, updateStatus, type UpdateState } from '../../shared/rpc';

export interface UpdateSource {
  status(): { version: string; state: UpdateState };
  check(): Promise<UpdateState>;
  restart(): Promise<boolean>;
}
interface Host { handle<C extends RpcContract>(contract: C, handler: (input: RpcInput<C>, context: HandlerContext) => unknown): void }

export function registerUpdateRpcs(host: Host, source: UpdateSource) {
  host.handle(updateStatus, () => source.status());
  host.handle(checkForUpdates, async () => { await source.check(); return source.status(); });
  host.handle(restartToUpdate, async () => ({ restarting: await source.restart(), state: source.status().state }));
}
