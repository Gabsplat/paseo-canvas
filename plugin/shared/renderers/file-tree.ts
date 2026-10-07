import { z } from "zod";
import type { RendererSpec } from "./spec";
export const FILE_TREE_LIMITS = { entries: 200, depth: 8, path: 300, note: 120 } as const;
const segment = /^[^/\u0000-\u001f]+$/;
const pathSchema = z.string().min(1).max(FILE_TREE_LIMITS.path).refine(path => {
  const parts = path.replace(/\/$/, "").split("/");
  return !path.startsWith("/") && parts.length <= FILE_TREE_LIMITS.depth && parts.every(part => segment.test(part) && part !== "." && part !== "..");
}, "Use a relative path such as src/lib/ or src/index.ts, at most 8 levels deep.");
const entrySchema = z.object({
  /** Relative path. A trailing slash marks a directory; parents that are not listed are implied. */
  path: pathSchema,
  /** What it is for, in a few words. Shown beside the name. */
  note: z.string().max(FILE_TREE_LIMITS.note).optional(),
  /** One of the few entries the explanation is about. */
  highlight: z.boolean().optional(),
  /** Present but beside the point: generated, ignored or vendored. */
  muted: z.boolean().optional(),
}).strict();
export const fileTreeDataSchema = z.object({
  root: z.string().max(120).optional(),
  entries: z.array(entrySchema).min(1).max(FILE_TREE_LIMITS.entries),
  /** Directories that start closed. The reader can open them; that choice is not stored. */
  collapsed: z.array(pathSchema).max(50).optional(),
}).strict().superRefine((data, context) => {
  const seen = new Set<string>();
  data.entries.forEach((entry, index) => { const key = entry.path.replace(/\/$/, ""); if (seen.has(key)) context.addIssue({ code: "custom", path: ["entries", index, "path"], message: `Duplicate path ${entry.path}.` }); seen.add(key); });
});
export type FileTreeData = z.infer<typeof fileTreeDataSchema>;
export type FileTreeRow = { path: string; name: string; depth: number; dir: boolean; note?: string; highlight: boolean; muted: boolean; children: number };
/**
 * The tree as display rows, parents before children. Siblings keep the order the author listed them in, so the
 * tree reads in the order of the explanation; a directory that is only implied by its children is created for them.
 */
export function fileTreeRows(data: FileTreeData): FileTreeRow[] {
  type Node = FileTreeRow & { kids: Node[] };
  const root: Node[] = [], byPath = new Map<string, Node>();
  const ensure = (path: string, dir: boolean): Node => {
    const known = byPath.get(path); if (known) { if (dir) known.dir = true; return known; }
    const cut = path.lastIndexOf("/"), parent = cut < 0 ? null : ensure(path.slice(0, cut), true);
    const node: Node = { path, name: path.slice(cut + 1), depth: parent ? parent.depth + 1 : 0, dir, highlight: false, muted: false, children: 0, kids: [] };
    byPath.set(path, node); (parent ? parent.kids : root).push(node); return node;
  };
  for (const entry of data.entries) {
    const node = ensure(entry.path.replace(/\/$/, ""), entry.path.endsWith("/"));
    if (entry.note) node.note = entry.note; node.highlight = !!entry.highlight; node.muted = !!entry.muted;
  }
  const rows: FileTreeRow[] = [];
  const walk = (nodes: Node[], muted: boolean) => nodes.forEach(({ kids, ...row }) => { rows.push({ ...row, dir: row.dir || kids.length > 0, muted: row.muted || muted, children: kids.length }); walk(kids, row.muted || muted); });
  walk(root, false); return rows;
}
/** Rows left once the closed directories hide what they contain. */
export function visibleFileTreeRows(rows: readonly FileTreeRow[], closed: ReadonlySet<string>): FileTreeRow[] {
  return rows.filter(row => { for (let cut = row.path.lastIndexOf("/"); cut >= 0; cut = row.path.lastIndexOf("/", cut - 1)) if (closed.has(row.path.slice(0, cut))) return false; return true; });
}
export const fileTreeSpec = {
  id: "file-tree", dataSchema: fileTreeDataSchema, interactive: false,
  guidance: "Use file-tree for folder and repository structures; never draw a tree with ASCII characters in a code block. data.entries is a flat list of relative paths in reading order; a trailing slash marks a directory and unlisted parents are implied. note says in a few words what an entry is for. highlight the one to three entries the explanation is about, mark generated or vendored ones muted, and list directories that should start closed in data.collapsed. Show the part that matters (about 40 entries at most), not the whole disk.",
  blockType: { id: "file-tree", name: "Árbol de archivos", description: "Carpetas y archivos con una nota breve por entrada. Las carpetas se abren y cierran.", renderer: "file-tree",
    properties: [{ key: "root", label: "Raíz", kind: "text", required: false }, { key: "entries", label: "Entradas", kind: "json", required: true }, { key: "collapsed", label: "Carpetas cerradas", kind: "json", required: false }],
    defaults: { root: "proyecto/", entries: [{ path: "src/", note: "código" }, { path: "src/index.ts", note: "punto de entrada" }, { path: "README.md", note: "cómo empezar" }] } },
} satisfies RendererSpec;
