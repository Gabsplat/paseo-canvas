import { WB_TEXT_FONT, type WbShapeData, type WbDrawData, type WbScale } from '../shared/whiteboard';
import type { Point } from './logic';
import { tokens } from './tokens';
const f = (n: number) => Number(n.toFixed(2));
export function strokePath(points: readonly number[]): string {
  return points.map((v,i) => i % 2 ? ` ${f(v)}` : `${i ? ' L' : 'M'}${f(v)}`).join('');
}
export function lineEnds(data: Pick<WbShapeData,'from'>, width: number, height: number): [Point,Point] {
  const from = data.from ?? 'nw', a = { x: from.endsWith('e') ? width : 0, y: from.startsWith('s') ? height : 0 }, b = { x: width - a.x, y: height - a.y };
  if (width <= 8) a.x = b.x = width/2; if (height <= 8) a.y = b.y = height/2; return [a,b];
}
/** `radius`: a corner radius bound to a variable (rectangles only); absent, the shape's own corners. */
export function shapePath(data: WbShapeData, width: number, height: number, radius?: number): string {
  const w = Math.max(1,width), h = Math.max(1,height);
  if ((data.shape === 'rect' || data.shape === 'rounded') && radius !== undefined) { const r=f(Math.max(0,Math.min(radius,w/2,h/2))); if (r>0) return `M${r} 0H${f(w-r)}Q${w} 0 ${w} ${r}V${f(h-r)}Q${w} ${h} ${f(w-r)} ${h}H${r}Q0 ${h} 0 ${f(h-r)}V${r}Q0 0 ${r} 0Z`; if (data.shape === 'rounded') return `M0 0H${f(w)}V${f(h)}H0Z`; }
  if (data.shape === 'line') { const [a,b]=lineEnds(data,w,h);return `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`; }
  if (data.shape === 'ellipse') return `M0 ${f(h/2)}A${f(w/2)} ${f(h/2)} 0 1 0 ${f(w)} ${f(h/2)}A${f(w/2)} ${f(h/2)} 0 1 0 0 ${f(h/2)}Z`;
  if (data.shape === 'rounded') {const r=Math.min(16,w/2,h/2);return `M${r} 0H${f(w-r)}Q${w} 0 ${w} ${r}V${f(h-r)}Q${w} ${h} ${f(w-r)} ${h}H${r}Q0 ${h} 0 ${f(h-r)}V${r}Q0 0 ${r} 0Z`;}
  if (data.shape === 'cylinder') {const r=Math.min(28,h*.18)/2;return `M0 ${f(r)}A${f(w/2)} ${f(r)} 0 0 1 ${w} ${f(r)}V${f(h-r)}A${f(w/2)} ${f(r)} 0 0 1 0 ${f(h-r)}ZM0 ${f(r)}A${f(w/2)} ${f(r)} 0 0 0 ${w} ${f(r)}`;}
  const points = data.shape === 'diamond' ? [w/2,0,w,h/2,w/2,h,0,h/2] : data.shape === 'triangle' ? [w/2,0,w,h,0,h] : data.shape === 'hexagon' ? [w*.22,0,w*.78,0,w,h/2,w*.78,h,w*.22,h,0,h/2] : [0,0,w,0,w,h,0,h];
  return strokePath(points)+'Z';
}
export function arrowPath(data: WbShapeData, width:number,height:number,weight:number):string {
  if(data.shape!=='line'||!data.heads||data.heads==='none')return '';
  const [a,b]=lineEnds(data,width,height),len=11+2*weight,angle=28*Math.PI/180;
  const head=(at:Point,other:Point)=>{const d=Math.atan2(other.y-at.y,other.x-at.x);return `M${f(at.x+len*Math.cos(d-angle))} ${f(at.y+len*Math.sin(d-angle))}L${f(at.x)} ${f(at.y)}L${f(at.x+len*Math.cos(d+angle))} ${f(at.y+len*Math.sin(d+angle))}`;};
  return (data.heads==='start'||data.heads==='both'?head(a,b):'')+(data.heads==='end'||data.heads==='both'?head(b,a):'');
}
export function segmentDistance(p:Point,a:Point,b:Point):number {
  const dx=b.x-a.x,dy=b.y-a.y,t=dx||dy?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy))):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
