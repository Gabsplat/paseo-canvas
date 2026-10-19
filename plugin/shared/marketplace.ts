/**
 * The extensions catalog: a public GitHub repository (its contents live in marketplace/ of this repo until the owner
 * publishes it) with one folder per file, extensions/<id>/extension.json, and an index.json its CI builds and
 * validates. The app reads the index over the network (kept for offline use), installs through the usual review, and
 * prepares a submission as a pull request in the person's browser. It never holds a GitHub token.
 *
 * To point the app at another repository, change MARKETPLACE below (docs/extensions.md, "Catalog").
 */
import { z } from "zod";
import { idSchema, extensionPermissionSchema } from "./model";
import { actionNameSchema } from "./actions";

export const MARKETPLACE = { repository: "Gabsplat/lienzo-extensions", branch: "main" } as const;
export type MarketplaceConfig = { repository: string; branch: string };
export const MARKETPLACE_LIMITS = { index: 2 * 1024 * 1024, file: 1024 * 1024, entries: 500, prefilledUrl: 7500, timeoutMs: 10_000 } as const;

export function marketplaceUrls(config: MarketplaceConfig = MARKETPLACE) {
  const raw = (path: string) => `https://raw.githubusercontent.com/${config.repository}/${config.branch}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const web = `https://github.com/${config.repository}`;
  return {
    index: raw("index.json"), raw, web,
    folder: (id: string) => `${web}/tree/${config.branch}/extensions/${encodeURIComponent(id)}`,
    contributing: `${web}/blob/${config.branch}/CONTRIBUTING.md`,
    /** GitHub's new-file page with the path and the content filled in; it offers a fork and a pull request. */
    newFile: (path: string, value: string) => `${web}/new/${config.branch}?filename=${encodeURIComponent(path)}&value=${encodeURIComponent(value)}`,
    /** GitHub's upload page for a folder, for files too long for a link. */
    upload: (folder: string) => `${web}/upload/${config.branch}/${folder.split("/").map(encodeURIComponent).join("/")}`,
  };
}

const repoPath = z.string().max(300).regex(/^extensions\/[a-zA-Z0-9][a-zA-Z0-9._-]*\/[A-Za-z0-9._-]+$/);
export const marketplaceEntrySchema = z.object({
  /** The file's id, which is also its folder: extensions/<id>/. */
  id: idSchema, name: z.string().min(1).max(200), description: z.string().max(2000),
  /** The extensions inside, as the review will show them. */
  // Not strict: a field added to the index later is ignored by this version instead of making the whole list unreadable.
  extensions: z.array(z.object({ id: idSchema, name: z.string().min(1).max(80), description: z.string().max(600), icon: z.string().regex(/^[A-Za-z0-9]{1,40}$/).optional(), permissions: z.array(extensionPermissionSchema).max(4), docs: z.boolean(),
    /** The names of the actions it offers agents. */
    actions: z.array(actionNameSchema).max(20).optional() })).min(1).max(50),
  path: repoPath, sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().positive().max(MARKETPLACE_LIMITS.file),
  /**
   * SHA-256 of the file's extensions as canonical JSON (server/catalog.ts, extensionsHash): unlike sha256, the same
   * whatever the file's formatting, so Discover can compare it with what is installed and see a change in code.
   */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  author: z.string().max(100).optional(), updated: z.string().max(40).optional(),
  readme: repoPath.optional(), screenshot: repoPath.optional(),
}).refine(entry => entry.path === `extensions/${entry.id}/extension.json`, "An entry's file is extensions/<id>/extension.json.")
  .refine(entry => entry.extensions.every(e => e.id.startsWith(`${entry.id}.`)), "Every extension id starts with the file's id and a dot.");
export const marketplaceIndexSchema = z.object({
  format: z.literal("lienzo-extension-index"), version: z.literal(1),
  repository: z.string().max(200), generatedAt: z.string().max(40),
  entries: z.array(marketplaceEntrySchema).max(MARKETPLACE_LIMITS.entries),
}).strict().refine(index => new Set(index.entries.map(e => e.id)).size === index.entries.length, "The index repeats a file id.");
export type MarketplaceIndex = z.infer<typeof marketplaceIndexSchema>;
export type MarketplaceEntry = MarketplaceIndex["entries"][number];

