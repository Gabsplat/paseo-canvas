import { registerRendererVisual } from "../renderer-visuals";
import type { ClientRenderer } from './types';
const entries: ClientRenderer[] = [];
function registerClientRenderer<Data>(renderer: ClientRenderer<Data>) {
  if (entries.some(entry => entry.id === renderer.id)) throw new Error(`Duplicate renderer ${renderer.id}.`);
  entries.push(renderer as unknown as ClientRenderer);
  registerRendererVisual(renderer.id, renderer.visual);
}
// Add one import/register line here. RegisteredRenderer parses data before dispatch.
import { diagramRenderer } from './diagram'; registerClientRenderer(diagramRenderer);
import { controlsRenderer } from './controls'; registerClientRenderer(controlsRenderer);
export const getClientRenderer = (id?: string) => entries.find(entry => entry.id === id);
export type { RendererProps, ClientRenderer, RendererVisual } from './types';
