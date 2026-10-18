#!/usr/bin/env node
// Validates every extensions/<id>/ folder and writes index.json, the list Lienzo's Discover tab reads.
// No dependencies: Node 20 or later. The rules match Lienzo's own (plugin/shared/model.ts and marketplace.ts in
// github.com/Gabsplat/paseo-canvas); the app checks every file again before it installs anything.
//
//   node scripts/build-index.mjs            validate and write index.json
//   node scripts/build-index.mjs --check    validate only (pull requests); exit 1 on any problem
//   node scripts/build-index.mjs --root <dir> --out <file> --repository <owner/repo>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const root = resolve(flag("--root") ?? join(import.meta.dirname, "..")), out = flag("--out") ?? join(root, "index.json"), check = args.includes("--check");
const repository = flag("--repository") ?? process.env.GITHUB_REPOSITORY ?? "Gabsplat/lienzo-extensions";

const LIMITS = { file: 1024 * 1024, html: 300_000, docs: 20_000, sections: 12, screenshot: 512 * 1024, readme: 64 * 1024 };
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/, FOLDER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, ICON = /^[A-Za-z0-9]{1,40}$/;
const ALLOWED = new Set(["extension.json", "README.md", "screenshot.png"]);
const TAG = /<\/?[a-zA-Z!][^>]*>/, CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;
const SAFE_LINK = /^(help:[a-z0-9][a-z0-9.:-]{0,120}|mailto:[^\s<>"]+@[^\s<>"]+|https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?([/?#][^\s<>"'`]*)?)$/i;

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);
const isText = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max;
const only = (where, value, keys) => { for (const key of Object.keys(value)) if (!keys.includes(key)) fail(where, `unknown field "${key}"`); };
function docsIssue(docs) {
  const markdown = typeof docs === "string" ? docs : Array.isArray(docs) ? docs.map(s => `## ${s?.title ?? ""}\n\n${s?.body ?? ""}`).join("\n\n") : null;
  if (markdown === null) return "docs is Markdown text or a list of { title, body } sections";
  if (Array.isArray(docs)) { if (!docs.length || docs.length > LIMITS.sections) return `docs has 1 to ${LIMITS.sections} sections`; if (docs.some(s => !s || typeof s !== "object" || !isText(s.title, 1, 120) || typeof s.body !== "string" || Object.keys(s).some(k => k !== "title" && k !== "body"))) return "each docs section is { title (1-120 characters), body }"; }
  else if (!docs.length) return "docs is empty";
  if (markdown.length > LIMITS.docs) return `docs is at most ${LIMITS.docs} characters`;
  const prose = markdown.split(CODE).filter((_, i) => i % 2 === 0).join("\n");
  if (TAG.test(prose)) return "docs is Markdown only: no HTML (put markup in a code block)";
  for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) if (!SAFE_LINK.test(m[1])) return `docs links to "${m[1]}"; only http, https and mailto links are allowed`;
  return null;
}
function validateExtension(where, e, fileId) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return fail(where, "is not an object");
  only(where, e, ["id", "kind", "api", "name", "description", "icon", "html", "permissions", "docs"]);
  if (!isText(e.id, 1, 100) || !ID.test(e.id)) fail(where, "id is 1-100 letters, digits, . _ : -");
  else if (!e.id.startsWith(`${fileId}.`)) fail(where, `id must start with "${fileId}."`);
  if (e.kind !== "tool") fail(where, 'kind must be "tool"');
  if (e.api !== 1) fail(where, "api must be 1");
  if (!isText(e.name, 1, 80)) fail(where, "name is 1-80 characters");
  if (e.description !== undefined && !isText(e.description, 0, 600)) fail(where, "description is up to 600 characters");
  if (!isText(e.description ?? "", 1, 600)) fail(where, "the catalog needs a one-line description");
  if (e.icon !== undefined && (typeof e.icon !== "string" || !ICON.test(e.icon))) fail(where, "icon is a Lucide icon name, letters and digits");
  if (!isText(e.html, 1, LIMITS.html)) fail(where, `html is 1-${LIMITS.html} characters`);
  const permissions = e.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.length > 2 || new Set(permissions).size !== permissions.length || permissions.some(p => p !== "edit" && p !== "network")) fail(where, 'permissions is a list of "edit" and "network", without repeats');
  if (e.docs !== undefined) { const issue = docsIssue(e.docs); if (issue) fail(where, issue); }
}
function git(argsList) { try { return execFileSync("git", argsList, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }

const folder = join(root, "extensions"), entries = [];
const ids = existsSync(folder) ? readdirSync(folder).filter(name => statSync(join(folder, name)).isDirectory()).sort() : [];
for (const id of ids) {
  const dir = join(folder, id), where = `extensions/${id}`;
  if (!FOLDER.test(id) || id.length > 100) { fail(where, "the folder name is letters, digits, . _ -"); continue; }
  for (const name of readdirSync(dir)) if (!ALLOWED.has(name)) fail(`${where}/${name}`, "only extension.json, README.md and screenshot.png belong in a folder");
  const path = join(dir, "extension.json");
  if (!existsSync(path)) { fail(where, "has no extension.json"); continue; }
  const bytes = readFileSync(path), text = bytes.toString("utf8");
  if (bytes.length > LIMITS.file) { fail(`${where}/extension.json`, "is over 1 MB"); continue; }
  let file; try { file = JSON.parse(text); } catch (error) { fail(`${where}/extension.json`, `is not JSON (${error.message})`); continue; }
  const at = `${where}/extension.json`;
  if (!file || typeof file !== "object" || Array.isArray(file)) { fail(at, "is not an object"); continue; }
  only(at, file, ["format", "version", "id", "name", "description", "blockTypes", "templates", "documents", "extensions"]);
  if (file.format !== "paseo-canvas-pack" || file.version !== 1) fail(at, 'format must be "paseo-canvas-pack", version 1 (an Export from Lienzo)');
  if (file.id !== id) fail(at, `id must be "${id}", the folder's name`);
  if (!isText(file.name, 1, 200)) fail(at, "name is 1-200 characters");
  if (!isText(file.description ?? "", 0, 2000)) fail(at, "description is up to 2000 characters");
  for (const key of ["blockTypes", "templates", "documents"]) if (!Array.isArray(file[key]) || file[key].length) fail(at, `${key} must be an empty list: the catalog carries extensions only`);
  if (!Array.isArray(file.extensions) || !file.extensions.length || file.extensions.length > 50) { fail(at, "extensions is a list of 1 to 50"); continue; }
  file.extensions.forEach((e, i) => validateExtension(`${at} extensions[${i}]`, e, id));
  if (new Set(file.extensions.map(e => e?.id)).size !== file.extensions.length) fail(at, "repeats an extension id");
  for (const [name, limit] of [["README.md", LIMITS.readme], ["screenshot.png", LIMITS.screenshot]]) { const p = join(dir, name); if (existsSync(p) && statSync(p).size > limit) fail(`${where}/${name}`, `is over ${Math.round(limit / 1024)} KB`); }
  const screenshot = join(dir, "screenshot.png");
  if (existsSync(screenshot) && !readFileSync(screenshot).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) fail(`${where}/screenshot.png`, "is not a PNG");
  const author = git(["log", "--diff-filter=A", "--format=%an", "--", `extensions/${id}/extension.json`]).split("\n").pop() || undefined;
  const updated = git(["log", "-1", "--format=%cI", "--", `extensions/${id}`]) || undefined;
  entries.push({ id, name: file.name, description: file.description ?? "",
    extensions: file.extensions.map(e => ({ id: e.id, name: e.name, description: e.description ?? "", ...(e.icon ? { icon: e.icon } : {}), permissions: e.permissions ?? [], docs: e.docs !== undefined })),
    path: `extensions/${id}/extension.json`, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
    ...(author ? { author: author.slice(0, 100) } : {}), ...(updated ? { updated } : {}),
    ...(existsSync(join(dir, "README.md")) ? { readme: `extensions/${id}/README.md` } : {}), ...(existsSync(screenshot) ? { screenshot: `extensions/${id}/screenshot.png` } : {}) });
}
// One extension id belongs to one file across the whole catalog.
const owners = new Map();
for (const entry of entries) for (const e of entry.extensions) { if (owners.has(e.id)) fail(`extensions/${entry.id}`, `extension id ${e.id} is already in extensions/${owners.get(e.id)}`); owners.set(e.id, entry.id); }

if (problems.length) { console.error(`The catalog has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n` + problems.map(p => `  - ${p}`).join("\n")); process.exit(1); }
if (check) { console.log(`The catalog is valid: ${entries.length} file${entries.length === 1 ? "" : "s"}.`); process.exit(0); }
// generatedAt changes only when the entries do, so an unchanged catalog writes an identical index.
let generatedAt = new Date().toISOString();
try { const old = JSON.parse(readFileSync(out, "utf8")); if (JSON.stringify(old.entries) === JSON.stringify(entries) && old.repository === repository) generatedAt = old.generatedAt; } catch { /* first index */ }
writeFileSync(out, JSON.stringify({ format: "lienzo-extension-index", version: 1, repository, generatedAt, entries }, null, 2) + "\n");
console.log(`Wrote ${out}: ${entries.length} file${entries.length === 1 ? "" : "s"}.`);
