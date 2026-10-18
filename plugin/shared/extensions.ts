import type { CanvasExtension } from "./model";

/**
 * The contract between Lienzo and code it did not write. An extension is one self-contained page; it runs sandboxed in
 * its own frame and sees the canvas only through `window.lienzo`. Version 1 is stable: members are added, not renamed.
 * The one exception is `lienzo.ask` and the "agent" permission, removed when the canvas became one-way (it never
 * sends anything to the agent).
 */
export const EXTENSION_API = 1;
export const EXTENSION_LIMITS = { operations: 200, selection: 1200 } as const;
/** Operations an extension may not send: what is selected and what the assistant is told belong to the person. */
export const EXTENSION_FORBIDDEN_OPERATIONS = ["selection.set", "communication.set"] as const;

/**
 * What runs inside the frame before the page: `window.lienzo`. Plain ES5-style JavaScript in a string, because it is
 * shipped as text into a document this plugin does not otherwise control.
 */
export const EXTENSION_RUNTIME = String.raw`(function(){
var listeners=[],ctx=null,calls={},seq=0;
function post(m){m.lienzo=1;parent.postMessage(m,'*')}
function call(method,args){return new Promise(function(ok,no){var id=++seq;calls[id]={ok:ok,no:no};post({type:'call',id:id,method:method,args:args||{}})})}
window.addEventListener('message',function(e){var d=e.data;if(e.source!==parent||!d||d.lienzo!==1)return;
 if(d.type==='context'){ctx=d.context;listeners.slice().forEach(function(f){try{f(ctx)}catch(err){console.error(err)}})}
 else if(d.type==='result'){var c=calls[d.id];if(!c)return;delete calls[d.id];if(d.ok)c.ok(d.value);else c.no(new Error(d.error||'Error'))}});
var lienzo=window.lienzo={api:1,
 get context(){return ctx},
 onContext:function(f){listeners.push(f);if(ctx)f(ctx);return function(){listeners=listeners.filter(function(x){return x!==f})}},
 select:function(ids){return call('select',{ids:[].concat(ids||[])})},
 open:function(id){return call('open',{id:String(id)})},
 edit:function(operations,label){return call('edit',{operations:operations,label:label})},
 close:function(){return call('close',{})},
 kit:{}};
function rounded(g,x,y,w,h,r){r=Math.max(0,Math.min(r,w/2,h/2));g.beginPath();g.moveTo(x+r,y);g.lineTo(x+w-r,y);g.quadraticCurveTo(x+w,y,x+w,y+r);g.lineTo(x+w,y+h-r);g.quadraticCurveTo(x+w,y+h,x+w-r,y+h);g.lineTo(x+r,y+h);g.quadraticCurveTo(x,y+h,x,y+h-r);g.lineTo(x,y+r);g.quadraticCurveTo(x,y,x+r,y);g.closePath()}
function cut(g,text,max){text=String(text==null?'':text);if(g.measureText(text).width<=max)return text;var lo=0,hi=text.length;while(lo<hi){var mid=(lo+hi+1)>>1;if(g.measureText(text.slice(0,mid)+'…').width<=max)lo=mid;else hi=mid-1}return lo?text.slice(0,lo)+'…':''}
lienzo.kit.rounded=rounded;lienzo.kit.fit=cut;
/* A thing as a card, drawn the way the rest of Lienzo draws selection, hover and a drag in progress. */
lienzo.kit.card=function(g,t,view,o){o=o||{};var c=view.theme.colors,on=!!view.selected[t.id],hv=view.hover===t.id,x=t.x,y=t.y,w=t.w,h=t.h;
 if(view.drag&&view.drag.ids.indexOf(t.id)>=0){x+=view.drag.dx;y+=view.drag.dy}
 rounded(g,x,y,w,h,10);g.fillStyle=o.fill||c.surface;g.fill();g.lineWidth=on?2.5:hv?1.75:1;g.strokeStyle=on?c.accent:hv?c.foreground:c.border;g.stroke();
 if(o.color){g.save();rounded(g,x,y,w,h,10);g.clip();g.fillStyle=o.color;g.fillRect(x,y,4,h);g.restore()}
 if(view.scale<.3)return;g.textAlign='left';g.textBaseline='middle';g.fillStyle=c.foreground;g.font='600 13px system-ui,-apple-system,"Segoe UI",sans-serif';
 var sub=o.subtitle&&h>=44;g.fillText(cut(g,o.title==null?t.title:o.title,w-26),x+14,sub?y+h/2-9:y+h/2);
 if(sub){g.fillStyle=c.muted;g.font='12px system-ui,-apple-system,"Segoe UI",sans-serif';g.fillText(cut(g,o.subtitle,w-26),x+14,y+h/2+10)}};
/* A surface that behaves like the canvas: the wheel pans, command-wheel zooms, a press selects, shift adds, a drag
   on nothing draws a selection box, a drag on a thing moves the selection, a double press opens it on the canvas. */
lienzo.kit.stage=function(o){
 var canvas=o.canvas;if(!canvas){document.documentElement.style.height='100%';document.body.style.cssText='margin:0;height:100%;overflow:hidden';canvas=document.createElement('canvas');canvas.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline:none';document.body.appendChild(canvas)}
 canvas.tabIndex=0;var g=canvas.getContext('2d'),cam={x:0,y:0,s:1},items=[],sel={},hover=null,fitted=false,drag=null,space=false,raf=0,W=0,H=0;
 function world(px,py){return{x:(px-cam.x)/cam.s,y:(py-cam.y)/cam.s}}
 function at(px,py){var p=world(px,py);for(var i=items.length-1;i>=0;i--){var t=items[i];if(p.x>=t.x&&p.x<=t.x+t.w&&p.y>=t.y&&p.y<=t.y+t.h)return t}return null}
 function redraw(){if(!raf)raf=requestAnimationFrame(paint)}
 function fit(){if(!items.length||W<40||H<40)return;var x0=1/0,y0=1/0,x1=-1/0,y1=-1/0;items.forEach(function(t){x0=Math.min(x0,t.x);y0=Math.min(y0,t.y);x1=Math.max(x1,t.x+t.w);y1=Math.max(y1,t.y+t.h)});
  var pad=o.padding==null?56:o.padding,s=Math.max(.05,Math.min((W-2*pad)/Math.max(1,x1-x0),(H-2*pad)/Math.max(1,y1-y0),o.maxFit||1.2));cam={s:s,x:W/2-(x0+x1)/2*s,y:H/2-(y0+y1)/2*s};fitted=true;redraw()}
 function size(){var r=canvas.getBoundingClientRect(),d=window.devicePixelRatio||1;W=r.width;H=r.height;canvas.width=Math.max(1,Math.round(W*d));canvas.height=Math.max(1,Math.round(H*d));if(!fitted)fit();redraw()}
 function paint(){raf=0;var d=window.devicePixelRatio||1;g.setTransform(d,0,0,d,0,0);g.clearRect(0,0,W,H);if(!ctx)return;
  var view={scale:cam.s,width:W,height:H,items:items,selected:sel,hover:hover,theme:ctx.theme,context:ctx,drag:drag&&drag.kind==='move'&&drag.moved&&o.onMove?{ids:drag.ids,dx:drag.dx,dy:drag.dy}:null};
  g.save();g.translate(cam.x,cam.y);g.scale(cam.s,cam.s);try{o.draw(g,view)}finally{g.restore()}
  if(drag&&drag.kind==='box'&&drag.moved){var bx=Math.min(drag.x,drag.px),by=Math.min(drag.y,drag.py),bw=Math.abs(drag.px-drag.x),bh=Math.abs(drag.py-drag.y);g.globalAlpha=.12;g.fillStyle=ctx.theme.colors.accent;g.fillRect(bx,by,bw,bh);g.globalAlpha=1;g.lineWidth=1;g.strokeStyle=ctx.theme.colors.accent;g.strokeRect(bx+.5,by+.5,bw,bh)}}
 function choose(ids){sel={};ids.forEach(function(id){sel[id]=true});lienzo.select(ids);redraw()}
 function chosen(){return Object.keys(sel)}
 function refresh(c){items=(o.layout?o.layout(c):[])||[];sel={};(c.selection||[]).forEach(function(id){sel[id]=true});if(!fitted)fit();redraw()}
 function pos(e){var r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
 canvas.addEventListener('pointerdown',function(e){canvas.focus();try{canvas.setPointerCapture(e.pointerId)}catch(_){ }var p=pos(e),t=at(p.x,p.y),add=e.shiftKey||e.metaKey||e.ctrlKey;
  drag=e.button===1||space?{kind:'pan',x:p.x,y:p.y,px:p.x,py:p.y,moved:true}:t?{kind:'move',id:t.id,x:p.x,y:p.y,px:p.x,py:p.y,dx:0,dy:0,ids:[],moved:false,add:add}:{kind:'box',x:p.x,y:p.y,px:p.x,py:p.y,moved:false,add:add};e.preventDefault()});
 canvas.addEventListener('pointermove',function(e){var p=pos(e);
  if(!drag){var t=at(p.x,p.y),id=t?t.id:null;if(id!==hover){hover=id;canvas.style.cursor=id?'pointer':'default';if(o.onHover)o.onHover(id);redraw()}return}
  if(!drag.moved&&Math.abs(p.x-drag.x)+Math.abs(p.y-drag.y)>4){drag.moved=true;if(drag.kind==='move'&&o.onMove&&!sel[drag.id])choose(drag.add?chosen().concat(drag.id):[drag.id]);if(drag.kind==='move')drag.ids=chosen()}
  if(drag.kind==='pan'){cam.x+=p.x-drag.px;cam.y+=p.y-drag.py}else if(drag.kind==='move'){drag.dx=(p.x-drag.x)/cam.s;drag.dy=(p.y-drag.y)/cam.s}
  drag.px=p.x;drag.py=p.y;redraw()});
 function end(e){var d=drag;drag=null;if(!d||e.type==='pointercancel'){redraw();return}
  if(d.kind==='move'){if(d.moved&&o.onMove){if(d.dx||d.dy)o.onMove(d.ids,d.dx,d.dy)}else if(!d.moved){if(d.add){var now=chosen(),i=now.indexOf(d.id);if(i>=0)now.splice(i,1);else now.push(d.id);choose(now)}else choose([d.id])}}
  else if(d.kind==='box'){if(d.moved){var a=world(Math.min(d.x,d.px),Math.min(d.y,d.py)),b=world(Math.max(d.x,d.px),Math.max(d.y,d.py)),ids=d.add?chosen():[];items.forEach(function(t){if(t.x<b.x&&t.x+t.w>a.x&&t.y<b.y&&t.y+t.h>a.y&&ids.indexOf(t.id)<0)ids.push(t.id)});choose(ids)}else if(!d.add)choose([])}
  redraw()}
 canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
 canvas.addEventListener('dblclick',function(e){var p=pos(e),t=at(p.x,p.y);if(t){if(o.onOpen)o.onOpen(t.id);else lienzo.open(t.id)}else fit()});
 canvas.addEventListener('wheel',function(e){e.preventDefault();var p=pos(e);if(e.ctrlKey||e.metaKey){var s=Math.max(.05,Math.min(8,cam.s*Math.exp(-e.deltaY*.002)));cam={s:s,x:p.x-(p.x-cam.x)/cam.s*s,y:p.y-(p.y-cam.y)/cam.s*s}}else{cam.x-=e.deltaX;cam.y-=e.deltaY}redraw()},{passive:false});
 window.addEventListener('keydown',function(e){if(e.key===' ')space=true;else if(e.key==='Escape')choose([]);else if((e.metaKey||e.ctrlKey)&&e.key==='a'){e.preventDefault();choose(items.map(function(t){return t.id}))}});
 window.addEventListener('keyup',function(e){if(e.key===' ')space=false});
 if(window.ResizeObserver)new ResizeObserver(size).observe(canvas);else window.addEventListener('resize',size);size();lienzo.onContext(refresh);
 return{canvas:canvas,fit:fit,redraw:redraw,items:function(){return items},selection:chosen,at:function(x,y){var t=at(x,y);return t?t.id:null}}};
post({type:'ready'});
})();`;

