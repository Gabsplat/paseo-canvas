import { z } from "zod";
import type { RendererSpec } from "./spec";
const entityId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).refine(id => !["__proto__", "constructor", "prototype"].includes(id));
export const diagramNodeSchema = z.object({ id: entityId, label: z.string().min(1).max(200), description: z.string().max(1000).optional(), position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional() }).strict();
export const diagramEdgeSchema = z.object({ id: entityId, from: entityId, to: entityId, label: z.string().max(200).optional() }).strict();
export const diagramDataSchema = z.object({ nodes: z.array(diagramNodeSchema).max(100), edges: z.array(diagramEdgeSchema).max(200), caption: z.string().max(2000).optional() }).strict().superRefine((data, context) => {
  const ids = new Set(data.nodes.map(node => node.id));
  if (ids.size !== data.nodes.length) context.addIssue({ code: "custom", path: ["nodes"], message: "Node IDs must be unique." });
  if (new Set(data.edges.map(edge => edge.id)).size !== data.edges.length) context.addIssue({ code: "custom", path: ["edges"], message: "Edge IDs must be unique." });
  data.edges.forEach((edge, index) => { if (!ids.has(edge.from) || !ids.has(edge.to)) context.addIssue({ code: "custom", path: ["edges", index], message: "Both edge endpoints must exist." }); });
});
export type DiagramNode = z.infer<typeof diagramNodeSchema>;
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;
export type DiagramData = z.infer<typeof diagramDataSchema>;

export const diagramSpec = {
  id: "diagram", dataSchema: diagramDataSchema, interactive: true,
  guidance: "Use diagrams for small self-contained figures; use graph groups for larger flows.",
  blockType: { id: "diagram", name: "Diagrama", description: "Nodos y conexiones declarativos. Añade pasos progresivamente con block.update; el cliente los dibuja como tarjetas y conectores.", renderer: "diagram", properties: [{ key: "nodes", label: "Nodos", kind: "json", required: true }, { key: "edges", label: "Conexiones", kind: "json", required: true }, { key: "caption", label: "Pie", kind: "text", required: false }], defaults: { nodes: [], edges: [] } },
} satisfies RendererSpec;
