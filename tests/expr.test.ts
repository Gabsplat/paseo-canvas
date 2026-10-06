import test from 'node:test';
import assert from 'node:assert/strict';
import { compileExpression, validateExpression, ExpressionParseError, MAX_EXPRESSION_DEPTH, MAX_EXPRESSION_LENGTH } from '../plugin/shared/expr';
const evaluate = (source: string, variables?: Record<string, number>) => compileExpression(source).evaluate(variables);
const near = (value: number, expected: number) => assert.ok(Math.abs(value - expected) < 1e-10, `${value} != ${expected}`);
test('expression precedence, right-associative powers, unary operators, comparisons and ternaries', () => {
  for (const [source, expected] of [['2+3*4', 14], ['(2+3)*4', 20], ['2^3^2', 512], ['-2^2', -4], ['2^-2', .25], ['10%3', 1], ['!!3', 1], ['!0', 1], ['1<2 && 2<=2', 1], ['1>2 || 3>=3', 1], ['2==2 && 2!=3', 1], ['1?2:3', 2], ['0?2:1?4:5', 4], ['1?0?3:4:5', 4], ['.5+1e-2', .51]] as const) near(evaluate(source), expected);
});
test('all declared math functions and constants evaluate without executing code', () => {
  for (const [source, expected] of [
    ['sin(pi/2)', 1], ['cos(0)', 1], ['tan(0)', 0], ['asin(1)', Math.PI/2], ['acos(1)', 0], ['atan(0)', 0], ['atan2(1,0)', Math.PI/2],
    ['sinh(0)', 0], ['cosh(0)', 1], ['tanh(0)', 0], ['exp(1)', Math.E], ['ln(e)', 1], ['log(e)', 1], ['log10(100)', 2], ['log2(8)', 3],
    ['sqrt(9)', 3], ['cbrt(-8)', -2], ['abs(-2)', 2], ['floor(1.9)', 1], ['ceil(1.1)', 2], ['round(1.6)', 2], ['sign(-9)', -1],
    ['min(3,1,2)', 1], ['max(3,1,2)', 3], ['clamp(4,0,2)', 2], ['mix(2,4,.5)', 3], ['step(2,1)', 0], ['step(2,2)', 1], ['smoothstep(0,1,.5)', .5], ['mod(-1,3)', 2], ['hypot(3,4)', 5], ['tau/pi', 2],
  ] as const) near(evaluate(source), expected);
});
test('compiled expressions reuse variable environments, report unknown names, and never throw during evaluation', () => {
  const expression = compileExpression('amplitude*sin(t)+offset');
  assert.deepEqual(expression.identifiers, ['amplitude', 't', 'offset']); near(expression.evaluate({ amplitude: 2, t: Math.PI/2, offset: 1 }), 3); near(expression.evaluate({ amplitude: 3, t: 0, offset: 4 }), 4);
  assert.ok(Number.isNaN(expression.evaluate({})));
  assert.deepEqual(validateExpression('sin(x)+y+pi', ['x']), { valid: false, unknownIdentifiers: ['y'] });
  assert.equal(validateExpression('sin(x)+pi', new Set(['x'])).valid, true);
  const throwing = Object.defineProperty({}, 'x', { get() { throw new Error('getter'); } }); assert.ok(Number.isNaN(compileExpression('x').evaluate(throwing)));
  for (const source of ['1/0', '0/0', 'sqrt(-1)', 'ln(-1)', 'exp(1000)', 'missing', 'constructor']) assert.ok(Number.isNaN(evaluate(source)));
  assert.equal(evaluate('0 && missing'), 0); assert.equal(evaluate('1 || missing'), 1); assert.equal(evaluate('1?2:missing'), 2);
});
test('parse failures carry positions and reject executable syntax, wrong arity and unbounded recursion', () => {
  for (const source of ['', '1+', 'sin()', 'atan2(1)', 'clamp(1,2)', 'min()', 'unknown(2)', '1 2', 'sin(1,2)', 'x.y', 'x[0]', '(()=>1)()', 'new Date()', 'x=3', '1;2', '`x`', '/* hi */1', 'Math.sin(1)', 'sin(1', '1?2', 'sin(1,)']) {
    assert.throws(() => compileExpression(source), (error: unknown) => error instanceof ExpressionParseError && error.position >= 0 && error.message.length > 10, source);
  }
  const result = validateExpression('1+'); assert.equal(result.valid, false); assert.equal(result.error?.position, 2);
  assert.throws(() => compileExpression('1'.repeat(MAX_EXPRESSION_LENGTH + 1)), ExpressionParseError);
  assert.throws(() => compileExpression('('.repeat(MAX_EXPRESSION_DEPTH + 1) + '1' + ')'.repeat(MAX_EXPRESSION_DEPTH + 1)), ExpressionParseError);
  assert.throws(() => compileExpression(Array(100).fill('1').join('+')), ExpressionParseError);
  assert.throws(() => compileExpression('!'.repeat(100) + '1'), ExpressionParseError);
});
