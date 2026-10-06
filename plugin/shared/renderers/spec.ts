import type { z } from "zod";
import type { BlockType, CanvasDocument, CanvasBlock } from "../model";
import type { JSONValue } from "../learning";
export type RendererSpec = {
  id: string; dataSchema: z.ZodType; blockType: BlockType; guidance: string;
  interactive: boolean; minSize?: { width: number; height: number }; defaultSize?: { width: number; height: number };
  /** Presentation only: hide these blocks until this renderer's local gate opens. */
  hiddenTargets?: (data: unknown, runtime: Record<string, JSONValue>, document: CanvasDocument, blockId: string) => readonly string[];
  /** Rewrite declared internal references when a subtree/template is copied. */
  remapReferences?: (data: CanvasBlock['data'], ids: ReadonlyMap<string, string>) => CanvasBlock['data'];
};
