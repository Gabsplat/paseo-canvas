import type { RendererSpec } from './spec';
import { wbTextDataSchema, wbShapeDataSchema, wbSvgDataSchema, wbDrawDataSchema, remapDrawAnchor } from '../whiteboard';
const guidance = 'Usa wb-text para rótulos sueltos, wb-shape para cajas y flechas simples, wb-svg con iconos de la biblioteca para arquitectura. Para explicar relaciones usa links, no flechas dibujadas. No generes wb-draw salvo petición explícita. Todos llevan position y usan operaciones normales de bloque; wb-text usa data.width y no block.size. En wb-shape, fillColor (opcional) colorea el interior aparte del contorno y weight fija a la vez el grosor del contorno y el tamaño del rótulo. wb-svg acepta SVG estático local, nunca URLs; el servidor fija viewBox. wb-draw requiere size y extent, pares x,y y roles color/weight; un wb-draw puede reunir varios trazos de una misma ilustración (hasta 32), mientras que el lápiz de la persona crea un wb-draw por trazo; un wb-draw creado por el asistente queda marcado author assistant y se pinta discontinuo y rotulado; anchor opcional es el id de la tarjeta que anota (mismo grupo) y entonces position es relativa a la esquina de esa tarjeta.';
const property = (key: string, kind: 'text' | 'number' | 'json', required = false) => ({ key, label: key, kind, required });
export const whiteboardSpecs: RendererSpec[] = [
  {
    id: 'wb-text', dataSchema: wbTextDataSchema, interactive: false, minSize: { width: 24, height: 8 }, guidance,
    blockType: { id: 'wb-text', renderer: 'wb-text', name: 'Free text', description: 'A label without a card, placed freely on the Lienzo or in a Frame.',
      properties: [property('text', 'text', true), property('color', 'text'), property('scale', 'text'), property('font', 'text'), property('align', 'text'), property('width', 'number')], defaults: { text: '' } },
  },
  {
    id: 'wb-shape', dataSchema: wbShapeDataSchema, interactive: false, minSize: { width: 24, height: 24 }, defaultSize: { width: 160, height: 104 }, guidance,
    blockType: { id: 'wb-shape', renderer: 'wb-shape', name: 'Shape', description: 'A shape or line with colour, stroke and an optional label.',
      properties: ['shape', 'color', 'fill', 'fillColor', 'stroke', 'weight', 'text', 'from', 'heads'].map(key => property(key, 'text')), defaults: { shape: 'rect' } },
  },
  {
    id: 'wb-svg', dataSchema: wbSvgDataSchema, interactive: false, minSize: { width: 24, height: 24 }, defaultSize: { width: 96, height: 96 }, guidance,
    blockType: { id: 'wb-svg', renderer: 'wb-svg', name: 'SVG image', description: 'A static SVG, cleaned on the server. Keeps its attribution and licence.',
      properties: [property('svg', 'text', true), property('viewBox', 'json'), property('color', 'text'), property('caption', 'text'), property('source', 'text'), property('license', 'text')], defaults: { svg: '<svg viewBox="0 0 24 24"/>' } },
  },
  {
    id: 'wb-draw', dataSchema: wbDrawDataSchema, interactive: false, minSize: { width: 8, height: 8 }, guidance, remapReferences: remapDrawAnchor,
    blockType: { id: 'wb-draw', renderer: 'wb-draw', name: 'Drawing', description: 'Freehand strokes, bounded and simplified. Create only when asked.',
      properties: [property('extent', 'json', true), property('strokes', 'json', true), property('author', 'text'), property('anchor', 'text')], defaults: { extent: { width: 8, height: 8 }, strokes: [{ points: [0, 0, 0, 0], color: 'tinta', weight: 'm' }] } },
  },
];
