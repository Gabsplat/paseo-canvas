import type { CanvasCatalog, CanvasDocument } from '../shared/model';
import type { RuntimeState } from '../shared/learning';
import { getRendererSpec } from '../shared/renderers';
import { bindingStates, boundValues, setBound, type BoundValues } from '../shared/bindings';

/** `bound`: what each bound block shows now (shared/bindings.ts); the same values sit beside its block in `document`. */
export type CanvasPresentation = { document: CanvasDocument; hiddenBy: ReadonlyMap<string, readonly string[]>; activeGates: ReadonlySet<string>; bound: ReadonlyMap<string, BoundValues> };
/** A view of authored content. Never pass this document to persistence, export or MCP. */
export function canvasPresentation(document: CanvasDocument, catalog: CanvasCatalog, runtime: RuntimeState,
  lookup = getRendererSpec): CanvasPresentation {
  const hiddenBy = new Map<string, string[]>(), activeGates = new Set<string>(), ids = new Set(document.blocks.map(block => block.id));
  const renderers = new Map(catalog.blockTypes.map(type => [type.id, type.renderer]));
  for (const block of document.blocks) {
    const spec = lookup(renderers.get(block.typeId));
    for (const id of new Set(spec?.hiddenTargets?.(block.data, runtime.blocks[block.id] ?? {}, document, block.id) ?? [])) {
      activeGates.add(block.id);
      if (id === block.id || !ids.has(id)) continue;
      const gates = hiddenBy.get(id) ?? [];
      gates.push(block.id); hiddenBy.set(id, gates);
    }
  }
  // Bound properties are drawn from runtime values: a projected copy of the block carries them beside it, never in it.
  const bound = new Map<string, BoundValues>();
  for (const block of document.blocks) if (block.bindings && !hiddenBy.has(block.id)) {
    const values = boundValues(bindingStates(document, block, runtime, renderers.get(block.typeId)));
    if (Object.keys(values).length) bound.set(block.id, values);
  }
  if (!hiddenBy.size && !bound.size) return { document, hiddenBy, activeGates, bound };
  const project = (block: CanvasDocument['blocks'][number]) => { const values = bound.get(block.id); if (!values) return block; const copy = { ...block }; setBound(copy, values); return copy; };
  return {
    hiddenBy, activeGates, bound,
    document: { ...document,
      blocks: document.blocks.map(block => hiddenBy.has(block.id)
        ? { ...block, title: 'Hidden result', data: {}, communication: undefined } : project(block)),
      links: document.links.map(link => hiddenBy.has(link.from) || hiddenBy.has(link.to) ? { ...link, label: '' } : link),
    },
  };
}
