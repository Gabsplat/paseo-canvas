import { createHash } from "node:crypto";
import { z } from "zod";
import type { RpcInput, RpcOutput } from "../shared/contract";
import type * as rpc from "../shared/rpc";
import { CanvasError } from "../shared/errors";
import { builtinTypes } from "../shared/builtins";
import { actionScripts } from "../shared/actions";
import { isRetiredRenderer } from "../shared/renderers";
import { cleanRuntime, RUNTIME_DOCUMENT_BYTES, type JSONValue, type RuntimeState } from "../shared/learning";
import { COMMENT_LIMITS, commentsRecordSchema, type CommentThread } from "../shared/comments";
import { EXTENSION_LIMITS } from "../shared/extensions";
import { MEDIA_TYPES, fromBase64, mediaRef, prepareImage, type MediaExtension } from "../shared/media";
import { documentSchema, packSchema, type BlockType, type CanvasCatalog, type CanvasPack, type DocumentContent } from "../shared/model";
import {
  LIENZO_FILE, importedTitle, lienzoFileName, lienzoFileSchema, mediaExtensionOf, mediaKeyOf, mediaRefsIn, readLienzoText, replaceMediaRefs,
  type LienzoExtension, type LienzoFile, type LienzoReview,
} from "../shared/lienzo-file";
import { canonicalJson, catalogView, validateType } from "./catalog";
import { clone, newId, normalizeBlock, safeJson, validateDocument } from "./reducer";
import { documentRecord, type CanvasState, type CanvasStore } from "./store";
import type { MediaStore } from "./media";

const MB = 1024 * 1024, DOCUMENT_BYTES = MB;
const tooLarge = (bytes: number) => new CanvasError("TOO_LARGE", `This Lienzo is ${(bytes / MB).toFixed(1)} MB with its images; a .lienzo file can be up to ${LIENZO_FILE.maxBytes / MB} MB. Remove some images and try again.`);
const comparable = (value: unknown) => canonicalJson(value);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * Writes one Lienzo as a .lienzo file's text. The document as it is now, without history, revision, connection or
 * selection; every stored image it shows; the custom block types it uses; the extensions that keep state on it.
 * Comments and runtime (what people did with interactive blocks, extension storage) only when asked for.
 */
export async function exportLienzo(store: CanvasStore, media: MediaStore, input: RpcInput<typeof rpc.exportLienzo>, app: { name: string; version: string }) {
  const state = await store.read(), record = documentRecord(state, input.documentId, input.workspaceId), catalog = catalogView(state.catalog);
  const { id: _id, workspaceId: _workspace, revision: _revision, createdAt: _created, updatedAt: _updated, ...content } = clone(record.document);
  const document: DocumentContent = { ...content, selectedIds: [] };
  const files: LienzoFile["media"] = {}; let missingImages = 0;
  for (const ref of mediaRefsIn(document)) {
    try { const image = await media.read(ref); files[mediaKeyOf(ref)!] = { type: image.mime, data: image.data }; }
    catch { missingImages++; }
  }
  const shipped = new Set(builtinTypes.map(type => type.id)), used = new Set(document.blocks.map(block => block.typeId));
  const blockTypes = catalog.blockTypes.filter(type => used.has(type.id) && !shipped.has(type.id));
  const extensions: LienzoExtension[] = Object.keys(record.extensionStorage ?? {}).flatMap(id => {
    const held = catalog.extensions.find(extension => extension.id === id); if (!held) return [];
    const { source, granted: _granted, ...extension } = held, pack = catalog.packs.find(item => item.id === source);
    return [{ ...extension, ...(pack ? { pack: { id: pack.id, name: pack.name, description: pack.description } } : {}) }];
  });
  const runtime = input.runtime ? { ...clone(record.runtime), ...(record.extensionStorage && Object.keys(record.extensionStorage).length ? { extensionStorage: clone(record.extensionStorage) } : {}) } : undefined;
  const file: LienzoFile = lienzoFileSchema.parse({
    format: LIENZO_FILE.format, version: LIENZO_FILE.version, exportedAt: new Date().toISOString(), app, document,
    ...(input.comments ? { comments: clone(record.comments?.threads ?? []) } : {}), ...(runtime ? { runtime } : {}),
    media: files, catalog: { blockTypes, extensions },
  });
  const text = JSON.stringify(file), bytes = Buffer.byteLength(text);
  if (bytes > LIENZO_FILE.maxBytes) throw tooLarge(bytes);
  return { fileName: lienzoFileName(document.title), mime: LIENZO_FILE.mime, text, bytes, images: Object.keys(files).length, missingImages };
}

