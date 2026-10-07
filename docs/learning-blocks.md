# Learning renderer contract

Renderers are trusted plugin code. Packs contain declarative JSON only; never execute
agent-supplied JavaScript or HTML. Rich interactions run on web/desktop. Native shows a
static summary and `La versión interactiva está disponible en escritorio/web.`
Every manipulable block needs a visible guiding question or goal and a visible Reiniciar
control. Use the existing `useUI`, typography and controls. Show useful Spanish error text;
keep transport internals out of the learner's UI. GLSL compile/link errors are the exception:
show a bounded compiler message below a Spanish error label, rather than throwing or hiding it.

## Ownership and registration

Each wave 2 engineer owns exactly these files and their renderer tests:

- `plugin/shared/renderers/<id>.ts`
- `plugin/client/renderers/<id>.tsx`
- `tests/<id>.test.ts`

Send the two exported registration names to the coordinator. The coordinator adds one
import/register line to each `renderers/index.ts`, before the shared `rendererNames`
constant. Implementers do not edit core files, indices, tokens, Panel or other renderers.
For example, the controls registration lines are:

```ts
// shared/renderers/index.ts
import { controlsSpec } from './controls'; registerRenderer(controlsSpec);
// client/renderers/index.ts
import { controlsRenderer } from './controls'; registerClientRenderer(controlsRenderer);
```

`RendererSpec` is exported from `shared/renderers`:

```ts
type RendererSpec = {
  id: string;
  dataSchema: z.ZodType;
  blockType: BlockType;
  guidance: string;
  interactive: boolean;
  minSize?: { width: number; height: number };
  defaultSize?: { width: number; height: number };
  hiddenTargets?: (data: unknown, runtime: Record<string, JSONValue>,
    document: CanvasDocument, blockId: string) => readonly string[];
  remapReferences?: (data: CanvasBlock['data'],
    ids: ReadonlyMap<string, string>) => CanvasBlock['data'];
};
```

Use the same `id` as `blockType.renderer`; built-in type IDs normally match too. The
schema validates all data, including JSON properties, on server writes and pack validation.
Client dispatch parses data before calling the renderer. Defaults must pass the schema.
List every top-level data key in `blockType.properties`. One-line guidance appears in MCP
catalog results and agent integration instructions. The 15 legacy renderer names remain
valid. Diagram uses the registry; the remaining legacy renderers still work.

Creation merges type defaults with supplied data. Updates use JSON merge patch, with null
removing a key. For a schema with variants, a complete valid data object replaces the
defaults or previous data when the merged object would be invalid. This allows changing
variant without retaining properties of the previous one. Incomplete invalid data
still rejects the transaction; ordinary partial updates keep their merge semantics.

`hiddenTargets` is an optional pure presentation hook; no built-in renderer declares
it. Return existing target block IDs while those blocks must stay hidden; validate raw
runtime against the current data before accepting an open state. The hook is connected
to canvas, list and details. It does not change the stored document, export, MCP access
or permissions. Several hiding blocks on one target require all of them to open.
While one is closed, its target card is replaced before renderer dispatch, including
compact graph nodes and native/list views. The presentation masks target titles, data,
instructions and adjacent link labels. Details shows the hiding block's controls instead
of its raw data fields, and replaces a hidden target's editor with a link back to it.
The authored document remains available to MCP and exports; this is a learning sequence,
not a security boundary.

`remapReferences` rewrites only declared reference fields on duplication and template
insertion. The map includes copied block, group and link IDs. Internal references point
to their copies; external references stay unchanged. Return declarative data without
mutating the input or map. Document copies and pack exports preserve IDs, so they do
not need remapping. Runtime stays excluded from every copy or template.

## Client props

`RendererProps<Data>` and `ClientRenderer<Data>` are exported from `client/renderers`.
The authoritative definitions are in `client/renderers/types.ts`:

