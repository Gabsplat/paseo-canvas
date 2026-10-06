import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { CanvasBlock } from '../../shared/model';
import { getRendererSpec } from '../../shared/renderers';
import type { CanvasController } from '../useCanvas';
import { useLearning } from '../useLearning';
import { Txt, useUI } from '../ui';
import { getClientRenderer } from './index';
import { usePresentation } from '../usePresentation';
import { HiddenResult } from '../HiddenResult';
export function RegisteredRenderer({ block, id, controller, readOnly, send }: {
  block: CanvasBlock; id: string; controller: CanvasController; readOnly: boolean;
  send(kind: string, payload: CanvasBlock['data'], label: string, delivery?: 'immediate' | 'batched'): Promise<void>;
}) {
  const ui = useUI(), { runtime, scope } = useLearning(block, controller), [width, setWidth] = useState(0), presentation = usePresentation(controller);
  const gates = presentation?.hiddenBy.get(block.id);
  const spec = getRendererSpec(id), entry = getClientRenderer(id), parsed = useMemo(() => spec?.dataSchema.safeParse(block.data), [spec, block.data]);
  const document = controller.view?.document;
  const identity = JSON.stringify([document?.workspaceId, document?.id, block.id, id]);
  const concealed = !!gates?.length || !!(document && spec?.hiddenTargets?.(block.data, runtime.state, document, block.id)?.length);
  const lifetime = useRef({ identity, concealed, epoch: 0, active: true });
  if (lifetime.current.identity !== identity || (!lifetime.current.concealed && concealed)) lifetime.current.epoch++;
  lifetime.current.identity = identity; lifetime.current.concealed = concealed;
  const epoch = lifetime.current.epoch;
  useEffect(() => {
    lifetime.current.active = true;
    return () => { lifetime.current.active = false; };
  }, []);
  if (gates?.length) return <HiddenResult gateIds={gates} open={target => { void controller.select([target]); }} />;
  if (!entry || !parsed?.success || !controller.view) return <Txt kind="small" style={{ color: ui.c.statusDanger }}>No se puede mostrar este bloque. Revisa sus datos en Detalles.</Txt>;
  const Component = entry.Component;
  // Discard local renderer state when switching documents or closing a gate.
  // Effects reconcile runtime after commit; they cannot conceal a stale reveal
  // in the first rendered frame after an external reset.
  // Opening a gate preserves the attempt that is sending its comparison. Closing
  // invalidates both local state and callbacks still waiting for that delivery.
  const rendererKey = JSON.stringify([identity, epoch]);
  const active = () => lifetime.current.active && lifetime.current.epoch === epoch
    && lifetime.current.identity === identity
    && controller.current.current?.document.id === document?.id
    && controller.current.current?.document.workspaceId === document?.workspaceId;
  const scopedRuntime = { ...runtime,
    set: (...args: Parameters<typeof runtime.set>) => { if (active()) runtime.set(...args); },
    async settle(...args: Parameters<typeof runtime.settle>) {
      await runtime.flush();
      if (!active()) throw new Error('El documento o la apuesta cambió antes de completar la interacción.');
      return runtime.settle(...args);
    },
  };
  const scopedScope = { ...scope, set: (...args: Parameters<typeof scope.set>) => { if (active()) scope.set(...args); } };
  return <View nativeID={spec?.interactive ? `lienzo-interactive-renderer-${block.id}` : undefined} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Component key={rendererKey} document={presentation?.document ?? controller.view.document} data={parsed.data} block={block} availableWidth={width} compact={ui.compact} readOnly={readOnly} ui={ui} runtime={scopedRuntime} scope={scopedScope} send={send} />
  </View>;
}
