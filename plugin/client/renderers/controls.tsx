import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import type { ControlsData } from '../../shared/renderers/controls';
import { Button, Txt } from '../ui';
import { NativeLearningFallback } from '../Surfaces';
import { WebRange } from '../web';
import { tokens } from '../tokens';
import type { RendererProps, ClientRenderer } from './types';
function Controls({ data, block, scope, runtime, readOnly, ui }: RendererProps<ControlsData>) {
  const ranges = useRef<Record<string, [number, number]>>({}), [error, setError] = useState('');
  const summary = data.variables.map(name => `${scope.variables[name]?.label ?? name}: ${scope.get(name)}`).join(', ');
  if (ui.layout.platform !== 'web') return <NativeLearningFallback summary={`${data.question} ${summary || 'No variables.'}`} />;
  return <View style={{ gap: 8 }}><Txt>{data.question}</Txt>{!data.variables.length && <Txt kind="small" muted>Add names of variables declared in the Marco or the Lienzo.</Txt>}{data.variables.map(name => {
    const variable = scope.variables[name];
    if (!variable) return <Txt key={name} kind="small" style={{ color: ui.c.statusDanger }}>Variable sin declarar: {name}</Txt>;
    const changed = (value: number) => {
      const visited = ranges.current[name] ?? [variable.current, variable.current];
      ranges.current[name] = [Math.min(visited[0], value), Math.max(visited[1], value)]; scope.set(name, value);
    };
    return <View key={name} nativeID={`lienzo-interactive-controls-${block.id}-${name}`} style={{ gap: 4 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Txt kind="label">{variable.label ?? name}</Txt><Txt kind="code">{Number(variable.current.toPrecision(6))}{variable.unit ? ` ${variable.unit}` : ''}</Txt></View><WebRange id={`${block.id}-${name}`} label={variable.label ?? name} min={variable.min} max={variable.max} step={variable.step ?? 'any'} value={variable.current} disabled={readOnly} color={ui.c.accent} onChange={changed} onSettle={value => {
      changed(value); const visited = ranges.current[name] ?? [value, value]; delete ranges.current[name]; setError('');
      void runtime.record(`controls.${name}`, { name, value, visited, scopeId: variable.scopeId }, `Ajustar ${variable.label ?? name}`).catch(() => setError('The setting could not be saved. Check the connection and try again.'));
    }} /></View>;
  })}<Button label="Reset" small variant="ghost" disabled={readOnly || !data.variables.some(name => !!scope.variables[name])} onPress={() => {
    const defaults: Record<string, number> = {};
    for (const name of data.variables) if (scope.variables[name]) { defaults[name] = scope.variables[name].value; scope.set(name, null); }
    ranges.current = {}; setError('');
    void runtime.record('controls.reset', { values: defaults }, 'Reset controls').catch(() => setError('The controls could not be reset. Check the connection and try again.'));
  }} />{!!error && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{error}</Txt>}</View>;
}
export const controlsRenderer: ClientRenderer<ControlsData> = { id: 'controls', Component: Controls, visual: tokens.renderers.form };
