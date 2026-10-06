import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { GLSL_TIME_MAX, glslShaderState, glslUtf8Length, type GlslShaderData, type GlslShaderState } from '../../shared/renderers/glsl-shader';
import { GLSurface, NativeLearningFallback, compileGLProgram, type GLContext, type SurfaceFrame } from '../Surfaces';
import { WebRange } from '../web';
import { Button, Txt } from '../ui';
import type { ClientRenderer, RendererProps } from './types';

const VERTEX_SOURCE = 'attribute vec2 a_position;\nvoid main() { gl_Position = vec4(a_position, 0.0, 1.0); }';
export function boundedShaderMessage(message: string): string {
  const clean = message.slice(0, 4096).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/(?:https?:\/\/|\/home\/|\/tmp\/|[A-Z]:\\)[^\s]+/g, '[ruta omitida]');
  let result = '', bytes = 0;
  for (const char of clean) { const size = glslUtf8Length(char); if (bytes + size > 1021) return result + '…'; result += char; bytes += size; }
  return result || 'El compilador no proporcionó más detalles.';
}
type Resources = { gl: GLContext; program: object; buffer: object; locations: Record<string, object | null>; dispose(): void };
// All allocations belong to this bundle, including failed initialization. Disposal is idempotent.
export function prepareShader(gl: GLContext, data: GlslShaderData): { resources?: Resources; error?: string } {
  const result = compileGLProgram(gl, VERTEX_SOURCE, data.fragmentSource);
  if (!result.program) return { error: boundedShaderMessage(result.error ?? '') };
  const program = result.program; let buffer: object | null = null, disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; try { if (buffer) gl.deleteBuffer(buffer); } finally { gl.deleteProgram(program); } };
  try {
    buffer = gl.createBuffer(); if (!buffer) throw new Error('No se pudo crear el buffer de dibujo.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    if (gl.getAttribLocation(program, 'a_position') < 0) throw new Error('No se pudo preparar la posición del dibujo.');
    const names = [...data.uniforms.map(u => u.name), ...(data.builtins.resolution ? ['u_resolution'] : []), ...(data.builtins.time ? ['u_time'] : [])];
    const locations = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
    return { resources: { gl, program, buffer, locations, dispose } };
  } catch (error) { dispose(); return { error: boundedShaderMessage(error instanceof Error ? error.message : String(error)) }; }
}

