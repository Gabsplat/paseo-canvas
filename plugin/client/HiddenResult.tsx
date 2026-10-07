import React from 'react';
import { View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import { Button, Txt, useUI } from './ui';
export function HiddenResult({ gateIds, open }: { gateIds: readonly string[]; open: (id: string) => void }) {
  const ui = useUI();
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Icon name="LockKeyhole" size={16} color={ui.tone('violeta')} /><Txt kind="heading">Resultado oculto</Txt></View>
    <Txt kind="small" muted>Completa el bloque que lo oculta para descubrirlo.</Txt>
    {gateIds.map((id, index) => <Button key={id} label={gateIds.length === 1 ? 'Ir al bloque que lo oculta' : `Ir al bloque ${index + 1}`} small variant="ghost" onPress={() => open(id)} />)}
  </View>;
}