export function hitStroke(points:readonly number[],at:Point,box:{width:number;height:number},extent:{width:number;height:number},radius:number):boolean {
  for(let i=2;i<points.length;i+=2){const a={x:points[i-2]*box.width/extent.width,y:points[i-1]*box.height/extent.height},b={x:points[i]*box.width/extent.width,y:points[i+1]*box.height/extent.height};if(segmentDistance(at,a,b)<=radius)return true;}
  return false;
}
function segmentsDistance(a:Point,b:Point,c:Point,d:Point):number {
  const cross=(p:Point,q:Point,r:Point)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const abc=cross(a,b,c),abd=cross(a,b,d),cda=cross(c,d,a),cdb=cross(c,d,b);
  const boundsOverlap=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));
  if(boundsOverlap&&abc*abd<=0&&cda*cdb<=0)return 0;
  return Math.min(segmentDistance(a,c,d),segmentDistance(b,c,d),segmentDistance(c,a,b),segmentDistance(d,a,b));
}
export function erasedStrokes(data:WbDrawData,point:Point,size:{width:number;height:number},radius:number,from=point):number[]{
  return data.strokes.flatMap((stroke,index)=>{
    const p=stroke.points;for(let i=2;i<p.length;i+=2){
      const a={x:p[i-2]*size.width/data.extent.width,y:p[i-1]*size.height/data.extent.height},b={x:p[i]*size.width/data.extent.width,y:p[i+1]*size.height/data.extent.height};
      if(segmentsDistance(from,point,a,b)<=radius)return[index];
    }return[];
  });
}
/** Whether `p` (box-local) lies inside the shape's outline. Lines have no inside. */
export function shapeContains(shape:WbShapeData['shape'],width:number,height:number,p:Point):boolean{
  if(shape==='line'||p.x<0||p.y<0||p.x>width||p.y>height)return false;
  if(shape==='ellipse'){const rx=width/2,ry=height/2;return rx>0&&ry>0&&((p.x-rx)/rx)**2+((p.y-ry)/ry)**2<=1;}
  const poly=shape==='diamond'?[width/2,0,width,height/2,width/2,height,0,height/2]:shape==='triangle'?[width/2,0,width,height,0,height]:shape==='hexagon'?[width*.22,0,width*.78,0,width,height/2,width*.78,height,width*.22,height,0,height/2]:null;
  if(!poly)return true;
  let inside=false;for(let i=0,j=poly.length-2;i<poly.length;j=i,i+=2){const xi=poly[i],yi=poly[i+1],xj=poly[j],yj=poly[j+1];if(yi>p.y!==yj>p.y&&p.x<(xj-xi)*(p.y-yi)/(yj-yi)+xi)inside=!inside;}
  return inside;
}
/**
 * The shape whose inside holds `p` when the press reached the canvas or a Frame's body, i.e. nothing else was hit there.
 * Hollow shapes only paint their outline, so this is how their interior selects and edits (as in tldraw): the
 * smallest shape containing the point wins, so a box drawn inside a bigger one stays reachable.
 */
export function shapeInteriorAt(shapes:readonly {id:string;shape:WbShapeData['shape'];rect:{x:number;y:number;width:number;height:number}}[],p:Point):string|null{
  let best:string|null=null,area=Infinity;
  for(const s of shapes){const r=s.rect,a=r.width*r.height;if(a<area&&shapeContains(s.shape,r.width,r.height,{x:p.x-r.x,y:p.y-r.y})){best=s.id;area=a;}}
  return best;
}
/** Bounded online sampling. Persisted simplification is shared; preview never grows without a limit. */
export function appendPreviewPoint(points:number[],p:Point,max=8192):void {
  const last=points.length;if(last>=4&&Math.hypot(p.x-points[last-2],p.y-points[last-1])<.5)return;
  if(last/2>=max){const reduced=points.filter((_,i)=>Math.floor(i/2)%2===0);points.splice(0,points.length,...reduced);}
  points.push(p.x,p.y);
}

