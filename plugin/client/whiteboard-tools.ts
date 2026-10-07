import type { Point } from './logic';
import type { WbColor, WbScale, WbShape } from '../shared/whiteboard';
export type CanvasTool = 'select' | 'hand' | 'text' | 'shape' | 'draw' | 'eraser' | 'svg';
export type ToolStyle = {
  color: WbColor; scale: WbScale; fill: 'none' | 'wash' | 'solid'; fillColor?: WbColor; stroke: 'solid' | 'dashed' | 'dotted';
  shape: WbShape; heads: 'none' | 'end' | 'start' | 'both'; font: 'sans' | 'serif' | 'mono'; align: 'left' | 'center' | 'right';
};
export const DEFAULT_TOOL_STYLE: ToolStyle = { color: 'tinta', scale: 'm', fill: 'none', stroke: 'solid', shape: 'rect', heads: 'none', font: 'sans', align: 'left' };
export type SvgInsertOptions = { caption?: string; source?: string; license?: string; at?: Point; atPage?: Point; parentGroupId?: string | null };
export type CanvasToolProps = { tool?: CanvasTool; onToolChange?: (tool: CanvasTool) => void; toolStyle?: ToolStyle; toolLocked?: boolean };