/** What the screen says when the catalog cannot be read. Raw network errors are never shown. */
export const MARKETPLACE_MESSAGES = {
  offline: "The catalog could not be reached. Check your connection and try again.",
  invalid: "The catalog sent a list Lienzo cannot read. Try again later.",
  file: "That extension's file could not be downloaded. Try again later.",
  changed: "That extension's file does not match the catalog. It was not installed.",
  large: "That extension's file is over 1 MB.",
} as const;
export class MarketplaceError extends Error { constructor(readonly reason: keyof typeof MARKETPLACE_MESSAGES) { super(MARKETPLACE_MESSAGES[reason]); } }

/** What the catalog needs from the device: a bounded download, a place to keep the last list, and SHA-256 when there is one. */
export type MarketplaceDeps = {
  fetchText(url: string, limit: number): Promise<string>;
  cache: { read(): string | null; write(text: string): void };
  sha256?(text: string): Promise<string | null>;
  now?(): number;
};
export type LoadedIndex = { index: MarketplaceIndex; source: "network" | "cache"; fetchedAt: number; stale?: string };

function parseIndex(text: string): MarketplaceIndex | null {
  try { const parsed = marketplaceIndexSchema.safeParse(JSON.parse(text)); return parsed.success ? parsed.data : null; } catch { return null; }
}
function readCache(deps: MarketplaceDeps): { index: MarketplaceIndex; fetchedAt: number } | null {
  try {
    const kept = JSON.parse(deps.cache.read() ?? "null") as { fetchedAt?: unknown; text?: unknown } | null;
    const index = kept && typeof kept.text === "string" ? parseIndex(kept.text) : null;
    return index && typeof kept!.fetchedAt === "number" ? { index, fetchedAt: kept!.fetchedAt } : null;
  } catch { return null; }
}
/** The kept list, if any, without the network: shown at once while the fresh one loads. */
export const cachedIndex = (deps: MarketplaceDeps): LoadedIndex | null => { const kept = readCache(deps); return kept ? { ...kept, source: "cache" } : null; };

/**
 * The published list: from the network when it answers with a valid index (and kept), otherwise the kept one with the
 * reason it is stale. With neither, a MarketplaceError says why.
 */
export async function loadIndex(deps: MarketplaceDeps, config: MarketplaceConfig = MARKETPLACE): Promise<LoadedIndex> {
  const now = deps.now?.() ?? Date.now();
  let reason: keyof typeof MARKETPLACE_MESSAGES = "offline";
  try {
    const text = await deps.fetchText(marketplaceUrls(config).index, MARKETPLACE_LIMITS.index), index = parseIndex(text);
    if (index) { try { deps.cache.write(JSON.stringify({ fetchedAt: now, text })); } catch { /* a full store keeps the old list */ } return { index, source: "network", fetchedAt: now }; }
    reason = "invalid";
  } catch { reason = "offline"; }
  const kept = readCache(deps);
  if (kept) return { ...kept, source: "cache", stale: MARKETPLACE_MESSAGES[reason] };
  throw new MarketplaceError(reason);
}

/** One entry's file, checked against the index (size, SHA-256 when the device has it, its id), as text for the review. */
export async function downloadEntry(deps: MarketplaceDeps, entry: MarketplaceEntry, config: MarketplaceConfig = MARKETPLACE): Promise<string> {
  let text: string;
  try { text = await deps.fetchText(marketplaceUrls(config).raw(entry.path), MARKETPLACE_LIMITS.file); }
  catch (error) { throw error instanceof Error && /1 MB|too large|larger/i.test(error.message) ? new MarketplaceError("large") : new MarketplaceError("file"); }
  const hash = await deps.sha256?.(text);
  if (hash && hash !== entry.sha256) throw new MarketplaceError("changed");
  try { if ((JSON.parse(text) as { id?: unknown }).id !== entry.id) throw new MarketplaceError("changed"); }
  catch (error) { throw error instanceof MarketplaceError ? error : new MarketplaceError("file"); }
  return text;
}

/**
 * A submission for one file: where it goes in the catalog and the GitHub page that proposes it. A short file is put
 * in the link itself; a longer one opens the folder's upload page, for the file the app has just saved.
 */
export function submission(file: { id: string }, text: string, config: MarketplaceConfig = MARKETPLACE): { path: string; url: string; method: "prefilled" | "upload" } {
  const urls = marketplaceUrls(config), path = `extensions/${file.id}/extension.json`, prefilled = urls.newFile(path, text);
  return prefilled.length <= MARKETPLACE_LIMITS.prefilledUrl ? { path, url: prefilled, method: "prefilled" } : { path, url: urls.upload(`extensions/${file.id}`), method: "upload" };
}
