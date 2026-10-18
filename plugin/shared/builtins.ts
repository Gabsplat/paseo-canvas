import { builtinExtensions } from "./extensions";
import { rendererSpecs } from "./renderers";
import type { BlockType, CanvasPack, DocumentContent, GroupTemplate } from "./model";

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
  { id: "preview", name: "Ventana", description: "A live web page, or a clearly labelled conceptual reference. Ventana is Spanish for window.", renderer: "preview-frame", properties: [property("description", "text", true), property("url", "text")], defaults: { description: "", url: "" } },
  { id: "media", name: "Media", description: "An HTTP/HTTPS link to an image, a video or a sound. The native app opens the link; no HTML from packs runs.", renderer: "image-ref", properties: [property("url", "text", true), property("caption", "text"), property("mediaKind", "text")], defaults: { url: "", caption: "", mediaKind: "reference" } },
];
const communication = { instructions: "Use the Lienzo to explain. Tell example data apart from real results.", intent: "", audience: "" };
const empty = (title: string): DocumentContent => ({ title, description: "Editable example data; it does not show work done by an agent.", example: true, blocks: [], groups: [], links: [], selectedIds: [], communication });
const frontend = empty("Example: reviewing a screen");
frontend.blocks = [
  { id: "spec", typeId: "note", title: "What the screen is for", data: { text: "Example: a profile screen lets you review your name, email and preferences." }, parentGroupId: "screen" },
  { id: "tree", typeId: "code", title: "Component tree", data: { code: "ProfileScreen\n  ProfileHeader\n  PreferencesForm\n  SaveButton", language: "text" }, parentGroupId: "screen" },
  { id: "states", typeId: "checklist", title: "States to review", data: { items: ["Empty", "Loading", "Recoverable error", "Save confirmed"] }, parentGroupId: "screen" },
  { id: "preview", typeId: "preview", title: "Screen reference", data: { description: "Conceptual example of a profile form. No app is running here." }, parentGroupId: "screen" },
];
frontend.groups = [{ id: "screen", title: "Frontend review", description: "Compare the spec, the structure and the states.", blockIds: frontend.blocks.map(block => block.id), groupIds: [], collapsed: false, layout: { mode: "stack" }, communication: { instructions: "Explain the visible states before suggesting an implementation.", intent: "Interface review", audience: "" } }];
const learning = empty("Example: learning the state of an interface");
learning.blocks = [
  { id: "flow", typeId: "node", title: "Request and states", data: { kind: "FLOW", summary: "A request goes from loading to ready, or to error.", details: "Loading: the request is pending.\nReady: the request returned the data.\nError: the request failed; offer a retry.\nExample walk-through. The agent can teach by adding one node or one link per step." }, parentGroupId: "lesson" },
  { id: "concept", typeId: "note", title: "Concept", data: { text: "State describes what the interface knows at a moment. A request can be pending, completed or failed." }, parentGroupId: "lesson" },
  { id: "worked", typeId: "code", title: "Worked example", data: { code: "state = 'loading'\nresponse = waitForRequest()\nstate = response.ok ? 'ready' : 'error'", language: "pseudocode" }, parentGroupId: "lesson" },
  { id: "quiz", typeId: "note", title: "Check your understanding", data: { text: "Review question: what should the interface show while it waits for a request? Select this block and tell the agent your answer in the conversation." }, parentGroupId: "lesson", communication: { instructions: "After an answer, explain why it fits the concept. Do not pretend the person answered.", intent: "Progressive learning", audience: "Beginner" } },
  { id: "recap", typeId: "note", title: "Recap", data: { text: "Tell waiting, success and error apart. Confirm results only after receiving them." }, parentGroupId: "lesson" },
];
learning.groups = [{ id: "lesson", title: "A lesson, step by step", description: "Concept, example, question and recap.", blockIds: learning.blocks.map(block => block.id), groupIds: [], layout: { mode: "stack" }, collapsed: false, communication: { instructions: "Present one step at a time. Use the selection as context. Wait for the person to say they are ready before moving on.", intent: "Teach", audience: "Beginner" } }];
const graph = empty("Example: how Lienzo works");
graph.layout = { mode: "graph", direction: "right" };
graph.communication = { instructions: "Explain the path by selecting nodes and following links. Add one node or link per confirmed step. This map is an architecture example, not the activity of a connected agent.", intent: "Understand Lienzo", audience: "Users and developers" };
graph.blocks = [
  { id: "view", typeId: "node", title: "Shared Lienzo", parentGroupId: "interface", data: { kind: "INTERFACE", summary: "Draws blocks, Marcos and links.", details: "The client shows DocumentView. Positions are relative to the Marco; the graph layout arranges entities without explicit coordinates." } },
  { id: "action", typeId: "node", title: "Person's action", parentGroupId: "interface", data: { kind: "INTERACTION", summary: "Selecting and using blocks leaves state.", details: "Selecting changes selectedIds and selectionVersion. A quiz answer, a moved control or a mini app's setState is stored on the block. Nothing is sent to the agent." } },
  { id: "transaction", typeId: "node", title: "Transaction", parentGroupId: "backend", data: { kind: "SERVICE", summary: "Validates operations and expectedRevision.", details: "canvas.mutate and canvas_apply use the same reducer. A conflict means reading the revision again. If one operation fails, the whole batch is left unchanged." } },
  { id: "storage", typeId: "node", title: "Stored state", parentGroupId: "backend", data: { kind: "STORAGE", summary: "Documents and history are saved together.", details: "state.json holds documents, catalog, history and block state. One atomic write keeps blocks, Marcos and links in the same revision. Undo and redo restore links too." } },
  { id: "catalog", typeId: "node", title: "Local catalog", parentGroupId: "backend", data: { kind: "CATALOG", summary: "Types, templates and JSON packs.", details: "Templates remap the IDs of entities and links. Exporting a Marco includes its inner links; packs are declarative data with no executable code." } },
  { id: "agent", typeId: "node", title: "Connected agent", parentGroupId: "conversation", data: { kind: "AGENT", summary: "Reads the selection and draws through tools.", details: "The MCP authenticates agent and workspace. canvas_selection returns what the person selected, its instructions and the state their interaction left; canvas_apply changes the Lienzo. This example is not a live session." } },
  { id: "chat", typeId: "node", title: "The person's chat", parentGroupId: "conversation", data: { kind: "MESSAGE", summary: "The person talks to the agent there.", details: "The canvas is one-way: it never messages the agent. The person says “look at what I selected” in the conversation, and the agent reads the canvas." } },
];
graph.groups = [
  { id: "interface", title: "Interface", description: "Reading and explicit actions.", blockIds: ["view", "action"], groupIds: [], layout: { mode: "graph", direction: "down" } },
  { id: "backend", title: "Backend", description: "Validation, storage and catalog.", blockIds: ["transaction", "storage", "catalog"], groupIds: [], layout: { mode: "graph", direction: "down" } },
  { id: "conversation", title: "Conversation", description: "The person talks; the agent reads and draws.", blockIds: ["chat", "agent"], groupIds: [], layout: { mode: "graph", direction: "down" } },
];
graph.links = [
  { id: "view-action", from: "view", to: "action", kind: "flow", label: "explicit action" },
  { id: "transaction-storage", from: "transaction", to: "storage", kind: "flow", label: "atomic commit" },
  { id: "transaction-catalog", from: "transaction", to: "catalog", kind: "depends", label: "validates types" },
  { id: "catalog-storage", from: "catalog", to: "storage", kind: "reference", label: "same aggregate" },
  { id: "chat-agent", from: "chat", to: "agent", kind: "flow", label: "“look at this”" },
  { id: "interface-backend", from: "interface", to: "backend", kind: "flow", label: "operations RPC" },
  { id: "backend-conversation", from: "backend", to: "conversation", kind: "flow", label: "selection and state" },
  { id: "agent-transaction", from: "agent", to: "transaction", kind: "flow", label: "canvas_apply" },
];
export const builtinTemplates: GroupTemplate[] = [
  { id: "frontend-review", name: "Frontend review", description: frontend.groups[0].description, blocks: frontend.blocks, groups: frontend.groups, links: [] },
  { id: "progressive-lesson", name: "Progressive lesson", description: learning.groups[0].description, blocks: learning.blocks, groups: learning.groups, links: [] },
];
export const builtinPacks: CanvasPack[] = [
  { format: "paseo-canvas-pack", version: 1, id: "frontend", name: "Frontend example", description: "Example data for reviewing an interface.", blockTypes: [], templates: [builtinTemplates[0]], documents: [frontend], extensions: [] },
  { format: "paseo-canvas-pack", version: 1, id: "learn", name: "Learning example", description: "Example data for learning step by step.", blockTypes: [], templates: [builtinTemplates[1]], documents: [learning], extensions: [] },
  { format: "paseo-canvas-pack", version: 1, id: "graph", name: "Example: Lienzo's architecture", description: "An example map with nodes, Marcos and links of Lienzo itself. It is not real activity.", blockTypes: [], templates: [], documents: [graph], extensions: [] },
  { format: "paseo-canvas-pack", version: 1, id: "ejemplos", name: "Extension examples", description: "Example extensions made with the extensions API. A place to start from.", blockTypes: [], templates: [], documents: [], extensions: builtinExtensions },
];
