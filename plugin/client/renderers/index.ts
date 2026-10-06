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
import { predictionGateRenderer } from './prediction-gate'; registerClientRenderer(predictionGateRenderer);
import { functionPlotRenderer } from './function-plot'; registerClientRenderer(functionPlotRenderer);
import { animatedFlowRenderer } from './animated-flow';
import { annotatedContentRenderer } from './annotated-content'; registerClientRenderer(annotatedContentRenderer);
import { stepFigureRenderer } from './step-figure'; registerClientRenderer(stepFigureRenderer);
import { glslShaderRenderer } from './glsl-shader'; registerClientRenderer(glslShaderRenderer);
import { stepSequencerRenderer } from './step-sequencer'; registerClientRenderer(stepSequencerRenderer);
import { simulateAnimatedFlow, tokensAt, flowTimeAt } from '../../shared/renderers/animated-flow';
registerClientRenderer({ ...animatedFlowRenderer, prepareLinkMotion(data, document) {
  const simulation = simulateAnimatedFlow(data, document);
  return (runtime, epochMs) => Object.hasOwn(runtime, 'playhead') && typeof runtime.playhead === 'number' && Number.isFinite(runtime.playhead)
    ? tokensAt(simulation, flowTimeAt(data, runtime, epochMs)) : [];
} });
export const getClientRenderer = (id?: string) => entries.find(entry => entry.id === id);
export type { RendererProps, ClientRenderer, RendererVisual } from './types';
