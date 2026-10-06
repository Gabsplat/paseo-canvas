import type { CanvasCatalog, CanvasDocument } from '../shared/model';
import type { RuntimeState } from '../shared/learning';
import { getRendererSpec } from '../shared/renderers';
import type { ClientRenderer, LinkMotionSample, LinkMotionToken } from './renderers/types';

export const MAX_LINK_MOTION_TOKENS = 256;
/** Schema validation and graph preparation happen once, never on an animation frame. */
export function prepareLinkMotion(document: CanvasDocument, catalog: CanvasCatalog,
  lookup: (id?: string) => ClientRenderer | undefined) {
  const renderers = new Map(catalog.blockTypes.map(type => [type.id, type.renderer]));
  const sources = document.blocks.flatMap(block => {
    const id = renderers.get(block.typeId), renderer = lookup(id);
    if (!renderer?.prepareLinkMotion) return [];
    const parsed = getRendererSpec(id)?.dataSchema.safeParse(block.data);
    if (!parsed?.success) return [];
    return [{ id: block.id, sample: renderer.prepareLinkMotion(parsed.data, document) }];
  });
  const links = new Map(document.links.map(link => [link.id, link]));
  return (runtime: RuntimeState, epochMs: number, hidden: ReadonlyMap<string, readonly string[]>): LinkMotionSample => {
    const tokens: LinkMotionToken[] = []; let playing = false;
    for (const source of sources) {
      if (hidden.has(source.id)) continue;
      const state = runtime.blocks[source.id] ?? {};
      if (state.playing === true) playing = true;
      const sampled = source.sample(state, epochMs);
      for (const token of sampled) {
        const link = links.get(token.linkId);
        if (!link || hidden.has(link.from) || hidden.has(link.to) || !Number.isFinite(token.progress) || token.progress < 0 || token.progress > 1) continue;
        if (tokens.length < MAX_LINK_MOTION_TOKENS) tokens.push(token);
      }
    }
    return { tokens, playing };
  };
}
