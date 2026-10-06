import type { z } from "zod";
import type { BlockType } from "../model";
export type RendererSpec = {
  id: string; dataSchema: z.ZodType; blockType: BlockType; guidance: string;
  interactive: boolean; minSize?: { width: number; height: number }; defaultSize?: { width: number; height: number };
};
