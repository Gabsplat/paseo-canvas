import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { GLSL_TIME_MAX, glslChrome, glslShaderState, glslUtf8Length, type GlslShaderData, type GlslShaderState } from '../../shared/renderers/glsl-shader';
import { GLSurface, NativeLearningFallback, compileGLProgram, type GLContext, type SurfaceFrame } from '../Surfaces';
import { WebRange, prefersReducedMotion } from '../web';
import { withAlpha } from '../color';
import { Button, Txt } from '../ui';
import type { ClientRenderer, RendererProps } from './types';

const VERTEX_SOURCE = 'attribute vec2 a_position;\nvoid main() { gl_Position = vec4(a_position, 0.0, 1.0); }';
export function boundedShaderMessage(message: string): string {
  const clean = message.slice(0, 4096).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/(?:https?:\/\/|\/home\/|\/tmp\/|[A-Z]:\\)[^\s]+/g, '[ruta omitida]');
  let result = '', bytes = 0;
  for (const char of clean) { const size = glslUtf8Length(char); if (bytes + size > 1021) return result + '…'; result += char; bytes += size; }
  return result || 'The compiler gave no more detail.';
}
type Resources = { gl: GLContext; program: object; buffer: object; locations: Record<string, object | null>; dispose(): void };
// All allocations belong to this bundle, including failed initialization. Disposal is idempotent.
export function prepareShader(gl: GLContext, data: GlslShaderData): { resources?: Resources; error?: string } {
  const result = compileGLProgram(gl, VERTEX_SOURCE, data.fragmentSource);
  if (!result.program) return { error: boundedShaderMessage(result.error ?? '') };
  const program = result.program; let buffer: object | null = null, disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; try { if (buffer) gl.deleteBuffer(buffer); } finally { gl.deleteProgram(program); } };
  try {
    buffer = gl.createBuffer(); if (!buffer) throw new Error('The drawing buffer could not be created.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    if (gl.getAttribLocation(program, 'a_position') < 0) throw new Error('The drawing position could not be prepared.');
    const names = [...data.uniforms.map(u => u.name), ...(data.builtins.resolution ? ['u_resolution'] : []), ...(data.builtins.time ? ['u_time'] : [])];
    const locations = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
    return { resources: { gl, program, buffer, locations, dispose } };
  } catch (error) { dispose(); return { error: boundedShaderMessage(error instanceof Error ? error.message : String(error)) }; }
}

