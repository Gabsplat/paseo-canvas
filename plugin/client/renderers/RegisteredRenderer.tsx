import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { CanvasBlock } from '../../shared/model';
import { getRendererSpec } from '../../shared/renderers';
import type { CanvasController } from '../useCanvas';
import { useLearning } from '../useLearning';
import { Txt, useUI } from '../ui';
import { getClientRenderer } from './index';
export function RegisteredRenderer({ block, id, controller, readOnly, send }: {
  block: CanvasBlock; id: string; controller: CanvasController; readOnly: boolean;
  send(kind: string, payload: CanvasBlock['data'], label: string, delivery?: 'immediate' | 'batched'): Promise<void>;
}) {
  const ui = useUI(), { runtime, scope } = useLearning(block, controller), [width, setWidth] = useState(0);
  const spec = getRendererSpec(id), entry = getClientRenderer(id), parsed = useMemo(() => spec?.dataSchema.safeParse(block.data), [spec, block.data]);
  if (!entry || !parsed?.success || !controller.view) return <Txt kind="small" style={{ color: ui.c.statusDanger }}>No se puede mostrar este bloque. Revisa sus datos en Detalles.</Txt>;
  const Component = entry.Component;
  return <View nativeID={spec?.interactive ? `lienzo-interactive-renderer-${block.id}` : undefined} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Component document={controller.view.document} data={parsed.data} block={block} availableWidth={width} compact={ui.compact} readOnly={readOnly} ui={ui} runtime={runtime} scope={scope} send={send} />
  </View>;
}
