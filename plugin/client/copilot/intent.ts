// Hand-off from the composer pill to the workspace panel. openPanel(id, { workspaceId }) carries no parameters, and the
// pill and the panel live in the same client bundle, so the intent waits here until the panel takes it.
// Stage 2b (canvas side): the Lienzo panel calls takeCanvasIntent(workspaceId) when it mounts and subscribes with
// onCanvasIntent while open, then switches to documentId and flies to ids.

export type CanvasIntent = {
  workspaceId: string;
  documentId: string;
  /** "latest": fly to the agent's latest edit (ids). "open": just show the document. */
  kind: 'latest' | 'open';
  ids: string[];
  transactionId?: string;
  agentId?: string;
  requestedAt: number;
};

const pending = new Map<string, CanvasIntent>();
const listeners = new Set<(intent: CanvasIntent) => void>();
/** Unclaimed intents expire: a panel opened much later should not jump somewhere unexpected. */
export const INTENT_TTL_MS = 60_000;

export function requestCanvasIntent(intent: Omit<CanvasIntent, 'requestedAt'>, now = Date.now()): CanvasIntent {
  const stored = { ...intent, ids: [...intent.ids], requestedAt: now };
  pending.set(intent.workspaceId, stored);
  for (const listener of [...listeners]) listener(stored);
  return stored;
}
/** Returns and clears the pending intent for a workspace, if it is still fresh. */
export function takeCanvasIntent(workspaceId: string, now = Date.now()): CanvasIntent | null {
  const intent = pending.get(workspaceId);
  pending.delete(workspaceId);
  return intent && now - intent.requestedAt <= INTENT_TTL_MS ? intent : null;
}
/** Live intents while a panel is open. The listener should call takeCanvasIntent to claim it. */
export function onCanvasIntent(listener: (intent: CanvasIntent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