/** The least picture a sized card keeps: room for what sits on it (the overlay's sliders and Play), else a strip. */
export function shaderSurfaceFloor(controls: 'overlay' | 'below' | 'none', uniforms: number, transport: boolean): number {
  return Math.max(96, controls === 'overlay' ? uniforms ? 48 * uniforms + 64 : transport ? 52 : 0 : 0);
}
function GlslShader(props: RendererProps<GlslShaderData>) {
  const { data, block, ui, readOnly, runtime, availableWidth } = props;
  const parsed = glslShaderState(data, runtime.state);
  const live = useRef({ props, state: parsed }); live.current = { props, state: parsed };
  const clock = useRef({ seconds: parsed.time, saved: parsed.time, playing: false, last: null as number | null, visited: [parsed.time, parsed.time] as [number, number] });
  if (!clock.current.playing && clock.current.saved !== parsed.time) { clock.current.seconds = parsed.time; clock.current.saved = parsed.time; clock.current.last = null; }
  const [playing, setPlaying] = useState(false), [compileError, setCompileError] = useState(''), [surfaceError, setSurfaceError] = useState(''), [eventError, setEventError] = useState(''), [attempt, setAttempt] = useState(0);
  const bundle = useRef<Resources | null>(null), failed = useRef(false), visible = useRef(false), ranges = useRef<Record<string, [number, number]>>({}), measured = useRef({ parts: {} as Record<string, number>, sent: 0 }), report = useRef(() => {});
  useEffect(() => report.current());
  const clearResources = () => { const old = bundle.current; bundle.current = null; old?.dispose(); };
  const save = (state: GlslShaderState) => { live.current.state = state; clock.current.saved = state.time; live.current.props.runtime.set(state); };
  const valuesNow = () => Object.fromEntries(live.current.props.data.uniforms.map(u => {
    const scope = live.current.props.scope;
    return [u.name, Object.hasOwn(scope.variables, u.name) ? scope.get(u.name) : live.current.state.values[u.name] ?? u.value];
  }));
  const settle = (kind: string, payload: RendererProps['block']['data'], label: string) => {
    setEventError(''); void live.current.props.runtime.record(kind, payload, label).catch(() => setEventError('The setting could not be saved. Check the connection and try again.'));
  };
  const pause = (reason: string) => {
    if (!clock.current.playing) return;
    clock.current.playing = false; clock.current.last = null; setPlaying(false);
    save({ ...live.current.state, time: clock.current.seconds });
    settle('glsl-shader.pause', { time: clock.current.seconds, visited: clock.current.visited, values: valuesNow(), reason }, 'Pause shader');
  };
  useEffect(() => { if (readOnly) pause('read only'); }, [readOnly]);
  useEffect(() => () => { pause('left the block'); clearResources(); }, []);
  // Recompile programs inside the same context. Changing initialize would tear down the adapter
  // and lose its WebGL context on the same canvas, so the host initializer stays stable.
  const signature = JSON.stringify([data.fragmentSource, data.uniforms.map(u => u.name), data.builtins]);
  const compilation = useRef({ wanted: signature, attempt, built: '', builtAttempt: -1 });
  compilation.current.wanted = signature; compilation.current.attempt = attempt;
  const initialize = useMemo(() => (gl: GLContext) => {
    clearResources(); failed.current = false; setCompileError(''); setSurfaceError('');
    compilation.current.built = compilation.current.wanted; compilation.current.builtAttempt = compilation.current.attempt;
    const prepared = prepareShader(gl, live.current.props.data);
    if (prepared.error) { failed.current = true; setCompileError(prepared.error); pause('compile error'); }
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
      if (clock.current.seconds === GLSL_TIME_MAX) pause('time limit');
    } catch { setSurfaceError('The shader could not be drawn. Reset the experiment.'); pause('drawing error'); clearResources(); failed.current = true; }
  };
  const onVisibilityChange = (drawable: boolean) => {
    visible.current = drawable;
    if (!drawable) { pause('out of view'); clearResources(); }
  };
  const reset = () => {
    if (live.current.props.readOnly || ui.layout.platform !== 'web') return;
    clock.current = { seconds: 0, saved: 0, last: null, playing: false, visited: [0, 0] }; setPlaying(false); ranges.current = {};
    if (failed.current) setAttempt(attempt + 1);
    live.current.state = { values: {}, time: 0 }; live.current.props.runtime.set(null);
    // Shared variables are owned by their own control. This reset clears local values and time only.
    settle('glsl-shader.reset', { time: 0, values: valuesNow() }, 'Reset shader');
  };
  const summary = data.staticSummary ?? 'Shader without a declared static reference. It has not run on this device.';
  const chrome = glslChrome(data), native = ui.layout.platform !== 'web', selected = !!props.selection?.includes(block.id);
  const play = () => {
    if (live.current.props.readOnly || !visible.current || failed.current) return;
    if (clock.current.playing) pause('paused by the person');
    else { clock.current.playing = true; clock.current.last = null; clock.current.visited = [clock.current.seconds, clock.current.seconds]; setPlaying(true); }
  };
  // Autoplay starts the clock once the picture is in view, unless the person asked the system for less motion.
  const autoplayed = useRef(false);
  const onVisible = (drawable: boolean) => {
    onVisibilityChange(drawable);
    if (drawable && chrome.autoplay && data.builtins.time && !autoplayed.current && !live.current.props.readOnly && !failed.current && !prefersReducedMotion()) { autoplayed.current = true; play(); }
  };
  if (native) return <View nativeID={`lienzo-interactive-shader-${block.id}-static`} style={{ gap: 8, padding: chrome.question ? 0 : 12 }}>{!!chrome.question && <Txt>{chrome.question}</Txt>}<Txt kind="label" muted>Static</Txt><NativeLearningFallback summary={summary} />{chrome.reset && <Button label="Reset" small variant="ghost" disabled onPress={reset} />}</View>;
  const sliders = data.uniforms.map(u => {
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
    return <View key={u.name} nativeID={`lienzo-interactive-shader-${block.id}-${u.name}`} style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Txt kind={chrome.controls === 'overlay' ? 'small' : 'label'} numberOfLines={1} style={{ flexShrink: 1 }}>{u.label}{variable ? ' · Shared' : ''}</Txt><Txt kind="code" muted={chrome.controls === 'overlay'}>{Number(value.toPrecision(chrome.controls === 'overlay' ? 4 : 6))}{(variable?.unit ?? u.unit) ? ` ${variable?.unit ?? u.unit}` : ''}</Txt></View>
      <WebRange id={`shader-${block.id}-${u.name}`} label={u.label} min={min} max={max} step={variable?.step ?? u.step ?? 'any'} value={value} color={variable ? ui.c.accent : ui.c.foreground} disabled={readOnly || min === max} onChange={change} onSettle={next => {
        if (live.current.props.readOnly || !Number.isFinite(next)) return;
        change(next); const current = live.current.props.scope.variables[u.name];
        const value = Math.max(current?.min ?? u.min, Math.min(current?.max ?? u.max, next)), visited = ranges.current[u.name] ?? [value, value]; delete ranges.current[u.name];
        const shared = live.current.props.scope.variables[u.name];
        settle(`glsl-shader.uniform.${u.name}`, { name: u.name, value, visited, ...(shared ? { scopeId: shared.scopeId } : {}) }, `Adjust ${u.label}`);
      }} />
    </View>;
  });
  const broken = !!compileError || !!surfaceError;
  const transport = (data.builtins.time || chrome.reset) && <View nativeID={`lienzo-interactive-shader-${block.id}-transport`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {data.builtins.time && <Button label={playing ? 'Pause' : 'Play'} small disabled={readOnly || broken} onPress={play} />}
    {chrome.reset && <Button label="Reset" small variant="ghost" disabled={readOnly} onPress={reset} />}
  </View>;
  // Without a stored size the picture keeps 16:10 and the card grows around it. With one, the picture takes what the
  // controls leave, down to a floor; below that the card grows (reportMinimumHeight), so the controls are never cut.
  const height = Math.max(140, Math.round((availableWidth || 360) * 10 / 16)), sized = !!block.size;
  const floor = shaderSurfaceFloor(chrome.controls, data.uniforms.length, !!transport);
  // What sits above and below the picture, measured piece by piece: a cut-off card cannot measure its own overflow.
  const below = chrome.controls === 'below' && (!!data.uniforms.length || !!transport), shown = { question: !!chrome.question, below, error: !!eventError };
  const send = () => {
    const m = measured.current; for (const part of Object.keys(m.parts)) if (!shown[part as keyof typeof shown]) delete m.parts[part];
    if (!sized) return; const minimum = Math.ceil(Object.values(m.parts).reduce((sum, h) => sum + h, floor));
    if (Math.abs(minimum - m.sent) >= 1) { m.sent = minimum; live.current.props.reportMinimumHeight?.(minimum); }
  };
  const measure = (part: keyof typeof shown) => (e: { nativeEvent: { layout: { height: number } } }) => { measured.current.parts[part] = e.nativeEvent.layout.height; send(); };
  report.current = send;
  const glass = { backgroundColor: withAlpha(ui.c.surface1 ?? ui.c.surface0, .86), borderRadius: 10, borderWidth: 1, borderColor: withAlpha(ui.c.foreground, .1), backdropFilter: 'blur(10px)' } as object;
  // The picture: the shader edge to edge. Everything else sits on it only when chosen, or under it.
  const overlay = chrome.controls === 'overlay' && (selected || !playing && data.builtins.time);
  return <View style={{ flex: 1, minHeight: 0 }}>
    {!!chrome.question && <Txt onLayout={measure('question')} style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 }}>{chrome.question}</Txt>}
    <View nativeID={`lienzo-shader-${block.id}`} style={{ flex: 1, minHeight: sized ? floor : height, backgroundColor: ui.c.surface0, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}><GLSurface id={`glsl-${block.id}`} passive label={chrome.question || block.title || 'Shader'} summary={summary} height="100%" maxPixelSize={data.maxPixelSize}
        animated={playing} initialize={initialize} draw={draw} onVisibilityChange={onVisible} onError={message => {
          pause('drawing error');
          setSurfaceError(message.includes('does not offer this drawing context') ? 'WebGL is not available' : message.includes('was lost') ? 'The WebGL context was lost. Waiting for it to come back.' : 'The shader could not start. Open the block again.');
        }} /></View>
      {chrome.title && !!block.title && <View pointerEvents="none" style={[glass, { position: 'absolute', left: 10, top: 10, maxWidth: '80%', paddingHorizontal: 10, paddingVertical: 5 }]}><Txt kind="heading" numberOfLines={1}>{block.title}</Txt></View>}
      {broken && <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, padding: 14, gap: 6, backgroundColor: withAlpha(ui.c.surface0, .94) }}>
        {!!compileError && <><Txt style={{ color: ui.c.statusDanger }}>The shader did not compile</Txt><Txt kind="code">{compileError}</Txt></>}
        {!!surfaceError && <><Txt style={{ color: ui.c.statusDanger }}>{surfaceError}</Txt><Txt kind="small" muted>{summary}</Txt></>}
      </View>}
      {overlay && <View nativeID={`lienzo-shader-${block.id}-overlay`} style={[glass, selected && data.uniforms.length ? { position: 'absolute', left: 8, right: 8, bottom: 8, padding: 10, gap: 8, maxWidth: 360 } : { position: 'absolute', left: 8, bottom: 8, padding: 4 }]}>
        {selected && sliders}{transport}
      </View>}
    </View>
    {below && <View onLayout={measure('below')} style={{ padding: 14, gap: 12, flexShrink: 0 }}>{sliders}{transport}</View>}
    {!!eventError && <Txt onLayout={measure('error')} kind="small" style={{ color: ui.c.statusDanger, paddingHorizontal: 14, paddingBottom: 8 }}>{eventError}</Txt>}
  </View>;
}
export const glslShaderRenderer: ClientRenderer<GlslShaderData> = { id: 'glsl-shader', Component: GlslShader, visual: { icon: 'Sparkles', tone: 'neutro', width: 'wide' } };
