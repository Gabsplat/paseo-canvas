import type { WbShapeData, WbDrawData } from '../shared/whiteboard';
import type { Point } from './logic';
const f = (n: number) => Number(n.toFixed(2));
export function strokePath(points: readonly number[]): string {
  return points.map((v,i) => i % 2 ? ` ${f(v)}` : `${i ? ' L' : 'M'}${f(v)}`).join('');
}
export function lineEnds(data: Pick<WbShapeData,'from'>, width: number, height: number): [Point,Point] {
  const from = data.from ?? 'nw', a = { x: from.endsWith('e') ? width : 0, y: from.startsWith('s') ? height : 0 }, b = { x: width - a.x, y: height - a.y };
  if (width <= 8) a.x = b.x = width/2; if (height <= 8) a.y = b.y = height/2; return [a,b];
}
export function shapePath(data: WbShapeData, width: number, height: number): string {
  const w = Math.max(1,width), h = Math.max(1,height);
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
/** Bounded online sampling. Persisted simplification is shared; preview never grows without a limit. */
export function appendPreviewPoint(points:number[],p:Point,max=8192):void {
  const last=points.length;if(last>=4&&Math.hypot(p.x-points[last-2],p.y-points[last-1])<.5)return;
  if(last/2>=max){const reduced=points.filter((_,i)=>Math.floor(i/2)%2===0);points.splice(0,points.length,...reduced);}
  points.push(p.x,p.y);
}

export type ResizeHandle = 'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'|'start'|'end';
export function resizeWhiteboardBox(start:{x:number;y:number;width:number;height:number},delta:Point,handle:ResizeHandle,minimum:{width:number;height:number},proportional=false):{x:number;y:number;width:number;height:number} {
  const west=handle.includes('w'),north=handle.includes('n'),horizontal=handle.includes('e')||west,vertical=handle.includes('s')||north;
  let width=Math.min(4096,Math.max(minimum.width,start.width+(horizontal?delta.x*(west?-1:1):0))),height=Math.min(4096,Math.max(minimum.height,start.height+(vertical?delta.y*(north?-1:1):0)));
  if(proportional){const ratio=start.width/start.height;if(horizontal&&(!vertical||Math.abs(delta.x/start.width)>=Math.abs(delta.y/start.height)))height=width/ratio;else width=height*ratio;const factor=Math.min(4096/width,4096/height);width*=factor;height*=factor;const low=Math.max(minimum.width/width,minimum.height/height,1);width*=low;height*=low;}
  width=Math.round(width);height=Math.round(height);
  return{x:Math.round(start.x+(west?start.width-width:0)),y:Math.round(start.y+(north?start.height-height:0)),width,height};
}
export function resizeLineBox(start:{x:number;y:number;width:number;height:number},data:WbShapeData,delta:Point,handle:'start'|'end',snapAngle=false):{position:Point;size:{width:number;height:number};from:NonNullable<WbShapeData['from']>} {
  const ends=lineEnds(data,start.width,start.height).map(p=>({x:p.x+start.x,y:p.y+start.y})),at=handle==='start'?0:1,other=1-at;
  ends[at]={x:ends[at].x+delta.x,y:ends[at].y+delta.y};
  if(snapAngle){const dx=ends[at].x-ends[other].x,dy=ends[at].y-ends[other].y,length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/12))*Math.PI/12;ends[at]={x:ends[other].x+length*Math.cos(angle),y:ends[other].y+length*Math.sin(angle)};}
  const x=Math.min(ends[0].x,ends[1].x),y=Math.min(ends[0].y,ends[1].y),width=Math.max(8,Math.abs(ends[1].x-ends[0].x)),height=Math.max(8,Math.abs(ends[1].y-ends[0].y));
  return{position:{x:width===8?x-4:x,y:height===8?y-4:y},size:{width:Math.min(4096,width),height:Math.min(4096,height)},from:`${ends[0].y>ends[1].y?'s':'n'}${ends[0].x>ends[1].x?'e':'w'}` as NonNullable<WbShapeData['from']>};
}
