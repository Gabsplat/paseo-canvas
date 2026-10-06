import { z } from "zod";
import { variableNameSchema } from "../learning";
import type { RendererSpec } from "./spec";
export const controlsDataSchema = z.object({ question: z.string().min(1).max(1000).default("¿Cómo cambia el resultado al ajustar estas variables?"), variables: z.array(variableNameSchema).max(4).refine(v => new Set(v).size === v.length, "Variable names must be unique.") }).strict();
export const controlsSpec = {
  id: "controls", dataSchema: controlsDataSchema, interactive: true,
  guidance: "Set a guiding question/goal in data.question. Declare numeric variables on a group or document, then list up to four names in controls.data.variables. Read/set current values with canvas_runtime; declarations use revisioned updates.",
  blockType: { id: "controls", name: "Controles", description: "Deslizadores para variables compartidas del grupo o documento.", renderer: "controls", properties: [{ key: "question", label: "Pregunta u objetivo", kind: "text", required: false }, { key: "variables", label: "Variables", kind: "json", required: true }], defaults: { question: "¿Cómo cambia el resultado al ajustar estas variables?", variables: [] } },
} satisfies RendererSpec;
export type ControlsData = z.infer<typeof controlsDataSchema>;
