import { rendererSpecs } from "./renderers";
import type { BlockType } from "./model";

// The shipped catalog is block types only. Example documents, templates and example packs left the app (docs/redesign-2026-10.md,
// "UI pass"); stored data that carries them still loads.

const propertyLabels = {
  text: "Text", code: "Code", language: "Language", items: "Items",
  description: "Description", url: "Address", caption: "Caption", mediaKind: "Kind of media",
  kind: "Kind", status: "Status", summary: "Summary", details: "Details",
};
const property = (key: keyof typeof propertyLabels, kind: "text" | "number" | "boolean" | "json", required = false) => ({ key, label: propertyLabels[key], kind, required });
export const builtinTypes: BlockType[] = [
  ...rendererSpecs.map(spec => spec.blockType),
  { id: "node", name: "Node", description: "A card with a title, a summary and optional detail. For systems, flows and explanations.", renderer: "node", properties: [property("kind", "text"), property("status", "text"), property("summary", "text"), property("details", "text")], defaults: {} },
  { id: "note", name: "Note", description: "Explanatory text.", renderer: "note", properties: [property("text", "text", true)], defaults: { text: "" } },
  { id: "code", name: "Code", description: "Example code; it does not run.", renderer: "code", properties: [property("code", "text", true), property("language", "text")], defaults: { code: "", language: "text" } },
  { id: "checklist", name: "Checklist", description: "Steps to go through and tick.", renderer: "checklist", properties: [property("items", "json", true)], defaults: { items: [] } },
  { id: "preview", name: "Window", description: "A live web page, or a clearly labelled conceptual reference.", renderer: "preview-frame", properties: [property("description", "text", true), property("url", "text")], defaults: { description: "", url: "" } },
  { id: "media", name: "Media", description: "An HTTP/HTTPS link to an image, a video or a sound. The native app opens the link; no HTML from packs runs.", renderer: "image-ref", properties: [property("url", "text", true), property("caption", "text"), property("mediaKind", "text")], defaults: { url: "", caption: "", mediaKind: "reference" } },
];
