import { z } from "zod";
import { variableNameSchema } from "../learning";
import type { RendererSpec } from "./spec";
export const controlsDataSchema = z.object({ question: z.string().min(1).max(1000).default("How does the result change as you adjust these variables?"), variables: z.array(variableNameSchema).max(4).refine(v => new Set(v).size === v.length, "Variable names must be unique.") }).strict();
export const controlsSpec = {
  id: "controls", dataSchema: controlsDataSchema, interactive: true,
  guidance: "Set a guiding question/goal in data.question. Declare numeric variables on a group or document, then list up to four names in controls.data.variables. Read/set current values with canvas_runtime; declarations use revisioned updates. The block state lastInteraction says which control the person last moved, and its range.",
  blockType: { id: "controls", name: "Controls", description: "Sliders for variables shared by the Frame or the Lienzo.", renderer: "controls", properties: [{ key: "question", label: "Question or goal", kind: "text", required: false }, { key: "variables", label: "Variables", kind: "json", required: true }], defaults: { question: "How does the result change as you adjust these variables?", variables: [] } },
} satisfies RendererSpec;
export type ControlsData = z.infer<typeof controlsDataSchema>;
