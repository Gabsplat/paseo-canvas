import { rendererSpecs } from "./renderers";
import type { BlockType } from "./model";

// The shipped catalog is block types only. Example documents, templates and example packs left the app (docs/redesign-2026-10.md,
// "UI pass"); stored data that carries them still loads.

const propertyLabels = {
  text: "Text", code: "Code", language: "Language", items: "Items",
  description: "Description", url: "Address", caption: "Caption", mediaKind: "Kind of media",
  kind: "Kind", status: "Status", summary: "Summary", details: "Details",
};
type Hints = { options?: string[]; advanced?: boolean; help?: string; label?: string };
const property = (key: keyof typeof propertyLabels, kind: "text" | "number" | "boolean" | "json", required = false, hints: Hints = {}) => {
  const { label, ...rest } = hints; return { key, label: label ?? propertyLabels[key], kind, required, ...rest };
};
/** Suggested values. A person may still type any other; the agent may write any text. */
export const NODE_KINDS = ["Service", "API", "Database", "Queue", "Worker", "Client", "Store", "Library", "Concept", "Step", "Person", "External"];
export const NODE_STATUSES = ["Done", "In progress", "Review", "Blocked", "New", "Planned"];
export const CODE_LANGUAGES = ["text", "typescript", "javascript", "python", "rust", "go", "java", "swift", "kotlin", "c", "cpp", "csharp", "ruby", "php", "sql", "html", "css", "json", "yaml", "bash", "glsl", "markdown"];
export const MEDIA_KINDS = ["reference", "image", "video", "audio"];
export const builtinTypes: BlockType[] = [
  ...rendererSpecs.map(spec => spec.blockType),
  { id: "node", name: "Node", description: "A card with a title, a summary and optional detail. For systems, flows and explanations.", renderer: "node", properties: [property("summary", "text", false, { help: "One or two lines shown on the card." }), property("status", "text", false, { options: NODE_STATUSES }), property("kind", "text", false, { options: NODE_KINDS, help: "A small label above the title." }), property("details", "text", false, { advanced: true, help: "Longer text, shown beside the card when it is selected." })], defaults: {} },
  { id: "note", name: "Note", description: "Explanatory text.", renderer: "note", properties: [property("text", "text", true)], defaults: { text: "" } },
  { id: "code", name: "Code", description: "Example code; it does not run.", renderer: "code", properties: [property("code", "text", true), property("language", "text", false, { options: CODE_LANGUAGES })], defaults: { code: "", language: "text" } },
  { id: "checklist", name: "Checklist", description: "Steps to go through and tick.", renderer: "checklist", properties: [property("items", "json", true)], defaults: { items: [] } },
  { id: "preview", name: "Window", description: "A live web page, or a clearly labelled conceptual reference.", renderer: "preview-frame", properties: [property("url", "text", false, { help: "An HTTP or HTTPS page. Without one, the Window shows the description as a reference." }), property("description", "text", false, { label: "Description" })], defaults: { description: "", url: "" } },
  { id: "media", name: "Media", description: "An HTTP/HTTPS link to an image, a video or a sound. The native app opens the link; no HTML from packs runs.", renderer: "image-ref", properties: [property("url", "text", true), property("caption", "text"), property("mediaKind", "text", false, { options: MEDIA_KINDS, advanced: true, help: "Usually found from the link." })], defaults: { url: "", caption: "", mediaKind: "reference" } },
];