```ts
type RendererProps<Data = unknown> = {
  document: DeepReadonly<CanvasDocument>;
  data: Data;
  block: CanvasBlock;
  availableWidth: number; // logical content width, initially 0 until measured
  compact: boolean;
  readOnly: boolean;
  ui: ReturnType<typeof useUI>;
  runtime: RendererRuntime;
  scope: RendererScope;
  send(kind: string, payload: CanvasBlock['data'], label: string,
       delivery?: 'immediate' | 'batched'): Promise<void>;
};
type ClientRenderer<Data = unknown> = {
  id: string;
  Component: ComponentType<RendererProps<Data>>;
  visual: { icon: string; tone: string; width: 'standard' | 'wide' | 'node' };
};
```

Use `ui.c`/`ui.tone` or call existing `useUI()` for theme access. Use shared spec `defaultSize` for an explicit initial frame; otherwise `visual.width`
selects the existing standard/wide/node width. Legacy token callers use registered visual
metadata with a generic fallback. `interactive:true` wraps the renderer
in `lienzo-interactive-renderer-<blockId>` to isolate gestures. Honor `readOnly` in every
control and give nested interactive elements the same `lienzo-interactive-` ID prefix.
Do not mutate any prop or cached snapshot.

Renderers can read `document.blocks`, `document.groups` and `document.links`.
Store node/link references as IDs in parsed declarative data; handle missing IDs
with useful Spanish text. A flow can resolve endpoints from this readonly document.
There is no prop for arbitrary block mutation or changing the outer link layer. Persist
an explicit step in own runtime; report a settled result with `runtime.settle`. Use
`send` to ask the connected agent for a revisioned document change. Referencing a block
is not proof that it has been generated or that an agent finished work.

## Runtime and scope

```ts
type RendererRuntime = {
  state: Record<string, JSONValue>;
  set(state: Record<string, JSONValue> | null, settled?: boolean): void;
  flush(): Promise<void>;
  settle(kind: string, payload: CanvasBlock['data'], label?: string, eventId?: string): Promise<void>;
};
type RendererScope = {
  variables: Record<string, ScopeVariable & { scopeId: string; current: number }>;
  values: Record<string, number>;
  get(name: string): number; // NaN if undeclared
  set(name: string, value: number | null, settled?: boolean): void;
};
```

`runtime.set` replaces the block's JSON object; null resets it. Changes publish locally
immediately, debounce network writes for 80 ms, and send immediately with `settled:true`.
`flush()` waits for network acknowledgement, not disk durability. `runtime.settle` first
flushes runtime writes, then sends one batched settled event for this block. Include final
value or visited range in the payload, up to 4 KiB. Use a stable kind
per interaction, such as `controls.amplitude`, so a newer pending event replaces the older
one for the same block/kind. Events already prepared for delivery remain immutable.
Settled context retains the target and ancestor groups, rather than the entire document.
Normal feedback still retains its full snapshot. Batched-only feedback waits for the
existing explicit flush mechanism.

The optional `eventId` lets an attempt retry the same event after an ambiguous network
response. Keep kind, payload, label and target identical on every retry: the server
deduplicates a retained event by ID and rejects reuse with a different action. This
is bounded by event retention (pending events and the most recent 100 sent/acknowledged
events); it is not a permanent delivery ledger. Use a distinct kind per attempt to
prevent pending coalescing from replacing an earlier attempt.

Declare `variables` on the document or a group through revisioned `document.update` or
`group.update`. Each declaration is `{name, value, min, max, label?, step?, unit?}`. Names
match `[a-zA-Z_][a-zA-Z0-9_]{0,31}`, excluding prototype keys. Each scope has at most 24
unique names; all numbers are finite, `min <= value <= max`, and supplied step is positive.
Resolution uses the nearest declaring ancestor, then document scope `$document`. Current
values come from runtime or fall back to declared value; reads clamp old overrides to the
current range. `scope.set(name,null)` removes the override. Every sibling resolves against
one optimistic store, so sliders and figures update together before the server responds.
`controls.data.variables` lists at most four names per block, while each scope permits 24.
Reset each listed variable with null, then settle a reset event with the declared defaults.

