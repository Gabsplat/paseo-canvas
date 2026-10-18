import type { CanvasExtension } from "../../plugin/shared/model";

const REEMPLAZAR = String.raw`<style>
body{margin:0;padding:12px;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;gap:8px}
input,button{font:inherit;padding:7px 9px;border-radius:7px;border:1px solid;box-sizing:border-box;width:100%}
button{cursor:pointer;font-weight:600}button:disabled{opacity:.45;cursor:default}small{opacity:.75}
</style>
<label>Find in titles<input id="find" autocomplete="off"></label>
<label>Replace with<input id="put" autocomplete="off"></label>
<small id="scope"></small><button id="go" disabled>Replace</button><small id="note" role="status"></small>
<script>
var ctx=null,find=document.getElementById('find'),put=document.getElementById('put'),go=document.getElementById('go'),scope=document.getElementById('scope'),note=document.getElementById('note');
function hits(){if(!ctx||!find.value)return[];var only=ctx.selection.length?ctx.selection:null;return ctx.document.blocks.filter(function(b){return(!only||only.indexOf(b.id)>=0)&&b.title.indexOf(find.value)>=0})}
function show(){var n=hits().length;scope.textContent=(ctx&&ctx.selection.length?'In the selection ('+ctx.selection.length+'). ':'In the whole Lienzo. ')+(find.value?n+(n===1?' title matches.':' titles match.'):'');go.disabled=!n}
lienzo.onContext(function(c){ctx=c;var k=c.theme.colors;document.body.style.background=k.surface;document.body.style.color=k.foreground;[find,put].forEach(function(i){i.style.background=k.background;i.style.color=k.foreground;i.style.borderColor=k.border});go.style.background=k.accent;go.style.color=k.background;go.style.borderColor=k.accent;show()});
find.oninput=put.oninput=function(){note.textContent='';show()};
go.onclick=function(){var list=hits();if(!list.length)return;go.disabled=true;
 lienzo.edit(list.map(function(b){return{type:'block.update',id:b.id,patch:{title:b.title.split(find.value).join(put.value)||'Untitled'}}}),'Replace “'+find.value+'” in '+list.length+' titles')
  .then(function(){note.textContent='Done. '+list.length+' titles changed. You can undo it.'},function(e){note.textContent='Could not replace: '+e.message;show()})};
</script>`;
/** A tool that edits, written against API 1 only. The contract test runs it; it no longer ships in the app. */
export const findAndReplace: CanvasExtension = { id: "find-replace", kind: "tool", api: 1, name: "Find and replace", description: "Changes text in the titles of the selection, or of the whole Lienzo.", icon: "Replace", permissions: ["edit"], html: REEMPLAZAR };
