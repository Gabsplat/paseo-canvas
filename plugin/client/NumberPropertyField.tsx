import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { TextInput } from '@getpaseo/plugin/client/react-native';
import { Button, Txt, useUI } from './ui';
import { propertyValue } from './logic';
/** The property form uses a numeric native keyboard and validates before submitting. */
export function NumberPropertyField({ label, value, required, disabled, save }: { label: string; value: string; required?: boolean; disabled: boolean; save(value: number): Promise<unknown> }) {
  const u = useUI(), [draft, setDraft] = useState(value), [error, setError] = useState(''), [pending, setPending] = useState(false), [focused, setFocused] = useState(false), dirty = useRef(false), flight = useRef(false);
  const live = useRef({ draft, disabled, save }); live.current = { draft, disabled, save };
  useEffect(() => { if (!dirty.current) setDraft(value); }, [value]);
  const submit = async () => {
    const current = live.current; if (!dirty.current || flight.current || current.disabled) return;
    let number: number; try { number = propertyValue('number', current.draft) as number; } catch { setError('Número no válido'); return; }
    flight.current = true; setPending(true); setError('');
    try { const result = await current.save(number); if (!result) throw new Error(); if (live.current.draft === current.draft) dirty.current = false; }
    catch { setError('El cambio no se aplicó.'); } finally { flight.current = false; setPending(false); }
  };
  return <View style={{ gap: 4 }}><Txt kind="small" style={{ fontWeight: '600' }}>{label}{required ? ' *' : ''}</Txt>
    <TextInput accessibilityLabel={label} keyboardType="numeric" value={draft} editable={!disabled} onChangeText={text => { dirty.current = true; setDraft(text); setError(''); }} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); void submit(); }} onSubmitEditing={() => { void submit(); }} style={[u.font('code'), { height: u.compact ? 44 : 32, paddingHorizontal: focused ? 9 : 10, backgroundColor: u.c.surface2, borderRadius: 6, borderWidth: focused ? 2 : 1, borderColor: focused ? u.c.accent : u.c.border }]} />
    {pending && <Txt kind="small" muted>Guardando…</Txt>}{!!error && <><Txt kind="small" accessibilityLiveRegion="polite" style={{ color: u.c.statusDanger }}>No se guardó · {error}</Txt><Button label="Reintentar" small variant="ghost" disabled={disabled || pending} onPress={() => { void submit(); }} /></>}
  </View>;
}