Runtime has no document revision, history or undo. Updates copy only runtime in memory,
use last-write-wins and persist the aggregate with a 250 ms coalescing window. A normal
transaction or store close also flushes it. Process/power loss within that window can lose
recent runtime changes; content transactions retain their existing durability. Background
write failures retry on the next runtime write or explicit store flush/close. Limits are
4 KiB of serialized UTF-8 JSON per block and 256 KiB per document. JSON nesting is limited
to 32 and reserved keys are rejected. Deleted entities/declarations lose their runtime
entries; undo restores content, not those entries. Document copy/export and selection packs retain document/group declarations, not overrides.
Group templates retain the exported groups' declarations; declarations on excluded ancestors
or the source document are outside that template and must be supplied by its destination.
`runtimeVersion` also covers existing selection/connection/feedback changes; watch/poll
therefore observes both kinds of runtime changes. Runtime updates never lock the card.

## Math and drawing

`shared/expr.ts` exports `compileExpression(source): CompiledExpression`,
`validateExpression(source, allowedIdentifiers = [])`, and `ExpressionParseError`.
Compilation throws a readable error with zero-based `position` on invalid syntax.
A compiled object has `identifiers` and `evaluate(variables = {}): number`. Compile once
with `useMemo`, then evaluate with scope values. Evaluation catches failures and returns
NaN for missing variables and nonfinite/domain results. Validator returns
`{valid, unknownIdentifiers, error?}` for a Zod refinement.

Operators are `+ - * / ^ %`, unary `- + !`, `< <= > >= == !=`, `&& ||`, and ternary `?:`.
Powers associate right, `-2^2` is -4, logic/comparisons return 0/1, and logic/ternary
short-circuit. Constants are `pi e tau`. Functions are `sin cos tan asin acos atan atan2
sinh cosh tanh exp ln log log10 log2 sqrt cbrt abs floor ceil round sign min max clamp mix
step smoothstep mod hypot`. `log` means natural log; `%` is remainder and `mod` wraps.
Source length is capped at 4096 characters, nesting/tree depth at 64 and variadic arity
at 64. No property access, assignment, eval, Function or executable code is supported.

Import `CanvasSurface`, `GLSurface`, `NativeLearningFallback` and drawing types from
`client/Surfaces`. Only `client/web.ts` accesses DOM; do not enable the DOM TypeScript lib.
Both wrappers take `{id,label,height,summary,animated?,maxPixelSize?,onVisibilityChange?,onPointer?,onError?,draw}`.
2D draw receives `(Canvas2DContext, SurfaceFrame)`; GL draw receives `(GLContext, frame)`.
Frame is `{width,height,pixelRatio,time}`, with logical dimensions and RAF time in ms.
2D coordinates are already scaled for DPR; GL gets a physical viewport. Pointers report
`{kind,x,y,pointerId,buttons,pressure}` in logical coordinates with pointer capture.
Surfaces resize and stop drawing offscreen or when the tab is hidden. Static surfaces
redraw on props/size changes; animated ones use RAF.

`onVisibilityChange` receives changes to the stage's drawable visibility, including
offscreen, hidden tab, context loss and unmount. Pause local playback when it becomes
false; do not emit per-frame events. `maxPixelSize` optionally caps the larger physical
canvas dimension, clamped to 16–2048 pixels. Logical drawing coordinates stay unchanged.
Shaders should declare a conservative resolution cap rather than use unlimited DPR.

`GLSurface` also accepts `initialize(gl)` returning `{dispose?,error?}` or void. Memoize
initialize to avoid context churn. It runs again after context restoration. Context loss
pauses rendering; at most eight mounted GL contexts are live. Overflow shows a Spanish
message; close another graph and remount the block. `compileGLProgram(gl,vertex,fragment)`
returns `{program?,error?}` with compile/link diagnostics and frees temporary shaders.
Delete a successful program in dispose. Display a bounded compile/link error beneath
"No se pudo compilar el shader"; do not include transport errors, stack traces or private paths.
Native wrappers show the static fallback and never create contexts.

