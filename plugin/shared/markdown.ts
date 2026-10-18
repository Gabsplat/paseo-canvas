/**
 * A tiny, safe Markdown dialect for the Help pages and for the guide an extension brings (`docs`). It is parsed into
 * plain data and drawn with native text, never as HTML: headings (#, ##, ###), paragraphs, bullet and numbered lists,
 * fenced code, `> ` notes, inline code, **bold**, *italic* and [links](https://…). Links go only to http(s), mailto,
 * or another Help page (`help:page-id`); any other target is shown as its text. HTML is never interpreted: tags
 * outside code are removed, and extension docs that carry them are refused (`extensionDocsIssue`).
 */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };
export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "note"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; language: string; text: string };

export const DOCS_LIMITS = { chars: 20_000, sections: 12, title: 120 } as const;
const TAG = /<\/?[a-zA-Z!][^>]*>/g;
// Control characters other than tab and newline never belong in text that is shown.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

/** A link target that may be followed, or null. Internal Help links keep their `help:` scheme. */
export function safeHref(href: string): string | null {
  const value = href.trim();
  if (/^help:[a-z0-9][a-z0-9.:-]{0,120}$/i.test(value)) return value;
  if (/^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(value)) return value;
  // No URL parser: React Native's is incomplete. A plain http(s) address without spaces or quotes is enough here.
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?([/?#][^\s<>"'`]*)?$/i.test(value) ? value : null;
}

/** Code spans and fences are left alone; everything else loses HTML tags and control characters. */
function outsideCode(text: string, change: (part: string) => string): string {
  return text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part, i) => i % 2 ? part : change(part)).join("");
}
export function sanitizeMarkdown(text: string): string {
  return outsideCode(text.replace(/\r\n?/g, "\n").replace(CONTROL, ""), part => part.replace(TAG, ""));
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [], push = (inline: Inline) => {
    const last = out[out.length - 1];
    if (inline.kind === "text" && last?.kind === "text") last.text += inline.text; else if (inline.text) out.push(inline);
  };
  const pattern = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*/g;
  let at = 0;
  for (const match of source.matchAll(pattern)) {
    push({ kind: "text", text: source.slice(at, match.index) });
    const [whole, code, label, href, bold, bold2, italic] = match;
    if (code !== undefined) push({ kind: "code", text: code });
    else if (label !== undefined) { const safe = safeHref(href); push(safe ? { kind: "link", text: label, href: safe } : { kind: "text", text: label }); }
    else if (bold !== undefined || bold2 !== undefined) push({ kind: "bold", text: bold ?? bold2 });
    else if (italic !== undefined) push({ kind: "italic", text: italic });
    else push({ kind: "text", text: whole });
    at = match.index + whole.length;
  }
  push({ kind: "text", text: source.slice(at) });
  return out;
}

/** Markdown to blocks. Always safe to draw: no block carries HTML or an unsafe link. */
export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = sanitizeMarkdown(markdown).split("\n"), blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [], list: { ordered: boolean; items: string[] } | null = null, note: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    if (note.length) blocks.push({ kind: "note", inlines: parseInline(note.join(" ")) });
    paragraph = []; list = null; note = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], trimmed = line.trim();
    const fence = /^```\s*([A-Za-z0-9+#.-]{0,20})\s*$/.exec(trimmed);
    if (fence) {
      flush(); const code: string[] = [];
      for (i++; i < lines.length && lines[i].trim() !== "```"; i++) code.push(lines[i]);
      blocks.push({ kind: "code", language: fence[1].toLowerCase(), text: code.join("\n") }); continue;
    }
    if (!trimmed) { flush(); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) { flush(); blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, inlines: parseInline(heading[2].replace(/\s+#+$/, "")) }); continue; }
    const bullet = /^[-*+]\s+(.+)$/.exec(trimmed), numbered = /^\d{1,3}[.)]\s+(.+)$/.exec(trimmed);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]); continue;
    }
    // An indented line continues the list item above it.
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += " " + trimmed; continue; }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) { if (!note.length) flush(); note.push(quote[1]); continue; }
    if (list || note.length) flush();
    paragraph.push(trimmed);
  }
  flush();
  return blocks;
}

/** The plain words of some Markdown, for search. */
export function markdownText(markdown: string): string {
  return parseMarkdown(markdown).map(block => block.kind === "code" ? block.text : block.kind === "list" ? block.items.map(item => item.map(i => i.text).join("")).join(" ") : block.inlines.map(i => i.text).join("")).join(" ");
}

/** An extension's guide: one short Markdown page, or a few titled sections. */
export type ExtensionDocs = string | readonly { title: string; body: string }[];
export function extensionDocsMarkdown(docs: ExtensionDocs): string {
  return typeof docs === "string" ? docs : docs.map(section => `## ${section.title.replace(/\n/g, " ")}\n\n${section.body}`).join("\n\n");
}
/** Why an extension's guide is refused, or null when it may be stored. Size first, then HTML and link targets. */
export function extensionDocsIssue(docs: ExtensionDocs): string | null {
  const markdown = extensionDocsMarkdown(docs);
  if (markdown.length > DOCS_LIMITS.chars) return `An extension guide is at most ${DOCS_LIMITS.chars} characters.`;
  if (typeof docs !== "string" && docs.length > DOCS_LIMITS.sections) return `An extension guide has at most ${DOCS_LIMITS.sections} sections.`;
  let html = false; outsideCode(markdown, part => { if (new RegExp(TAG.source).test(part)) html = true; return part; });
  if (html) return "An extension guide is Markdown only: HTML is not allowed (put markup examples in a code block).";
  let unsafe = false; outsideCode(markdown, part => { for (const m of part.matchAll(/\]\(([^)\s]+)\)/g)) if (!safeHref(m[1])) unsafe = true; return part; });
  if (unsafe) return "Links in an extension guide go to http, https or mailto addresses only.";
  return null;
}
