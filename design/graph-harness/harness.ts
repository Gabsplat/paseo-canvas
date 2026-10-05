// Visual harness for the graph canvas. It runs the REAL layout (plugin/client/logic.ts), the REAL connector adapter
// (plugin/client/web.ts) and the REAL tokens; only the cards are plain DOM stand-ins for the React Native components,
// because the Paseo panel cannot be mounted outside Paseo. Build: see README.md in this folder.
import { builtinPacks, builtinTypes, builtinTemplates } from '../../plugin/shared/builtins';
import type { CanvasCatalog, CanvasDocument } from '../../plugin/shared/model';
import { layoutCanvas, linkFocus, linkRoutes, isNodeBlock, type LinkRoute } from '../../plugin/client/logic';
import { tokens } from '../../plugin/client/tokens';
import { mountLinkLayer, type LinkDraw } from '../../plugin/client/web';
declare const document: any, location: any, window: any;
const params = new URLSearchParams(location.search), dark = params.get('theme') !== 'papel';
const theme = tokens.contributedThemes[dark ? 'lienzo-tinta' : 'lienzo-papel'].colors, status = tokens.mockOnly[dark ? 'dark' : 'light'];
const c = { surface0: theme.background, surface1: theme.raised, surface2: theme.control, border: theme.border, foreground: theme.foreground, muted: theme.mutedForeground, accent: theme.accent, statusSuccess: status.success, statusWarning: status.warning, statusDanger: status.danger };
const hostRole: Record<string, string> = { foregroundMuted: c.muted, accent: c.accent, statusSuccess: c.statusSuccess, statusWarning: c.statusWarning, statusDanger: c.statusDanger };
const tone = (name: string): string => { const value = (tokens.tones as any)[name === 'peligro' ? 'riesgo' : name][dark ? 'dark' : 'light'] as string; return value.startsWith('host:') ? hostRole[value.slice(5)] : value; };
const alpha = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, templates: builtinTemplates, packs: builtinPacks };
const base = { id: 'harness', workspaceId: 'w', revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', selectedIds: [], example: true, description: '', communication: { intent: '', audience: '', instructions: '' } };
const n = (id: string, title: string, parentGroupId: string | undefined, kind = 'MODULE', st = 'ready', summary = '') => ({ id, typeId: 'node', title, data: { kind, status: st, ...(summary ? { summary } : {}) }, ...(parentGroupId ? { parentGroupId } : {}) });
const l = (from: string, to: string, kind: 'flow' | 'depends' | 'reference' = 'flow', label?: string, t?: any) => ({ id: `${from}-${to}-${kind}`, from, to, kind, ...(label ? { label } : {}), ...(t ? { tone: t } : {}) });
const reference = (): CanvasDocument => ({ ...base, title: 'Account session (datos de ejemplo)', links: [l('inspect', 'host', 'depends'), l('host', 'session', 'depends'), l('host', 'profiles', 'depends'), l('session', 'convex', 'depends'), l('session', 'custody', 'flow', 'guarda tokens'), l('session', 'custody', 'depends'), l('session', 'custody', 'reference'), l('binding', 'custody', 'flow', undefined, 'peligro'), l('session', 'clerk', 'depends'), l('recovery', 'clerk'), l('inspect', 'convex'), l('convex', 'runtime'), l('custody', 'runtime'), l('clerk', 'runtime'), l('binding', 'runtime', 'reference')],
  groups: [{ id: 'inside', title: 'Inside Account session', description: '', blockIds: ['inspect', 'binding', 'recovery', 'host', 'session', 'profiles', 'convex', 'custody', 'clerk'], groupIds: [] }, { id: 'out', title: 'Outside: feature blocks', description: '', blockIds: ['account', 'cloud'], groupIds: [] }],
  blocks: [n('inspect', 'Account inspection', 'inside'), n('binding', 'Subscription binding', 'inside'), n('recovery', 'Workspace recovery', 'inside', 'MODULE', 'draft'), n('host', 'Host composition', 'inside'), n('session', 'Account session', 'inside', 'MODULE', 'ready', 'Mantiene la sesión viva y renueva credenciales.'), n('profiles', 'Local profiles', 'inside', 'MODULE', 'blocked'), n('convex', 'Convex client', 'inside'), n('custody', 'Credential custody', 'inside'), n('clerk', 'Clerk sign-in', 'inside', 'MODULE', 'review'), n('runtime', 'Runtime', undefined, 'OUTSIDE'), n('account', 'Account', 'out', 'OUTSIDE'), n('cloud', 'Cloud choice', 'out', 'OUTSIDE')] });
const chorizo = (): CanvasDocument => { const sections = ['Panorama', 'Estado y persistencia', 'Packs', 'Puente MCP', 'Componentes', 'Interacción']; return { ...base, title: 'Documento antiguo sin enlaces', links: [], groups: [{ id: 'all', title: 'Arquitectura de Theme Studio', description: 'Leer en orden.', blockIds: [], groupIds: sections.map((_, i) => `s${i}`) }, ...sections.map((title, i) => ({ id: `s${i}`, title: `${i + 1} · ${title}`, description: '', blockIds: [`a${i}`, `b${i}`], groupIds: [], parentGroupId: 'all' }))], blocks: sections.flatMap((_, i) => [{ id: `a${i}`, typeId: 'note', title: 'Qué es y cómo está partido', data: { text: 'Texto de ejemplo de una nota larga. '.repeat(3 + i) }, parentGroupId: `s${i}` }, { id: `b${i}`, typeId: i % 2 ? 'note' : 'diagram', title: 'Procesos y canales', data: i % 2 ? { text: 'Otra nota de ejemplo.' } : { nodes: [], edges: [] }, parentGroupId: `s${i}` }]) }; };
const which = params.get('doc') ?? 'reference';
let doc: CanvasDocument = which === 'chorizo' ? chorizo() : which === 'reference' ? reference() : { ...base, ...(builtinPacks.flatMap(p => p.documents).filter(d => d.links.length)[Number(params.get('n') ?? 0)] as any) };
if (params.get('dir') === 'right') doc = { ...doc, groups: doc.groups.map(g => g.id === 'inside' ? { ...g, layout: { mode: 'graph' as const, direction: 'right' as const } } : g) };
if (params.get('collapsed')) doc = { ...doc, groups: doc.groups.map(g => g.id === params.get('collapsed') ? { ...g, collapsed: true } : g) };
const moved = params.get('move'); if (moved) { const [id, x, y] = moved.split(','); doc = { ...doc, blocks: doc.blocks.map(b => b.id === id ? { ...b, position: { x: +x, y: +y } } : b) }; }
const sans = 'system-ui, -apple-system, "Segoe UI", sans-serif', serif = 'Georgia, "Iowan Old Style", "Times New Roman", serif', mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const el = (tag: string, style: string, text?: string) => { const e = document.createElement(tag); e.style.cssText = style; if (text !== undefined) e.textContent = text; return e; };
document.body.style.cssText = `margin:0;background:${c.surface0};color:${c.foreground};font:13px/19px ${sans}`;
const world = el('div', 'position:absolute;left:0;top:0;transform-origin:0 0'); document.body.appendChild(world);
const heights: Record<string, number> = {}; let hover: string | null = params.get('hover'), selected: string | null = params.get('select'), hoverLink: string | null = null, layer: ReturnType<typeof mountLinkLayer> = null;
const statusTone = (word: string) => (['exito', 'aviso', 'riesgo', 'acento'] as const).find(t => (tokens.graph.status[t] as readonly string[]).includes(word.toLowerCase())) ?? 'neutro';
function render() {
  const G = tokens.graph, layout = layoutCanvas(doc, heights, catalog, window.innerWidth), routes = linkRoutes(doc, layout), rects = layout.rects, index = layout.index;
  const hovered = routes.find(r => r.key === hoverLink), focus = hovered ? { lit: new Set([hovered.from, hovered.to]), routes: new Set([hovered.key]) } : linkFocus(routes, hover ? [hover] : selected ? [selected] : []);
  const lit = (id: string) => !focus || index.chain(id).some(x => focus.lit.has(x));
  const all = [...rects.values()].filter(r => !r.hidden), minX = Math.min(...all.map(r => r.x)), minY = Math.min(...all.map(r => r.y)), maxX = Math.max(...all.map(r => r.x + r.width)), maxY = Math.max(...all.map(r => r.y + r.height));
  const scale = Math.min(1, (window.innerWidth - 64) / (maxX - minX), params.get('fit') ? (window.innerHeight - 64) / (maxY - minY) : 1), origin = { x: minX, y: minY };
  world.style.transform = `translate(${32}px, ${32}px) scale(${scale})`; world.style.width = `${maxX - minX}px`; world.style.height = `${maxY - minY}px`;
  world.querySelectorAll('[data-e]').forEach((e: any) => e.remove());
  for (const g of [...doc.groups].sort((a, b) => rects.get(a.id)!.depth - rects.get(b.id)!.depth)) {
    const r = rects.get(g.id)!; if (r.hidden) continue; const dashed = index.mode(g.id) === 'graph' || index.mode(g.parentGroupId ?? null) === 'graph', nested = !!g.parentGroupId;
    const frame = el('div', `position:absolute;left:${r.x - origin.x}px;top:${r.y - origin.y}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;border-radius:${nested ? 10 : 14}px;border:${nested && !dashed ? 1 : 1.5}px ${dashed ? 'dashed' : 'solid'} ${dashed ? alpha(c.muted, .45) : c.border};background:${dashed ? alpha(c.muted, G.region.fillAlpha) : alpha(c.muted, tokens.alpha.groupFill)}`); frame.dataset.e = g.id;
    const head = el('div', `height:${nested ? 32 : 36}px;display:flex;align-items:center;gap:8px;padding:0 10px 0 12px;box-sizing:border-box;${dashed || g.collapsed ? '' : `border-bottom:1px solid ${c.border}`}`);
    head.appendChild(el('span', `color:${c.muted};font-size:12px`, g.collapsed ? '›' : '⌄')); head.appendChild(el('span', `font:600 15px/20px ${serif};flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, g.title));
    head.appendChild(el('span', `font:500 10.5px/14px ${mono};color:${c.muted};border:1px solid ${c.border};border-radius:9px;padding:1px 5px`, String(g.blockIds.length + g.groupIds.length))); frame.appendChild(head); world.appendChild(frame);
  }
  const host = el('div', `position:absolute;left:0;top:0;width:${maxX - minX}px;height:${maxY - minY}px;pointer-events:none`); host.dataset.e = 'links'; world.appendChild(host);
  const marksHost = el('div', `position:absolute;left:0;top:0;width:${maxX - minX}px;height:${maxY - minY}px;pointer-events:none;z-index:2`); marksHost.dataset.e = 'marks'; world.appendChild(marksHost);
  layer = mountLinkLayer(host, { onPress: key => { selected = null; hoverLink = key; render(); }, onHover: key => { if (key !== hoverLink) { hoverLink = key; render(); } } }, marksHost);
  const L = G.link, draws: LinkDraw[] = routes.flatMap((route: LinkRoute): LinkDraw[] => {
    const active = !!focus?.routes.has(route.key), dimmed = !!focus && !active, toned = route.tone && route.tone !== 'neutro', t = tone(route.tone ?? L.defaultTone[route.kind]), color = active || toned ? t : c.muted;
    const strands = active && route.count > 1 && route.count <= L.strands.max;
    return [{ key: route.key, d: route.d, color, width: active ? L.widthActive : L.width, opacity: strands ? 0 : dimmed ? L.alpha.dim : active ? 1 : toned ? L.alpha.toned : L.alpha.rest, dash: L.dash[route.kind], interactive: true, title: route.label, arrow: { ...route.end, side: route.endSide, length: L.arrow.length, width: L.arrow.width }, label: route.label ? { ...route.labelPoint, text: route.label, color: active ? c.foreground : c.muted } : null, badge: route.count > 1 ? { ...route.badgePoint, text: String(route.count), fill: active ? c.foreground : c.surface2, color: active ? c.surface0 : c.foreground, radius: L.badge.radius } : null },
      ...(strands ? route.links.map((link, i): LinkDraw => ({ key: `${route.key}#${i}`, d: route.d, color: tone(link.tone ?? L.defaultTone[link.kind]), width: L.widthActive, opacity: 1, dash: L.dash[link.kind], interactive: false, title: '', shift: { x: (i - (route.count - 1) / 2) * L.strands.gap, y: 0 }, arrow: { ...route.end, side: route.endSide, length: L.arrow.length, width: L.arrow.width }, label: null, badge: null })) : [])];
  });
  layer!.update({ draws, origin, halo: c.surface0, font: sans, labelSize: L.label.size, badgeSize: L.badge.size, hitWidth: L.hitWidth });
  let changed = false;
  for (const b of doc.blocks) {
    const r = rects.get(b.id)!; if (r.hidden) continue; const isNode = isNodeBlock(b, catalog), on = selected === b.id;
    const card = el('div', `position:absolute;left:${r.x - origin.x}px;top:${r.y - origin.y}px;width:${r.width}px;box-sizing:border-box;background:${c.surface1};border:${on ? 2 : 1}px solid ${on ? c.accent : hover === b.id ? alpha(c.muted, .5) : c.border};border-radius:10px;opacity:${lit(b.id) ? 1 : G.dim.node};cursor:pointer;${on ? `box-shadow:0 0 0 3px ${alpha(c.accent, .2)};` : ''}` + (isNode ? `min-height:${G.node.minHeight}px;padding:${G.node.paddingV - (on ? 1 : 0)}px ${G.node.paddingH - (on ? 1 : 0)}px;display:flex;flex-direction:column;gap:${G.node.gap}px` : `min-height:${r.height}px;padding:12px 14px 12px 17px;border-left:3px solid ${c.border}`)); card.dataset.e = b.id;
    if (isNode) {
      const top = el('div', 'display:flex;align-items:center;gap:6px;min-height:16px'), st = String(b.data.status ?? ''), tn = statusTone(st);
      top.appendChild(el('span', `flex:1;font:500 10.5px/14px ${mono};letter-spacing:.6px;text-transform:uppercase;color:${c.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, String(b.data.kind ?? 'Nodo')));
      if (st) top.appendChild(el('span', `font:600 10.5px/14px ${mono};padding:1px 6px;border-radius:999px;background:${alpha(tone(tn), .1)};color:${tn === 'neutro' ? c.muted : tone(tn)}`, st));
      card.appendChild(top); card.appendChild(el('div', 'font:600 14px/19px ' + sans, b.title)); if (b.data.summary) card.appendChild(el('div', `font:12px/17px ${sans};color:${c.muted};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden`, String(b.data.summary)));
    } else { card.appendChild(el('div', `font:500 10.5px/14px ${mono};letter-spacing:.6px;text-transform:uppercase;color:${c.muted}`, b.typeId)); card.appendChild(el('div', 'font:600 14px/19px ' + sans + ';margin-top:4px', b.title)); card.appendChild(el('div', `margin-top:8px;color:${c.foreground}`, String(b.data.text ?? ''))); }
    card.onmouseenter = () => { if (hover !== b.id) { hover = b.id; render(); } }; card.onmouseleave = () => { if (hover === b.id) { hover = null; render(); } }; card.onclick = () => { selected = selected === b.id ? null : b.id; render(); };
    world.appendChild(card);
    const h = isNode ? card.offsetHeight : r.height; if (Math.abs((heights[b.id] ?? 0) - h) >= 1) { heights[b.id] = h; changed = true; }
  }
  if (changed) render();
}
render(); window.addEventListener('resize', render);