Raster resolution samples DPR times CSS camera scale on each redraw, capped at 4x.
A static bitmap can briefly soften after a camera-only zoom until its next redraw, since
CSS transforms do not notify ResizeObserver. Animated surfaces resample each frame.
Headless adapter tests use simulated host/context objects and do not open a GUI.
The learning QA separately exercised real browser WebGL under RN-web in isolated omabox;
installed Paseo, native devices and physical GPU behavior remain unverified. See
`design/qa-learning-2026-10-06/report.md` for the browser environment and results.

### Motion over existing canvas links

A client renderer may expose `prepareLinkMotion(data, readonlyDocument)` returning
`(rawBlockRuntime, epochMs) => readonly LinkMotionToken[]`. Preparation runs once per
authored document/catalog, so graph simulation does not run on each frame. A token is
`{linkId, progress:0..1, kind:'message'|'signal'|'value', label, sign?:1|-1, delay?:ms}`.
The coordinator registers this adapter; renderer modules do not edit Canvas or Links.
The flow adapter samples the raw per-block runtime, not the RendererRuntime wrapper.
Use epoch milliseconds (`Date.now()`), never the relative RAF callback time.

Canvas samples optimistic runtime locally. Tokens follow the actual SVG path, including
live drag geometry and expanded parallel-link strands. Message/envelope, signal/triangle
and value/circle have distinct symbols and Spanish labels; declared sign/delay appear
beside the payload. Hidden gate targets, adjacent paths and hidden flow blocks emit no
visible tokens. Missing or collapsed internal paths are omitted; no replacement graph
is invented. Paused scrubs draw once, playback draws via RAF, and hidden/offscreen canvas
or unmount cancels that loop. Sampling never writes runtime or sends assistant events.
At most 256 tokens are drawn across the canvas per frame; excess tokens are omitted in
stable document/event order. Native retains static links and the honest block summary.

## Step sequencer (`step-sequencer`)

Data is declarative and strict: `question`; a locked `scale {root, mode, octave}` (roots `C..B`
with sharps or `Db/Eb/Gb/Ab/Bb`; modes `major`, `minor`, `dorian`, `pentatonic-major`,
`pentatonic-minor`, `blues`; octave 2..5); `rows`, 1..6 distinct one-based scale degrees up to
15; `labels` (`note` or `degree`); `steps` 2..16; `stepsPerBeat` 1..4; `tempo {bpm,min,max}`
inside 40..240; `pattern`, one string per row of exactly `steps` characters (`x` sounds, `.` is
silent); `voice` (`sine`, `triangle`, `square`). Pitches must fall in MIDI 36..96. There is no
URL, sample, script or autoplay field. Rows display highest first; `pattern[i]` always belongs
to `rows[i]`.

Runtime holds `{pattern, bpm, heard?}` and falls back to the authored pattern when the stored
shape no longer fits. `heard` is a short fingerprint of the exact music that completed a cycle
(scale, rows, voice, steps, subdivision, tempo and pattern), so an authored change to any of them
is unheard again while a still-fitting learner pattern and tempo are kept. The moving step
counter is hidden from assistive technology; a polite live region announces only playback state
and audio errors. The learner toggles cells (click, Space or Enter; arrows, Home and End
move between cells) and moves tempo inside the declared range. One coalescing settled event,
`step-sequencer.pattern`, describes the final pattern, tempo and whether a full cycle was heard:
600 ms after the last toggle, on tempo release, and once when a first full cycle has been heard.
`step-sequencer.reset` follows Reiniciar. Playback position is never stored or sent.

