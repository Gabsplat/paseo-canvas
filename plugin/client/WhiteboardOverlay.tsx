import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { TextInput } from './host';
import { WhiteboardContent, textBox } from './WhiteboardContent';
import { Button, Txt, useUI } from './ui';
import { focusInput, attachEditorKeys } from './web';
import type { TextSession, WhiteboardPreviewStore } from './useWhiteboard';
import type { Point } from './logic';
import { boundShapeLook, boundText, wbTextStyle } from './whiteboard-visuals';
import { wbTextType } from './whiteboard-geometry';
import { wbShapeDataSchema, wbTextDataSchema } from '../shared/whiteboard';
import { tokens } from './tokens';
import { withAlpha } from './color';
const T = tokens.whiteboard.selection;
export function WhiteboardPreview({store,origin}:{store:WhiteboardPreviewStore;origin:Point}){
  const preview=useSyncExternalStore(store.subscribe,store.snapshot,()=>null);if(!preview)return null;const r=preview.rect;
  return <View pointerEvents="none" style={{position:'absolute',left:r.x-origin.x,top:r.y-origin.y,width:r.width,height:r.height,opacity:.55,zIndex:8}}><WhiteboardContent block={preview.block} kind={preview.block.typeId==='wb-shape'?'wb-shape':'wb-draw'} width={r.width} height={r.height} onSelect={()=>{}}/></View>;
}
/**
 * Typing in place, for free text and shape labels. The box grows with the text on every key, with no inner scroll: an
 * invisible copy of the draft, set in the saved text's own type, sizes it and the field lies exactly over that copy, so
 * the lines break where the saved text will break them and nothing moves on commit. Enter is a new line; ⌘/Ctrl Enter,
 * Escape or a click elsewhere saves (tldraw); the browser's own undo works inside the field.
 * A label wraps inside its shape and the shape grows to fit it (`onGrow`, the height it needs, or null).
 */
export function WhiteboardEditor({session,origin,error,saving,onSave,onCancel,onGrow}:{session:TextSession;origin:Point;error:string;saving:boolean;onSave(value:string):Promise<boolean>;onCancel():void;onGrow?(height:number|null):void}){
  const u=useUI(),[draft,setDraft]=useState(session.value),draftRef=useRef(draft),host=useRef<View>(null),cancelled=useRef(false),committing=useRef(false),[need,setNeed]=useState(0);
  const submit=async()=>{if(cancelled.current||committing.current)return;committing.current=true;try{await onSave(draftRef.current);}finally{committing.current=false;}};
  const cancel=()=>{cancelled.current=true;onCancel();};
  useEffect(()=>{focusInput(host.current);return attachEditorKeys(host.current,()=>{void submit();},()=>{void submit();});},[]);
  const change=(value:string)=>{draftRef.current=value;setDraft(value);};
  useEffect(()=>{if(session.kind==='wb-shape')onGrow?.(need>session.height?need:null);},[need]);
  // No inner scrollbar, no resize grip, no focus ring: the box itself is the edge.
  const field={position:'absolute',left:0,top:0,width:'100%',height:'100%',padding:0,margin:0,borderWidth:0,borderRadius:0,backgroundColor:'transparent',overflow:'hidden',...({outlineStyle:'none',boxShadow:'none',resize:'none',caretColor:u.c.accent} as object)} as const;
  const failure=!!error&&<View style={{padding:6,backgroundColor:u.c.surface1,gap:4}}><Txt kind="small" style={{color:u.c.statusDanger}}>{error}</Txt><Button small label="Retry" disabled={saving} onPress={()=>{void submit();}}/><Button small variant="ghost" label="Cancel" onPress={cancel}/></View>;
  if(session.kind==='wb-shape'){
    // The label is edited where it lives: centred in the shape, in its own colour, on the shape's own fill.
    // A hollow shape has nothing behind the label: a faint wash marks where typing goes, and the caret and placeholder use the accent.
    const data=wbShapeDataSchema.parse(session.block.data),look=boundShapeLook(session.block,data,u),type={fontSize:look.fontSize,lineHeight:look.lineHeight,fontWeight:'500' as const,textAlign:'center' as const},L=tokens.whiteboard.shape.label,hollow=look.fill==='none';
    const height=Math.max(session.height,need);
    return <View ref={host} nativeID="lienzo-editor" style={{position:'absolute',left:session.at.x-origin.x,top:session.at.y-origin.y,width:session.width,height,zIndex:20}}>
      <View style={{flex:1,paddingHorizontal:look.padding,justifyContent:'center',overflow:'hidden'}}><View style={{minHeight:look.lineHeight,borderRadius:4,backgroundColor:hollow?withAlpha(u.c.accent,L.hollowEditWash):undefined}}>
        <Txt onLayout={e=>setNeed(Math.ceil(e.nativeEvent.layout.height)+2*look.padding)} style={{...type,opacity:0}}>{draft+'\u200b'}</Txt>
        <TextInput autoFocus multiline value={draft} maxLength={1000} editable={!saving} accessibilityLabel="Edit the shape label" placeholder={L.placeholder} placeholderTextColor={withAlpha(look.text,L.placeholderAlpha)} onChangeText={change} onBlur={()=>{void submit();}} style={[u.font('body'),type,{color:look.text},field]}/>
      </View></View>
      {failure&&<View style={{position:'absolute',left:0,top:'100%',minWidth:200,marginTop:6}}>{failure}</View>}
    </View>;
  }
  const data=wbTextDataSchema.safeParse(session.block.data),text=data.success?data.data:wbTextDataSchema.parse({text:''}),base=wbTextType(text),shown=boundText(session.block,draft,base.fontSize,base.lineHeight),style=wbTextStyle(text,shown,u);
  return <View ref={host} nativeID="lienzo-editor" style={{position:'absolute',left:session.at.x-origin.x,top:session.at.y-origin.y,zIndex:20}}>
    <View style={textBox(text.width,u.layout.platform==='web')}>
      <Txt style={{...style,opacity:0}}>{draft+'\u200b'}</Txt>
      <TextInput autoFocus multiline value={draft} maxLength={4000} editable={!saving} accessibilityLabel="Edit free text" onChangeText={change} onBlur={()=>{void submit();}} style={[u.font('body'),style,field]}/>
      <View pointerEvents="none" style={{position:'absolute',left:-T.outset,top:-T.outset,right:-T.outset,bottom:-T.outset,borderWidth:T.width,borderColor:u.c.accent}}/>
    </View>
    {failure}
  </View>;
}
