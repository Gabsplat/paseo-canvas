# Lienzo — design audit of `plugin/client`

Reviewer: visual designer (Opus). Reference: `docs/design.md` v2, `design/tokens.json` v2.
The designer does not edit `plugin/client`; each item is a concrete change for the frontend engineer.

Severity: **A** = breaks the design or a stated rule, fix before screenshots · **B** = visible
deviation · **C** = polish.

## Evidence status — final (pass 7, 2026-10-05)

| Surface | Evidence | Verdict |
| --- | --- | --- |
| `design/demo.html` | **Viewed** standalone (`design/review-demo*.png`) and embedded in a live `preview` block (dark and light host) | As designed |
| Plugin, wide, foreign **dark** host theme | **Viewed**: `native-learning`, `native-feedback-sent`, `qa-empty`, `qa-agents`, `qa-selected-note`, `qa-undo`, `qa-live-tailnet`, `qa-import-review`, `qa-pack-export` | Matches the design |
| Plugin, wide, **light host theme** (root's own omabox browser profile; no user theme was activated) | **Viewed**: `docs/screenshots/native-light.png` (learning example at 100 %, fan-out edge labels), `native-live-light.png` (two root groups, initial view) | Matches the design. Text stays on foreground/muted, tone only on spines, icons and washes |
| Plugin, compact 640×900 | **Viewed**: `native-compact.png` and `native-compact-inspector.png` (light host, latest build), `native-compact-catalog.png`, `native-compact-packs.png`, `native-compact-import.png` (dark host, earlier wrapper build) | Matches the design |
| Plugin, medium 1000×900, light host | **Viewed**: `docs/screenshots/native-medium-inspector.png` (top bar with inspector toggle, inspector as right overlay over a scrim, tray with real "Recibido por el agente") | Matches the design |
| Compact documents sheet, light host | **Viewed**: `docs/screenshots/native-compact-documents.png` | Matches the design for document rows; one B deviation recorded (D1) |
| `preview` block, full iframe, outline view, light host | **Viewed**: `docs/screenshots/native-media-preview.png` (URL bar, `EN VIVO`, embedded demo page, description) | Matches the design |
| `media` block body, light host | **Viewed**: `docs/screenshots/native-media.png` — fully visible: reference row (icon, host name, full URL in mono), "Abrir referencia", caption | Matches the design (reference variant). The image variant (`mediaKind: "image"`) was not captured |
| **Lienzo Papel / Lienzo Tinta contributed themes applied to the plugin** | **Not viewed. Not verified.** | Palette verified numerically and on `demo.html` only |
| Catalog as medium overlay, media **image** variant, "Paso a paso" ghosts, current-step highlight and detail strip, unanswered→answered choice flow, conflict / offline / reload banners, load-error state, unknown-block state, focus ring behaviour, iOS/Android | **Not viewed** | Code-reviewed only |
| Typecheck / tests | Reported by root: typecheck 0, 42/42 tests. Not re-run by the designer | — |

## Pass 1 — 2026-10-04, code read only (no screenshots yet)

Files present: `tokens.ts`, `color.ts`, `logic.ts`, `ui.tsx`, `web.ts`, `useCanvas.ts`. No panel,
canvas, block, group, catalog, inspector or tray components exist yet, so §3, §5–§11 of the spec are
**not reviewed**. Next pass happens when those land and when native screenshots are provided.

### `tokens.ts`

| # | Sev | Finding | Fix |
| --- | --- | --- | --- |
| T1 | A | Transcribed from tokens v1. v2 removed `size.blockWidth.s/l`, `size.handle`, `icons.lock`, `blockTypes.*` and added `renderers`, `layout`, `diagram`, `preview`, `media`, `web`, `size.blockWidth.{standard,wide}`, `size.groupHeaderNested`, `size.groupPaddingNested`. | Re-transcribe. Then `logic.ts:36` (`blockWidth.s`) must move to `tokens.diagram.node`. |

### `color.ts`

Matches §2.1. No changes. (Add the memoised `washStrong`, `toneBorder`, `groupFill`, `halo`, `hover`
next to `wash` in `useUI` — they are needed by blocks, groups and selection.)

### `ui.tsx`

| # | Sev | Finding | Fix |
| --- | --- | --- | --- |
| U1 | A | `Button` pressed state replaces the fill with `foreground`@0.1, so a **primary** button flashes to near-transparent with `accentForeground` text (unreadable on light themes). | Primary pressed: keep `accent`, set `opacity: 0.85`. Others: keep their fill and add the overlay (`secondary` → `surface2` stays; ghost → `foreground`@0.10). |
| U2 | A | Focus changes `borderWidth` 0→2 (primary/ghost) or 1→2 (secondary, `Input`), so controls grow and neighbours jump. | Always reserve the border: `borderWidth: 2` when focused with `paddingHorizontal − 1` (secondary/input) or a constant 1 px transparent border on primary/ghost and −1 padding on focus. Net size must not change. |
| U3 | B | No hover state anywhere (§4). | Use `({ pressed, hovered })`: hovered → overlay `foreground`@0.06 (primary: opacity 0.92). |
| U4 | B | `Segments`: inactive labels are `foreground`; spec says inactive = `foregroundMuted`. Also on compact every segment becomes 44×44 min, and `flexWrap` lets a 4-option control break into two rows inside the inspector. | Pass a muted label colour for inactive segments. Give segments `flex: 1` inside a non-wrapping row; on compact use height 36 inside a 40 track (the 44 target is met with `hitSlop`). |
| U5 | B | `Input` single-line: `paddingVertical: 8` + line height 19 = 35 px, not the 32 px control height; `textAlignVertical: "top"` on single-line. | Single-line: `paddingVertical: 0`, `height: 32` (44 compact), `textAlignVertical: "center"`. Multiline keeps 8 / top. |
| U6 | B | `Input` sets `autoCapitalize="none"` for every field; titles and notes in Spanish need sentence capitalisation. | `autoCapitalize={mono ? "none" : "sentences"}`. |
| U7 | A | `Field` discards save results (`void onSave`) — no in-flight dot, no "No se guardó" helper, no retry (§10 field pattern). A failed edit looks saved. | Track `pending`/`error` from the returned promise: 6 px `statusWarning` dot after the label while pending; on rejection keep the draft, helper `small` in `statusDanger` "No se guardó" + ghost small "Reintentar". Also commit after 600 ms idle, not only on blur (sheets can close without blur). |
| U8 | B | `Field` has no helper/placeholder/required props, so the communication editor placeholders and counters (§10) and `required` " *" cannot be rendered. | Add `helper`, `placeholder`, `required`, `counterMax`. |
| U9 | C | `CheckRow` always fills with `accent`. | Add `tone?: Tone` (checklist blocks use `exito`, fill `toneColor`, check icon in `surface1`); default stays accent. Add `strike` for done checklist items (muted + line-through). |
| U10 | C | `Section` draws a top rule on the first section and uses 16 instead of 20 before the rule. | `paddingTop: 20`; no rule/padding on the first child (prop `first` or wrap in a parent with `gap: 20` and separators between). |
| U11 | B | `JsonPreview`: size uses a decimal point ("2.4 KB"); only "Copiar JSON", no web download. | `toFixed(1).replace(".", ",")`. On web the primary is "Descargar JSON" (`downloadJson`) and "Copiar" is secondary; on native "Copiar JSON" primary + helper text (§9.2). |
| U12 | C | `Txt` compact bump covers `body`/`button` only. | Add `small` → 13/18 on compact (`font.compactBump`). |
| U13 | C | `Chip` label is always muted — correct — but there is no `OptionRow`, `ProgressBar`, `Banner`, `EmptyState`, `Skeleton` yet. | Build them per §4 / §11 before the block components, so blocks do not improvise them. |

### `web.ts`

| # | Sev | Finding | Fix |
| --- | --- | --- | --- |
| W1 | A | `PreviewFrame` height is 220 fixed. The profile example needs the spec height to show header + form. | 360 (240 on compact) from `tokens.preview.frame`. |
| W2 | B | Sandbox adds `allow-popups`. | Use `tokens.preview.sandbox` (`allow-scripts allow-forms`); opening elsewhere is the URL bar's `ExternalLink` job. |
| W3 | A | The iframe swallows pointer events, so the block cannot be selected or dragged by clicking the frame, and wheel-pan dies over it. | Transparent overlay `Pressable` above the iframe until the block is selected (§6.4). |
| W4 | B | `loaded` only feeds `aria-label`: no skeleton while loading, no hint when a site refuses embedding. | Skeleton fill until `onLoad`; after 8 s without load show `small` muted "Si no se ve, el sitio puede no permitir incrustarse." + ghost small "Abrir". |
| W5 | B | No `pickJsonFile`. | Add it (§9.3) and the web-only "Elegir archivo…" button in the import modal; pasted JSON stays the universal path. |
| W6 | C | `downloadJson(value, filename)` argument order differs from the spec table. | Fine as is; keep the filename pattern `{id}.lienzo-pack.json`. |
| W7 | C | No wheel helper. | `attachWheel` for pan / ⌘-zoom (§6.1); drag-pan and the zoom control must work without it. |

### `logic.ts`

| # | Sev | Finding | Fix |
| --- | --- | --- | --- |
| L1 | A | `diagramLayout` stacks 224×72 nodes in one column, ignores edges, has no layers. This is the essential teaching scenario. | Implement §7.2–7.4 exactly: fixed 136×44 nodes, layers by longest path (array order inside a layer), ≤ 3 columns, row pitch 84, centred rows, orthogonal routes (next row / same row / right rail / dashed left rail for back edges), arrowheads, edge-label pills. Return node rects **and** edge segments so the renderer only draws Views. Signature `(data, innerWidth)`. |
| L2 | A | No list fallback decision. | Return `{ mode: "list" }` when `innerWidth < 296` or `nodes.length > 30` (§7.6). |
| L3 | A | `layoutDocument` gives every block width 288 and keys the diagram estimate on `typeId === "diagram"`. | Width from `tokens.renderers[type.renderer].width` → 592 for `diagram` and `preview-frame` (resolve the type through the catalog). |
| L4 | A | A group without `layout` is treated as `free`, giving the 2-column 176-px guess grid. | Absent layout → `stack` if no child has `position`, else `free` (§6.2). |
| L5 | B | `stack`: default gap 16 and children keep their own width. | Gap `layout.gap ?? 12`; every child stretches to the widest child (a 288 note under a 592 diagram becomes 592). |
| L6 | B | `flow` shares the grid code (wraps every `columns`). | `flow` = one row, gap `?? 28`, with a `ChevronRight` 14 centred in each gap at y = 20 (renderer). `grid` = `columns ?? 2`, max 4, gap `?? 12`; a wide block takes a full row. |
| L7 | B | Root entities without `position` are stacked vertically from (32, 32): a document made by an agent becomes one very tall column. | Unplaced shelf: row-wrap, max width 1400, gap 48, placed below positioned content + 64 (§6.2). |
| L8 | B | Group box ignores the description row and nested metrics. | Add the description height (when non-empty, `small` up to 2 lines + 8) above children; nested groups use header 32 / padding 12; empty group content = 56 px dashed box; collapsed keeps width (min 320). |
| L9 | B | `moveOperations` rewrites a `stack`/`grid`/`flow` group to `free` and pins every sibling when one child is dragged. One drag silently discards the layout the agent (or the user) chose, and later unpositioned blocks no longer flow. | Children of non-free groups are not draggable in v1 (reorder with Subir/Bajar; reparent via inspector or by dropping onto another group, which appends without a position). If "convert to free" is wanted, make it the explicit Disposición → Libre choice in the group inspector. |
| L10 | C | Default block height estimates 176 / 448 before measurement cause a visible jump. | Render blocks at opacity 0 until their first `onLayout`, then lay out; skeleton only for the document load. |

### `design/demo.html`

Ready and verified from root's browser screenshots (`design/review-demo*.png`): Tinta with an edited
preference and the saved state, Papel with the example error state. Palette, three type voices,
`EJEMPLO` chip and the "no se envía nada" notice render as designed. No changes requested.
`?tema=papel|tinta` and `?estado=listo|vacio|cargando|error` pin a state from a `preview` block URL.

## Pass 2 — 2026-10-04, code read of `Blocks.tsx`, `Diagram.tsx`, `Inspector.tsx`, updated `ui.tsx`, `logic.ts`, `web.ts`

**Pass 1 status:** T1, U1–U12, W1–W5, W7, L1–L7 and L9 are fixed. Still open from pass 1: **L8**
(empty-group box and description row in the group rect — re-check with the group frame component),
**L10** (176/448 height guesses before the first measure), **U13** (no `OptionRow`, `Banner`,
`EmptyState`, `Skeleton` primitives yet). Panel, canvas viewport, group frame, catalog, tray, top bar
and all §11 states are still not reviewable.

Only new findings below, highest severity first.

### A — fix before screenshots

| # | File | Finding | Fix |
| --- | --- | --- | --- |
| P2-1 | `Diagram.tsx` | **Arrowheads are hidden.** The chevron is centred on the edge end point (`left: end.x − 3, top: end.y − 3`), so after rotation its two visible strokes lie *inside* the target node, and nodes are opaque and drawn above edges. | Pull the 6×6 box back along the direction of travel so its tip touches the node edge: `down` → `top: end.y − 7`; `up` → `top: end.y + 1`; `right` → `left: end.x − 7`; `left` → `left: end.x + 1` (cross-axis stays `− 3`). |
| P2-2 | `logic.ts` `diagramLayout` | **Left-rail (back) edges are clipped.** `left = Math.min(d.padding, …nodes.x)` is always 12 once nodes are shifted by the rail space, so the rail x is `2 − lane·8` → negative for lanes 1–3. Lanes come from the global edge index (`i % 4`), so even a single back edge can land off-area. | `left = Math.min(...nodes.map(n => n.x))`. Number lanes per side, in edge order, counting only edges that use that rail. |
| P2-3 | `logic.ts` `moveOperations` | Dropping onto a group always sends a `position`. For a group with no `layout`, one positioned child flips the whole group from stack to free (§6.2 default), so a drop scrambles it. | When the target group's effective mode is not `free`, send `entity.move` **without** `position` (append). Only free groups and the root get coordinates. |
| P2-4 | `Blocks.tsx` header | The `Ellipsis` is a full `IconButton` (32 px, 44 on compact) and always visible, so every card header is 32–44 px tall instead of 16 and every card carries a control. | Show it only when the block is selected (or hovered on web): icon 14 in a 20×20 box with `hitSlop` 12. Header row height 16 (24 on compact). |
| P2-5 | `Blocks.tsx` choice/quiz | Options use the text glyphs `●` / `○`, which change size and baseline per platform font. | Use the §4 radio glyph: 16×16 View, radius 8, 1.5 px `border` (selected: `toneColor("violeta")` border + 6 px violeta dot), then the label, gap 8, row `alignItems: "center"`. |
| P2-6 | `Blocks.tsx` card | The halo wrapper has `padding: 3` permanently, so every card is drawn 6 px narrower than its rect (282 / 586) and group padding looks like 19. Unselected and selected cards also differ from the layout maths. | Keep the card exactly at rect size: give the wrapper `margin: −3` (or draw the halo as an absolutely positioned sibling at `inset: −3`), so the halo overhangs. |
| P2-7 | `Inspector.tsx` Ubicación | Parent choices are secondary `Button`s with `active`; secondary and active share the same `surface2` fill, so the current group is indistinguishable. | Option rows (§4): radio glyph + group title, selected = `washStrong("acento")` fill + 1.5 px `accent` border; "Sin grupo" first. |
| P2-8 | `Diagram.tsx` stepper | With no current step the label reads "Paso 0 de N". On compact the row (44 + label + 44 + 160) leaves ~40 px for the label, which wraps or truncates. | No current step → label `{N} PASOS`. On compact (and whenever the block is 288 wide) put the `Todo / Paso a paso` control on its own full-width row under the arrows. |

### B — visible deviations

| # | File | Finding | Fix |
| --- | --- | --- | --- |
| P2-9 | `Blocks.tsx` code | The Copy button sits in its own row above the code, adding an empty 32–44 px band to every code block. | Overlay it: `position: "absolute", top: 4, right: 4`, 26×26; code box padding 8 / 10. |
| P2-10 | `Blocks.tsx` footer | The footer `View` is always rendered, so every card gets an extra 6 px gap at the bottom; the instruction chip and delivery state are stacked. | Render the footer only when it has content; one row: instruction marker left (`Compass` 12 `accent` + `small` "Con instrucción", no chip fill), delivery state right. |
| P2-11 | `Blocks.tsx` preview | Three "open" controls: URL-bar icon, an always-visible ghost "Abrir", and (native) the frame button. | Keep the URL-bar icon; show ghost "Abrir" only together with the 8 s embed hint; native keeps its frame button. |
| P2-12 | `Blocks.tsx` menu | Inline actions mix bordered secondary and ghost buttons, centred labels, no icons, inserted between title and body. | All ghost small, left-aligned, with icons (`PanelRight` Inspeccionar, `CopyPlus` Duplicar, `ChevronUp` Subir, `ChevronDown` Bajar), a 1 px `border` rule, then `Trash2` Eliminar in `statusDanger`. Place the list after the body, not before it. |
| P2-13 | `Blocks.tsx` states | No per-block in-flight or failed rendering; `c.busy` disables every control on the canvas during any mutation. | The block being mutated: opacity 0.7 + footer "Guardando…"; on failure 1 px `statusDanger` border + "No se guardó · Reintentar" (§6.3). Do not grey out unrelated blocks. |
| P2-14 | `Diagram.tsx` list fallback | The rail line lives inside each padded row and rows have `gap: 10`, so the line is broken between markers. The marker number is not vertically centred and the current marker keeps a `border`-coloured ring. | No gap between rows; put the 10 px spacing as bottom padding of the text column so the 1.5 px line runs marker to marker. Marker: `justifyContent: "center"`; current = `accent` border and fill. |
| P2-15 | `Diagram.tsx` invalid data | Dumps the whole `data` JSON unclamped. | `CircleAlert` 12 `statusDanger` + "Datos de diagrama no válidos", then the JSON in a `code` box, `numberOfLines={4}`. |
| P2-16 | `Inspector.tsx` communication | Inherited levels print the full instruction text (up to 8 000 characters each). No way to remove an entity's instruction. | One row per level: `Compass` 12 + "Grupo «…»" / "Documento", `numberOfLines={2}` preview in `small` muted, press selects that level. Add ghost small "Quitar instrucción" on block/group scope. |
| P2-17 | `Inspector.tsx` footer | Copiar ID, Duplicar, Guardar como plantilla, Desagrupar and Eliminar are one stack of full-width buttons inside "Datos". | "Datos": mono `label` key + `code` value rows, `Copy` icon button on the ID row. Then a separate footer: secondary actions in a wrapping row, the danger button last on its own row. |
| P2-18 | `Inspector.tsx` multi-selection | "Exportar selección como pack" is not in v2 (there is no selection-export RPC); selected items are centred ghost buttons. | Remove that button. Rows = type icon 14 + title, left-aligned; actions: secondary "Agrupar", danger "Eliminar". |
| P2-19 | `Inspector.tsx` Disposición | The control shows `stack` when `layout` is absent even if the group is effectively free; its label is a plain `small`. | Use the same effective-mode rule as `layoutDocument`; label in `small` 600 like other field labels. |
| P2-20 | `logic.ts` | An empty group measures header + padding only. | Empty group inner height = 56 (the dashed "Grupo vacío…" box, §6.6). |

### C — polish

- `Blocks.tsx`: `callout` and `step` fall back to plain note text; give `callout` its wash + severity icon and `step` its marker (§6.3) when pack types use them. `metric`: unit in `small`, not `display`.
- `Blocks.tsx` media: reference row should have the 32×32 `wash("turquesa")` tile and a trailing `ExternalLink` icon button instead of a separate "Abrir referencia" button.
- `Diagram.tsx`: no enter animation for added nodes/edges (opacity 0→1, translateY 6→0, 260 ms; none under reduce motion).
- `Diagram.tsx`: single-side dashed borders for back edges — verify on Android in the screenshots; if they render solid, draw dashes as 4 px Views with 3 px gaps.
- `Inspector.tsx`: document and group "Título" inputs should use the serif family; history times relative ("hace 2 h"); undo/redo rows italic; loading state as two skeleton lines; "Contenido" of an empty group needs `small` muted "Grupo vacío".
- `ui.tsx`: primary button has no hover feedback (opacity 0.92).

## Pass 3 — 2026-10-05, code read of `Panel.tsx`, `Canvas.tsx`, `Catalog.tsx`, `AgentModal.tsx` (+ re-check of pass 2)

`Panel.tsx` was still being edited by the integrator during this read (229 → 248 lines).

**Pass 2 status (code):** P2-1 … P2-8 fixed. Also fixed: P2-9, P2-13, P2-15, P2-18, P2-20, L8, L10.
Partly open: **P2-16** (inherited text is clamped to 4 lines, but no row-per-level press-to-select
and no "Quitar instrucción"), **P2-17** ("Datos" is still `ID …` text + stacked buttons).

### A — fix before screenshots

| # | File | Finding | Fix |
| --- | --- | --- | --- |
| P3-1 | `Panel.tsx` | **The designed loading and document-row components exist but are not used.** `LoadingDocument` (pulsing skeleton, reduce-motion, "Sigue cargando…") and `DocumentRow` are defined; the render still uses the inline "Cargando documento…" text + three static boxes, and the Documentos modal lists secondary `Button`s labelled "título · REV n". | Render `<LoadingDocument />` for `c.loading`. In the Documentos modal render `<DocumentRow>` under the eyebrows "TUS DOCUMENTOS" / "EJEMPLOS"; delete the inline versions. |
| P3-2 | `Panel.tsx` | **Empty / no-document / error states are one left-aligned column with a bare 24 px icon.** The load-error case reuses the no-documents layout: headline "No se pudo abrir el documento" followed by the "PASEO CANVAS" label and a primary "Crear documento" — no message, no retry. | One `EmptyState` component (§11): centred, max width 380, 56×56 tile (radius 14, `wash` + icon 24), serif `display` headline, `body` muted text, actions. Three uses: *no documents* (tile `acento`/`Frame`, "Lienzo", label "PASEO CANVAS", primary "Crear documento", eyebrow "EJEMPLOS" + ghost rows each with the chip **inline**); *empty document*; *load error* (tile `riesgo`/`CircleAlert`, real message in a selectable `code` box, primary "Reintentar", ghost "Copiar detalle" — no "PASEO CANVAS", no "Crear documento"). |
| P3-3 | `Panel.tsx` | **Offline and "recarga el agente" notices are unstyled text + a button** sitting on the canvas background, next to a properly framed failure banner. | One `Banner` component: `surface1`, radius 10, padding 12, 1.5 px border, leading 16 px icon, `bodyStrong` title, `small` text, action row; max width 560, centred. Conflict = `statusWarning` + `GitCompareArrows`; save failed = `statusDanger` + `CircleAlert`; offline = `border` colour + `Unplug`; reload = `accent` + `Info`. |
| P3-4 | `Canvas.tsx` | **Group header can overflow its reserved height.** The collapse chevron is an `IconButton` (32 px; 44 px when `layout.compact`) inside a header that the layout reserves at 36 / 32 (nested). Nested headers and every header on compact canvas push into the first child. | Chevron = 20×20 `Pressable` with `hitSlop` 12, icon 14. Header rows must be exactly 36 / 32. |
| P3-5 | `Canvas.tsx` | Group ordinal uses the index in the depth-sorted list of **all** groups, so nested groups show the wrong number (the outline computes it correctly per parent). | Ordinal = index among siblings: position in the parent's `groupIds`, or among root groups. |
| P3-6 | `Catalog.tsx` `PackImport` | **The import review hides part of the diff**: every kind is cut with `slice(0, 5)` and nothing says more exist. A user can replace items they never saw. | Show every `added` and `replaced` id (scroll if long). Only `unchanged` collapses, with "y {n} sin cambios". When the pack id already exists and "Reemplazar" is unchecked, explain the disabled button: `small` muted "Este pack ya está instalado. Marca «Reemplazar los que ya existen» para continuar." |
| P3-7 | `AgentModal.tsx` | **The connection is shown as a raw id** ("Conectado a 0d5e8061-…"), and agent rows show the raw English status enum. The connected agent is not marked in the list. | Current connection: agent title (`useAgent`) in `bodyStrong`, provider in mono `label`, id in `code` muted below. List = option rows (§4): radio selected on the connected agent, title, provider label, status dot + Spanish word (`idle` "inactivo", `running` "trabajando", `error` "con error", `closed` "cerrado", `initializing` "iniciando"). Pressing a row connects; "Desconectar" stays a danger ghost under the list. |

### B — visible deviations

| # | File | Finding | Fix |
| --- | --- | --- | --- |
| P3-8 | `Panel.tsx` top bar | "Más acciones" (`Ellipsis`) is shown on every layout; on wide it duplicates undo, redo, catalog and agent, which are already in the bar. Its modal is a stack of centred secondary buttons. | Show it on compact only (and medium if the bar overflows). Modal rows: ghost, left-aligned, icon + label (`Undo2`, `Redo2`, `LibraryBig`, `Compass`, `Plug`, `FileInput`). |
| P3-9 | `Panel.tsx` medium overlay | A full-width ghost "Cerrar catálogo" button is stacked above the catalog; the overlay top is hard-coded to 48. | `X` icon button in the catalog header row (like the inspector); top = the bar's measured height. |
| P3-10 | `Panel.tsx` tray | "Inspeccionar" is shown on wide too, where the inspector is already open. The "Datos de la acción" modal has no trigger. | Show "Inspeccionar" only when not wide. Either remove the dead modal or open it from a ghost `Eye` icon button ("Ver datos de la acción") before the send button. |
| P3-11 | `Canvas.tsx` group frame | No 1 px rule under the group header; a selected group has no halo; the selected-group `Ellipsis` actually opens the inspector. | Header `borderBottomWidth: 1` (`border`), none when collapsed. Selected: halo overhang like blocks (radius 17). Use `PanelRight` for "Inspeccionar grupo". |
| P3-12 | `Canvas.tsx` zoom control | The percentage is a bare `label` text: ~14 px tall target, no padding. | `Pressable` min height 24, padding H 6, centred. |
| P3-13 | `Catalog.tsx` pack card | Chip, id, per-document "Crear documento", "Exportar" and "Quitar" are all stacked full-width. | Row 1 icon + name + `EJEMPLO` chip; row 2 mono id; description; counts; one row per document (title flex 1 + ghost small "Crear documento"); last row: ghost small "Exportar" and danger ghost small "Quitar" side by side. |
| P3-14 | `Catalog.tsx` `PackExport` | Two ghost buttons toggle "referencia protegida" / "copia portable". | A segmented control `Copia portable | Referencia`, default portable; keep the explanatory `wash("aviso")` text. |
| P3-15 | `Inspector.tsx` | P2-16 and P2-17 remainders (see status above). | As written in pass 2, except: "Quitar instrucción" is replaced by **"Vaciar instrucción"** (the schema cannot remove `communication`). It writes three empty strings, and an all-empty communication is treated as absent everywhere — see `docs/design.md` §10. |

### C — polish

- `Catalog.tsx`: "Definir tipo local" (raw JSON editor over `type.put`) is outside the v2 visual spec. Acceptable as an advanced action; keep it ghost small and move it below the type list so the first thing in the rail is the list, not an editor.
- `Catalog.tsx`: search input has no leading `Search` icon; "Cargando catálogo…" should be two skeleton cards.
- `Panel.tsx` `Presence`: fine; add `wash("neutro")` chip background so it reads as a control.
- `Canvas.tsx`: `PanResponder.create` runs per block per render inside `draggable()`; memoise per id if drag feels heavy in the screenshots pass.

## Pass 3 status — 2026-10-05, code re-check (still no plugin screenshot viewed)

Confirmed fixed **in code**: P3-4, P3-5, P3-6, P3-7, P3-11, P3-12, P3-14, P3-15 (including "Vaciar
instrucción" with a shared `hasCommunication` used by `Inspector`, `Blocks` and `Canvas`).
`Panel.tsx` now references `LoadingDocument`, `DocumentRow`, `EmptyState` and `Banner` (P3-1 – P3-3);
their composition was not re-read line by line. Not re-checked: P3-8, P3-9, P3-10, P3-13.
No open A-severity item is known from code. Every visual claim in this file remains unverified
until the installed-plugin screenshots are reviewed.

## Pass 4 — 2026-10-05, **viewed** installed plugin (wide, foreign dark host theme)

Seen working as designed: top bar (serif title, `EJEMPLO` chip, `REV` chip with dot, undo/redo, view
toggle, agent chip), catalog rail and type cards with tone tiles, group frame with ordinal + serif
title + count, block cards with spines and mono type labels, selected-block accent border, code box
with overlaid copy, inspector sections, "Ubicación" option rows, inherited-instruction rows,
communication editor wash, context tray with removable chip and no-agent state, no-documents tile
state, agent modal with Spanish statuses. No agent turn was started by selecting. The three type
voices hold under a foreign theme.

Material visible issues only:

| # | Sev | Owner | Seen in | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| V1 | A | frontend · `Diagram.tsx` / `logic.ts` | all canvas shots | **Diagram edge labels collide.** The two labels of a fan-out ("Respuesta correcta", "Solicitud fallida") sit on adjacent halves of the same horizontal line and overlap into "Respuesta corre Solicitud fallida". | Spec change (§7.3): a next-row edge's label is centred on the **target's centre x**, in the lower part of the gap, max width 136 (node width), so sibling labels can never touch. When any edge has a label use `gapY = 48`: horizontal run at source bottom + 16, label centre at source bottom + 30, arrowhead in the last 7 px. Without labels keep `gapY = 40`. |
| V2 | A | frontend · `ui.tsx` (`OptionRow`, `CheckRow`, radios in `Blocks.tsx`) | selected-note, agents, learning | **Unselected radio and checkbox glyphs are invisible.** "Sin grupo", the three answer options, every agent row and the "Dar las herramientas…" checkbox show an empty gap where the glyph should be: its 1.5 px ring uses `border`, which has no contrast on `surface2`/`surface1` in this host theme. | Unselected glyph ring = `withAlpha(foregroundMuted, 0.7)` (spec §4 updated). Selected stays tone-coloured. |
| V3 | A | frontend · `Canvas.tsx` | all canvas shots | **A document opens at 60 %**: fit-all on a tall stack makes body text ~8 px, unreadable, with two thirds of the viewport empty. | Spec change (§6.1): on first open, `scale = clamp((vw − 96) / contentWidth, 0.8, 1)`, content horizontally centred, top of content at 48 px. The `Maximize` button keeps fitting everything (min 0.4). |
| V4 | A | backend · `plugin/shared/builtins.ts` | selected-note, undo | **Inspector shows the raw property key as the field label: "text \*".** `property(key, …)` sets `label: key`. | Spanish labels in the built-in types: `text` Texto · `code` Código · `language` Lenguaje · `items` Elementos · `question` Pregunta · `options` Opciones · `answer` Respuesta · `current` Actual · `total` Total · `description` Descripción · `url` URL · `caption` Pie · `mediaKind` Tipo de recurso · `nodes` Nodos · `edges` Conexiones. |
| V5 | B | integrator · `Panel.tsx` | qa-empty | Example rows in the no-documents state: the chip sits alone on a left-aligned line, the title is centred below it, and the title reads "Ejemplo: Ejemplo: revisión de una pantalla" (prefix doubled). | One left-aligned row per example inside the 380 column: chip, gap 8, title (`bodyStrong`, ghost press). Use the document title as is — do not prepend "Ejemplo:". |
| V6 | B | frontend · `Diagram.tsx` | all canvas shots | "Paso a paso" wraps onto two lines inside its segment. | Segmented control width 200 (was 160), labels `numberOfLines={1}`. |
| V7 | B | frontend · `ui.tsx` | native-learning, undo | The focus ring stays on Undo after a mouse click (2 px accent box around the icon). | Show the focus style only for keyboard focus: keep a "last input was keyboard" flag in `web.ts` (set on `keydown` Tab/arrows, cleared on `pointerdown`) and apply the ring only when it is set; on native never. |

**Pass 4 status (reported, not yet re-viewed):** the frontend reports V1, V2, V3, V6 and V7 applied
with tokens re-transcribed, typecheck green and 10/10 regressions (including fan-out label
separation and initial-camera geometry). The designer has confirmed only that the new token keys are
referenced in `plugin/client`; **none of these fixes has been seen rendered**. V4 (backend labels)
and V5 (Panel example rows) have no report yet. All seven stay open until new screenshots are reviewed.

Not judged yet (needs more screenshots): light theme and Lienzo Papel/Tinta, diagram at 100 % with a
current step and "Paso a paso", outline and compact, medium overlays, pack import/export, preview
and media blocks, conflict/offline banners, delivery states with a connected agent.

## Pass 5 — 2026-10-05, final rendered audit (latest build)

**Pass-4 items, as seen:**

| # | Status | Evidence |
| --- | --- | --- |
| V2 radio/checkbox rings | **Fixed, viewed** | `qa-live-tailnet`: "Sin grupo" / group radios and checklist boxes are visible |
| V3 initial zoom | **Fixed, viewed** (80 %, readable) — but see F1 | `qa-live-tailnet`, `native-feedback-sent` |
| V4 Spanish property labels | **Fixed, viewed** | "Nodos \*", "Conexiones \*", "Pie" in both inspectors |
| V6 "Paso a paso" on one line | **Fixed, viewed** | `qa-live-tailnet`, `native-feedback-sent` |
| V1 fan-out edge labels | **Not verifiable** — the live diagram has no edge labels | Covered by a unit test only |
| V5 no-documents example rows | **Not re-viewed** (no new empty-state screenshot) | — |
| V7 focus ring after mouse click | **Not contradicted** — no stray ring in the latest shot; not specifically exercised | — |

**Newly confirmed by viewing:** diagram at 80 % — fixed-size nodes, orthogonal connectors, visible
arrowheads, and a dashed back edge on the left rail (dashed single-side borders render in Chromium);
`preview` block with URL bar, `EN VIVO` qualifier and the embedded demo page; checklist block;
delivery states "Enviado · 22:14" (wide) and "Recibido por el agente" (compact, real `acked`);
connected-agent chip; pack import review and export modal ("Descargar JSON" primary, "Copiar"
secondary, size in "0,6 KB"); compact outline with the diagram's connected-list fallback, the
bottom tray with a 44 px primary, and the inspector as a sheet.

**Remaining material findings (rendered):**

| # | Sev | Owner | Seen in | Finding | Fix |
| --- | --- | --- | --- | --- | --- |
| F1 | A | frontend · `Canvas.tsx` | `qa-live-tailnet`, `native-feedback-sent` | With two root groups the content is wider than the viewport at the clamped scale, and it is centred — so the **first group is cut off on the left** ("…dos de una UI", "…IAGRAMA", group title starting off-screen). Reading starts mid-word. (If root had panned before capturing, disregard; both captures show the same cut.) | First open: if `contentWidth · s > vw − 96`, do not centre — align the content's left edge at 48 px (top stays 48). Centre only when it fits. Spec §6.1 updated. |
| F2 | B | integrator · `Panel.tsx` | `native-compact` | The view toggle truncates its active label: "Lienzo / Esqu…". | Compact toggle width 168 (was 126), labels one line; the title already flexes and truncates. |
| F3 | B | integrator · `Panel.tsx` / `Inspector` | `native-compact-inspector` | The inspector sheet has two headers and two close buttons: the Modal's "Inspector ✕" and the inspector's own "BLOQUE · título ✕". | On compact do not pass `onClose` to `Inspector` (the sheet's ✕ and drag handle close it); keep the inspector's eyebrow + name row without the second ✕. |

Polish seen, not blocking: JSON property fields ("Nodos", "Conexiones") are three lines tall — give
`json` fields a 120 px minimum; the agent chip truncates its title at ~110 px on wide where there is
room for 160.

**Open from code review, never seen rendered** (carry into any later pass): P3-8, P3-9, P3-10, P3-13;
light/Papel/Tinta appearance; everything in the "Not viewed" rows of the evidence table.

## Pass 6 — 2026-10-05, final evidence (latest build, light host + compact)

| # | Status | Evidence |
| --- | --- | --- |
| F1 first group cut off on open | **Fixed, viewed** | `native-live-light`: content starts at the left inset, group 01 fully visible, group 02 runs off to the right as intended |
| F2 compact toggle truncated | **Fixed, viewed** | `native-compact`: "Lienzo / Esquema" in full |
| F3 double header in compact inspector | **Fixed, viewed** | `native-compact-inspector`: one sheet header with one ✕, then eyebrow + name without a second ✕ |
| V1 fan-out edge labels | **Fixed, viewed** | `native-light`: "Respuesta correcta" and "Solicitud fallida" sit above their own targets, clear of each other and of the arrowheads |
| V5 no-documents example rows | Not re-viewed | — |
| V7 focus ring | Not exercised; no stray ring in any new shot | — |

**No material visual finding remains open from what has been viewed.**

Polish only, not blocking: the compact catalog sheet repeats its title ("Catálogo local" as sheet
title and again as the mono eyebrow) — drop the eyebrow inside the sheet; JSON property fields are
three lines tall (120 px minimum would be kinder); in `native-compact-catalog` (earlier build) the
toggle still read "Esqu…", superseded by F2.

Unverified scope is exactly the "Not viewed" rows of the evidence table, plus P3-8, P3-9, P3-10 and
P3-13 from code review.

## Pass 7 — 2026-10-05, supplemental evidence (docs closed for commit)

Viewed: `native-medium-inspector.png`, `native-compact-documents.png`, `native-media-preview.png`,
`native-media.png`. All four match the design; evidence table updated above.

- **Medium:** the inspector opens as a right-hand overlay over a scrim with a single ✕; the top bar
  keeps revision, undo/redo, view toggle, agent chip and the inspector toggle on one line (the
  document title truncates first, as intended).
- **Preview:** the full iframe renders the HTTPS demo page inside the block, with URL bar,
  `EN VIVO` qualifier, external-open icon and description.
- **Media:** the body is fully visible — nothing clipped.
- **Compact documents sheet:** document rows are as designed (serif title, `EJEMPLO` chip,
  "REV n · hace …", check on the open one).

One recorded deviation, **not fixed by decision (scope closed):**

| # | Sev | Owner | Seen in | Finding | Fix when next touched |
| --- | --- | --- | --- | --- | --- |
| D1 | B | integrator · `Panel.tsx` | `native-compact-documents` | The two "create from example" entries show the `EJEMPLO` chip alone on a left-aligned line with a centred label below it ("Crear Ejemplo: …") — the same pattern as V5 in the no-documents state. | One left-aligned row: chip, gap 8, label; or a ghost small "Crear copia" at the end of each example row. |

## Final state

- **Material findings open from viewed UI: none.** A-severity items from all passes are fixed, and
  each fix was viewed except V5 and V7 (reported fixed, not re-viewed).
- **Known, accepted B/C deviations:** D1; the repeated "Catálogo local" title in the compact catalog
  sheet; three-line JSON property fields; P3-8, P3-9, P3-10, P3-13 (code review only, never seen).
- **Not verified:** Lienzo Papel / Lienzo Tinta applied to the plugin, and every row marked
  "Not viewed" in the evidence table. Nothing in this document should be read as covering them.

## Appendix — original screenshot checklist (kept for future passes)

1. Three typographic voices are used as specified (serif only on document/group titles, headlines, metric values).
2. `EJEMPLO` chip in top bar, documents modal and outline header for both built-in examples.
3. Block card: spine, header label = `BlockType.name`, selected halo without content shift.
4. Group frame: neutral fill, ordinal, count, template chip, collapsed state.
5. Diagram: current step, "Paso a paso" ghosts, detail strip, list fallback on compact.
6. Preview: iframe on web with overlay; native placeholder; conceptual box without URL.
7. Tray: no "Enviado" before the RPC resolves; `pending` shows "En cola"; no-agent state.
8. Conflict banner, load error, empty document, no documents, loading skeleton.
9. Light and dark under Lienzo Papel/Tinta **and** one foreign host theme (text never in a tone colour).
10. Compact: outline default, sheets, 44 px targets, no horizontal overflow in the top bar.
