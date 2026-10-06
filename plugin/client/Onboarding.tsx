import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import type { CanvasCatalog } from '../shared/model';
import { Button, Chip, Input, Modal, Segments, Txt, useUI } from './ui';
import { Appear } from './motion';
import { tokens } from './tokens';
import { guideSections, guideShortcuts, type GuideAction } from './guide';

export function Onboarding({ open, close, catalog, onAction }: { open: boolean; close: () => void; catalog: CanvasCatalog | null; onAction: (action: GuideAction) => void }) {
  const u = useUI(), [mode, setMode] = useState<'tour' | 'all'>('tour'), [step, setStep] = useState(0), [query, setQuery] = useState('');
  useEffect(() => { if (open) { setMode('tour'); setStep(0); setQuery(''); } }, [open]);
  const section = guideSections[step], normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), search = normalized(query.trim());
  const matches = guideSections.map(s => ({ ...s, features: s.features.filter(f => normalized(`${s.title} ${f.title} ${f.detail} ${f.keywords ?? ''}`).includes(search)) })).filter(s => s.features.length);
  const types = (catalog?.blockTypes ?? []).filter(type => !search || normalized('catálogo tipos bloques').includes(search) || normalized(`${type.name} ${type.id} ${type.description ?? ''}`).includes(search));
  const shortcuts = guideShortcuts.filter(([key, label]) => !search || normalized('atajos teclado shortcuts').includes(search) || normalized(`${key} ${label}`).includes(search));
  const action = (value: GuideAction) => { close(); onAction(value); };
  const features = (list: typeof section.features) => <View style={{ gap: 16 }}>{list.map(feature => <View key={feature.title} style={{ gap: 4 }}><Txt kind="bodyStrong">{feature.title}</Txt><Txt kind="small" muted>{feature.detail}</Txt>{feature.action && <Button label={feature.button ?? feature.title} small variant="ghost" style={{ alignSelf: 'flex-start', marginLeft: -8 }} onPress={() => action(feature.action!)} />}</View>)}</View>;
  return <Modal title="Guía de Lienzo" open={open} onOpenChange={value => { if (!value) close(); }}><Modal.Content>
    <Segments value={mode} options={[{ value: 'tour', label: 'Recorrido' }, { value: 'all', label: 'Todas las opciones' }]} onChange={setMode} />
    {mode === 'tour' ? <>
      <View accessibilityLabel={`Paso ${step + 1} de ${guideSections.length}`} style={{ flexDirection: 'row', gap: 6 }}>{guideSections.map((s, i) => <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`Paso ${i + 1}: ${s.title}`} accessibilityState={{ selected: step === i }} onPress={() => setStep(i)} hitSlop={8} style={{ flex: 1, height: 16, justifyContent: 'center' }}><View style={{ height: 3, borderRadius: 2, backgroundColor: i <= step ? u.c.accent : u.c.border }} /></Pressable>)}</View>
      <Appear key={section.id} interactive ms={tokens.motion.enter.ms} style={{ gap: 16 }}>
        <View style={{ width: 44, height: 44, borderRadius: tokens.radius.block, backgroundColor: u.wash('acento'), alignItems: 'center', justifyContent: 'center' }}><Icon name={section.icon} size={22} color={u.c.accent} /></View>
        <View style={{ gap: 8 }}><Txt kind="display">{section.title}</Txt><Txt muted>{section.intro}</Txt></View>
        {features(section.features)}
      </Appear>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: u.c.border, paddingTop: 12 }}>
        <Button label={step ? 'Atrás' : 'Después'} variant="ghost" onPress={() => step ? setStep(v => v - 1) : close()} />
        <Txt kind="label" muted>{step + 1} / {guideSections.length}</Txt>
        <Button label={step === guideSections.length - 1 ? 'Usar mi lienzo' : 'Siguiente'} variant="primary" onPress={() => step === guideSections.length - 1 ? close() : setStep(v => v + 1)} />
      </View>
    </> : <>
      <Input label="Buscar en la guía" placeholder="Buscar: resize, videos, agente…" value={query} onChange={setQuery} />
      {!matches.length && !types.length && !shortcuts.length && <Txt muted>No hay opciones con ese texto.</Txt>}
      {matches.map(s => <View key={s.id} style={{ gap: 12, paddingTop: 8 }}><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name={s.icon} size={16} color={u.c.foregroundMuted} /><Txt kind="heading">{s.title}</Txt></View>{features(s.features)}</View>)}
      {!!types.length && <View style={{ gap: 8 }}><Txt kind="heading">Tipos de tu catálogo</Txt><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{types.map(type => <Chip key={type.id} label={type.name} />)}</View><Button label="Abrir catálogo" small variant="ghost" onPress={() => action('catalog')} /></View>}
      {!!shortcuts.length && <View style={{ gap: 8 }}><Txt kind="heading">Atajos de teclado</Txt>{u.layout.platform === 'web' ? shortcuts.map(([key, label]) => <View key={key} style={{ gap: 4, paddingVertical: 6, borderBottomWidth: 1, borderColor: u.c.border }}><Txt kind="code">{key}</Txt><Txt kind="small" muted>{label}</Txt></View>) : <Txt kind="small" muted>Los atajos están disponibles en la versión web. En móvil usá el inspector, Esquema y Más acciones.</Txt>}</View>}
      <Button label="Volver al lienzo" variant="primary" onPress={close} />
    </>}
  </Modal.Content></Modal>;
}
