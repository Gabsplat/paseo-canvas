import React from 'react';
import { View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import { Button, Txt, useUI } from './ui';
export function HiddenResult({ gateIds, open }: { gateIds: readonly string[]; open: (id: string) => void }) {
  const ui = useUI();
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Icon name="LockKeyhole" size={16} color={ui.tone('violeta')} /><Txt kind="heading">Hidden result</Txt></View>
    <Txt kind="small" muted>Complete the block that hides it to reveal it.</Txt>
    {gateIds.map((id, index) => <Button key={id} label={gateIds.length === 1 ? 'Go to the block that hides it' : `Go to block ${index + 1}`} small variant="ghost" onPress={() => open(id)} />)}
  </View>;
}
