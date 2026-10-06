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
};
export type RendererVisual = { icon: string; tone: string; width: 'standard' | 'wide' | 'node' };
export type ClientRenderer<Data = unknown> = { id: string; Component: ComponentType<RendererProps<Data>>; visual: RendererVisual };