function GlslShader(props: RendererProps<GlslShaderData>) {
  const { data, block, ui, readOnly, runtime, availableWidth } = props;
  const parsed = glslShaderState(data, runtime.state);
  const live = useRef({ props, state: parsed }); live.current = { props, state: parsed };
  const clock = useRef({ seconds: parsed.time, saved: parsed.time, playing: false, last: null as number | null, visited: [parsed.time, parsed.time] as [number, number] });
  if (!clock.current.playing && clock.current.saved !== parsed.time) { clock.current.seconds = parsed.time; clock.current.saved = parsed.time; clock.current.last = null; }
  const [playing, setPlaying] = useState(false), [compileError, setCompileError] = useState(''), [surfaceError, setSurfaceError] = useState(''), [eventError, setEventError] = useState(''), [attempt, setAttempt] = useState(0);
  const bundle = useRef<Resources | null>(null), failed = useRef(false), visible = useRef(false), ranges = useRef<Record<string, [number, number]>>({});
  const clearResources = () => { const old = bundle.current; bundle.current = null; old?.dispose(); };
  const save = (state: GlslShaderState) => { live.current.state = state; clock.current.saved = state.time; live.current.props.runtime.set(state); };
  const valuesNow = () => Object.fromEntries(live.current.props.data.uniforms.map(u => {
    const scope = live.current.props.scope;
    return [u.name, Object.hasOwn(scope.variables, u.name) ? scope.get(u.name) : live.current.state.values[u.name] ?? u.value];
  }));
  const settle = (kind: string, payload: RendererProps['block']['data'], label: string) => {
    setEventError(''); void live.current.props.runtime.settle(kind, payload, label).catch(() => setEventError('No se pudo guardar el ajuste. Revisa la conexión del lienzo y vuelve a intentarlo.'));
  };
  const pause = (reason: string) => {
    if (!clock.current.playing) return;
    clock.current.playing = false; clock.current.last = null; setPlaying(false);
    save({ ...live.current.state, time: clock.current.seconds });
    settle('glsl-shader.pause', { time: clock.current.seconds, visited: clock.current.visited, values: valuesNow(), reason }, 'Pausar shader');
  };
  useEffect(() => { if (readOnly) pause('solo lectura'); }, [readOnly]);
  useEffect(() => () => { pause('salir del bloque'); clearResources(); }, []);
  // Recompile programs inside the same context. Changing initialize would tear down the adapter
  // and lose its WebGL context on the same canvas, so the host initializer stays stable.
  const signature = JSON.stringify([data.fragmentSource, data.uniforms.map(u => u.name), data.builtins]);
  const compilation = useRef({ wanted: signature, attempt, built: '', builtAttempt: -1 });
  compilation.current.wanted = signature; compilation.current.attempt = attempt;
  const initialize = useMemo(() => (gl: GLContext) => {
    clearResources(); failed.current = false; setCompileError(''); setSurfaceError('');
    compilation.current.built = compilation.current.wanted; compilation.current.builtAttempt = compilation.current.attempt;
    const prepared = prepareShader(gl, live.current.props.data);
    if (prepared.error) { failed.current = true; setCompileError(prepared.error); pause('error de compilación'); }
    bundle.current = prepared.resources ?? null;
    const owned = prepared.resources;
    // Keep the adapter active on compile failure so its generic overlay does not hide diagnostics.
    return { dispose() { owned?.dispose(); if (bundle.current === owned) bundle.current = null; } };
  }, []);
  const draw = (gl: GLContext, frame: SurfaceFrame) => {
    const compiled = compilation.current;
    if (compiled.built !== compiled.wanted || compiled.builtAttempt !== compiled.attempt || (!bundle.current && !failed.current)) initialize(gl);
    const resource = bundle.current; if (!resource || resource.gl !== gl) return;
    if (clock.current.playing) {
      if (clock.current.last !== null) clock.current.seconds = Math.min(GLSL_TIME_MAX, clock.current.seconds + Math.max(0, Math.min(250, frame.time - clock.current.last)) / 1000);
      clock.current.last = frame.time; clock.current.visited[1] = clock.current.seconds;
    }
    try {
      gl.useProgram(resource.program); gl.bindBuffer(gl.ARRAY_BUFFER, resource.buffer);
      const position = gl.getAttribLocation(resource.program, 'a_position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      for (const [name, value] of Object.entries(valuesNow())) gl.uniform1f(resource.locations[name], value);
      if (live.current.props.data.builtins.resolution) gl.uniform2f(resource.locations.u_resolution, Math.max(1, Math.round(frame.width * frame.pixelRatio)), Math.max(1, Math.round(frame.height * frame.pixelRatio)));
      if (live.current.props.data.builtins.time) gl.uniform1f(resource.locations.u_time, clock.current.seconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (clock.current.seconds === GLSL_TIME_MAX) pause('límite de tiempo');
    } catch { setSurfaceError('No se pudo dibujar el shader. Reinicia el experimento.'); pause('error de dibujo'); clearResources(); failed.current = true; }
  };
  const onVisibilityChange = (drawable: boolean) => {
    visible.current = drawable;
    if (!drawable) { pause('fuera de vista'); clearResources(); }
  };
  const reset = () => {
    if (live.current.props.readOnly || ui.layout.platform !== 'web') return;
    clock.current = { seconds: 0, saved: 0, last: null, playing: false, visited: [0, 0] }; setPlaying(false); ranges.current = {};
    if (failed.current) setAttempt(attempt + 1);
    live.current.state = { values: {}, time: 0 }; live.current.props.runtime.set(null);
    // Shared variables are owned by their own control. This reset clears local values and time only.
    settle('glsl-shader.reset', { time: 0, values: valuesNow() }, 'Reiniciar shader');
  };
  const summary = data.staticSummary ?? 'Shader sin referencia estática declarada. No se ha ejecutado en este dispositivo.';
  const native = ui.layout.platform !== 'web';
  if (native) return <View nativeID={`lienzo-interactive-shader-${block.id}-static`} style={{ gap: 8 }}><Txt>{data.question}</Txt><Txt kind="label" muted>Estático</Txt><NativeLearningFallback summary={summary} /><Button label="Reiniciar" small variant="ghost" disabled onPress={reset} /></View>;
  return <View style={{ gap: 12 }}><Txt>{data.question}</Txt>
    <View style={{ backgroundColor: ui.c.surface0, borderRadius: 8, borderWidth: 1, borderColor: ui.c.border, overflow: 'hidden' }}>
      <GLSurface id={`glsl-${block.id}`} label={data.question} summary={summary} height={Math.max(160, Math.min(420, (availableWidth || 360) * 9 / 16))} maxPixelSize={data.maxPixelSize}
        animated={playing} initialize={initialize} draw={draw} onVisibilityChange={onVisibilityChange} onError={message => {
          pause('error del gráfico');
          setSurfaceError(message.includes('no ofrece este contexto') ? 'WebGL no está disponible' : message.includes('demasiados') ? 'Hay demasiados gráficos WebGL abiertos. Cierra otro gráfico y vuelve a abrir este bloque.' : message.includes('perdió') ? 'El contexto WebGL se perdió. Esperando restauración.' : 'No se pudo iniciar el shader. Vuelve a abrir el bloque.');
        }} />
    </View>
    {!!compileError && <View style={{ gap: 4 }}><Txt style={{ color: ui.c.statusDanger }}>No se pudo compilar el shader</Txt><Txt kind="code">{compileError}</Txt></View>}
    {!!surfaceError && <View style={{ gap: 4 }}><Txt style={{ color: ui.c.statusDanger }}>{surfaceError}</Txt><Txt kind="small" muted>{summary}</Txt></View>}
    {data.uniforms.map(u => {
      const variable = props.scope.variables[u.name], value = valuesNow()[u.name], min = variable?.min ?? u.min, max = variable?.max ?? u.max;
      const change = (next: number) => {
        if (live.current.props.readOnly || !Number.isFinite(next)) return;
        const currentVariable = live.current.props.scope.variables[u.name];
        const value = Math.max(currentVariable?.min ?? u.min, Math.min(currentVariable?.max ?? u.max, next));
        const start = valuesNow()[u.name], visited = ranges.current[u.name] ?? [start, start];
        ranges.current[u.name] = [Math.min(visited[0], value), Math.max(visited[1], value)];
        if (currentVariable) live.current.props.scope.set(u.name, value);
        else save({ values: { ...live.current.state.values, [u.name]: value }, time: clock.current.seconds });
      };
      return <View key={u.name} nativeID={`lienzo-interactive-shader-${block.id}-${u.name}`} style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Txt kind="label">{u.label}{variable ? ' · Compartida' : ''}</Txt><Txt kind="code">{Number(value.toPrecision(6))}{(variable?.unit ?? u.unit) ? ` ${variable?.unit ?? u.unit}` : ''}</Txt></View>
        <WebRange id={`shader-${block.id}-${u.name}`} label={u.label} min={min} max={max} step={variable?.step ?? u.step ?? 'any'} value={value} color={variable ? ui.c.accent : ui.c.foreground} disabled={readOnly || min === max} onChange={change} onSettle={next => {
          if (live.current.props.readOnly || !Number.isFinite(next)) return;
          change(next); const current = live.current.props.scope.variables[u.name];
          const value = Math.max(current?.min ?? u.min, Math.min(current?.max ?? u.max, next)), visited = ranges.current[u.name] ?? [value, value]; delete ranges.current[u.name];
          const shared = live.current.props.scope.variables[u.name];
          settle(`glsl-shader.uniform.${u.name}`, { name: u.name, value, visited, ...(shared ? { scopeId: shared.scopeId } : {}) }, `Ajustar ${u.label}`);
        }} />
      </View>;
    })}
    <View nativeID={`lienzo-interactive-shader-${block.id}-transport`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {data.builtins.time && <Button label={playing ? 'Pausar' : 'Reproducir'} small disabled={readOnly || !!compileError || !!surfaceError} onPress={() => {
        if (live.current.props.readOnly || !visible.current || failed.current) return;
        if (clock.current.playing) pause('pausa del usuario');
        else { clock.current.playing = true; clock.current.last = null; clock.current.visited = [clock.current.seconds, clock.current.seconds]; setPlaying(true); }
      }} />}
      <Button label="Reiniciar" small variant="ghost" disabled={readOnly} onPress={reset} />
      <Button label="Pedir una pista" small variant="ghost" disabled={readOnly} onPress={() => {
        if (live.current.props.readOnly) return;
        settle('glsl-shader.hint', { request: 'Da una pista sobre el efecto de los parámetros en la imagen, sin revelar la solución.', values: valuesNow(), time: clock.current.seconds }, 'Pedir una pista');
      }} />
    </View>
    {!!eventError && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{eventError}</Txt>}
  </View>;
}
export const glslShaderRenderer: ClientRenderer<GlslShaderData> = { id: 'glsl-shader', Component: GlslShader, visual: { icon: 'Sparkles', tone: 'neutro', width: 'wide' } };
