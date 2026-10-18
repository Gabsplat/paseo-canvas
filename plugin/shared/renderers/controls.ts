import { z } from "zod";
import { variableNameSchema } from "../learning";
import type { RendererSpec } from "./spec";
export const controlsDataSchema = z.object({ question: z.string().max(1000).optional(), variables: z.array(variableNameSchema).max(4).refine(v => new Set(v).size === v.length, "Variable names must be unique.") }).strict();
export const controlsSpec = {
  id: "controls", dataSchema: controlsDataSchema, interactive: true,
  guidance: "Optionally set a guiding question/goal in data.question. Declare variables on a group or document (type number, boolean as 0/1, or choice with options and the option index as value), then list up to four names in controls.data.variables; the person sees a slider, a switch or option buttons. Read/set current values with canvas_runtime; declarations use revisioned updates. The block state lastInteraction says which control the person last moved, and its range.",
  blockType: { id: "controls", name: "Controls", description: "Sliders, switches and choices for variables shared by the Frame or the Lienzo.", renderer: "controls", properties: [{ key: "variables", label: "Variables", kind: "json", required: true, help: "Pick variables of this Frame or of the Lienzo, or make a new one." }, { key: "question", label: "Question or goal", kind: "text", required: false, advanced: true, help: "Shown above the controls." }], defaults: { variables: [] } },
} satisfies RendererSpec;
export type ControlsData = z.infer<typeof controlsDataSchema>;
