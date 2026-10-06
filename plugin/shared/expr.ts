/** Declarative math only. Compilation may throw ExpressionParseError; evaluation never throws. */
export const MAX_EXPRESSION_LENGTH = 4096, MAX_EXPRESSION_DEPTH = 64;
export class ExpressionParseError extends Error {
  constructor(readonly position: number, message: string) { super(`${message} at position ${position}.`); this.name = 'ExpressionParseError'; }
}
export type CompiledExpression = { evaluate(variables?: Readonly<Record<string, number>>): number; identifiers: readonly string[] };
type Evaluate = (variables: Readonly<Record<string, number>>) => number;
type Node = { run: Evaluate; depth: number };
type Token = { text: string; position: number; number?: number };
const constants: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const mod = (x: number, y: number) => ((x % y) + y) % y;
const functions: Record<string, { min: number; max: number; run: (...args: number[]) => number }> = {};
for (const name of ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'sqrt', 'cbrt', 'abs', 'floor', 'ceil', 'round', 'sign', 'log10', 'log2'] as const) functions[name] = { min: 1, max: 1, run: Math[name] };
Object.assign(functions, {
  ln: { min: 1, max: 1, run: Math.log }, log: { min: 1, max: 1, run: Math.log },
  atan2: { min: 2, max: 2, run: Math.atan2 }, min: { min: 1, max: 64, run: Math.min }, max: { min: 1, max: 64, run: Math.max }, hypot: { min: 1, max: 64, run: Math.hypot },
  clamp: { min: 3, max: 3, run: clamp }, mix: { min: 3, max: 3, run: (a: number, b: number, t: number) => a * (1 - t) + b * t },
  step: { min: 2, max: 2, run: (edge: number, x: number) => x < edge ? 0 : 1 },
  smoothstep: { min: 3, max: 3, run: (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); } },
  mod: { min: 2, max: 2, run: mod },
});
const precedence: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 8 };
const binary: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b, '^': (a, b) => a ** b,
  '<': (a, b) => +(a < b), '<=': (a, b) => +(a <= b), '>': (a, b) => +(a > b), '>=': (a, b) => +(a >= b), '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b),
};
export function compileExpression(source: string): CompiledExpression {
  if (source.length > MAX_EXPRESSION_LENGTH) throw new ExpressionParseError(MAX_EXPRESSION_LENGTH, 'Expression exceeds 4096 characters');
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { offset++; continue; }
    const tail = source.slice(offset), numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(tail), name = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(tail), operator = /^(?:&&|\|\||<=|>=|==|!=|[+\-*/^%<>()!?:,])/.exec(tail);
    const text = numeric?.[0] ?? name?.[0] ?? operator?.[0];
    if (!text) throw new ExpressionParseError(offset, `Unexpected character '${source[offset]}'`);
    tokens.push({ text, position: offset, ...(numeric ? { number: Number(text) } : {}) }); offset += text.length;
  }
  tokens.push({ text: '', position: source.length });
  let cursor = 0; const identifiers = new Set<string>();
  const peek = () => tokens[cursor], take = () => tokens[cursor++];
  const expect = (text: string) => { if (peek().text !== text) throw new ExpressionParseError(peek().position, `Expected '${text}'`); take(); };
  const node = (run: Evaluate, children: Node[], position: number): Node => {
    const depth = 1 + Math.max(0, ...children.map(c => c.depth));
    if (depth > MAX_EXPRESSION_DEPTH) throw new ExpressionParseError(position, 'Expression nesting exceeds 64 levels');
    return { run, depth };
  };
  function parse(minimum = 0, nesting = 0): Node {
    if (nesting > MAX_EXPRESSION_DEPTH) throw new ExpressionParseError(peek().position, 'Expression nesting exceeds 64 levels');
    const token = take(); let left: Node;
    if (token.number !== undefined) left = node(() => token.number!, [], token.position);
    else if (token.text === '(') { left = parse(0, nesting + 1); expect(')'); }
    else if (['-', '+', '!'].includes(token.text)) {
      const child = parse(7, nesting + 1);
      left = node(v => token.text === '-' ? -child.run(v) : token.text === '+' ? child.run(v) : +!child.run(v), [child], token.position);
    } else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token.text)) {
      if (peek().text === '(') {
        const fn = Object.hasOwn(functions, token.text) ? functions[token.text] : undefined;
        if (!fn) throw new ExpressionParseError(token.position, `Unknown function '${token.text}'`);
        take(); const args: Node[] = [];
        if (peek().text !== ')') do { args.push(parse(0, nesting + 1)); if (peek().text !== ',') break; take(); } while (true);
        expect(')');
        if (args.length < fn.min || args.length > fn.max) throw new ExpressionParseError(token.position, `${token.text} expects ${fn.min === fn.max ? fn.min : `${fn.min}..${fn.max}`} arguments`);
        left = node(v => fn.run(...args.map(a => a.run(v))), args, token.position);
      } else if (Object.hasOwn(constants, token.text)) left = node(() => constants[token.text], [], token.position);
      else { identifiers.add(token.text); left = node(v => Object.hasOwn(v, token.text) && typeof v[token.text] === 'number' ? v[token.text] : NaN, [], token.position); }
    } else throw new ExpressionParseError(token.position, 'Expected a number, variable or parenthesized expression');
    while (true) {
      const op = peek(), prec = precedence[op.text];
      if (prec === undefined || prec < minimum) break;
      take(); const a = left, b = parse(prec + (op.text === '^' ? 0 : 1), nesting + 1);
      left = node(v => op.text === '&&' ? +(!!a.run(v) && !!b.run(v)) : op.text === '||' ? +(!!a.run(v) || !!b.run(v)) : binary[op.text](a.run(v), b.run(v)), [a, b], op.position);
    }
    if (minimum === 0 && peek().text === '?') {
      const at = take(), condition = left, yes = parse(0, nesting + 1); expect(':'); const no = parse(0, nesting + 1);
      left = node(v => condition.run(v) ? yes.run(v) : no.run(v), [condition, yes, no], at.position);
    }
    return left;
  }
  const root = parse();
  if (peek().text) throw new ExpressionParseError(peek().position, `Unexpected '${peek().text}'`);
  return { identifiers: [...identifiers], evaluate(variables = {}) {
    try { const result = root.run(variables); return Number.isFinite(result) ? result : NaN; } catch { return NaN; }
  } };
}
export function validateExpression(source: string, allowedIdentifiers: Iterable<string> = []): { valid: boolean; unknownIdentifiers: string[]; error?: ExpressionParseError } {
  try {
    const compiled = compileExpression(source), allowed = new Set(allowedIdentifiers), unknownIdentifiers = compiled.identifiers.filter(id => !allowed.has(id));
    return { valid: !unknownIdentifiers.length, unknownIdentifiers };
  } catch (error) { return { valid: false, unknownIdentifiers: [], error: error as ExpressionParseError }; }
}
