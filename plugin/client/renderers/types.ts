import type { ComponentType } from 'react';
import type { CanvasBlock, CanvasDocument } from '../../shared/model';
import type { RendererRuntime, RendererScope } from '../useLearning';
import type { useUI } from '../ui';
export type DeepReadonly<T> = T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[] : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;
export type RendererProps<Data = unknown> = {
  document: DeepReadonly<CanvasDocument>;
  data: Data; block: CanvasBlock; availableWidth: number; compact: boolean; readOnly: boolean;
  ui: ReturnType<typeof useUI>; runtime: RendererRuntime; scope: RendererScope;
  send(kind: string, payload: CanvasBlock['data'], label: string, delivery?: 'immediate' | 'batched'): Promise<void>;
  /** The canvas selection, and a way to move it: how a renderer points at other cards. Absent outside a canvas. */
  selection?: readonly string[]; select?(ids: string[]): void;
};
export type RendererVisual = { icon: string; tone: string; width: 'standard' | 'wide' | 'node' };
export type LinkMotionToken = { linkId: string; progress: number; kind: 'message' | 'signal' | 'value'; label: string; sign?: 1 | -1; delay?: number };
export type LinkMotionSample = { tokens: readonly LinkMotionToken[]; playing: boolean };
export type ClientRenderer<Data = unknown> = {
  id: string; Component: ComponentType<RendererProps<Data>>; visual: RendererVisual;
  /** Prepare once per authored document; sample raw per-block runtime with epoch milliseconds. Read only. */
  prepareLinkMotion?(data: Data, document: DeepReadonly<CanvasDocument>):
    (runtime: Readonly<Record<string, unknown>>, epochMs: number) => readonly LinkMotionToken[];
};
