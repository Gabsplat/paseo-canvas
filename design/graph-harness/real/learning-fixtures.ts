import type { CanvasBlock, CanvasDocument } from '../../../plugin/shared/model';
import { builtinTypes } from '../../../plugin/shared/builtins';

// Authored examples only. These exercise the registered components, never a live agent.
export function learningFixture(base: CanvasDocument, lesson: string): CanvasDocument {
  const block = (id: string, typeId: string, title: string, x: number, y: number, data = {}, width = 440, height = 600): CanvasBlock => ({
    id, typeId, title, position: { x, y }, size: { width, height },
    data: { ...builtinTypes.find(type => type.id === typeId)?.defaults, ...data },
  });
  const cases: Record<string, CanvasBlock[]> = {
    controls: [block('controls', 'controls', 'Controles de ejemplo', 0, 0, { variables: ['amplitude'] }, 320, 240)],
    flow: [block('flow', 'animated-flow', 'Flujo de ejemplo', 0, 0, { duration: 4000, travelMs: 2000,
      events: [{ t: 0, from: 'sender', to: 'receiver', linkId: 'ruta', payload: 'Ejemplo', kind: 'message' }] }),
      block('sender', 'node', 'Origen de ejemplo', 500, 60, {}, 220, 140), block('receiver', 'node', 'Destino de ejemplo', 810, 280, {}, 220, 140)],
    shader: [block('shader', 'glsl-shader', 'Shader de ejemplo', 0, 0)],
  };
  return { ...base, title: `Aprendizaje: ${lesson} (datos de ejemplo)`, example: true, layout: { mode: 'free' }, groups: [],
    variables: [{ name: 'amplitude', label: 'Amplitud', value: 1, min: .1, max: 3, step: .1 }], blocks: cases[lesson] ?? cases.controls,
    links: lesson === 'flow' ? [{ id: 'ruta', from: 'sender', to: 'receiver', kind: 'flow', label: 'Conexión de ejemplo' }] : [],
  };
}
