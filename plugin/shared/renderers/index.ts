import type { RendererSpec } from './spec';
const entries: RendererSpec[] = [];
function registerRenderer(spec: RendererSpec) {
  if (entries.some(entry => entry.id === spec.id) || spec.blockType.renderer !== spec.id) throw new Error(`Invalid or duplicate renderer ${spec.id}.`);
  entries.push(spec);
}
// Add one import/register line here, before rendererNames is built.
import { controlsSpec } from './controls'; registerRenderer(controlsSpec);
import { animatedFlowSpec } from './animated-flow'; registerRenderer(animatedFlowSpec);
import { glslShaderSpec } from './glsl-shader'; registerRenderer(glslShaderSpec);
import { whiteboardSpecs } from './whiteboard'; whiteboardSpecs.forEach(registerRenderer);
import { fileTreeSpec } from './file-tree'; registerRenderer(fileTreeSpec);
import { htmlAppSpec } from './html-app'; registerRenderer(htmlAppSpec);
export const rendererSpecs: readonly RendererSpec[] = entries;
export const legacyRendererNames = ['text', 'note', 'code', 'checklist', 'form', 'metric', 'image-ref', 'step', 'callout', 'preview-frame', 'quiz', 'node'] as const;
export const rendererNames: [string, ...string[]] = [...new Set([...legacyRendererNames, ...entries.map(s => s.id)])] as [string, ...string[]];
/**
 * Renderers that no longer exist. Stored catalogs and packs may still name them, so the type schema keeps
 * accepting these names as data. Nothing draws them and catalogView leaves their types out of the usable catalog.
 */
export const retiredRendererNames = ['prediction-gate', 'choice', 'progress', 'diagram', 'function-plot', 'annotated-content', 'step-figure', 'step-sequencer'] as const;
export const isRetiredRenderer = (id?: string) => (retiredRendererNames as readonly string[]).includes(id ?? '');
/** Every renderer name a stored type may carry: the live ones plus the retired ones. */
export const storedRendererNames: [string, ...string[]] = [...rendererNames, ...retiredRendererNames.filter(name => !rendererNames.includes(name))] as [string, ...string[]];
export const getRendererSpec = (id?: string) => entries.find(spec => spec.id === id);
export type { RendererSpec } from './spec';
