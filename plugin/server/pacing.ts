import { CanvasError } from "../shared/errors";
import type { CanvasDocument } from "../shared/model";
import { sheetsOf } from "./sheets";

/**
 * Drawing in front of the person. Asking an agent to build piece by piece is not enough: one that plans the whole
 * explanation first sends it in one call. While the copilot is on, a call may add only a few blocks, and a Sheet made
 * only of cards gets a nudge in the write result, where the agent reads it right before its next stage.
 */
export const PACE = { blocksPerCall: 6, plainSheetAfter: 5 } as const;
/** Types that are only words on a card; anything else (a shape, a drawing, a mini app, controls…) counts as variety. */
const PLAIN = new Set(["node", "note", "wb-text"]);

export function checkPace(newBlocks: number): void {
  if (newBlocks <= PACE.blocksPerCall) return;
  throw new CanvasError("VALIDATION", `Draw piece by piece: this call adds ${newBlocks} blocks and the copilot allows ${PACE.blocksPerCall} per call. The person watches the Lienzo assemble, so send the next stage only (its blocks and links), tell them about it in the conversation, then draw the following one. Nothing was applied.`, { limit: PACE.blocksPerCall, blocks: newBlocks });
}

/** The Sheet an entity lives in, walking up its groups. */
function sheetOf(document: Pick<CanvasDocument, "blocks" | "groups">, id: string): string | undefined {
  const sheets = new Set(sheetsOf(document).map(sheet => sheet.id));
  let at = document.blocks.find(block => block.id === id)?.parentGroupId ?? document.groups.find(group => group.id === id)?.parentGroupId;
  for (let depth = 0; at && depth < 8; depth++) { if (sheets.has(at)) return at; at = document.groups.find(group => group.id === at)?.parentGroupId; }
  return sheets.has(id) ? id : undefined;
}

/** A Sheet touched by this write that is still only cards, past a few of them. */
export function varietyNudge(document: Pick<CanvasDocument, "blocks" | "groups">, changed: string[]): { variety: string } | {} {
  const touched = new Set(changed.map(id => sheetOf(document, id)).filter((id): id is string => !!id));
  for (const sheet of touched) {
    const blocks = document.blocks.filter(block => sheetOf(document, block.id) === sheet);
    if (blocks.length < PACE.plainSheetAfter || blocks.some(block => !PLAIN.has(block.typeId))) continue;
    const title = document.groups.find(group => group.id === sheet)?.title ?? sheet;
    return { variety: `Sheet "${title}" is only cards so far (${blocks.length}). In the next stage, show instead of tell: a drawing or shapes for the physical thing (wb-draw, wb-shape, icons), animated-flow for what moves or transforms, controls or a mini app (html) for a quantity the person can change, a checklist for a procedure. Pick what this content asks for.` };
  }
  return {};
}
