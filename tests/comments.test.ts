import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { CopilotService } from "../plugin/server/copilot";
import { ToolRouter, toolNames, drawingGuide, integrationInstructions, toolDefinitions } from "../plugin/server/tools";
import { COMMENT_LIMITS, agentLabel, pinPoint } from "../plugin/shared/comments";
import * as rpc from "../plugin/shared/rpc";
import { setup, workspaceId, mutation } from "./helpers";

// Comments are the person's notes pinned on the canvas: stored with the document, never drawing content.
const person = { kind: "person" as const };
const router = (service: CanvasService, agentId = "a", label?: string) => new ToolRouter(service, async () => ({ agentId, workspaceId, ...(label ? { label } : {}) }));

test("a comment survives a restart and never touches the revision, the history or undo", async t => {
  const { service, store, directory } = await setup(t);
  const before = await service.read({ workspaceId, documentId: "d" });
  const created = await service.createComment({ workspaceId, documentId: "d", anchor: { kind: "block", id: "b", dx: 0, dy: 0 }, text: "  Is this the right name?  " }, person);
  assert.equal(created.threads.length, 1); assert.equal(created.commentsVersion, 1); assert.ok(created.threadId);
  assert.equal(created.threads[0].messages[0].text, "Is this the right name?", "text is trimmed");
  await service.replyComment({ workspaceId, documentId: "d", threadId: created.threadId!, text: "Yes." }, person);
  const after = await service.read({ workspaceId, documentId: "d" });
  assert.equal(after.document.revision, before.document.revision, "a comment is not a revision");
  assert.equal(after.commentsVersion, 2);
  assert.deepEqual((await service.history({ workspaceId, documentId: "d" })).transactions, [], "no drawing transaction");
  assert.equal(after.canUndo, false);
  // The watch reports the counter and hands a fresh view only when the client's counter is behind.
  const quiet = await service.watch({ workspaceId, documentId: "d", knownRevision: after.document.revision, knownRuntimeVersion: after.runtimeVersion, knownCommentsVersion: 2 });
  assert.equal(quiet.view, undefined); assert.equal(quiet.commentsVersion, 2);
  const behind = await service.watch({ workspaceId, documentId: "d", knownRevision: after.document.revision, knownRuntimeVersion: after.runtimeVersion, knownCommentsVersion: 1 });
  assert.equal(behind.view?.commentsVersion, 2);
  // An older client that does not send the counter is not told to reload for comments.
  assert.equal((await service.watch({ workspaceId, documentId: "d", knownRevision: after.document.revision, knownRuntimeVersion: after.runtimeVersion })).view, undefined);

  await store.close();
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  const again = new CanvasService(reopened), listed = await again.comments({ workspaceId, documentId: "d" });
  assert.equal(listed.commentsVersion, 2);
  assert.deepEqual(listed.threads[0].messages.map(m => m.text), ["Is this the right name?", "Yes."]);
  assert.match(await readFile(join(directory, "state.json"), "utf8"), /"comments":\{"version":2/);
});

test("a comment between the agent's read and its write does not break expectedRevision", async t => {
  const { service } = await setup(t), tools = router(service);
  const read = await tools.call("canvas_read", { documentId: "d" }, "owner") as { document: { revision: number } };
  await service.createComment({ workspaceId, documentId: "d", anchor: { kind: "point", x: 10, y: 20 }, text: "Make the second card shorter." }, person);
  const applied = await tools.call("canvas_apply", { documentId: "d", expectedRevision: read.document.revision, operations: [{ type: "block.update", id: "c", patch: { title: "Shorter" } }] }, "owner") as { revision: number };
  assert.equal(applied.revision, read.document.revision + 1);
  // And resolving one in the middle of the agent's undo window does not block its undo.
  const list = await service.comments({ workspaceId, documentId: "d" });
  await service.setCommentStatus({ workspaceId, documentId: "d", threadId: list.threads[0].id }, "resolved");
  const undone = await tools.call("canvas_undo", { documentId: "d", expectedRevision: applied.revision }, "owner") as { revision: number };
  assert.equal(undone.revision, applied.revision + 1);
});

test("deleting an anchored entity orphans its threads at the pin's last place; nothing is lost", async t => {
  const { service } = await setup(t);
  await service.mutate(mutation(0, [{ type: "group.create", group: { id: "g", title: "Area", description: "", blockIds: [], groupIds: [], position: { x: 400, y: 100 } } }]));
  const onBlock = await service.createComment({ workspaceId, documentId: "d", anchor: { kind: "block", id: "b", dx: 0, dy: 0 }, text: "On the block" }, person);
  const onGroup = await service.createComment({ workspaceId, documentId: "d", anchor: { kind: "group", id: "g", dx: -4, dy: 2 }, text: "On the group" }, person);
  // The group has an explicit position, so the server already knows roughly where its pin is.
  const groupAnchor = onGroup.threads.find(t => t.id === onGroup.threadId)!.anchor;
  assert.equal(groupAnchor.kind, "group"); assert.ok(groupAnchor.kind === "group" && groupAnchor.at);
  // The client reports where it draws the block's pin.
  assert.deepEqual(await service.locateComments({ workspaceId, documentId: "d", points: [{ threadId: onBlock.threadId!, x: 312, y: 40 }] }), { updated: 1 });
  assert.equal((await service.comments({ workspaceId, documentId: "d" })).commentsVersion, onGroup.commentsVersion, "locating is a hint: no counter change");
  await service.mutate(mutation(1, [{ type: "block.delete", id: "b" }, { type: "group.delete", id: "g" }]));
  const after = await service.comments({ workspaceId, documentId: "d" });
  assert.equal(after.threads.length, 2);
  const block = after.threads.find(t => t.id === onBlock.threadId)!, group = after.threads.find(t => t.id === onGroup.threadId)!;
  assert.deepEqual(block.anchor, { kind: "point", x: 312, y: 40 });
  assert.deepEqual(block.orphanedFrom, { kind: "block", id: "b", title: "B" });
  assert.equal(group.anchor.kind, "point"); assert.equal(group.orphanedFrom?.title, "Area");
  assert.ok(after.commentsVersion > onGroup.commentsVersion);
  // A pin's place follows its entity's rectangle, and falls back to the last place seen.
  assert.deepEqual(pinPoint({ kind: "block", id: "x", dx: 2, dy: -3 }, () => ({ x: 10, y: 20, width: 100, height: 50 })), { x: 112, y: 17 });
  assert.deepEqual(pinPoint({ kind: "block", id: "x", dx: 0, dy: 0, at: { x: 5, y: 6 } }, () => undefined), { x: 5, y: 6 });
  await assert.rejects(service.createComment({ workspaceId, documentId: "d", anchor: { kind: "block", id: "b", dx: 0, dy: 0 }, text: "gone" }, person), /not on this Lienzo/);
});

test("canvas_comments: list defaults to the copilot's Lienzo, the agent signs its replies, resolve closes", async t => {
  const { service } = await setup(t);
  await service.create({ workspaceId, id: "e", content: { title: "Other", description: "", example: false, blocks: [], groups: [], links: [], selectedIds: [], communication: { instructions: "", intent: "", audience: "" } } });
  const thread = await service.createComment({ workspaceId, documentId: "d", anchor: { kind: "block", id: "b", dx: 0, dy: 0 }, text: "Why two steps here?" }, person);
  await service.createComment({ workspaceId, documentId: "e", anchor: { kind: "point", x: 0, y: 0 }, text: "Elsewhere" }, person);
  const copilot = new CopilotService(service, toolNames);
  await copilot.set({ workspaceId, agentId: "a", patch: { documentId: "d" } });
  const tools = router(service, "a", "Auth refactor");
  const listed = await tools.call("canvas_comments", { action: "list" }, "owner") as { documentId: string; threads: { threadId: string; anchor: { kind: string; title: string; type: string }; messages: { author: string; text: string }[] }[]; counts: { open: number } };
  assert.equal(listed.documentId, "d", "the copilot's Lienzo");
  assert.deepEqual(listed.threads.map(t => [t.anchor.kind, t.anchor.title, t.anchor.type, t.messages[0].author, t.messages[0].text]), [["block", "B", "note", "person", "Why two steps here?"]]);
  const replied = await tools.call("canvas_comments", { action: "reply", threadId: thread.threadId, text: "One validates, one signs." }, "owner") as { thread: { messages: { author: string }[] } };
  assert.deepEqual(replied.thread.messages.map(m => m.author), ["person", "you"]);
  const stored = (await service.comments({ workspaceId, documentId: "d" })).threads[0].messages[1].author;
  assert.deepEqual(stored, { kind: "agent", agentId: "a", label: "Auth refactor" });
  await tools.call("canvas_comments", { action: "resolve", threadId: thread.threadId }, "owner");
  assert.equal(((await tools.call("canvas_comments", { action: "list", documentId: "d" }, "owner")) as { threads: unknown[] }).threads.length, 0, "open is the default filter");
  assert.equal(((await tools.call("canvas_comments", { action: "list", documentId: "d", status: "resolved" }, "owner")) as { threads: unknown[] }).threads.length, 1);
  const created = await tools.call("canvas_comments", { action: "create", documentId: "d", anchor: { kind: "point", x: 40, y: 40 }, text: "Decision: keep both steps." }, "owner") as { threadId: string };
  assert.ok(created.threadId);
  // Another agent sees who wrote it.
  const other = await router(service, "b").call("canvas_comments", { action: "list", documentId: "d" }, "owner") as { threads: { messages: { author: string }[] }[] };
  assert.equal(other.threads[0].messages[0].author, "agent: Auth refactor");
  // Without a copilot Lienzo, the default is the one the person selected in most recently.
  const view = await service.read({ workspaceId, documentId: "e" });
  await service.selection({ workspaceId, documentId: "e", expectedSelectionVersion: view.selectionVersion, ids: [] });
  const fallback = await router(service, "b").call("canvas_comments", { action: "list" }, "owner") as { documentId: string };
  assert.equal(fallback.documentId, "e");
  // The agent's revision did not move through any of it.
  assert.equal((await service.read({ workspaceId, documentId: "d" })).document.revision, 0);
  // Selection reads mention open comments on what is selected.
  const current = await service.read({ workspaceId, documentId: "d" });
  await service.createComment({ workspaceId, documentId: "d", anchor: { kind: "block", id: "c", dx: 0, dy: 0 }, text: "Rename?" }, person);
  await service.selection({ workspaceId, documentId: "d", expectedSelectionVersion: current.selectionVersion, ids: ["c"] });
  const selection = await tools.call("canvas_selection", { documentId: "d" }, "owner") as { entities: { openComments?: number }[]; openComments: number };
  assert.equal(selection.entities[0].openComments, 1); assert.equal(selection.openComments, 2);
});

test("comment limits: text length, messages per thread, threads per Lienzo", async t => {
  const { service } = await setup(t), point = { kind: "point" as const, x: 0, y: 0 };
  await assert.rejects(service.createComment({ workspaceId, documentId: "d", anchor: point, text: "   " }, person), /Write something/);
  await assert.rejects(service.createComment({ workspaceId, documentId: "d", anchor: point, text: "x".repeat(COMMENT_LIMITS.text + 1) }, person), /2000/);
  const { threadId } = await service.createComment({ workspaceId, documentId: "d", anchor: point, text: "x".repeat(COMMENT_LIMITS.text) }, person);
  for (let i = 1; i < COMMENT_LIMITS.messages; i++) await service.replyComment({ workspaceId, documentId: "d", threadId: threadId!, text: `reply ${i}` }, person);
  await assert.rejects(service.replyComment({ workspaceId, documentId: "d", threadId: threadId!, text: "one more" }, person), /at most 50 messages/);
  for (let i = 1; i < COMMENT_LIMITS.threads; i++) await service.createComment({ workspaceId, documentId: "d", anchor: point, text: `t${i}` }, person);
  await assert.rejects(service.createComment({ workspaceId, documentId: "d", anchor: point, text: "too many" }, person), /at most 200 comment threads/);
  await service.deleteComment({ workspaceId, documentId: "d", threadId: threadId! });
  assert.equal((await service.comments({ workspaceId, documentId: "d" })).threads.length, COMMENT_LIMITS.threads - 1);
  await assert.rejects(service.replyComment({ workspaceId, documentId: "d", threadId: threadId!, text: "deleted" }, person), /not found/);
  // RPC inputs refuse the same things before the service.
  assert.equal(rpc.createComment.input.safeParse({ workspaceId, documentId: "d", anchor: point, text: "" }).success, false);
});

test("the agent guidance is short: comments live in the guide and the tool, not the system prompt", () => {
  assert.ok(integrationInstructions.length < 1500);
  assert.match(drawingGuide, /canvas_comments list/); assert.match(drawingGuide, /never to narrate/);
  const tool = toolDefinitions.find(t => t.name === "canvas_comments")!;
  assert.match(tool.description, /atendé los comentarios/); assert.ok(tool.description.length < 1000);
  assert.equal(agentLabel("a", "  Fix   login "), "Fix login"); assert.equal(agentLabel("a", null, "claude"), "Claude"); assert.equal(agentLabel("mcp:claude-code"), "claude-code"); assert.equal(agentLabel("x"), "Agent");
});

test("the panel: C is the Comment tool, pins pick the smallest card under the press, resolved pins stay hidden", async () => {
  const { DEFAULT_SHORTCUTS, resolveShortcuts } = await import("../plugin/client/shortcuts");
  const { commentTarget, visibleThreads, relativeTime } = await import("../plugin/client/comment-logic");
  const resolved = resolveShortcuts(DEFAULT_SHORTCUTS);
  assert.equal(resolved.byCombo.get("c"), "tool.comment"); assert.ok(!resolved.list.some(s => s.unassigned), "C was free");
  const rect = (x: number, y: number, width: number, height: number, depth = 0) => ({ x, y, width, height, depth, hidden: false });
  const rects = new Map([["sheet", rect(0, 0, 1000, 800)], ["frame", rect(100, 100, 400, 300, 1)], ["card", rect(120, 140, 200, 80, 2)], ["big", rect(110, 120, 380, 260, 2)]]);
  const groups = new Set(["sheet", "frame"]);
  assert.deepEqual(commentTarget({ x: 150, y: 160 }, rects, groups), { kind: "block", id: "card" }, "the smallest block wins");
  assert.deepEqual(commentTarget({ x: 105, y: 105 }, rects, groups), { kind: "group", id: "frame" }, "else the innermost Frame");
  assert.equal(commentTarget({ x: 2000, y: 2000 }, rects, groups), null, "else the empty spot");
  const thread = (id: string, status: "open" | "resolved") => ({ id, status, anchor: { kind: "point" as const, x: 0, y: 0 }, createdAt: "", updatedAt: "", messages: [] });
  const threads = [thread("a", "open"), thread("b", "resolved")];
  assert.deepEqual(visibleThreads(threads, { pins: true, filter: "open", listOpen: false }).map(t => t.id), ["a"]);
  assert.deepEqual(visibleThreads(threads, { pins: true, filter: "resolved", listOpen: true }).map(t => t.id), ["a", "b"]);
  assert.deepEqual(visibleThreads(threads, { pins: false, filter: "open", listOpen: false, openId: "b" }).map(t => t.id), ["b"], "hidden pins still show the open thread");
  const now = Date.parse("2026-10-19T12:00:00.000Z");
  assert.deepEqual(["2026-10-19T11:59:40.000Z", "2026-10-19T11:15:00.000Z", "2026-10-19T07:00:00.000Z", "2026-10-17T12:00:00.000Z"].map(at => relativeTime(at, now)), ["just now", "45 min ago", "5 h ago", "2 d ago"]);
});

test("the copilot popover counts open comments for the person; the agent is never told", async t => {
  const { service } = await setup(t), copilot = new CopilotService(service, toolNames);
  await copilot.set({ workspaceId, agentId: "a", patch: { documentId: "d" } });
  await service.createComment({ workspaceId, documentId: "d", anchor: { kind: "point", x: 0, y: 0 }, text: "One" }, person);
  const two = await service.createComment({ workspaceId, documentId: "d", anchor: { kind: "point", x: 0, y: 0 }, text: "Two" }, person);
  await service.setCommentStatus({ workspaceId, documentId: "d", threadId: two.threadId! }, "resolved");
  assert.equal((await copilot.read({ workspaceId, agentId: "a" })).document?.openComments, 1);
  assert.deepEqual(Object.keys(await copilot.summary("a")).sort(), ["cadence", "documentId", "enabled", "rule"], "tool responses carry no comment count");
});

test("extensions: lienzo.comments lists for free and writes with edit, documented in the guide", async () => {
  const { EXTENSION_RUNTIME, EXTENSION_GUIDE } = await import("../plugin/shared/extensions");
  const posted: { method: string; args: unknown }[] = [], listeners: ((e: unknown) => void)[] = [];
  const parent = { postMessage: (m: { type: string; method: string; args: unknown }) => { if (m.type === "call") posted.push({ method: m.method, args: m.args }); } };
  const window: Record<string, unknown> = { addEventListener: (type: string, fn: (e: unknown) => void) => { if (type === "message") listeners.push(fn); } };
  new Function("window", "parent", "document", "requestAnimationFrame", EXTENSION_RUNTIME)(window, parent, {}, () => 0);
  const lienzo = window.lienzo as { comments: Record<string, (...a: unknown[]) => Promise<unknown>> };
  assert.deepEqual(Object.keys(lienzo.comments).sort(), ["create", "list", "reply", "resolve"]);
  void lienzo.comments.list(); void lienzo.comments.create({ kind: "block", id: "b" }, "Hi"); void lienzo.comments.reply("t1", "Yes"); void lienzo.comments.resolve("t1");
  assert.deepEqual(posted, [{ method: "comments.list", args: { status: "open" } }, { method: "comments.create", args: { anchor: { kind: "block", id: "b" }, text: "Hi" } }, { method: "comments.reply", args: { threadId: "t1", text: "Yes" } }, { method: "comments.resolve", args: { threadId: "t1" } }]);
  assert.match(EXTENSION_GUIDE, /lienzo\.comments/); assert.match(EXTENSION_GUIDE, /need "edit"/);
});
