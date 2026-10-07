import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { TextInput } from '@getpaseo/plugin/client/react-native';
import { WhiteboardContent } from './WhiteboardContent';
import { Button, Txt, useUI } from './ui';
import { focusInput, attachEditorKeys } from './web';
import type { TextSession, WhiteboardPreviewStore } from './useWhiteboard';
import type { Point } from './logic';
import { wbColor, wbFont, shapeLook } from './whiteboard-visuals';
import { wbShapeDataSchema } from '../shared/whiteboard';
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
  const failure=!!error&&<View style={{padding:6,backgroundColor:u.c.surface1,gap:4}}><Txt kind="small" style={{color:u.c.statusDanger}}>{error}</Txt><Button small label="Reintentar" disabled={saving} onPress={()=>{void submit();}}/><Button small variant="ghost" label="Cancelar" onPress={cancel}/></View>;
  if(session.kind==='wb-shape'){
    // The label is edited where it lives: centred in the shape, in its own colour, on the shape's own fill.
    // An invisible copy of the draft sizes the box, so the caret stays vertically centred as lines are added.
    const look=shapeLook(wbShapeDataSchema.parse(session.block.data),u),type={fontSize:look.fontSize,lineHeight:look.lineHeight,fontWeight:'500' as const,textAlign:'center' as const};
    return <View ref={host} nativeID="lienzo-editor" style={{position:'absolute',left:session.at.x-origin.x,top:session.at.y-origin.y,width:session.width,height:session.height,zIndex:20}}>
      <View style={{flex:1,paddingHorizontal:look.padding,justifyContent:'center',overflow:'hidden'}}><View style={{minHeight:look.lineHeight}}>
        <Txt style={{...type,opacity:0}}>{draft+'\u200b'}</Txt>
        <TextInput autoFocus multiline value={draft} maxLength={1000} editable={!saving} accessibilityLabel="Editar texto de la forma" onChangeText={value=>{draftRef.current=value;setDraft(value);}} onBlur={()=>{void submit();}} onKeyPress={event=>{if(event.nativeEvent.key==='Escape')cancel();}} style={{...type,position:'absolute',left:0,right:0,top:0,bottom:0,padding:0,borderWidth:0,borderRadius:0,backgroundColor:'transparent',color:look.text,textAlignVertical:'top',...({outlineStyle:'none',boxShadow:'none'} as object)}}/>
      </View></View>
      {failure&&<View style={{position:'absolute',left:0,top:'100%',minWidth:200,marginTop:6}}>{failure}</View>}
    </View>;
  }
  return <View ref={host} nativeID="lienzo-editor" style={{position:'absolute',left:session.at.x-origin.x,top:session.at.y-origin.y,width:session.width,minHeight:session.height,zIndex:20}}>
    <TextInput autoFocus multiline value={draft} maxLength={4000} editable={!saving} accessibilityLabel="Editar texto libre" onChangeText={value=>{draftRef.current=value;setDraft(value);}} onBlur={()=>{void submit();}} onKeyPress={event=>{if(event.nativeEvent.key==='Escape')cancel();}} style={{minHeight:t.lineHeight,width:'100%',padding:0,borderWidth:1.5,borderColor:u.c.accent,borderRadius:0,backgroundColor:u.c.surface0,color:wbColor((session.block.data.color??'tinta') as Parameters<typeof wbColor>[0],u),fontFamily:wbFont(font??'sans'),fontWeight:'400',fontSize:t.fontSize,lineHeight:t.lineHeight,textAlign:session.block.data.align as 'left'|'center'|'right'|undefined,textAlignVertical:'top'}}/>
    {failure}
  </View>;
}
