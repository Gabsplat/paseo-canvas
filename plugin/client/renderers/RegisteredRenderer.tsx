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
export function RegisteredRenderer({ block, id, controller, readOnly, fill = false }: {
  block: CanvasBlock; id: string; controller: CanvasController; readOnly: boolean;
  /** Grow to the card's height (a sized card drawn edge to edge). */
  fill?: boolean;
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
  if (!entry || !parsed?.success || !controller.view) return <Txt kind="small" style={{ color: ui.c.statusDanger }}>This block cannot be shown. Check its data in Properties.</Txt>;
  const Component = entry.Component;
  // Discard local renderer state when switching documents or closing a gate.
  // Effects reconcile runtime after commit; they cannot conceal a stale reveal
  // in the first rendered frame after an external reset.
  // Opening a gate preserves the attempt that is recording its comparison. Closing
  // invalidates both local state and callbacks still waiting for that save.
  const rendererKey = JSON.stringify([identity, epoch]);
  const active = () => lifetime.current.active && lifetime.current.epoch === epoch
    && lifetime.current.identity === identity
    && controller.current.current?.document.id === document?.id
    && controller.current.current?.document.workspaceId === document?.workspaceId;
  const scopedRuntime = { ...runtime,
    set: (...args: Parameters<typeof runtime.set>) => { if (active()) runtime.set(...args); },
    async record(...args: Parameters<typeof runtime.record>) {
      await runtime.flush();
      if (!active()) throw new Error('The Lienzo or the block changed before the interaction finished.');
      return runtime.record(...args);
    },
  };
  const scopedScope = { ...scope, set: (...args: Parameters<typeof scope.set>) => { if (active()) scope.set(...args); } };
  return <View nativeID={spec?.interactive ? `lienzo-interactive-renderer-${block.id}` : undefined} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={fill ? { flex: 1, minHeight: 0 } : undefined}>
    <Component key={rendererKey} document={presentation?.document ?? controller.view.document} data={parsed.data} block={block} availableWidth={width} compact={ui.compact} readOnly={readOnly} ui={ui} runtime={scopedRuntime} scope={scopedScope} selection={controller.selection} select={ids => { void controller.select(ids); }} />
  </View>;
}
