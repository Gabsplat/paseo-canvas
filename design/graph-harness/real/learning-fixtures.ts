import type { CanvasBlock, CanvasDocument } from '../../../plugin/shared/model';
import { builtinTypes } from '../../../plugin/shared/builtins';

// Authored examples only. These exercise the registered components, never a live agent.
export function learningFixture(base: CanvasDocument, lesson: string): CanvasDocument {
  const block = (id: string, typeId: string, title: string, x: number, y: number, data = {}, width = 440, height = 600): CanvasBlock => ({
    id, typeId, title, position: { x, y }, size: { width, height },
    data: { ...builtinTypes.find(type => type.id === typeId)?.defaults, ...data },
  });
  const result = block('resultado', 'note', 'Resultado de ejemplo', 500, 0, { text: 'SOLUCIÓN DE EJEMPLO: aumenta.' });
  const sourceUrl = 'http://127.0.0.1:8765/image-fixture.svg';
  const passageText = 'La amplitud cambia la altura de la onda.';
  const annotations = (image: boolean) => ({
    question: '¿Qué señala la anotación de ejemplo?',
    base: image ? { kind: 'image', key: 'base', revision: '1', url: sourceUrl, alt: 'Imagen local de ejemplo', aspectRatio: 640 / 420 }
      : { kind: 'text', key: 'base', revision: '1', passages: [{ id: 'p', text: passageText }] },
    layers: [{ id: 'capa', name: 'Capa de ejemplo', visible: true }],
    annotations: [{ id: 'marca', title: image ? 'Sol de ejemplo' : 'Amplitud de ejemplo', text: 'Explicación local de ejemplo.', anchor: {
      baseKey: 'base', baseRevision: '1', layerId: 'capa', ...(image ? { kind: 'image-point', sourceUrl, x: 445 / 640, y: 125 / 420 }
        : { kind: 'text-range', passageId: 'p', passageText, start: 3, end: 11 }),
    } }],
  });
  const cases: Record<string, CanvasBlock[]> = {
    controls: [block('controls', 'controls', 'Controles de ejemplo', 0, 0, { variables: ['amplitude'] }, 320, 240),
      block('plot', 'function-plot', 'Gráfica de ejemplo', 370, 0, { expressions: [{ expression: 'amplitude*sin(x)', label: 'Onda de ejemplo' }], yRange: [-3, 3] })],
    prediction: [block('gate', 'prediction-gate', 'Apuesta de ejemplo', 0, 0), result],
    figure: [block('figure', 'step-figure', 'Figura de ejemplo', 0, 0, { playback: { intervalMs: 700 } })],
    flow: [block('flow', 'animated-flow', 'Flujo de ejemplo', 0, 0, { duration: 4000, travelMs: 2000,
      events: [{ t: 0, from: 'sender', to: 'receiver', linkId: 'ruta', payload: 'Ejemplo', kind: 'message' }] }),
      block('sender', 'node', 'Origen de ejemplo', 500, 60, {}, 220, 140), block('receiver', 'node', 'Destino de ejemplo', 810, 280, {}, 220, 140)],
    shader: [block('shader', 'glsl-shader', 'Shader de ejemplo', 0, 0)],
    sequencer: [block('sequencer', 'step-sequencer', 'Secuenciador de ejemplo', 0, 0, {}, 560, 520), block('sequencer-b', 'step-sequencer', 'Segundo secuenciador de ejemplo', 620, 0, { steps: 16, stepsPerBeat: 4, labels: 'degree', rows: [6, 5, 4, 3, 2, 1], tempo: { bpm: 120, min: 60, max: 200 }, pattern: Array.from({ length: 6 }, (_, i) => `${'.'.repeat(i * 2)}x${'.'.repeat(15 - i * 2)}`) }, 560, 560)],
    annotations: [block('image-annotation', 'annotated-content', 'Imagen anotada de ejemplo', 0, 0, annotations(true)),
      block('text-annotation', 'annotated-content', 'Texto anotado de ejemplo', 500, 0, annotations(false))],
  };
  return { ...base, title: `Aprendizaje: ${lesson} (datos de ejemplo)`, example: true, layout: { mode: 'free' }, groups: [],
    variables: [{ name: 'amplitude', label: 'Amplitud', value: 1, min: .1, max: 3, step: .1 }], blocks: cases[lesson] ?? cases.controls,
    links: lesson === 'flow' ? [{ id: 'ruta', from: 'sender', to: 'receiver', kind: 'flow', label: 'Conexión de ejemplo' }] : [],
  };
}
