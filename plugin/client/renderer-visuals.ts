import type { RendererVisual } from './renderers/types';
// No component imports here: layout and legacy tokens can read metadata without cycles.
const visuals = new Map<string, RendererVisual>();
export const getRendererVisual = (id?: string) => id ? visuals.get(id) : undefined;
export function registerRendererVisual(id: string, visual: RendererVisual) {
  const previous = visuals.get(id); visuals.set(id, visual);
  return () => { if (previous) visuals.set(id, previous); else visuals.delete(id); };
}
