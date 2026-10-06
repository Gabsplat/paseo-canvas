import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { TextInput } from '@getpaseo/plugin/client/react-native';
import { WhiteboardContent } from './WhiteboardContent';
import { Button, Txt, useUI } from './ui';
import { focusInput, attachEditorKeys } from './web';
import type { TextSession, WhiteboardPreviewStore } from './useWhiteboard';
import type { Point } from './logic';
import { wbColor, wbFont } from './whiteboard-visuals';
import { tokens } from './tokens';
export function WhiteboardPreview({store,origin}:{store:WhiteboardPreviewStore;origin:Point}){
  const preview=useSyncExternalStore(store.subscribe,store.snapshot,()=>null);if(!preview)return null;const r=preview.rect;
  return <View pointerEvents="none" style={{position:'absolute',left:r.x-origin.x,top:r.y-origin.y,width:r.width,height:r.height,opacity:.55,zIndex:8}}><WhiteboardContent block={preview.block} kind={preview.block.typeId==='wb-shape'?'wb-shape':'wb-draw'} width={r.width} height={r.height} onSelect={()=>{}}/></View>;
}
export function WhiteboardEditor({session,origin,error,saving,onSave,onCancel}:{session:TextSession;origin:Point;error:string;saving:boolean;onSave(value:string):Promise<boolean>;onCancel():void}){
  const u=useUI(),[draft,setDraft]=useState(session.value),draftRef=useRef(draft),host=useRef<View>(null),cancelled=useRef(false),committing=useRef(false);
  const submit=async()=>{if(cancelled.current||committing.current)return;committing.current=true;try{await onSave(draftRef.current);}finally{committing.current=false;}};
  const cancel=()=>{cancelled.current=true;onCancel();};
  useEffect(()=>{focusInput(host.current);return attachEditorKeys(host.current,()=>{void submit();},cancel);},[]);
  const scale=session.block.data.scale as 's'|'m'|'l'|'xl'|undefined,t=tokens.whiteboard.text[scale??'m'],font=session.block.data.font as 'sans'|'serif'|'mono'|undefined;
  return <View ref={host} nativeID="lienzo-editor" style={{position:'absolute',left:session.at.x-origin.x,top:session.at.y-origin.y,width:session.width,minHeight:session.height,zIndex:20}}>
    <TextInput autoFocus multiline value={draft} maxLength={session.kind==='wb-text'?4000:1000} editable={!saving} accessibilityLabel={session.kind==='wb-text'?'Editar texto libre':'Editar texto de la forma'} onChangeText={value=>{draftRef.current=value;setDraft(value);}} onBlur={()=>{void submit();}} onKeyPress={event=>{if(event.nativeEvent.key==='Escape')cancel();}} style={{minHeight:session.kind==='wb-text'?t.lineHeight:42,width:'100%',padding:0,borderWidth:1.5,borderColor:u.c.accent,borderRadius:0,backgroundColor:u.c.surface0,color:wbColor((session.block.data.color??'tinta') as Parameters<typeof wbColor>[0],u),fontFamily:wbFont(font??'sans'),fontWeight:session.kind==='wb-text'?'400':'500',fontSize:session.kind==='wb-text'?t.fontSize:15,lineHeight:session.kind==='wb-text'?t.lineHeight:21,textAlign:session.kind==='wb-shape'?'center':session.block.data.align as 'left'|'center'|'right'|undefined,textAlignVertical:'top'}}/>
    {!!error&&<View style={{padding:6,backgroundColor:u.c.surface1,gap:4}}><Txt kind="small" style={{color:u.c.statusDanger}}>{error}</Txt><Button small label="Reintentar" disabled={saving} onPress={()=>{void submit();}}/><Button small variant="ghost" label="Cancelar" onPress={cancel}/></View>}
  </View>;
}