export type ResizeHandle = 'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'|'start'|'end';
/** Largest side a whiteboard box may take, in canvas units (the schema's limit). */
export const WB_MAX_SIDE = 4096;
/**
 * The box that results from dragging one of the eight handles by `delta` (canvas units). The opposite edge or corner
 * stays put. With `proportional` the start's aspect ratio is kept: a corner follows whichever axis moved more, and a
 * side handle grows the other axis evenly about the centre. Sizes stay within [minimum, WB_MAX_SIDE]; only a box that
 * is already larger than the limit is ever scaled down, never up.
 */
export function resizeWhiteboardBox(start:{x:number;y:number;width:number;height:number},delta:Point,handle:ResizeHandle,minimum:{width:number;height:number},proportional=false):{x:number;y:number;width:number;height:number} {
  const west=handle.includes('w'),north=handle.includes('n'),horizontal=handle.includes('e')||west,vertical=handle.includes('s')||north;
  const clamp=(v:number,low:number)=>Math.min(WB_MAX_SIDE,Math.max(low,v));
  let width=clamp(start.width+(horizontal?delta.x*(west?-1:1):0),minimum.width),height=clamp(start.height+(vertical?delta.y*(north?-1:1):0),minimum.height);
  if(proportional&&start.width>0&&start.height>0){
    const sx=width/start.width,sy=height/start.height;
    const scale=horizontal&&(!vertical||Math.abs(sx-1)>=Math.abs(sy-1))?sx:sy;
    width=start.width*scale;height=start.height*scale;
    // Grow to the minimum, then shrink to the limit; both keep the ratio. The limit wins if they disagree.
    const up=Math.max(1,minimum.width/width,minimum.height/height);width*=up;height*=up;
    const down=Math.min(1,WB_MAX_SIDE/width,WB_MAX_SIDE/height);width*=down;height*=down;
  }
  width=Math.round(width);height=Math.round(height);
  const x=west?start.x+start.width-width:horizontal||!proportional?start.x:start.x+(start.width-width)/2;
  const y=north?start.y+start.height-height:vertical||!proportional?start.y:start.y+(start.height-height)/2;
  return{x:Math.round(x),y:Math.round(y),width,height};
}
export function resizeLineBox(start:{x:number;y:number;width:number;height:number},data:WbShapeData,delta:Point,handle:'start'|'end',snapAngle=false):{position:Point;size:{width:number;height:number};from:NonNullable<WbShapeData['from']>} {
  const ends=lineEnds(data,start.width,start.height).map(p=>({x:p.x+start.x,y:p.y+start.y})),at=handle==='start'?0:1,other=1-at;
  ends[at]={x:ends[at].x+delta.x,y:ends[at].y+delta.y};
  if(snapAngle){const dx=ends[at].x-ends[other].x,dy=ends[at].y-ends[other].y,length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/12))*Math.PI/12;ends[at]={x:ends[other].x+length*Math.cos(angle),y:ends[other].y+length*Math.sin(angle)};}
  const x=Math.min(ends[0].x,ends[1].x),y=Math.min(ends[0].y,ends[1].y),width=Math.max(8,Math.abs(ends[1].x-ends[0].x)),height=Math.max(8,Math.abs(ends[1].y-ends[0].y));
  return{position:{x:width===8?x-4:x,y:height===8?y-4:y},size:{width:Math.min(4096,width),height:Math.min(4096,height)},from:`${ends[0].y>ends[1].y?'s':'n'}${ends[0].x>ends[1].x?'e':'w'}` as NonNullable<WbShapeData['from']>};
}

// ---- Free text: its type, its auto size and corner scaling -------------------------------------------------------
export type TextType = { fontSize: number; lineHeight: number };
/**
 * Free text's type: its own `fontSize` (a corner handle scaled it) or its S/M/L/XL step (mono one px smaller).
 * A scaled size keeps its step's line-height ratio, so twice the size is exactly twice the box.
 */
