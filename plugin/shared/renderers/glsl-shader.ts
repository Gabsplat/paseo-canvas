import { z } from 'zod';
import { variableNameSchema, type JSONValue } from '../learning';
import type { RendererSpec } from './spec';

export const GLSL_SOURCE_BYTES = 4096;
export const GLSL_TIME_MAX = 86400;
export function glslUtf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) { const code = char.codePointAt(0)!; bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
  return bytes;
}
const reserved = new Set(['u_resolution', 'u_time', 'a_position', 'main', 'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', 'uniform', 'varying', 'attribute', 'precision', 'sampler2D', 'samplerCube', 'const', 'void', 'if', 'else', 'for', 'while', 'return', 'true', 'false']);
const scalar = z.number().finite().min(-1e6).max(1e6);
export const glslUniformSchema = z.object({
  name: variableNameSchema.refine(name => !reserved.has(name) && !name.startsWith('gl_') && !name.includes('__'), 'Reserved GLSL uniform name.'),
  label: z.string().trim().min(1).max(80), min: scalar, max: scalar, value: scalar,
  step: z.number().finite().positive().max(2e6).optional(), unit: z.string().max(24).optional(),
}).strict().refine(v => v.min < v.max && v.value >= v.min && v.value <= v.max, 'Expected min < max and a default inside the range.');
export const glslShaderDataSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  fragmentSource: z.string().trim().min(1).max(GLSL_SOURCE_BYTES).refine(s => glslUtf8Length(s) <= GLSL_SOURCE_BYTES, 'Fragment source exceeds 4096 UTF-8 bytes.'),
  uniforms: z.array(glslUniformSchema).max(4).refine(v => new Set(v.map(u => u.name)).size === v.length, 'Uniform names must be unique.'),
  builtins: z.object({ resolution: z.boolean(), time: z.boolean() }).strict().default({ resolution: true, time: false }),
  maxPixelSize: z.number().int().min(16).max(1024).default(512),
  staticSummary: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((data, ctx) => {
  // Author declarations remain explicit. Unsupported declarations cannot create hidden controls,
  // samplers or a second source of values. GLSL syntax itself is checked by the GL compiler.
  const source = data.fragmentSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const allowed = new Map(data.uniforms.map(u => [u.name, 'float']));
  if (data.builtins.resolution) allowed.set('u_resolution', 'vec2');
  if (data.builtins.time) allowed.set('u_time', 'float');
  const seen = new Set<string>();
  for (const declaration of source.matchAll(/\buniform\s+([^;]+);/g)) {
    const match = /^(?:(?:lowp|mediump|highp)\s+)?(float|vec2)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/.exec(declaration[1].trim());
    if (!match || allowed.get(match[2]) !== match[1] || seen.has(match[2])) {
      ctx.addIssue({ code: 'custom', path: ['fragmentSource'], message: 'Declare each configured float uniform or enabled builtin once; arrays and samplers are unsupported.' });
    } else seen.add(match[2]);
  }
  for (const name of allowed.keys()) if (!seen.has(name)) ctx.addIssue({ code: 'custom', path: ['fragmentSource'], message: `Missing uniform declaration: ${name}.` });
});
export type GlslShaderData = z.infer<typeof glslShaderDataSchema>;
export type GlslUniform = GlslShaderData['uniforms'][number];
export type GlslShaderState = { values: Record<string, number>; time: number };
export function glslShaderState(data: GlslShaderData, raw: Record<string, JSONValue>): GlslShaderState {
  const values: Record<string, number> = {}, source = raw.values;
  for (const uniform of data.uniforms) {
    const value = source && typeof source === 'object' && !Array.isArray(source) ? source[uniform.name] : undefined;
    if (typeof value === 'number' && Number.isFinite(value)) values[uniform.name] = Math.max(uniform.min, Math.min(uniform.max, value));
  }
  return { values, time: typeof raw.time === 'number' && Number.isFinite(raw.time) ? Math.max(0, Math.min(GLSL_TIME_MAX, raw.time)) : 0 };
}
export const glslShaderSpec = {
  id: 'glsl-shader', dataSchema: glslShaderDataSchema, interactive: true,
  minSize: { width: 260, height: 280 }, defaultSize: { width: 440, height: 440 },
  guidance: 'Una pregunta, fragment GLSL WebGL1 completo de hasta 4096 bytes, hasta cuatro uniforms float declarados con rangos. Nombres iguales al scope enlazan valores compartidos. Declare u_resolution vec2 y u_time float solo si sus builtins están habilitados. Tiempo solo tras Reproducir; pistas sin soluciones.',
  blockType: {
    id: 'glsl-shader', renderer: 'glsl-shader', name: 'Shader GLSL', description: 'Explora una imagen calculada con pocos parámetros. WebGL en escritorio/web; referencia estática en native.',
    properties: [
      { key: 'question', label: 'Pregunta', kind: 'text', required: true },
      { key: 'fragmentSource', label: 'Fragment GLSL', kind: 'text', required: true },
      { key: 'uniforms', label: 'Uniforms y rangos', kind: 'json', required: true },
      { key: 'builtins', label: 'Resolución y tiempo', kind: 'json', required: false },
      { key: 'maxPixelSize', label: 'Límite de resolución', kind: 'number', required: false },
      { key: 'staticSummary', label: 'Referencia estática', kind: 'text', required: false },
    ],
    defaults: {
      question: '¿Cómo cambia la separación de las franjas al variar la frecuencia?',
      fragmentSource: 'precision mediump float;\nuniform vec2 u_resolution;\nuniform float frequency;\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / u_resolution;\n  float band = 0.5 + 0.5 * sin(uv.x * frequency * 6.283185);\n  gl_FragColor = vec4(vec3(band), 1.0);\n}',
      uniforms: [{ name: 'frequency', label: 'Frecuencia', min: 1, max: 12, value: 4, step: 0.1 }],
      builtins: { resolution: true, time: false }, maxPixelSize: 512,
      staticSummary: 'Referencia estática: franjas verticales grises. La frecuencia controla cuántas franjas aparecen.',
    },
  },
} satisfies RendererSpec;
