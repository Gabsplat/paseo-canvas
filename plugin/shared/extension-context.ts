import type { CanvasCatalog, CanvasDocument } from "./model";
import type { ExtensionView } from "./extensions";

/**
 * What an open extension is told, and how often (docs/extensions.md, "Cost model"). Pure, so the frame code in
 * client/Extensions.tsx stays a thin wire and tests can count bytes.
 *
 * The context goes whole once per page load, then as patches of the top-level parts that changed: a selection is a few
 * bytes, not the document again. The document part follows the extension's choice (`context.document` in its manifest,
 * or lienzo.setContext): "full" (blocks with their data), "outline" (ids, titles, types, parents, groups and links; no
 * block data) or "none" (id, title, description and revision only). lienzo.read(ids) brings whole entities on demand.
 */
export const CONTEXT_DOCUMENT_MODES = ["full", "outline", "none"] as const;
export type ContextDocumentMode = typeof CONTEXT_DOCUMENT_MODES[number];
export const isContextDocumentMode = (value: unknown): value is ContextDocumentMode => (CONTEXT_DOCUMENT_MODES as readonly unknown[]).includes(value);
type Box = { x: number; y: number; width: number; height: number };

const rendererOf = (catalog: Pick<CanvasCatalog, "blockTypes"> | null | undefined) => { const map = new Map((catalog?.blockTypes ?? []).map(t => [t.id, t.renderer])); return (typeId: string) => map.get(typeId) ?? null; };
const groupEntry = (g: CanvasDocument["groups"][number]) => ({ id: g.id, title: g.title, description: g.description, blockIds: g.blockIds, groupIds: g.groupIds, parentGroupId: g.parentGroupId ?? null });
const linkEntry = (l: CanvasDocument["links"][number]) => ({ id: l.id, from: l.from, to: l.to, kind: l.kind, label: l.label ?? "" });
/** context.document in the extension's mode. `mode` is always there, so a page can tell what it holds. */
export function contextDocument(doc: CanvasDocument, catalog: Pick<CanvasCatalog, "blockTypes"> | null | undefined, mode: ContextDocumentMode) {
  const head = { id: doc.id, title: doc.title, description: doc.description, revision: doc.revision, mode };
  if (mode === "none") return head;
  const renderer = rendererOf(catalog);
  return { ...head,
    blocks: doc.blocks.map(b => ({ id: b.id, title: b.title, typeId: b.typeId, renderer: renderer(b.typeId), ...(mode === "full" ? { data: b.data } : {}), parentGroupId: b.parentGroupId ?? null })),
    groups: doc.groups.map(groupEntry), links: (doc.links ?? []).map(linkEntry) };
}
/** lienzo.read(ids): those blocks, groups and links whole (a block with its data), whatever the context mode. */
export function contextEntities(doc: CanvasDocument, catalog: Pick<CanvasCatalog, "blockTypes"> | null | undefined, ids: readonly string[]) {
  const wanted = new Set(ids), renderer = rendererOf(catalog);
  return { revision: doc.revision,
    blocks: doc.blocks.filter(b => wanted.has(b.id)).map(b => ({ id: b.id, title: b.title, typeId: b.typeId, renderer: renderer(b.typeId), data: b.data, parentGroupId: b.parentGroupId ?? null })),
    groups: doc.groups.filter(g => wanted.has(g.id)).map(groupEntry), links: (doc.links ?? []).filter(l => wanted.has(l.id)).map(linkEntry) };
}

/** One part of the context: a key that changes exactly when the part does, and how to build it (only when it did). */
export type ContextPart = readonly [key: unknown, build: () => unknown];
/**
 * Tells one frame its context. The first push after reset (a page that just loaded) sends `{ type: "context", context }`
 * with every part; later pushes send `{ type: "patch", patch }` with only the parts whose key changed, or nothing.
 */