export function wbTextType(data: { scale?: unknown; fontSize?: unknown; font?: unknown }): TextType {
  const step = tokens.whiteboard.text[(typeof data.scale === 'string' && data.scale in tokens.whiteboard.text ? data.scale : 'm') as WbScale];
  if (typeof data.fontSize === 'number' && Number.isFinite(data.fontSize)) { const fontSize = clampFontSize(data.fontSize); return { fontSize, lineHeight: Math.round(fontSize * step.lineHeight / step.fontSize * 10) / 10 }; }
  return { fontSize: step.fontSize + (data.font === 'mono' ? tokens.whiteboard.text.monoDelta : 0), lineHeight: step.lineHeight };
}
/** Within 8–400 px, to a tenth: a slow drag still moves the size smoothly without storing long decimals. */
export const clampFontSize = (n: number) => Math.round(Math.min(WB_TEXT_FONT.max, Math.max(WB_TEXT_FONT.min, n)) * 10) / 10;
/** Width of one line of text, in px. The canvas measures the real DOM; layout and tests pass an estimate. */
export type MeasureLine = (line: string) => number;
export const estimateLine = (fontSize: number): MeasureLine => line => line.length * fontSize * .56;
/** How many lines `line` (no newline) takes in `width`, broken like CSS pre-wrap with break-word: at spaces, a long word by letters. */
export function wrappedLines(line: string, width: number, measure: MeasureLine): number {
  if (!line || measure(line.trimEnd()) <= width) return 1;
  let lines = 1, current = '';
  for (const word of line.split(/(?<= )/)) {
    if (measure((current + word).trimEnd()) <= width) { current += word; continue; }
    if (current) { lines++; current = ''; }
    // A word wider than the line breaks by letters.
    for (const ch of word) { if (current && measure(current + ch) > width && ch !== ' ') { lines++; current = ''; } current += ch; }
  }
  return lines;
}
/**
 * Free text's box (tldraw's auto-size): with no `width` it is as wide as its longest line, at least `minWidth`, and
 * wraps past `maxWidth`; a stored `width` wraps there. Height is lines × line height. The canvas uses this as the first
 * guess and then the measured box, which the editor and the saved text share.
 */
export function fitText(text: string, type: TextType, measure: MeasureLine, options: { width?: number; maxWidth: number; minWidth: number }): { width: number; height: number; lines: number } {
  const rows = text.split('\n'), natural = Math.max(0, ...rows.map(measure));
  const width = options.width ?? Math.max(options.minWidth, Math.min(options.maxWidth, Math.ceil(natural)));
  const lines = rows.reduce((sum, row) => sum + wrappedLines(row, width, measure), 0);
  return { width, height: Math.max(1, lines) * type.lineHeight, lines: Math.max(1, lines) };
}
/**
 * A corner drag on free text scales it: `box` is the proportional box the handle asks for (resizeWhiteboardBox), and
 * the font and the box take the same factor, held so the font stays within 8–400. The corner opposite the handle stays
 * put, or the centre with Alt (`centre`). Nothing rewraps: a stored wrap width scales too, and an auto-width text that
 * would pass `maxWidth` (or already wraps there) keeps its scaled width as a wrap width. One px of slack absorbs
 * rounding in the glyphs' widths at the new size.
 */
export function scaleTextBox(start: { x: number; y: number; width: number; height: number }, box: { width: number; height: number }, handle: ResizeHandle, type: TextType, text: { wrap?: number; maxWidth: number }, centre = false): { x: number; y: number; width: number; height: number; fontSize: number; wrap?: number; factor: number } {
  const asked = start.width > 0 ? box.width / start.width : 1, fontSize = clampFontSize(type.fontSize * asked), factor = fontSize / type.fontSize;
  const scaled = start.width * factor, fixes = text.wrap !== undefined || start.width >= text.maxWidth - 1 || scaled > text.maxWidth;
  const width = fixes ? Math.min(4096, Math.max(24, Math.ceil(scaled) + 1)) : scaled, height = start.height * factor;
  const x = centre ? start.x + (start.width - width) / 2 : handle.includes('w') ? start.x + start.width - width : start.x;
  const y = centre ? start.y + (start.height - height) / 2 : handle.includes('n') ? start.y + start.height - height : start.y;
  return { x: Math.round(x), y: Math.round(y), width, height, fontSize, factor, ...(fixes ? { wrap: width } : {}) };
}
