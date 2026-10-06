import type { RendererSpec } from './spec';
const entries: RendererSpec[] = [];
function registerRenderer(spec: RendererSpec) {
  if (entries.some(entry => entry.id === spec.id) || spec.blockType.renderer !== spec.id) throw new Error(`Invalid or duplicate renderer ${spec.id}.`);
  entries.push(spec);
}
// Add one import/register line here, before rendererNames is built.
import { diagramSpec } from './diagram'; registerRenderer(diagramSpec);
import { controlsSpec } from './controls'; registerRenderer(controlsSpec);
import { predictionGateSpec, remapPredictionGateReferences } from './prediction-gate'; registerRenderer({ ...predictionGateSpec, remapReferences: remapPredictionGateReferences });
import { functionPlotSpec } from './function-plot'; registerRenderer(functionPlotSpec);
import { animatedFlowSpec } from './animated-flow'; registerRenderer(animatedFlowSpec);
import { annotatedContentSpec } from './annotated-content'; registerRenderer(annotatedContentSpec);
import { stepFigureSpec } from './step-figure'; registerRenderer(stepFigureSpec);
import { glslShaderSpec } from './glsl-shader'; registerRenderer(glslShaderSpec);
import { whiteboardSpecs } from './whiteboard'; whiteboardSpecs.forEach(registerRenderer);
export const rendererSpecs: readonly RendererSpec[] = entries;
export const legacyRendererNames = ['text', 'note', 'code', 'checklist', 'choice', 'form', 'metric', 'image-ref', 'step', 'callout', 'preview-frame', 'quiz', 'progress', 'diagram', 'node'] as const;
export const rendererNames: [string, ...string[]] = [...new Set([...legacyRendererNames, ...entries.map(s => s.id)])] as [string, ...string[]];
export const getRendererSpec = (id?: string) => entries.find(spec => spec.id === id);
export type { RendererSpec } from './spec';
