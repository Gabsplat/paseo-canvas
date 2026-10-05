import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { AgentGateway, type Paseo } from "../plugin/server/agent-integration";
import { documentContentSchema, mutateInputSchema, type DocumentContent, type CanvasOperation } from "../plugin/shared/model";

export const workspaceId = "workspace-a";
export function content(): DocumentContent {
  return documentContentSchema.parse({ title: "Test document", blocks: [{ id: "b", typeId: "note", title: "B", data: { text: "old" } }, { id: "c", typeId: "note", title: "C", data: { text: "other" } }], groups: [], communication: { instructions: "Explain plainly." } });
}
export async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "paseo-canvas-test-"));
  const store = new CanvasStore(directory), service = new CanvasService(store);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  await service.create({ workspaceId, id: "d", content: content() });
  return { directory, store, service };
}
export function mutation(expectedRevision: number, operations: CanvasOperation[], documentId = "d") {
  return mutateInputSchema.parse({ workspaceId, documentId, expectedRevision, operations });
}
export function fakeGateway(service: CanvasService, initialStatus = "idle") {
  const agents = new Map<string, { workspaceId: string; status: string; archivedAt: string | null }>([["a", { workspaceId, status: initialStatus, archivedAt: null }], ["b", { workspaceId, status: "idle", archivedAt: null }], ["outsider", { workspaceId: "workspace-b", status: "idle", archivedAt: null }]]);
  const sends: { agentId: string; text: string; messageId: string }[] = [];
  let onSend: ((messageId: string) => Promise<void>) | undefined;
  const paseo = {
    agents: { ref: (id: string) => {
      const data = agents.get(id);
      return { id, get workspaceId() { return data?.workspaceId ?? null; }, get status() { return data?.status ?? null; }, get archivedAt() { return data?.archivedAt ?? null; }, refresh: async () => data ? { agent: { id, ...data } } : null, send: async (text: string, options: { messageId: string }) => { sends.push({ agentId: id, text, messageId: options.messageId }); await onSend?.(options.messageId); } };
    } },
    workspaces: { list: async () => ({ entries: [{ id: workspaceId, workspaceDirectory: "/workspace/a" }] }) },
  } as unknown as Paseo;
  const gateway = new AgentGateway(service); gateway.bind(paseo);
  return { gateway, paseo, agents, sends, setOnSend(callback: (id: string) => Promise<void>) { onSend = callback; } };
}
