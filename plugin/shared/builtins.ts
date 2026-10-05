import type { BlockType, CanvasPack, DocumentContent, GroupTemplate } from "./model";

const propertyLabels = {
  text: "Texto", code: "Código", language: "Lenguaje", items: "Elementos",
  question: "Pregunta", options: "Opciones", answer: "Respuesta", current: "Actual",
  total: "Total", description: "Descripción", url: "URL", caption: "Pie",
  mediaKind: "Tipo de recurso", nodes: "Nodos", edges: "Conexiones",
};
const property = (key: keyof typeof propertyLabels, kind: "text" | "number" | "boolean" | "json", required = false) => ({ key, label: propertyLabels[key], kind, required });
export const builtinTypes: BlockType[] = [
  { id: "diagram", name: "Diagrama", description: "Nodos y conexiones declarativos. Añade pasos progresivamente con block.update; el cliente los dibuja como tarjetas y conectores.", renderer: "diagram", properties: [property("nodes", "json", true), property("edges", "json", true), property("caption", "text")], defaults: { nodes: [], edges: [] } },
  { id: "note", name: "Nota", description: "Texto explicativo.", renderer: "note", properties: [property("text", "text", true)], defaults: { text: "" } },
  { id: "code", name: "Código", description: "Código de ejemplo; no se ejecuta.", renderer: "code", properties: [property("code", "text", true), property("language", "text")], defaults: { code: "", language: "text" } },
  { id: "checklist", name: "Lista", description: "Pasos y revisión.", renderer: "checklist", properties: [property("items", "json", true)], defaults: { items: [] } },
  { id: "choice", name: "Pregunta", description: "Opciones para responder al agente.", renderer: "choice", properties: [property("question", "text", true), property("options", "json", true), property("answer", "text")], defaults: { question: "", options: [] } },
  { id: "progress", name: "Progreso", description: "Progreso declarado; los datos de ejemplo no indican actividad real.", renderer: "progress", properties: [property("current", "number", true), property("total", "number", true)], defaults: { current: 0, total: 1 } },
  { id: "preview", name: "Vista previa", description: "URL de una vista frontend o referencia conceptual claramente etiquetada.", renderer: "preview-frame", properties: [property("description", "text", true), property("url", "text")], defaults: { description: "", url: "" } },
  { id: "media", name: "Referencia multimedia", description: "Enlace HTTP/HTTPS a una imagen, video o recurso. La app nativa abre el enlace; no ejecuta HTML del pack.", renderer: "image-ref", properties: [property("url", "text", true), property("caption", "text"), property("mediaKind", "text")], defaults: { url: "", caption: "", mediaKind: "reference" } },
];
const communication = { instructions: "Usa el lienzo para explicar. Distingue datos de ejemplo de resultados reales.", intent: "", audience: "" };
const empty = (title: string): DocumentContent => ({ title, description: "Datos de ejemplo editables; no representan trabajo realizado por un agente.", example: true, blocks: [], groups: [], selectedIds: [], communication });
const frontend = empty("Ejemplo: revisión de una pantalla");
frontend.blocks = [
  { id: "spec", typeId: "note", title: "Objetivo de la pantalla", data: { text: "Ejemplo: una pantalla de perfil permite revisar nombre, correo y preferencias." }, parentGroupId: "screen" },
  { id: "tree", typeId: "code", title: "Árbol de componentes", data: { code: "ProfileScreen\n  ProfileHeader\n  PreferencesForm\n  SaveButton", language: "text" }, parentGroupId: "screen" },
  { id: "states", typeId: "checklist", title: "Estados para revisar", data: { items: ["Vacío", "Cargando", "Error recuperable", "Guardado confirmado"] }, parentGroupId: "screen" },
  { id: "preview", typeId: "preview", title: "Referencia de pantalla", data: { description: "Ejemplo conceptual de un formulario de perfil. No hay aplicación ejecutándose aquí." }, parentGroupId: "screen" },
];
frontend.groups = [{ id: "screen", title: "Revisión frontend", description: "Comparar especificación, estructura y estados.", blockIds: frontend.blocks.map(block => block.id), groupIds: [], collapsed: false, layout: { mode: "stack" }, communication: { instructions: "Explica los estados visibles antes de sugerir implementación.", intent: "Revisión de interfaz", audience: "" } }];
const learning = empty("Ejemplo: aprender el estado de una interfaz");
learning.blocks = [
  { id: "flow", typeId: "diagram", title: "Solicitud y estados", data: { nodes: [{ id: "waiting", label: "Cargando", description: "La solicitud está pendiente." }, { id: "ready", label: "Listo", description: "La solicitud devolvió los datos." }, { id: "error", label: "Error", description: "La solicitud falló; ofrece reintentar." }], edges: [{ id: "success", from: "waiting", to: "ready", label: "Respuesta correcta" }, { id: "failure", from: "waiting", to: "error", label: "Solicitud fallida" }], caption: "Diagrama de ejemplo. El agente puede enseñar agregando un nodo o conexión por paso." }, parentGroupId: "lesson" },
  { id: "concept", typeId: "note", title: "Concepto", data: { text: "El estado describe lo que la interfaz sabe en un momento. Una solicitud puede estar pendiente, completada o fallida." }, parentGroupId: "lesson" },
  { id: "worked", typeId: "code", title: "Ejemplo trabajado", data: { code: "estado = 'cargando'\nrespuesta = esperarSolicitud()\nestado = respuesta.ok ? 'listo' : 'error'", language: "pseudocode" }, parentGroupId: "lesson" },
  { id: "quiz", typeId: "choice", title: "Comprobar comprensión", data: { question: "¿Qué debe mostrar la interfaz mientras espera una solicitud?", options: ["Cargando", "Guardado confirmado", "Error obligatorio"] }, parentGroupId: "lesson", communication: { instructions: "Después de una respuesta, explica por qué encaja con el concepto. No inventes que el usuario respondió.", intent: "Aprendizaje progresivo", audience: "Principiante" } },
  { id: "recap", typeId: "note", title: "Recapitulación", data: { text: "Distingue espera, éxito y error. Confirma resultados solo después de recibirlos." }, parentGroupId: "lesson" },
];
learning.groups = [{ id: "lesson", title: "Una lección paso a paso", description: "Concepto, ejemplo, pregunta y recapitulación.", blockIds: learning.blocks.map(block => block.id), groupIds: [], layout: { mode: "stack" }, collapsed: false, communication: { instructions: "Presenta un paso por vez. Usa la selección como contexto. Espera una acción explícita antes de avanzar.", intent: "Enseñar", audience: "Principiante" } }];
export const builtinTemplates: GroupTemplate[] = [
  { id: "frontend-review", name: "Revisión frontend", description: frontend.groups[0].description, blocks: frontend.blocks, groups: frontend.groups },
  { id: "progressive-lesson", name: "Lección progresiva", description: learning.groups[0].description, blocks: learning.blocks, groups: learning.groups },
];
export const builtinPacks: CanvasPack[] = [
  { format: "paseo-canvas-pack", version: 1, id: "frontend", name: "Ejemplo frontend", description: "Datos de ejemplo para revisar una interfaz.", blockTypes: [], templates: [builtinTemplates[0]], documents: [frontend] },
  { format: "paseo-canvas-pack", version: 1, id: "learn", name: "Ejemplo de aprendizaje", description: "Datos de ejemplo para aprender progresivamente.", blockTypes: [], templates: [builtinTemplates[1]], documents: [learning] },
];
