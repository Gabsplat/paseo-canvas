import type { CanvasCatalog, CanvasDocument } from '../shared/model';
import type { RuntimeState } from '../shared/learning';
import { getRendererSpec } from '../shared/renderers';

export type CanvasPresentation = { document: CanvasDocument; hiddenBy: ReadonlyMap<string, readonly string[]>; activeGates: ReadonlySet<string> };
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
  if (!hiddenBy.size) return { document, hiddenBy, activeGates };
  return {
    hiddenBy, activeGates,
    document: { ...document,
      blocks: document.blocks.map(block => hiddenBy.has(block.id)
        ? { ...block, title: 'Resultado oculto', data: {}, communication: undefined } : block),
      links: document.links.map(link => hiddenBy.has(link.from) || hiddenBy.has(link.to) ? { ...link, label: '' } : link),
    },
  };
}
