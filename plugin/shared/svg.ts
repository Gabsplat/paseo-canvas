/** A deliberately small, static SVG dialect. No browser/DOM APIs or resource loading. */
export const SVG_LIMITS = { bytes: 64 * 1024, elements: 2000, depth: 16, attributes: 24, pathCharacters: 8192, geometryNumbers: 8192 } as const;
export type SanitizedSvg = { svg: string; viewBox: [number, number, number, number] };
const namespace = 'http://www.w3.org/2000/svg';
const elements = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'title', 'desc']);
const common = new Set(['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'transform', 'clip-path', 'mask']);
const geometry: Record<string, readonly string[]> = {
  svg: ['viewBox', 'width', 'height', 'preserveAspectRatio', 'xmlns'], g: [], path: ['d', 'pathLength'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points'], title: [], desc: [],
  text: ['x', 'y', 'dx', 'dy', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'],
  tspan: ['x', 'y', 'dx', 'dy', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'], defs: [],
  linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  stop: ['offset', 'stop-color', 'stop-opacity'], clipPath: ['clipPathUnits'],
  mask: ['x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits'],
};
const bad = (message: string): never => { throw new Error(`Unsafe SVG: ${message}`); };
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) { const c = character.codePointAt(0)!; bytes += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4; }
  return bytes;
}
function stripComments(source: string): string {
  const pieces: string[] = []; let offset = 0;
  while (offset < source.length) {
    const start = source.indexOf('<!--', offset);
    if (start < 0) { pieces.push(source.slice(offset)); break; }
    pieces.push(source.slice(offset, start));
    const end = source.indexOf('-->', start + 4);
    if (end < 0 || source.slice(start + 4, end).includes('--')) bad('malformed comment');
    offset = end + 3;
  }
  return pieces.join('');
}
function decode(value: string): string {
  // No numeric/custom entities, DTD, or entity expansion. The five XML escapes suffice for labels.
  if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(value)) bad('unsupported entity');
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]!);
}
function numbers(value: string): number[] {
  const tokens = value.trim().split(/[\s,]+/);
  if (!value.trim() || tokens.length > SVG_LIMITS.geometryNumbers) return bad('invalid geometry');
  return tokens.map(token => {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) return bad('invalid number');
    const result = Number(token);
    if (!Number.isFinite(result) || Math.abs(result) > 100000) return bad('geometry outside bounds');
    return result;
  });
}
function validatePath(value: string): void {
  if (!value.length || value.length > SVG_LIMITS.pathCharacters) bad('invalid path');
  const token = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[MmLlHhVvCcSsQqTtAaZz]/y;
  const tokens: (string | number)[] = []; let offset = 0, count = 0;
  while (offset < value.length) {
    if (/[\s,]/.test(value[offset])) { offset++; continue; }
    token.lastIndex = offset; const match = token.exec(value);
    if (!match) bad('invalid path token');
    const raw = match![0]; offset = token.lastIndex;
    if (/^[a-zA-Z]$/.test(raw)) tokens.push(raw);
    else {
      const numeric = Number(raw);
      if (++count > SVG_LIMITS.geometryNumbers || !Number.isFinite(numeric) || Math.abs(numeric) > 100000) bad('path outside bounds');
      tokens.push(numeric);
    }
  }
  if (!['M', 'm'].includes(String(tokens[0]))) bad('path must start with moveto');
  const counts: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (typeof command !== 'string') bad('path needs a command');
    const kind = String(command).toUpperCase(), args: number[] = [];
    while (i < tokens.length && typeof tokens[i] === 'number') args.push(tokens[i++] as number);
    const arity = counts[kind];
    if (arity === 0 ? args.length !== 0 : !args.length || args.length % arity) bad('invalid path arguments');
    if (kind === 'A') for (let a = 0; a < args.length; a += 7) {
      if (args[a] < 0 || args[a + 1] < 0 || ![0, 1].includes(args[a + 3]) || ![0, 1].includes(args[a + 4])) bad('invalid arc arguments');
    }
  }
}
function validateAttribute(name: string, value: string): void {
  if (name === 'xmlns') { if (value !== namespace) bad('invalid namespace'); return; }
  if (/(?:https?:|data:|file:|javascript:|@import)/i.test(value)) bad('external resource');
  if (name === 'viewBox') { const v = numbers(value); if (v.length !== 4 || v[2] <= 0 || v[3] <= 0) bad('invalid viewBox'); return; }
  if (name === 'fill' || name === 'stroke' || name === 'stop-color') {
    if (!/^(?:none|currentColor|transparent|#[\da-fA-F]{3}|#[\da-fA-F]{6}|#[\da-fA-F]{8}|black|white|url\(#[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}\))$/.test(value)) bad('unsupported paint');
    return;
  }
  if (name === 'clip-path' || name === 'mask' || name === 'href') {
    if (!(name === 'href' ? /^#[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}$/ : /^(?:none|url\(#[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}\))$/).test(value)) bad('external reference');
    return;
  }
  const enums: Record<string, readonly string[]> = {
    'stroke-linecap': ['butt', 'round', 'square'], 'stroke-linejoin': ['miter', 'round', 'bevel'],
    'fill-rule': ['nonzero', 'evenodd'], 'clip-rule': ['nonzero', 'evenodd'],
    preserveAspectRatio: ['none', 'xMidYMid meet', 'xMidYMid', 'xMinYMin meet', 'xMaxYMax meet'],
    'font-family': ['sans-serif', 'serif', 'monospace'], 'font-weight': ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
    'text-anchor': ['start', 'middle', 'end'], 'dominant-baseline': ['auto', 'middle', 'central', 'hanging', 'alphabetic'],
    gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'], clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
    maskUnits: ['userSpaceOnUse', 'objectBoundingBox'], maskContentUnits: ['userSpaceOnUse', 'objectBoundingBox'], spreadMethod: ['pad', 'reflect', 'repeat'],
  };
  if (enums[name]) { if (!enums[name].includes(value)) bad(`invalid ${name}`); return; }
  if (name === 'd') {
    validatePath(value);
    return;
  }
  if (name === 'transform' || name === 'gradientTransform') {
    const tokens = value.match(/(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([^()]*\)/g) ?? [];
    if (!tokens.length || tokens.length > 16 || value.replace(/(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([^()]*\)/g, '').trim()) bad('invalid transform');
    for (const token of tokens) {
      const kind = token.slice(0, token.indexOf('(')).trim(), values = numbers(token.slice(token.indexOf('(') + 1, -1));
      const counts: Record<string, readonly number[]> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };
      if (!counts[kind].includes(values.length)) bad('invalid transform arguments');
    }
    return;
  }
  if (name === 'stroke-dasharray' && value === 'none') return;
  const percent = value.endsWith('%');
  if (percent && !['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'fx', 'fy', 'fr', 'width', 'height', 'offset'].includes(name)) bad('unsupported percentage');
  const values = numbers(percent ? value.slice(0, -1) : value);
  if (name === 'points') { if (values.length < 4 || values.length % 2) bad('invalid points'); }
  else if (name !== 'stroke-dasharray' && values.length !== 1) bad(`invalid ${name}`);
  if (['width', 'height', 'r', 'rx', 'ry', 'fr', 'stroke-width', 'pathLength', 'font-size'].includes(name) && values.some(v => v < 0)) bad(`negative ${name}`);
  if (['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset'].includes(name) && values.some(v => v < 0 || v > (percent ? 100 : 1))) bad('invalid opacity/offset');
}

/** Validate then rebuild; untrusted markup is never passed through unchanged. */
export function sanitizeSvg(raw: string): SanitizedSvg {
  // Count UTF-8 without Node/browser globals. Stop before parsing oversized input.
  if (typeof raw !== 'string' || raw.length > SVG_LIMITS.bytes) return bad('input exceeds 64 KiB');
  if (utf8Bytes(raw) > SVG_LIMITS.bytes) bad('input exceeds 64 KiB');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) bad('control character');
  let source = raw.trim().replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/i, '').trim();
  source = stripComments(source);
  if (/<[!?]/.test(source)) bad('declarations and processing instructions are forbidden');
  const stack: string[] = [], output: string[] = [];
  const idStack: (string | undefined)[] = [], ids = new Set<string>(), references: { from?: string; to: string }[] = [];
  let offset = 0, count = 0, finished = false, viewBox: SanitizedSvg['viewBox'] | undefined;
  while (offset < source.length) {
    if (source[offset] !== '<') {
      const end = source.indexOf('<', offset), text = source.slice(offset, end < 0 ? source.length : end);
      if (text.trim() && !['title', 'desc', 'text', 'tspan'].includes(stack.at(-1) ?? '')) bad('text outside label');
      if (text.trim() || ['text', 'tspan'].includes(stack.at(-1) ?? '')) output.push(escape(decode(text)));
      offset = end < 0 ? source.length : end; continue;
    }
    const end = source.indexOf('>', offset);
    if (end < 0) bad('unclosed tag');
    const tag = source.slice(offset + 1, end); offset = end + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      if (!stack.length || stack.pop() !== name) bad('mismatched closing tag');
      idStack.pop();
      output.push(`</${name}>`); if (!stack.length) finished = true; continue;
    }
    const match = /^([a-zA-Z][a-zA-Z0-9]*)([\s\S]*)$/.exec(tag);
    if (!match) bad('invalid tag');
    const name = match![1]; let rest = match![2], selfClosing = /\/\s*$/.test(rest);
    if (selfClosing) rest = rest.replace(/\/\s*$/, '');
    if (!elements.has(name) || finished || !stack.length && name !== 'svg' || stack.length && name === 'svg') bad('unsupported or nested element');
    if (['title', 'desc'].includes(stack.at(-1) ?? '')) bad('nested label markup');
    if (++count > SVG_LIMITS.elements || stack.length >= SVG_LIMITS.depth) bad('element/depth budget exceeded');
    const attributes = new Map<string, string>(); let attrCount = 0;
    while (rest.trim()) {
      const attr = /^\s+([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(rest);
      if (!attr) bad('invalid attribute syntax');
      rest = rest.slice(attr![0].length);
      const rawKey = attr![1], key = rawKey === 'xlink:href' ? 'href' : rawKey, value = decode(attr![2] ?? attr![3]);
      if (++attrCount > SVG_LIMITS.attributes || attributes.has(key)) bad('attribute budget or duplicate');
      if (key === 'xmlns:xlink') { if (name !== 'svg' || value !== 'http://www.w3.org/1999/xlink') bad('invalid XLink namespace'); attributes.set(key, value); continue; }
      if (key === 'class') { if (!/^[a-zA-Z0-9_ .:-]{0,200}$/.test(value)) bad('invalid decorative attribute'); attributes.set(key, value); continue; }
      if (key === 'id') {
        if (!/^[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}$/.test(value) || ids.has(value)) bad('invalid or duplicate id');
        ids.add(value); attributes.set(key, value); continue;
      }
      if (key === 'style') {
        // A fixed presentation-property list, converted to ordinary attributes. Never retain CSS.
        if (/url\s*\(|@|\\|\/\*/i.test(value)) bad('CSS resource or escape');
        for (const declaration of value.split(';').filter(part => part.trim())) {
          const parts = declaration.split(':');
          if (parts.length !== 2) bad('invalid presentation style');
          const property = parts[0].trim(), content = parts[1].trim();
          if ((!common.has(property) && !geometry[name].includes(property)) || attributes.has(property) || ['title', 'desc'].includes(name)) bad('forbidden style property');
          validateAttribute(property, content); attributes.set(property, content);
        }
        if (attributes.size > SVG_LIMITS.attributes) bad('expanded style attribute budget');
        continue;
      }
      if (!common.has(key) && !geometry[name].includes(key) || ['title', 'desc'].includes(name)) bad(`forbidden attribute ${key}`);
      validateAttribute(key, value); attributes.set(key, value);
    }
    if (name === 'svg') {
      if (attributes.has('viewBox')) viewBox = numbers(attributes.get('viewBox')!) as SanitizedSvg['viewBox'];
      else {
        const width = Number(attributes.get('width')), height = Number(attributes.get('height'));
        if (!(width > 0 && height > 0)) bad('root needs viewBox or positive width/height');
        viewBox = [0, 0, width, height]; attributes.set('viewBox', viewBox.join(' '));
      }
      attributes.set('xmlns', namespace);
    }
    const owner = attributes.get('id') ?? [...idStack].reverse().find(Boolean);
    for (const [key, value] of attributes) {
      const reference = /^url\(#([^)]*)\)$/.exec(value)?.[1] ?? (key === 'href' ? value.slice(1) : undefined);
      if (reference) references.push({ from: owner, to: reference });
    }
    attributes.delete('class');
    attributes.delete('xmlns:xlink');
    output.push(`<${name}${[...attributes].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ` ${key}="${escape(value)}"`).join('')}${selfClosing ? '/>' : '>'}`);
    if (selfClosing) { if (!stack.length) finished = true; } else { stack.push(name); idStack.push(attributes.get('id') ?? idStack.at(-1)); }
  }
  if (stack.length || !finished || !viewBox) bad('incomplete SVG');
  if (references.length > 2000 || references.some(ref => !ids.has(ref.to))) bad('unresolved/budget reference');
  const edges = new Map<string, string[]>();
  for (const ref of references) if (ref.from) edges.set(ref.from, [...edges.get(ref.from) ?? [], ref.to]);
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string, depth: number): void => {
    if (visiting.has(id) || depth > SVG_LIMITS.depth) bad('cyclic or deep reference');
    if (visited.has(id)) return;
    visiting.add(id); for (const target of edges.get(id) ?? []) visit(target, depth + 1);
    visiting.delete(id); visited.add(id);
  };
  for (const id of edges.keys()) visit(id, 0);
  const svg = output.join('');
  if (utf8Bytes(svg) > SVG_LIMITS.bytes) bad('canonical output exceeds 64 KiB');
  return { svg, viewBox: viewBox! };
}
