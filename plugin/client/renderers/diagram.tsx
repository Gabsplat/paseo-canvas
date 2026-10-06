import React from 'react';
import type { DiagramData } from '../../shared/renderers/diagram';
import { Diagram } from '../Diagram';
import { tokens } from '../tokens';
import type { ClientRenderer, RendererProps } from './types';
function DiagramRenderer({ block, readOnly, send }: RendererProps<DiagramData>) {
  return <Diagram block={block} disabled={readOnly} onAsk={(nodeId, label) => { void send('diagram.step', { nodeId, label }, `Preguntar por «${label}»`); }} />;
}
export const diagramRenderer: ClientRenderer<DiagramData> = { id: 'diagram', Component: DiagramRenderer, visual: tokens.renderers.diagram };
