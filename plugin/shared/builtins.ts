import { builtinExtensions } from "./extensions";
import { rendererSpecs } from "./renderers";
import type { BlockType, CanvasPack, DocumentContent, GroupTemplate } from "./model";

const propertyLabels = {
  text: "Texto", code: "Código", language: "Lenguaje", items: "Elementos",
  description: "Descripción", url: "URL", caption: "Pie", mediaKind: "Tipo de recurso",
  kind: "Clase", status: "Estado", summary: "Resumen", details: "Detalles",
};
const property = (key: keyof typeof propertyLabels, kind: "text" | "number" | "boolean" | "json", required = false) => ({ key, label: propertyLabels[key], kind, required });
export const builtinTypes: BlockType[] = [
  ...rendererSpecs.map(spec => spec.blockType),
  { id: "node", name: "Nodo", description: "Tarjeta con título, resumen y detalle opcional. Para sistemas, flujos y explicaciones.", renderer: "node", properties: [property("kind", "text"), property("status", "text"), property("summary", "text"), property("details", "text")], defaults: {} },
  { id: "note", name: "Nota", description: "Texto explicativo.", renderer: "note", properties: [property("text", "text", true)], defaults: { text: "" } },
  { id: "code", name: "Código", description: "Código de ejemplo; no se ejecuta.", renderer: "code", properties: [property("code", "text", true), property("language", "text")], defaults: { code: "", language: "text" } },
  { id: "checklist", name: "Lista", description: "Pasos y revisión.", renderer: "checklist", properties: [property("items", "json", true)], defaults: { items: [] } },
  { id: "preview", name: "Vista previa", description: "URL de una vista frontend o referencia conceptual claramente etiquetada.", renderer: "preview-frame", properties: [property("description", "text", true), property("url", "text")], defaults: { description: "", url: "" } },
  { id: "media", name: "Referencia multimedia", description: "Enlace HTTP/HTTPS a una imagen, video o recurso. La app nativa abre el enlace; no ejecuta HTML del pack.", renderer: "image-ref", properties: [property("url", "text", true), property("caption", "text"), property("mediaKind", "text")], defaults: { url: "", caption: "", mediaKind: "reference" } },
];
const communication = { instructions: "Usa el lienzo para explicar. Distingue datos de ejemplo de resultados reales.", intent: "", audience: "" };
const empty = (title: string): DocumentContent => ({ title, description: "Datos de ejemplo editables; no representan trabajo realizado por un agente.", example: true, blocks: [], groups: [], links: [], selectedIds: [], communication });
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
  { id: "flow", typeId: "node", title: "Solicitud y estados", data: { kind: "FLUJO", summary: "Una solicitud pasa de cargando a listo o a error.", details: "Cargando: la solicitud está pendiente.\nListo: la solicitud devolvió los datos.\nError: la solicitud falló; ofrece reintentar.\nRecorrido de ejemplo. El agente puede enseñar agregando un nodo o una conexión por paso." }, parentGroupId: "lesson" },
  { id: "concept", typeId: "note", title: "Concepto", data: { text: "El estado describe lo que la interfaz sabe en un momento. Una solicitud puede estar pendiente, completada o fallida." }, parentGroupId: "lesson" },
  { id: "worked", typeId: "code", title: "Ejemplo trabajado", data: { code: "estado = 'cargando'\nrespuesta = esperarSolicitud()\nestado = respuesta.ok ? 'listo' : 'error'", language: "pseudocode" }, parentGroupId: "lesson" },
  { id: "quiz", typeId: "note", title: "Comprobar comprensión", data: { text: "Pregunta de repaso: ¿qué debe mostrar la interfaz mientras espera una solicitud? Selecciona este bloque y escribe tu respuesta al asistente." }, parentGroupId: "lesson", communication: { instructions: "Después de una respuesta, explica por qué encaja con el concepto. No inventes que el usuario respondió.", intent: "Aprendizaje progresivo", audience: "Principiante" } },
  { id: "recap", typeId: "note", title: "Recapitulación", data: { text: "Distingue espera, éxito y error. Confirma resultados solo después de recibirlos." }, parentGroupId: "lesson" },
];
learning.groups = [{ id: "lesson", title: "Una lección paso a paso", description: "Concepto, ejemplo, pregunta y recapitulación.", blockIds: learning.blocks.map(block => block.id), groupIds: [], layout: { mode: "stack" }, collapsed: false, communication: { instructions: "Presenta un paso por vez. Usa la selección como contexto. Espera una acción explícita antes de avanzar.", intent: "Enseñar", audience: "Principiante" } }];
const graph = empty("Ejemplo: cómo funciona Lienzo");
graph.layout = { mode: "graph", direction: "right" };
graph.communication = { instructions: "Explica el recorrido seleccionando nodos y siguiendo conexiones. Añade un nodo o conexión por paso confirmado. Este mapa es un ejemplo de arquitectura, no actividad de un agente conectado.", intent: "Entender Lienzo", audience: "Usuarios y desarrolladores" };
graph.blocks = [
  { id: "view", typeId: "node", title: "Lienzo compartido", parentGroupId: "interface", data: { kind: "INTERFAZ", summary: "Dibuja bloques, regiones y conexiones.", details: "El cliente muestra DocumentView. Las posiciones son relativas al grupo; el layout graph organiza las entidades sin coordenadas explícitas." } },
  { id: "action", typeId: "node", title: "Acción del usuario", parentGroupId: "interface", data: { kind: "INTERACCIÓN", summary: "Una acción explícita genera feedback.", details: "Seleccionar solo cambia selectedIds y selectionVersion. Pedir una explicación crea un AgentEvent persistido; su estado indica si está pendiente, enviado, fallido o reconocido." } },
  { id: "transaction", typeId: "node", title: "Transacción", parentGroupId: "backend", data: { kind: "SERVICIO", summary: "Valida operaciones y expectedRevision.", details: "canvas.mutate y canvas_apply usan el mismo reductor. Un conflicto exige releer la revisión. Si una operación falla, el lote completo queda sin cambios." } },
  { id: "storage", typeId: "node", title: "Estado persistente", parentGroupId: "backend", data: { kind: "ALMACENAMIENTO", summary: "Documento e historial se guardan juntos.", details: "state.json contiene documentos, catálogo, historial y feedback. Una escritura atómica conserva bloques, grupos y links en una misma revisión. Undo y redo también restauran conexiones." } },
  { id: "catalog", typeId: "node", title: "Catálogo local", parentGroupId: "backend", data: { kind: "CATÁLOGO", summary: "Tipos, plantillas y packs JSON.", details: "Las plantillas remapean IDs de entidades y conexiones. Exportar un grupo incluye las conexiones internas; los packs son datos declarativos sin código ejecutable." } },
  { id: "agent", typeId: "node", title: "Agente conectado", parentGroupId: "conversation", data: { kind: "AGENTE", summary: "Lee contexto y confirma cambios reales.", details: "El MCP autentica agente y workspace. La conexión elige al receptor del feedback. El agente reconoce eventos con canvas_events y actualiza el lienzo mediante herramientas; este ejemplo no representa una sesión activa." } },
  { id: "delivery", typeId: "node", title: "Entrega de feedback", parentGroupId: "conversation", data: { kind: "MENSAJE", summary: "Envía acciones cuando el agente está libre.", details: "La cola conserva el messageId y el contenido al reintentar. Aceptar un mensaje no prueba que el agente terminó el trabajo; el reconocimiento del evento es una señal separada." } },
];
graph.groups = [
  { id: "interface", title: "Interfaz", description: "Lectura y acciones explícitas.", blockIds: ["view", "action"], groupIds: [], layout: { mode: "graph", direction: "down" } },
  { id: "backend", title: "Backend", description: "Validación, almacenamiento y catálogo.", blockIds: ["transaction", "storage", "catalog"], groupIds: [], layout: { mode: "graph", direction: "down" } },
  { id: "conversation", title: "Conversación", description: "Conexión y entrega confirmada.", blockIds: ["delivery", "agent"], groupIds: [], layout: { mode: "graph", direction: "down" } },
];
graph.links = [
  { id: "view-action", from: "view", to: "action", kind: "flow", label: "acción explícita" },
  { id: "transaction-storage", from: "transaction", to: "storage", kind: "flow", label: "commit atómico" },
  { id: "transaction-catalog", from: "transaction", to: "catalog", kind: "depends", label: "valida tipos" },
  { id: "catalog-storage", from: "catalog", to: "storage", kind: "reference", label: "mismo agregado" },
  { id: "delivery-agent", from: "delivery", to: "agent", kind: "flow", label: "mensaje con contexto" },
  { id: "interface-backend", from: "interface", to: "backend", kind: "flow", label: "RPC de operaciones" },
  { id: "backend-conversation", from: "backend", to: "conversation", kind: "flow", label: "feedback persistido" },
  { id: "agent-transaction", from: "agent", to: "transaction", kind: "flow", label: "canvas_apply" },
];
export const builtinTemplates: GroupTemplate[] = [
  { id: "frontend-review", name: "Revisión frontend", description: frontend.groups[0].description, blocks: frontend.blocks, groups: frontend.groups, links: [] },
  { id: "progressive-lesson", name: "Lección progresiva", description: learning.groups[0].description, blocks: learning.blocks, groups: learning.groups, links: [] },
];
export const builtinPacks: CanvasPack[] = [
  { format: "paseo-canvas-pack", version: 1, id: "frontend", name: "Ejemplo frontend", description: "Datos de ejemplo para revisar una interfaz.", blockTypes: [], templates: [builtinTemplates[0]], documents: [frontend], extensions: [] },
  { format: "paseo-canvas-pack", version: 1, id: "learn", name: "Ejemplo de aprendizaje", description: "Datos de ejemplo para aprender progresivamente.", blockTypes: [], templates: [builtinTemplates[1]], documents: [learning], extensions: [] },
  { format: "paseo-canvas-pack", version: 1, id: "graph", name: "Ejemplo: arquitectura de Lienzo", description: "Mapa de ejemplo con nodos, grupos y conexiones del propio Lienzo. No representa actividad real.", blockTypes: [], templates: [], documents: [graph], extensions: [] },
  { format: "paseo-canvas-pack", version: 1, id: "ejemplos", name: "Ejemplos de extensiones", description: "Una vista y una herramienta de ejemplo hechas con la API de extensiones. Sirven de punto de partida.", blockTypes: [], templates: [], documents: [], extensions: builtinExtensions },
];
