import React from 'react';
import { View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import { Button, Txt, useUI } from './ui';
export function HiddenResult({ gateIds, open }: { gateIds: readonly string[]; open: (id: string) => void }) {
  const ui = useUI();
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Icon name="LockKeyhole" size={16} color={ui.tone('violeta')} /><Txt kind="heading">Resultado oculto</Txt></View>
    <Txt kind="small" muted>Guarda tu apuesta y pulsa «Ver resultado» para descubrirlo.</Txt>
    {gateIds.map((id, index) => <Button key={id} label={gateIds.length === 1 ? 'Ir a mi apuesta' : `Ir a la apuesta ${index + 1}`} small variant="ghost" onPress={() => open(id)} />)}
  </View>;
}