Audio lives behind `openStepAudio` in `client/web.ts`, the only Web Audio entry, and the pure
lookahead scheduler in `client/sequencer-audio.ts`. A context is created and resumed inside the
Reproducir press and closed, never suspended, on pause, reset, read-only, unmount, document
change, hidden tab, the grid leaving the viewport, a browser suspension, or another sequencer
starting: one live context across the plugin. Master gain 0.2, per-note peak at most 0.3, notes
at most 0.5 s, 24 voices, 30..4200 Hz. A refused start shows "No se pudo activar el sonido" with
"Activar sonido" and keeps the grid editable; a browser without Web Audio says so. Native shows
the labelled grid and its text description as static and never reaches for audio.

## Stroke annotations (`wb-draw`)

Trazos extends the existing whiteboard drawing layer. Data keeps bounded `extent` and
`strokes`, with optional `author` (`learner` or `assistant`) and `anchor` (a card ID).
An absent author denotes authored document or template content. The pencil creates learner
layers; agent-created layers are marked assistant. Assistant layers are dashed and labelled.

An anchored layer stores its position relative to the card's top-left corner and follows
that card during dragging, layout changes and reparenting. Deleting the card removes its
annotations in the same transaction, and undo restores them. Copying both remaps the anchor.
Custom types use their registered renderer to determine these semantics; an unrelated
custom card's `data.anchor` remains ordinary authored data.

`Borrar mis trazos` removes only learner layers in one undoable transaction. The eraser
removes whole strokes. Leaving the pencil or eraser emits one bounded `whiteboard.strokes`
summary with counts and anchor titles, never points or per-frame events. The document cap
remains 1 MiB; a rejected append retains the earlier drawing and shows the size error.
An append replaces its old layer in the client size estimate rather than counting it twice.

The schema and exact point limits are in `shared/whiteboard.ts`; persistent changes use
the existing document transaction path, not the interactive-card runtime channel.

## Skeleton and verification

```ts
// shared/renderers/example.ts
import { z } from 'zod';
import type { RendererSpec } from './spec';
export const exampleDataSchema = z.object({ question: z.string().min(1).max(1000) }).strict();
export type ExampleData = z.infer<typeof exampleDataSchema>;
export const exampleSpec = {
  id: 'example', dataSchema: exampleDataSchema, interactive: true,
  guidance: 'Set a guiding question and explicit declarative parameters.',
  blockType: { id: 'example', name: 'Ejemplo', description: 'Datos de ejemplo.',
    renderer: 'example', properties: [{key:'question',label:'Pregunta',kind:'text',required:true}],
    defaults: {question:'¿Qué cambia al mover el parámetro?'} },
} satisfies RendererSpec;
```

```tsx
// client/renderers/example.tsx
import React from 'react';
import { View } from 'react-native';
import type { ExampleData } from '../../shared/renderers/example';
import type { ClientRenderer, RendererProps } from './types';
import { Button, Txt } from '../ui';
import { NativeLearningFallback } from '../Surfaces';
function Example({data,ui,runtime,readOnly}: RendererProps<ExampleData>) {
  if (ui.layout.platform !== 'web') return <NativeLearningFallback summary={data.question} />;
  return <View style={{gap:8}}><Txt>{data.question}</Txt>
    {/* Add declarative controls/drawing here; honor readOnly. */}
    <Button label="Reiniciar" disabled={readOnly} onPress={() => {
      runtime.set(null);
      void runtime.settle('example.reset', {}, 'Reiniciar ejemplo').catch(() => {
        // Show a useful Spanish retry message in component state.
      });
    }} />
  </View>;
}
export const exampleRenderer: ClientRenderer<ExampleData> = {
  id:'example', Component:Example, visual:{icon:'Square',tone:'neutro',width:'standard'},
};
```

Test valid/invalid data and expressions, actual calculations, reset, missing references,
readOnly, and native fallback. Do not edit registry indices in parallel worktrees; send
registration lines to the coordinator, who can validate registry dispatch after integration.
Run `PATH="$HOME/.local/share/pnpm/bin:$PATH" pnpm typecheck` and `pnpm test`.
Here the pnpm executable requires execution outside the sandbox. No dependency install,
plugin install, daemon restart, GUI or public preview is needed for these checks.