type PreparedImage = { key: string; ref: string; next: string; extension: MediaExtension; mime: string; bytes: Uint8Array };
/** Reads and checks the whole file, images included, before anything is written. Bad input never reaches the store. */
function parseFile(text: string): { file: LienzoFile; images: PreparedImage[]; missing: number; bytes: number } {
  const bytes = Buffer.byteLength(text);
  if (bytes > LIENZO_FILE.maxBytes) throw new CanvasError("TOO_LARGE", `A .lienzo file can be up to ${LIENZO_FILE.maxBytes / MB} MB; this one is ${(bytes / MB).toFixed(1)} MB.`);
  let raw: unknown;
  try { raw = readLienzoText(text); } catch (error) { throw new CanvasError("VALIDATION", (error as Error).message); }
  safeJson(raw);
  const parsed = lienzoFileSchema.safeParse(raw);
  if (!parsed.success) throw new CanvasError("VALIDATION", `This Lienzo file is damaged or was changed by hand: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "file"}: ${issue.message}`).join("; ")}.`);
  const file = parsed.data, images: PreparedImage[] = []; let missing = 0;
  for (const ref of mediaRefsIn(file.document)) {
    const key = mediaKeyOf(ref)!, entry = Object.hasOwn(file.media, key) ? file.media[key] : undefined;
    if (!entry) { missing++; continue; }
    const extension = mediaExtensionOf(key), data = fromBase64(entry.data);
    if (entry.type !== MEDIA_TYPES[extension] || !data) throw new CanvasError("VALIDATION", `The image ${key.slice(0, 12)}… in this file is damaged.`);
    // The name is the content: an image whose bytes do not match its name was changed after export.
    if (sha256(data) !== key.slice(0, 64)) throw new CanvasError("VALIDATION", `The image ${key.slice(0, 12)}… in this file does not match its name; the file was changed after it was exported.`);
    let image;
    try { image = prepareImage(data); } catch (error) { throw new CanvasError((error as { code?: string }).code === "TOO_LARGE" ? "TOO_LARGE" : "VALIDATION", `An image in this file was refused: ${(error as Error).message}`); }
    if (image.extension !== extension) throw new CanvasError("VALIDATION", `The image ${key.slice(0, 12)}… in this file is not the kind of image its name says.`);
    images.push({ key, ref, next: mediaRef(sha256(image.bytes), image.extension), extension: image.extension, mime: image.mime, bytes: image.bytes });
  }
  return { file, images, missing, bytes };
}

const statusOf = (held: unknown, incoming: unknown) => held === undefined ? "new" as const : comparable(held) === comparable(incoming) ? "installed" as const : "conflict" as const;
const extensionContent = ({ source: _source, granted: _granted, ...extension }: CanvasCatalog["extensions"][number]) => extension;

/**
 * What importing this file into this state would do, and the change itself. The same function serves the review (on
 * a read of the state) and the import (inside one store transaction), so the review never promises what the import
 * would not do.
 */
function planImport(state: CanvasState, workspaceId: string, parsed: ReturnType<typeof parseFile>) {
  const { file, images, missing } = parsed, catalog = catalogView(state.catalog), warnings: string[] = [];
  // Block types: a missing one is installed in this computer's own catalog; an installed one with the same id but
  // different content stays as it is (it may be in use elsewhere) and the person is told.
  const types = file.catalog.blockTypes.map(type => ({ type, status: statusOf(catalog.blockTypes.find(held => held.id === type.id), type) }));
  const newTypes: BlockType[] = [];
  for (const { type, status } of types) {
    if (status === "conflict") warnings.push(`This computer already has a different block type “${type.name}” (${type.id}). Yours is kept, so those blocks may look different.`);
    if (status !== "new") continue;
    if (isRetiredRenderer(type.renderer) || isRetiredRenderer(type.id)) throw new CanvasError("VALIDATION", `The block type ${type.id} in this file uses a renderer this Lienzo no longer has.`);
    const copy = clone(type); validateType(copy); newTypes.push(copy);
  }
  const known = new Set([...catalog.blockTypes.map(type => type.id), ...newTypes.map(type => type.id)]);
  const unknown = [...new Set(file.document.blocks.map(block => block.typeId).filter(id => !known.has(id)))];
  if (unknown.length) throw new CanvasError("UNKNOWN_TYPE", `This Lienzo uses block types this computer does not have and the file does not bring: ${unknown.slice(0, 5).join(", ")}.`);
  // Extensions: installed in an extension file of their own, never granted. Until the person allows them they only read.
  const extensions = file.catalog.extensions.map(extension => { const { pack: _pack, ...content } = extension, held = catalog.extensions.find(item => item.id === extension.id); return { extension, content, status: statusOf(held && extensionContent(held), content) }; });
  if (new Set(extensions.map(e => e.extension.id)).size !== extensions.length) throw new CanvasError("VALIDATION", "This file repeats an extension.");
  const packs = new Map<string, CanvasPack>(), title = file.document.title;
  let fallback: CanvasPack | undefined;
  for (const { extension, content, status } of extensions) {
    if (status === "conflict") warnings.push(`This computer already has a different “${extension.name}” extension. Yours is kept.`);
    if (status !== "new") continue;
    if (new Set(content.permissions).size !== content.permissions.length) throw new CanvasError("VALIDATION", `Extension ${content.id} repeats a permission.`);
    if (content.actions?.length && !actionScripts(content.html).length) throw new CanvasError("VALIDATION", `Extension ${content.id} declares actions but has no script that registers them.`);
    const from = extension.pack, own = from && content.id.startsWith(`${from.id}.`) && !catalog.packs.some(pack => pack.id === from.id || pack.id.startsWith(`${from.id}.`) || from.id.startsWith(`${pack.id}.`));
    if (own) {
      const pack = packs.get(from.id) ?? packSchema.parse({ format: "paseo-canvas-pack", version: 1, id: from.id, name: from.name, description: from.description, blockTypes: [], templates: [], documents: [], extensions: [] });
      pack.extensions.push(clone(content)); packs.set(from.id, pack);
    } else {
      fallback ??= packSchema.parse({ format: "paseo-canvas-pack", version: 1, id: newId("lienzo-file"), name: `From “${title.slice(0, 160)}”`, description: "Extensions that came with a .lienzo file.", blockTypes: [], templates: [], documents: [], extensions: [] });
      fallback.extensions.push(clone(content));
    }
  }
  const newPacks = [...packs.values(), ...(fallback ? [fallback] : [])];
  if (missing) warnings.push(missing === 1 ? "One image was not in the file; it shows as missing." : `${missing} images were not in the file; they show as missing.`);
  // The document: new id, a title no other Lienzo of the workspace has, images under the names this computer keeps.
  const taken = Object.values(state.documents).filter(record => record.document.workspaceId === workspaceId).map(record => record.document.title);
  const importTitle = importedTitle(title, taken), refs = new Map(images.filter(image => image.ref !== image.next).map(image => [image.ref, image.next]));
  const now = new Date().toISOString(), id = newId("doc");
  const document = documentSchema.parse({ ...replaceMediaRefs(file.document, refs), title: importTitle, selectedIds: [], id, workspaceId, revision: 0, createdAt: now, updatedAt: now });
  const extended: CanvasCatalog = { ...catalog, blockTypes: [...catalog.blockTypes, ...newTypes] };
  for (const block of document.blocks) normalizeBlock(block, extended.blockTypes.find(type => type.id === block.typeId)!);
  validateDocument(document, extended);
  if (Buffer.byteLength(JSON.stringify(document)) > DOCUMENT_BYTES) throw new CanvasError("TOO_LARGE", "A document cannot exceed 1 MiB.");
  // Comments as they were, authors kept, marked imported. Ids are new so a thread is never found on two Lienzos.
  let comments: { version: number; threads: CommentThread[] } | undefined;
  if (file.comments?.length) {
    const present = new Set([...document.blocks, ...document.groups].map(entity => entity.id));
    const threads = file.comments.map((thread, index): CommentThread => {
      const anchor = thread.anchor.kind !== "point" && !present.has(thread.anchor.id) ? { kind: "point" as const, ...(thread.anchor.at ?? { x: 24 + index % 10 * 32, y: 24 }) } : clone(thread.anchor);
      return { ...clone(thread), id: newId("thread"), anchor, imported: true, messages: thread.messages.map(message => ({ ...clone(message), id: newId("msg") })) };
    });
    comments = commentsRecordSchema.parse({ version: 1, threads });
    if (Buffer.byteLength(JSON.stringify(comments)) > COMMENT_LIMITS.bytes) throw new CanvasError("TOO_LARGE", "The comments in this file exceed 1 MiB.");
  }
  // Runtime: only for blocks and variables that are there; extension storage only for extensions this computer will have.
  let runtime: RuntimeState = { blocks: {}, scopes: {} }, extensionStorage: Record<string, JSONValue> | undefined;
  if (file.runtime) {
    const { extensionStorage: storage, ...state } = clone(file.runtime); runtime = state; cleanRuntime(document, runtime);
    if (Buffer.byteLength(JSON.stringify(runtime)) > RUNTIME_DOCUMENT_BYTES) throw new CanvasError("TOO_LARGE", "The interactive state in this file exceeds 256 KiB.");
    const present = new Set([...catalog.extensions.map(e => e.id), ...newPacks.flatMap(pack => pack.extensions.map(e => e.id))]);
    const kept = Object.entries(storage ?? {}).filter(([key]) => present.has(key));
    if (kept.length > EXTENSION_LIMITS.storedExtensions) throw new CanvasError("TOO_LARGE", `At most ${EXTENSION_LIMITS.storedExtensions} extensions keep storage on one Lienzo.`);
    for (const [key, value] of kept) if (Buffer.byteLength(JSON.stringify(value)) > EXTENSION_LIMITS.storage) throw new CanvasError("TOO_LARGE", `The stored state of extension ${key} exceeds ${EXTENSION_LIMITS.storage / 1024} KiB.`);
    if (kept.length) extensionStorage = Object.fromEntries(kept);
  }
  const review: LienzoReview = {
    title, importTitle, description: file.document.description, exportedAt: file.exportedAt, app: file.app,
    blocks: document.blocks.length, frames: document.groups.filter(g => !g.sheet).length, sheets: document.groups.filter(g => g.sheet).length, links: document.links.length,
    images: { count: images.length, bytes: images.reduce((sum, image) => sum + image.bytes.length, 0), missing },
    comments: file.comments ? file.comments.length : null, runtime: !!file.runtime,
    blockTypes: types.map(({ type, status }) => ({ id: type.id, name: type.name, status })),
    extensions: extensions.map(({ content, status }) => ({ id: content.id, name: content.name, description: content.description, ...(content.icon ? { icon: content.icon } : {}), permissions: [...content.permissions], status })),
    warnings, bytes: parsed.bytes,
  };
  const apply = (next: CanvasState) => {
    if (newTypes.length || newPacks.length) {
      next.catalog.localTypes = [...next.catalog.localTypes, ...newTypes];
      next.catalog.packs = [...next.catalog.packs, ...newPacks];
      next.catalog.revision++;
    }
    next.documents[id] = { document, history: [], connection: null, selectionVersion: 0, runtimeVersion: 0, runtime, ...(extensionStorage ? { extensionStorage } : {}), ...(comments ? { comments } : {}) };
    return id;
  };
  return { review, apply };
}

/**
 * Reads a .lienzo file. dryRun answers the review and writes nothing. Otherwise images are written first (by content,
 * so one already kept is not written again), then the Lienzo, its types and extensions in one store transaction; if
 * that fails, the images this import wrote are removed again. Nothing is ever overwritten.
 */
export async function importLienzo(store: CanvasStore, media: MediaStore, input: RpcInput<typeof rpc.importLienzo>): Promise<RpcOutput<typeof rpc.importLienzo>> {
  const parsed = parseFile(input.text);
  if (input.dryRun) {
    const { review } = planImport(await store.read(), input.workspaceId, parsed);
    return { ...review, preview: parsed.file.document, committed: false };
  }
  // Checked against the current state before any image is written: a file that cannot be imported writes nothing.
  planImport(await store.read(), input.workspaceId, parsed);
  const written: string[] = [];
  try {
    for (const image of parsed.images) { const stored = await media.putPrepared(image); if (!stored.existed) written.push(stored.url); }
    const result = await store.transaction(state => { const plan = planImport(state, input.workspaceId, parsed); return { review: plan.review, documentId: plan.apply(state) }; });
    return { ...result.review, committed: true, documentId: result.documentId };
  } catch (error) {
    await Promise.all(written.map(url => media.discard(url).catch(() => {})));
    if (error instanceof z.ZodError) throw new CanvasError("VALIDATION", `This Lienzo file could not be imported: ${error.issues[0]?.message ?? "invalid content"}.`);
    throw error;
  }
}