export class ContextChannel {
  private keys = new Map<string, unknown>(); private live = false;
  constructor(private readonly post: (message: Record<string, unknown>) => void) {}
  reset() { this.keys.clear(); this.live = false; }
  push(parts: Record<string, ContextPart>): Record<string, unknown> | null {
    const changed = Object.entries(parts).filter(([name, [key]]) => !this.live || !this.keys.has(name) || this.keys.get(name) !== key);
    if (!changed.length) return null;
    const body = Object.fromEntries(changed.map(([name, [key, build]]) => { this.keys.set(name, key); return [name, build()]; }));
    const message = this.live ? { type: "patch", patch: body } : { type: "context", context: body };
    this.live = true; this.post(message); return message;
  }
}

/** The camera as a per-frame message carries it: scale, offset (screen = world · scale + offset), the world rect on screen, the canvas size. */
export type CameraState = { scale: number; offset: { x: number; y: number }; bounds: Box; screen: { width: number; height: number }; version: number };
export function cameraState(camera: { scale: number; bounds: Box }, version: number): CameraState {
  const k = camera.scale, b = camera.bounds, r = (n: number) => Math.round(n * 1000) / 1000;
  return { scale: r(k), offset: { x: r(-b.x * k), y: r(-b.y * k) }, bounds: { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) }, screen: { width: Math.round(b.width * k), height: Math.round(b.height * k) }, version };
}
/** World rect (or point) → canvas pixels with a camera; the same math lienzo.view.toScreen runs in the frame. */
export function toScreen<T extends { x: number; y: number; width?: number; height?: number }>(rect: T, camera: Pick<CameraState, "scale" | "bounds">) {
  const k = camera.scale, b = camera.bounds;
  return { x: (rect.x - b.x) * k, y: (rect.y - b.y) * k, ...(rect.width !== undefined ? { width: rect.width * k, height: (rect.height ?? 0) * k } : {}) };
}
export function toWorld<T extends { x: number; y: number; width?: number; height?: number }>(rect: T, camera: Pick<CameraState, "scale" | "bounds">) {
  const k = camera.scale, b = camera.bounds;
  return { x: rect.x / k + b.x, y: rect.y / k + b.y, ...(rect.width !== undefined ? { width: rect.width / k, height: (rect.height ?? 0) / k } : {}) };
}
/** How long the camera must stay still before the exact view (rects, visibleIds) is sent. */
export const VIEW_SETTLE_MS = 120;
/**
 * The camera, to one frame holding "view": while it moves, at most one `{ type: "camera" }` message per animation frame,
 * and only if the page listens (lienzo.view.onChange); once it has been still for VIEW_SETTLE_MS, one exact
 * `{ type: "view" }` (visibleIds and rects in pixels), which also keeps context.view current for pages that do not listen.
 */
export class ViewPump {
  watching = false;
  private version = 0; private raf: unknown = null; private last = 0; private dirty = false;
  constructor(private readonly o: { frame(run: () => void): unknown; cancel(id: unknown): void; now(): number; camera(): { scale: number; bounds: Box } | null; view(): ExtensionView | null; send(message: Record<string, unknown>): void; settleMs?: number }) {}
  /** The camera (or what is under it) changed. */
  moved() { this.version++; this.dirty = true; this.last = this.o.now(); if (this.raf === null) this.raf = this.o.frame(this.tick); }
  /** The exact view now (a page that just loaded), without waiting for the camera to settle. */
  settle() { this.stop(); this.dirty = false; this.sendView(); }
  stop() { if (this.raf !== null) this.o.cancel(this.raf); this.raf = null; }
  private readonly tick = () => {
    this.raf = null;
    if (this.dirty) { this.dirty = false; const camera = this.watching ? this.o.camera() : null; if (camera) this.o.send({ type: "camera", camera: cameraState(camera, this.version) }); }
    if (this.o.now() - this.last >= (this.o.settleMs ?? VIEW_SETTLE_MS)) { this.sendView(); return; }
    this.raf = this.o.frame(this.tick);
  };
  private sendView() {
    const view = this.o.view(), camera = this.o.camera(); if (!view) return;
    this.o.send({ type: "view", view: { ...view, ...(camera ? { offset: cameraState(camera, this.version).offset } : {}), version: this.version, moving: false } });
  }
}
