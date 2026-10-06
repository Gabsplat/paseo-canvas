import type { RendererSpec } from './spec';
import { wbTextDataSchema, wbShapeDataSchema, wbSvgDataSchema, wbDrawDataSchema } from '../whiteboard';
const guidance = 'Usa wb-text para rótulos sueltos, wb-shape para cajas y flechas simples, wb-svg con iconos de la biblioteca para arquitectura. Para explicar relaciones usa links, no flechas dibujadas. No generes wb-draw salvo petición explícita. Todos llevan position y usan operaciones normales de bloque; wb-text usa data.width y no block.size. wb-svg acepta SVG estático local, nunca URLs; el servidor fija viewBox. wb-draw requiere size y extent, pares x,y y roles color/weight.';
const property = (key: string, kind: 'text' | 'number' | 'json', required = false) => ({ key, label: key, kind, required });
export const whiteboardSpecs: RendererSpec[] = [
  {
    id: 'wb-text', dataSchema: wbTextDataSchema, interactive: false, minSize: { width: 24, height: 8 }, guidance,
    blockType: { id: 'wb-text', renderer: 'wb-text', name: 'Texto libre', description: 'Rótulo persistente sin tarjeta, situado libremente en el lienzo o un grupo.',
      properties: [property('text', 'text', true), property('color', 'text'), property('scale', 'text'), property('font', 'text'), property('align', 'text'), property('width', 'number')], defaults: { text: '' } },
  },
  {
    id: 'wb-shape', dataSchema: wbShapeDataSchema, interactive: false, minSize: { width: 24, height: 24 }, defaultSize: { width: 160, height: 104 }, guidance,
    blockType: { id: 'wb-shape', renderer: 'wb-shape', name: 'Forma', description: 'Forma o línea persistente con color, trazo y rótulo opcional.',
      properties: ['shape', 'color', 'fill', 'stroke', 'weight', 'text', 'from', 'heads'].map(key => property(key, 'text')), defaults: { shape: 'rect' } },
  },
  {
    id: 'wb-svg', dataSchema: wbSvgDataSchema, interactive: false, minSize: { width: 24, height: 24 }, defaultSize: { width: 96, height: 96 }, guidance,
    blockType: { id: 'wb-svg', renderer: 'wb-svg', name: 'Imagen SVG', description: 'SVG estático local saneado en el servidor. Conserva atribución y licencia.',
      properties: [property('svg', 'text', true), property('viewBox', 'json'), property('color', 'text'), property('caption', 'text'), property('source', 'text'), property('license', 'text')], defaults: { svg: '<svg viewBox="0 0 24 24"/>' } },
  },
  {
    id: 'wb-draw', dataSchema: wbDrawDataSchema, interactive: false, minSize: { width: 8, height: 8 }, guidance,
    blockType: { id: 'wb-draw', renderer: 'wb-draw', name: 'Dibujo', description: 'Trazos libres persistentes, acotados y simplificados. Crear solo por petición explícita.',
      properties: [property('extent', 'json', true), property('strokes', 'json', true)], defaults: { extent: { width: 8, height: 8 }, strokes: [{ points: [0, 0, 0, 0], color: 'tinta', weight: 'm' }] } },
  },
];