/** Without the `network` permission a page can load nothing from outside itself: inline code and data URLs only. */
const OFFLINE = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:">`;
/**
 * The whole document a frame is given: standards mode, the network rule, the runtime, then the extension's own page.
 * The body is opened first, so a page that is only a script already has a document to draw into.
 */
export function extensionDocument(extension: Pick<CanvasExtension, "html" | "permissions">, granted: boolean): string {
  return `<!doctype html><meta charset="utf-8">${granted && extension.permissions.includes("network") ? "" : OFFLINE}<script>${EXTENSION_RUNTIME}</script><body>${extension.html.replace(/^\s*<!doctype[^>]*>/i, "")}`;
}
export const EXTENSION_GUIDE = `An extension adds a tool to Lienzo without changing the plugin (kind "tool": it opens as a floating panel over the canvas and usually acts on the selection). Save one with canvas_catalog save_extension { id, kind: "tool", api: 1, name, description, icon (a Lucide icon name), permissions, html }. html is one complete self-contained page: any HTML, CSS and JavaScript, no build step, nothing imported from Lienzo. It runs sandboxed in its own frame. A global lienzo object (API 1, stable across plugin updates) is the only way to the canvas:
- lienzo.onContext(fn): fn(context) now and on every change. context = { api, extension: { id, kind, name, permissions }, theme: { dark, colors: { background, surface, foreground, muted, border, accent, flow, needs, mentions, areas[] } }, document: { id, title, description, revision, blocks: [{ id, title, typeId, renderer, data, parentGroupId }], groups: [{ id, title, description, blockIds, groupIds, parentGroupId }], links: [{ id, from, to, kind, label }] }, layout: { [id]: { x, y, width, height } } (where each thing is on the canvas), selection: [ids] }. Use theme.colors for every colour so it matches light and dark.
- lienzo.select(ids) sets the shared selection (the same one the canvas and every tool use). lienzo.open(id) goes to the canvas on that thing. lienzo.close() closes a tool panel.
- lienzo.edit(operations, label) -> Promise<{ revision }>. Needs permission "edit". operations are the same transactional operations as canvas_apply (block.create/update/delete, group.*, link.*, entity.move, entity.duplicate, document.update), so undo and revision conflicts work; selection.set and communication.set are refused.
- Permission "network" lets the page load things from the internet; without it only inline code and data: URLs work.
- lienzo.kit.stage({ layout(context) -> [{ id, x, y, w, h }], draw(g, view), onMove?(ids, dx, dy), onOpen?(id), onHover?(id) }) gives a tool that draws things the canvas' own behaviour on a 2D canvas it creates: wheel pans, command-wheel zooms, press selects, shift adds, drag on nothing box-selects, drag on a thing moves the selection (only if onMove is given), double press opens, Escape clears. draw runs in world units with view = { scale, selected: { [id]: true }, hover, drag, theme, context, items }. lienzo.kit.card(g, item, view, { title, subtitle, color }) draws a thing with the standard selection and hover look. Prefer the kit whenever a tool shows things: it is what keeps interactions consistent.
Keep ids stable; saving the same id replaces the extension. Give it a clear English name and a one-line description of the job it does. A small example, a tool that counts the selection:
<p id="n"></p><script>lienzo.onContext(function(c){var k=c.theme.colors;document.body.style.cssText="margin:0;padding:12px;font:13px system-ui;background:"+k.surface+";color:"+k.foreground;document.getElementById("n").textContent=c.selection.length+" selected of "+(c.document.blocks.length+c.document.groups.length)})</script>`;
