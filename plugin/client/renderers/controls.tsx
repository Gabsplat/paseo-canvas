import React, { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ControlsData } from '../../shared/renderers/controls';
import type { ResolvedVariable } from '../../shared/learning';
import { Button, CheckRow, Txt } from '../ui';
import { NativeLearningFallback } from '../Surfaces';
import { WebRange } from '../web';
import { withAlpha } from '../color';
import { tokens } from '../tokens';
import type { RendererProps, ClientRenderer } from './types';
const valueText = (v: ResolvedVariable, value: number) => v.type === 'boolean' ? value ? 'On' : 'Off' : v.type === 'choice' ? v.options?.[Math.round(value)] ?? String(value) : `${Number(value.toPrecision(6))}${v.unit ? ` ${v.unit}` : ''}`;
/** One control per variable: a slider for a number, a switch for on/off, buttons for a choice. */
function Controls({ data, block, scope, runtime, readOnly, ui }: RendererProps<ControlsData>) {
  const ranges = useRef<Record<string, [number, number]>>({}), [error, setError] = useState('');
  const summary = data.variables.map(name => scope.variables[name] ? `${scope.variables[name].label ?? name}: ${valueText(scope.variables[name], scope.get(name))}` : '').filter(Boolean).join(', ');
  if (ui.layout.platform !== 'web') return <NativeLearningFallback summary={`${data.question ? data.question + ' ' : ''}${summary || 'No variables.'}`} />;
  const record = (name: string, value: number, variable: ResolvedVariable) => {
    const visited = ranges.current[name] ?? [value, value]; delete ranges.current[name]; setError('');
    void runtime.record(`controls.${name}`, { name, value, visited, scopeId: variable.scopeId }, `Adjust ${variable.label ?? name}`).catch(() => setError('The setting could not be saved. Check the connection and try again.'));
  };
  const changed = (name: string, value: number, variable: ResolvedVariable) => {
    const visited = ranges.current[name] ?? [variable.current, variable.current];
    ranges.current[name] = [Math.min(visited[0], value), Math.max(visited[1], value)]; scope.set(name, value);
  };
  return <View style={{ gap: 8 }}>{!!data.question && <Txt>{data.question}</Txt>}
    {!data.variables.length && <Txt kind="small" muted>No variables yet. Select this block and pick some in Properties, or make a new one there.</Txt>}
    {data.variables.map(name => {
      const variable = scope.variables[name];
      if (!variable) return <Txt key={name} kind="small" style={{ color: ui.c.statusDanger }}>{name} is not declared on this Frame or the Lienzo. Declare it in Properties → Variables.</Txt>;
      const label = variable.label ?? name, id = `lienzo-interactive-controls-${block.id}-${name}`;
      if (variable.type === 'boolean') return <View key={name} nativeID={id}><CheckRow label={label} checked={variable.current === 1} disabled={readOnly} onPress={() => { const value = variable.current ? 0 : 1; changed(name, value, variable); scope.set(name, value, true); record(name, value, variable); }} /></View>;
      if (variable.type === 'choice') return <View key={name} nativeID={id} style={{ gap: 4 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Txt kind="label">{label}</Txt><Txt kind="code">{valueText(variable, variable.current)}</Txt></View>
        <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{(variable.options ?? []).map((option, i) => { const on = Math.round(variable.current) === i; return <Pressable key={option} accessibilityRole="radio" accessibilityLabel={option} accessibilityState={{ checked: on, disabled: readOnly }} disabled={readOnly} onPress={e => { e.stopPropagation(); changed(name, i, variable); scope.set(name, i, true); record(name, i, variable); }}
          style={({ pressed }) => ({ minHeight: ui.compact ? 44 : 28, paddingHorizontal: 10, borderRadius: tokens.radius.pill, justifyContent: 'center', borderWidth: 1, borderColor: on ? ui.c.accent : ui.c.border, backgroundColor: on ? withAlpha(ui.c.accent, .14) : pressed ? withAlpha(ui.c.foreground, .08) : 'transparent', opacity: readOnly ? .45 : 1 })}><Txt kind="small" style={{ color: on ? ui.c.accent : ui.c.foreground, fontWeight: on ? '600' : '400' }}>{option}</Txt></Pressable>; })}</View></View>;
      return <View key={name} nativeID={id} style={{ gap: 4 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Txt kind="label">{label}</Txt><Txt kind="code">{valueText(variable, variable.current)}</Txt></View><WebRange id={`${block.id}-${name}`} label={label} min={variable.min} max={variable.max} step={variable.step ?? 'any'} value={variable.current} disabled={readOnly} color={ui.c.accent} onChange={value => changed(name, value, variable)} onSettle={value => { changed(name, value, variable); record(name, value, variable); }} /></View>;
    })}
    <Button label="Reset" small variant="ghost" disabled={readOnly || !data.variables.some(name => !!scope.variables[name])} onPress={() => {
      const defaults: Record<string, number> = {};
      for (const name of data.variables) if (scope.variables[name]) { defaults[name] = scope.variables[name].value; scope.set(name, null); }
      ranges.current = {}; setError('');
      void runtime.record('controls.reset', { values: defaults }, 'Reset controls').catch(() => setError('The controls could not be reset. Check the connection and try again.'));
    }} />{!!error && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{error}</Txt>}</View>;
}
export const controlsRenderer: ClientRenderer<ControlsData> = { id: 'controls', Component: Controls, visual: tokens.renderers.form };
