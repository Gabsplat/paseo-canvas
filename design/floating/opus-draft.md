# Borrador recuperado de Opus

Fragmentos parciales recuperados de /tmp/lz. No son la especificación vigente; docs/design.md contiene el contrato completo revisado por Sol.

# Lienzo — visual design specification (v6, floating interface)

Owner: visual designer (Opus). Audience: the engineers of `plugin/client/`. Normative. Field,
operation and RPC names are the ones in `plugin/shared/model.ts`, `rpc.ts` and `builtins.ts`; if
those files change, **they win on names and shapes, this file wins on how things look and behave**.

| Artifact | Role |
| --- | --- |
| `design/tokens.json` (v6) | Numbers, colours, font styles and icon names. Transcribed into `plugin/client/tokens.ts`. |
| `design/floating/mockup.html` | Static picture of §3–§5, §8–§11 and §18 in Papel and Tinta. A picture of the target, not an implementation; where it and this file differ, this file wins. |
| `design/floating/hints.svg` | The three hand-drawn hint arrows of the empty canvas (§11.1). |
| `design/floating/contrast.py` | Contrast check of every new colour pair; must exit 0. |
| `design/demo.html` | Example content for the `preview` block, not a mock of the plugin. |
| `design/graph-harness/real/` | Real RN canvas components under react-native-web with example data. |
| `docs/design-audit.md` | Designer's review of the implemented UI. |

**Map of this file.** §1 identity · §2 platform · §3 regions and widths · §4 primitives and controls ·
§5 contextual toolbar and popovers · §6 canvas, blocks, groups · §7 diagram block · §8 direct
manipulation (in-place editing, `+` handles, quick-create) · §9 adding blocks, collections, Lista ·
§10 assistant composer · §11 states and first run · §12 keyboard · §13 accessibility · §15 graph ·
§16 dragging and motion · §17 media, sizes, link magnetism · §18 interactive learning blocks ·
§19 copy.

Not in the contract, therefore **not designed and must not be rendered**: per-block author glyphs,
per-block tone overrides, group resize handles. §18 describes block kinds whose data shapes are
still to be published by the backend; it fixes their look and behaviour, not their field names.

---

## 1. Identity

- **Name:** *Lienzo*. A document is called **un lienzo** everywhere in the interface.
- **Idea:** a drafting table shared by a person and an assistant. Paper surface, ink text, one
  blueprint-blue accent. Blocks are index cards; groups are frames. No gradients, no glows.
- **Three depths, one rule each.**
  1. *On the table* — cards and frames: a surface step and a 1 px border, never a shadow.
  2. *In the hand* — a card being dragged: lift shadow (§16).
  3. *Above the table* — everything that is interface and not content (islands, the contextual
     toolbar, popovers, menus, tooltips): `elevation.*` shadows. **A shadow at rest always means
     "this is a control, not part of your canvas".**
- **Simplicity rules** (each one is checkable in review):
  - At rest the canvas shows four small islands and nothing else (§3). Nothing is docked.
  - A control appears next to the thing it changes, and only while that thing is selected.
  - No confirmation dialogs. Every change is one undoable transaction with a Spanish label.
  - No modes that outlive their visible control: the only tool states are *editing text* (a visible
    caret) and a learning block's *pencil* (a visibly pressed button). `Esc` leaves both.
  - Never show identifiers, revision numbers, coordinates or pixel sizes.
  - A field has a label only inside a form with more than one field (the Datos popover, §5.3).
- **Language:** Spanish, sentence case, no exclamation marks, no emoji. Interface text is
  **impersonal**: buttons and menu rows are infinitives ("Añadir nota"), hints are noun phrases
  ("Doble clic para escribir una idea"). It never conjugates in the second person, so it reads the
  same for "tú" and "vos" readers. The complete string list is §19.
- **Vocabulary** (the only nouns the interface uses): lienzo · bloque · grupo · conexión ·
  asistente · instrucción · plantilla · colección · variable. Not used: documento, agente, nodo
  (except as the type name the catalog supplies), enlace, pack, inspector, catálogo, revisión.
- **Three typographic voices:**
  - **Serif** — names people author: lienzo title, group title, empty-canvas headline, metric value;
    in italics, the hint annotations of the empty canvas.
  - **Sans (system)** — everything you read or press, including `label` (11/14, 600, sentence
    case), which names types and sections.
  - **Mono** — only what is literally code or keys: `code` (code, URLs, JSON, shader source) and
    `keys` (shortcuts in tooltips and menus).
- **Hand-drawn accent:** exactly one, the hint arrows of the empty canvas (§11.1). They are drawn
  by hand because that marks them as a temporary annotation on top of the interface and not as part
  of it; they never appear near learning content, where decoration costs comprehension.
- **Honesty rules:**
  - `document.example === true` → chip "Ejemplo" (`FlaskConical` 12, tone `aviso`) after the title in
    the document island, the Lienzos list and the Lista header. Not dismissible.
  - Assistant activity is drawn only from real signals: `useAgent(...).status`, `AgentEvent.status`,
    `readHistory` transactions. No typing dots, no optimistic "Enviado".
  - `progress` blocks show declared numbers; never animate them as if work were happening.
  - An interactive block never plays, sounds or reveals by itself (§18.1).


## 3. Regions

Workspace panel (`context: "workspace"`). Title "Lienzo", icon `Frame`. Measure the root with
`onLayout`; never `Dimensions`. **The canvas fills the whole panel.** Nothing is docked on
non-compact layouts: there is no top bar, no side rail, no inspector and no tray.

### 3.1 Region map (not compact)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ┌─A─────────────────────┐        ┌─B──────────┐                        │
│ │ ☰  Título ▾  │  ↶  ↷ │        │ ▭  ◉  ▢  ＋ │                        │
│ └───────────────────────┘        └────────────┘                        │
│                              (banners, §11)                            │
│                                                                        │
│               ┌─toolbar (only with a selection, §5)─┐                  │
│               └─────────────────────────────────────┘                  │
│                        ┏━━━━━━━━━━━━━┓                                 │
│                        ┃  selection  ┃ ⊕                               │
│                        ┗━━━━━━━━━━━━━┛                                 │
│                                                                        │
│                   ┌─C───────────────────────────┐          ┌─D───────┐ │
│                   │ ● Escribir al asistente…  ↑ │          │ − 80% + │ │
│                   └─────────────────────────────┘          └─────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

Four persistent islands, each inset `island.inset` 12 from the panel edges. All four use the
`Island` primitive (§4.1). Nothing else is visible at rest.

| | Island | Position | Content, left → right |
| --- | --- | --- | --- |
| **A** | Lienzo | top-left | `Menu` button → main menu (§3.2) · **title** (serif `groupTitle`, one line, max 280, min 96, pad H 8; `ChevronDown` 12 muted after it) · chip "Ejemplo" if example · save dot (below) · divider · `Undo2` · `Redo2` (disabled by `view.canUndo` / `view.canRedo`) |
| **B** | Añadir | top-centre | three `tool` buttons (40) for the types `note`, `node` and a new group, then `Plus` → block picker (§9.1). Icon and tooltip name come from the catalog type (`tokens.renderers[*].icon`, `BlockType.name`); the group button is `Group` "Grupo". |
| **C** | Asistente | bottom-centre | the composer (§10) |
| **D** | Vista | bottom-right | `Minus` · percent (`value` style, min width 48, centred) · `Plus` |

- **A · title.** Press → popover "Lienzos" (§5.4). Double-click (or `F2` with nothing selected) →
  rename in place with the inline editor (§8.1), history label "Renombrar lienzo".
- **A · save dot.** 6 px, shown only when it has something to say: `statusWarning` while a mutation
  is in flight for more than 400 ms; `statusDanger` after a failed one (press → the banner, §11).
  In sync shows nothing. It has an `accessibilityLabel` ("Guardando" / "No se guardó").
- **B · press** creates the block and starts editing its first text (§8.1). Where: inside the group
  when exactly one group is selected; next to the block when exactly one block is selected (same
  parent, at `graph.gap.node` to its right, **not** connected); otherwise at the centre of the
  visible canvas. The camera pans the minimum needed to show it. **B · drag** (pointer devices): a
  0.92-opacity card of the type's default size follows the pointer from the button and is created
  where it is dropped, into the group under the pointer (same drop feedback as §6.2).
- **D · percent.** Press → menu: Ajustar todo (`1`), Ajustar a la selección (`2`, disabled without
  one), Tamaño real 100 % (`0`), separator, Solo lienzo (`F`). `Minus`/`Plus` step through
  `canvas.zoomSteps` and disable at the limits.
- **Solo lienzo** hides A, B and C. D stays and gains a leading `Minimize2` button "Mostrar
  controles" (`Esc` or `F` also leave). Banners stay visible.
- **Safe area.** Fit and fit-selection inset the viewport by top 68, bottom 72, left/right 48 so
  content never comes to rest under an island. Starting an in-place edit pans the minimum needed to
  bring the edited text inside that area.
- **Occlusion while dragging.** While an entity is being dragged and the pointer is inside an
  island's rectangle inflated by 8, that island drops to opacity 0.35 with `pointerEvents: "none"`
  until the drag ends, so a card can be dropped underneath it. Islands never move.
- **Z-order,** bottom to top: canvas (§6.1 order) · `+` handles and resize grip · contextual toolbar ·
  islands · banners · popover or menu · tooltip · host `Modal` and toasts.
- **At most one popover or menu is open.** Opening another closes the first.

### 3.2 Main menu (`Menu` on island A)

A `Menu` (§4.5), anchored below-left of the button. Rows, in order:

| Row | Icon | Keys | Does |
| --- | --- | --- | --- |
| Lienzos | `Frame` | | Popover "Lienzos" (§5.4) |
| Nuevo lienzo | `Plus` | | Creates "Lienzo sin título" and opens it, title in edit mode |
| Duplicar lienzo | `CopyPlus` | | For an example the row reads "Guardar una copia propia" |
| — | | | |
| Ajustes del lienzo | `SlidersHorizontal` | | Popover (§5.3) |
| Ver como lista / Ver como lienzo | `ListTree` / `Frame` | `⇧L` | Switches view (§9.4) |
| Historial | `History` | | Popover (§5.4) |
| — | | | |
| Colecciones | `Package` | | Host modal (§9.2) |
| Asistente | `Bot` | | Same popover as the composer's status button (§10.3) |
| — | | | |
| Atajos de teclado | `Keyboard` | `?` | Popover listing §12 |
| Guía de Lienzo | `BookOpen` | | The guide (§17.1) |

### 3.3 Narrower panels (not compact)

Nothing docks or undocks; thresholds only resolve collisions. Measure the panel width `w`.

| `w` | Change |
| --- | --- |
| ≥ 880 | As above. Composer rest width 360, max 560. |
| 560 – 879 | Title max 160. Island D shows only the percent button (its menu gains "Acercar" and "Alejar"). Composer max = `w − 2 · (88 + 12)`. |
| < 560 | Island B shows only `Plus` (the picker lists the three quick types first). Island A drops Redo (it moves into the main menu). Composer width = `w − 24 − 88`, left-aligned at 12; D keeps the percent button. |

The title is the element that shrinks first inside A; B is centred on the panel but never closer
than 8 to A (it then sits to the right of A).

### 3.4 Compact (`layout.compact`)

A phone cannot give four islands room, and there is no hover. Compact therefore **docks** the same
elements and defaults to the **Lista** view (§9.4):

```
┌ Top bar 52 (surface1, bottom border) ───────────┐
│ ☰   Título ▾ [Ejemplo]              ↶    ＋     │
├─────────────────────────────────────────────────┤
│ Lista (scrolls)                                 │
├ Action bar 48 — only with a selection (§5.1) ───┤
├ Composer, docked, full width (§10) ─────────────┤
└─────────────────────────────────────────────────┘
```

- Top bar: `Menu` · title (press → "Lienzos" sheet) · spacer · `Undo2` · `Plus` (picker sheet). Redo
  is in the main menu.
- Every `Popover` and `Menu` is presented as a host `Modal` sheet with the same content.
- Controls are 44 high, icon buttons 44×44, body text 14/21 (`font.compactBump`).
- "Ver como lienzo" shows the free canvas read-mostly: pan, island D (above the composer), tap to
  select, action bar. No dragging, no handles, no in-place editing; "Editar" in the action bar opens
  the Datos sheet.

### 3.5 Touch on a non-compact layout (tablets)

Detected per interaction (`pointerType === "touch"`, or native), not per device.

- No tooltips. Every icon-only action also exists, with its name, in the "Más" menu or main menu.
- Island and toolbar buttons use `sizeTouch` 44. `+` handles use `hitTouch` 44 and appear on
  selection only (there is no hover).
- Tap selects. Double-tap edits (§8.1). Long-press 500 ms on an entity adds it to the selection;
  long-press on empty canvas is quick-create (§8.3). Two-finger drag pans, pinch zooms where the
  platform delivers it.
- Scrubbable numbers open a stepper popover on tap (§18.4).


## 4. Primitives and controls

Seven primitives are built once in `ui.tsx` and reused by everything in §3, §5, §8–§10 and §18.
Sizes are in `tokens.island`, `toolbar`, `popover`, `menu`, `tooltip`, `contextChip`,
`inlineEditor`. Public props are a suggestion; anatomy, sizes and states are normative.

**Shared interaction states** (all pressable primitives): rest · hover (web pointer) `foreground`@0.06 ·
pressed `foreground`@0.10 and visual scale 0.97 over 100 ms (hit area fixed) · keyboard focus 2 px
`accent` ring inside the bounds, shown only when the last input was the keyboard · disabled opacity
0.45, no hover · *active* (toggled on, or its popover is open): fill `accent`@0.14, icon `accent`.

### 4.1 `Island`

The only floating surface. `View` with fill `surface1`, radius 12, padding 4, row, gap 2,
`alignItems: "center"`.

- **Elevation.** `boxShadow` built from `elevation.hairline` (a 0 0 0 1 px ring: `foreground`@0.10
  on light surfaces, `border` on dark) plus the layers of `elevation.island` — light
  `0 1px 2px ink@.06, 0 6px 16px ink@.08`; dark `0 2px 4px #000@.30, 0 8px 24px #000@.40`. Light or
  dark is `isDark(surface0)`; ink is `theme.colors.foreground`. Where `boxShadow` is unavailable:
  1 px `border` + `elevation` 3.
- Props: `elevation?: "island" | "popover"` (the contextual toolbar, popovers and menus use
  `popover`: light `0 2px 6px ink@.08, 0 12px 32px ink@.12`; dark `0 4px 8px #000@.35,
  0 16px 40px #000@.50`), `vertical?`, `style`.
- `Island.Divider`: 1 × 20, `border`, margin H 4.
- An island never scrolls and never wraps. If its content cannot fit, §3.3 says what is dropped.
- `accessibilityRole="toolbar"` with an `accessibilityLabel` ("Lienzo", "Añadir", "Asistente",
  "Vista"). `pointerEvents="box-none"` on its positioning wrapper so the canvas stays reachable
  around it.

### 4.2 `IconButton` (with tooltip)

Replaces the current `IconButton`. One component, three sizes: `island` 36×36 with icon 18,
`tool` 40×40 with icon 20, `inline` 28×28 with icon 16 (inside cards and popovers). Touch and
compact: 44×44 hit, visual unchanged. Radius 8. Icon `foregroundMuted`; hover and pressed
`foreground`; active `accent`.

- Required props: `icon`, `label` (also the `accessibilityLabel` and the tooltip text). Optional:
  `keys` (shortcut, e.g. `"N"`, `"⌘Z"`), `active`, `disabled`, `tone="danger"` (icon `statusDanger`
  on hover/pressed only — a quiet bin, not a red button).
- **Tooltip.** Appears after 500 ms of hover or immediately on keyboard focus; if another tooltip
  was visible in the last 300 ms it appears at once (moving along a toolbar reads as one gesture).
  Fill `foreground`, text `surface1` in `small`, radius 6, pad 4 × 8, then the shortcut in `keys`
  at 0.7 opacity after a gap of 6. Placed 6 px outside the button on the side away from the nearest
  panel edge (below for A and B, above for C and D, above for the contextual toolbar unless it is
  flipped). Fades 80 ms. `pointerEvents: "none"`. Hidden on press, on touch and while any popover is
  open. Disabled buttons still show their tooltip.
- A button that opens a popover or menu sets `accessibilityState.expanded`.

### 4.3 `Toolbar`

A row of actions inside an `Island`: `IconButton`s, `Toolbar.LabelButton` (icon 16 + `button`
text, pad H 10, height 36, same states), `Toolbar.Swatch` (a 20 px colour chip in a 36 box, §5.2)
and `Island.Divider`. Keyboard: the toolbar is one tab stop; `←`/`→` move between its items,
`Home`/`End` jump, `Enter`/`Space` activate. It is used by island A, B, D, the contextual toolbar
(§5), the compact action bar and a learning block's transport (§18.5).

### 4.4 `Popover`

A floating panel anchored to a rectangle (a button, an entity's screen box or a point).

- Surface: `Island` with `elevation="popover"`, column, padding 12, gap 12, radius 12. Widths 240 /
  320 / 360 (`small` / `medium` / `large`), max height 440 with its own `ScrollView` body.
- **Placement.** Preferred side given by the caller; 8 px from the anchor; flips to the opposite
  side when it would cross the safe area; then shifts along the edge to stay 8 px inside the panel.
  No arrow. An entity-anchored popover follows the camera; it closes if its anchor leaves the panel.
- **Enter** opacity 0→1, scale 0.96→1, 4 px towards its resting place, 120 ms; **exit** 80 ms
  opacity. Instant under reduce motion.
- **Dismissal.** Press outside (that press is consumed only if it lands on the canvas background;
  pressing another control activates it) · `Esc` (focus returns to the trigger) · its trigger
  pressed again · the selection changes · a drag or resize starts. Text fields inside commit on
  dismissal exactly as on blur — a popover is never "cancelled".
- **Header** (optional): `bodyStrong` title, and nothing else — no close button on non-compact.
- No scrim. Focus moves to the first field or row on open and is trapped only while open.
- Compact: the same children inside a host `Modal` sheet whose title is the header.

### 4.5 `Menu`

A `Popover` of width 232, padding 4, whose children are rows.

- **Row** 32 high (44 touch), pad H 8, radius 6, gap 8: icon 16 `foregroundMuted` (or a 16 px
  spacer when the menu mixes rows with and without icons) · `body` label, one line · spacer ·
  shortcut in `keys` muted, or `ChevronRight` 14 for a row that opens a popover, or `Check` 14 for
  the current choice.
- Hover and keyboard highlight: `foreground`@0.06. `↑`/`↓` move, `Enter` activates, typing jumps to
  the first row that starts with the typed letters (600 ms buffer), `Esc` closes.
- **Danger row:** label and icon in `statusDanger`, always last, after a separator.
- **Separator** 1 px `border`, margin V 4. **Section label** `label` muted, height 24, pad H 8.
- Activating a row closes the menu, except rows that toggle a value in place (they show `Check`).
- A menu has at most 9 rows and no nested menus; a row may open a popover that replaces the menu at
  the same anchor.

### 4.6 `Chip`

One component, three uses.

| Use | Height | Fill | Content |
| --- | --- | --- | --- |
| Status ("Ejemplo", "Estático", counts) | 20 | `wash(tone)` | optional icon 12 in tone + `label` muted |
| Context (selection in the composer, §10) | 24 (32 touch) | `wash("acento")` | type icon 12 `accent` + `small` 600 title, max width 160 + `X` 12 in a 24 hit ("Quitar del contexto") |
| Toggle (layers, §18.9; quick types) | 24 | off transparent + 1 px `border`; on `wash` of its colour + 1 px of its colour @0.38 | optional leading icon 12 + `small` 600; `accessibilityState.checked` |

Radius 6, pad H 6, gap 4. A chip never wraps its text.

### 4.7 `InlineText` (in-place editor)

Text that becomes its own editor. Rendered as `Text` at rest and as a `TextInput` while editing,
**in exactly the same box**: same font style, colour, line height, alignment and width; padding 0;
no border, no fill. Nothing around it moves when editing starts. Behaviour is §8.1.

- Props: `value`, `onCommit(next)`, `style` (a `tokens.font.style` key), `multiline`,
  `placeholder`, `maxLines` (ignored while editing), `editing` / `onEditingChange` (controlled, so
  `Enter`, `F2` and double-click on the card can start it).
- While editing: text selection colour `accent`@0.20; placeholder in `foregroundMuted`@0.55; the
  owning card shows the *editing* state (§8.1). Multiline grows with its content; the card's
  measured height follows without animation.
- `accessibilityRole="text"` at rest with hint "Doble clic para editar"; a `TextInput` with the
  field's name as label while editing.

### 4.8 Controls inside cards and popovers

`Pressable` + `accessibilityRole/Label/State`. States as in the shared list above.

| Control | Height | Pad H | Radius | Fill | Border | Label |
| --- | --- | --- | --- | --- | --- | --- |
| Button primary | 32 (44 compact) | 12 | 8 | `accent`; disabled `surface2` @0.7 | — | `button`, `accentForeground`; disabled `foregroundMuted` |
| Button secondary | 32 (44) | 12 | 8 | `surface2` | 1 `border` | `button`, `foreground` |
| Button ghost | 32 (44) | 8 | 8 | transparent | — | `button`, `foreground` |
| Button small | 26 | 8 | 8 | per variant | per variant | `small` 600 |
| Segmented | 28 in a 32 track | 10 | 6 in 8 | track `surface2`; active `surface1` + 1 `border` | — | `small` 600; inactive muted |
| Input | 32 (44) | 10 | 8 | `surface2` | 1 `border`; focus 2 `accent` | `body` |
| Text area | min 64 | 10 / 8 | 8 | `surface2` | as input | `body` (`code` for JSON) |
| Option row | min 36 | 10 | 8 | transparent; selected `washStrong(violeta)` | 1 `border`; hover `foregroundMuted`@.5; selected 1.5 violeta | `body` + 16 radio |
| Check row | min 28, pad V 5 | 6 (bleeds −6) | 6 | hover `foreground`@.06 | — | 16 box aligned to the **first line** of a wrapping label + `body` |

There is no danger button: deleting is an icon in the toolbar or a danger row in a menu, and it is
always undoable. One primary button per card or popover. Icon+label: icon 14, gap 6. Radio/check
glyphs are Views: 16×16, 1.5 px ring in `foregroundMuted`@0.7; checked = tone fill + host `Check`
12 in `surface1`; radio radius 8 with a 6 px dot. Progress bar: 6 high, radius 3, track `surface2`,
fill `toneColor("exito")`, `accessibilityRole="progressbar"`.

**Field pattern** (only inside the Datos and Ajustes popovers): label `small` 600 above the control
(gap 4), helper `small` muted below; fields gap 12. Commit on blur, on popover dismissal or after
600 ms idle, one transaction each ("Editar «{campo}»"). In flight: 6 px `statusWarning` dot after
the label. Failure: helper becomes `statusDanger` "No se guardó" + ghost small "Reintentar".


## 5. Contextual toolbar and popovers

### 5.1 Behaviour

One `Toolbar` in an `Island` with `elevation="popover"`, height 44, shown whenever something is
selected. It is the **only** place where properties of the selection are changed; there is no
inspector.

- **Position.** Horizontally centred on the selection's screen bounding box, its bottom edge 12 px
  above the box (16 px above the press point for a connection). If that would cross the safe area's
  top (§3.1), it goes 12 px **below** the box instead. Then it is clamped 8 px inside the panel
  horizontally. If the selection is larger than the viewport it sits 12 px below the safe area's
  top, centred. Constant size at every zoom.
- **Timing.** Appears 120 ms after the selection settles (opacity 0→1 and 4 px towards the
  selection, 100 ms). Hidden — unmounted, not faded to a disabled state — while a drag, resize, pan,
  zoom animation, connection gesture or in-place edit is in progress; it returns 120 ms after the
  gesture ends. It never appears during a rubber-band selection until release.
- **Never under the pointer on arrival:** if it would appear under the pointer that just made the
  selection, it uses the opposite side.
- **Offline or mutation in flight:** actions that write are disabled (0.45); "Preguntar" stays.
- **Compact:** the same items as a docked **action bar** (48 high, `surface1`, top border, 44 px
  targets, horizontal scroll when they do not fit), directly above the composer.
- At most six items plus "Más" (`Ellipsis`). Everything in the toolbar is also reachable from the
  keyboard (§12) and, by name, from "Más".

### 5.2 Items by selection

Order is left → right. `▾` opens a popover (§5.3) anchored to the button. "Preguntar" is a
`LabelButton` (`MessageCircleQuestion` + "Preguntar", key `A`): it focuses the composer, whose chips
already show the selection (§10). It is first because talking about a thing is the main reason to
select it.

| Selection | Items | Behind "Más" |
| --- | --- | --- |
| **One block** | Preguntar · *type slot* · `Compass` Instrucción ▾ · `CopyPlus` Duplicar (`⌘D`) · `Trash2` Eliminar (`⌫`) · Más | Editar texto (`Enter`) · Datos… (when the type slot is something else) · Conectar con… · Sacar del grupo (if grouped) · Soltar posición (if pinned) · Tamaño automático (if sized) · Mover antes / Mover después (in `stack`, `grid`, `flow`) |
| **One group** | Preguntar · `Plus` Añadir dentro ▾ (picker, §9.1) · *layout icon* Disposición ▾ · `Compass` Instrucción ▾ · `Ungroup` Desagrupar (`⇧⌘G`) · Más | Editar título (`Enter`) · Plegar / Desplegar · Variables… (§18.6, only if the group has any) · Conectar con… · Duplicar · Guardar como plantilla… · Reordenar automáticamente (if any child is pinned) · Sacar del grupo (if nested) · **Eliminar grupo y contenido** (danger) |
| **One connection** | `Type` Etiqueta · *line glyph* Tipo ▾ · *swatch* Color ▾ · `ArrowLeftRight` Invertir · `Trash2` Eliminar (`⌫`) | — (no "Más") |
| **Several entities** | Preguntar · `Group` Agrupar (`⌘G`) · `Spline` Conectar (`L`; only with exactly two; tooltip "Conectar «A» → «B»") · `CopyPlus` Duplicar · `Trash2` Eliminar · Más | Soltar posiciones (if any is pinned) · Sacar del grupo (if all share a parent group) |
| **Nothing** | no toolbar | Lienzo-wide settings are in the main menu (§3.2) |

- **Type slot** (one item, chosen by renderer, so the most likely edit is one press away):
  `preview-frame` and `image-ref` → `Link` "Cambiar enlace" ▾ (a `small` popover with one `code`
  input, placeholder `https://…`, helper for an invalid URL "Hace falta un enlace http o https.");
  `code` → `Code` "Lenguaje" ▾ (one input); `node` → `CircleDot` "Estado" ▾ (one input for
  `status`, with the four tones of §15.2 offered as chips: Listo, En curso, Bloqueado, Nuevo);
  interactive learning blocks → `RotateCcw` "Reiniciar"; every other type with properties that
  cannot be edited in place → `SlidersHorizontal` "Datos" ▾; otherwise the slot is omitted.
- **Several entities** shows only actions valid for all of them; a mixed selection of blocks and
  groups gets exactly the row above. A connection is never part of a multi-selection.
- **Deleting** shows a toast "Eliminado · Deshacer" (the toast action undoes); no confirmation,
  including "Eliminar grupo y contenido".
- **Etiqueta** (connection) starts the inline editor on the label, or on an empty label placed at
  the connection's midpoint (placeholder "Qué pasa por aquí").
- **Tipo ▾** — `Menu` with three rows, each drawing its real line style as a 28 px sample before
  the name: Flujo ("sigue o envía a") · Depende ("necesita a") · Referencia ("menciona a"); the
  meaning is the row's muted second line. `Check` on the current one.
- **Color ▾** — a `small` popover holding one row of seven 24 px swatches (radius 12, gap 8):
  "Automático" (half ink, half `surface2`, a diagonal split) and the six `graph.tones`. Selected =
  2 px `accent` ring at 2 px distance. Each swatch has an `accessibilityLabel` with the colour name.
  The toolbar's own swatch shows the current colour.

### 5.3 Popovers that replace the inspector

| Popover | Opened from | Width | Content |
| --- | --- | --- | --- |
| **Instrucción** | toolbar `Compass` | medium | One text area (min 3 lines, grows to 8, placeholder "Cómo debe hablar el asistente sobre esto") bound to `communication.instructions`. Below it, when ancestors carry instructions: `small` muted "También se aplica:" and one row per level (`Compass` 12 + "Grupo «…»" / "Todo el lienzo"; press selects that level and reopens this popover there). When `intent` or `audience` hold text written elsewhere, they are shown read-only under the field as `small` muted lines "Intención: …" / "Audiencia: …". Footer, only when anything is filled: ghost small "Vaciar" (`Eraser`) → writes three empty strings, toast "Instrucción vaciada · Deshacer". The `Compass` toolbar button is *active* (accent) whenever `hasCommunication` is true. |
| **Disposición** | group toolbar; Ajustes del lienzo | medium | A row of five 56×48 tiles (icon 20 over `small` label; selected = `accent`@0.14 fill, 1.5 px `accent` border): Grafo `Workflow` · Pila `Rows3` · Rejilla `Grid2x2` · Flujo `ArrowRightFromLine` · Libre `Move`. Under it, only the option of the chosen mode: Grafo → segmented "Hacia abajo \| Hacia la derecha"; Rejilla → "Columnas" with `Minus` *n* `Plus` (1–4). While no layout is stored, the tile of the mode in effect is outlined (1 px dashed `border`) and a `small` muted line reads "Automático: se ordena como {modo}." The toolbar button's icon is the icon of the mode in effect. |
| **Datos** | type slot or "Más" | medium | Header = the type's name. One field (§4.8 field pattern) per `BlockType.properties` entry **that is not editable in place** (§8.1): number → input with numeric keyboard; boolean → check row; json → `code` text area, min height 120, validated on blur ("No es JSON válido", not sent). `required` adds " *". For a type missing from the collections: the unknown-type message of §6.3 and no fields. |
| **Conectar con…** | "Más" | medium | Search input (autofocus, placeholder "Buscar por título"), up to 8 result rows (type icon + title + `small` muted group name). `Enter` or press creates a `flow` connection from the selection to that row, selects it and closes. No results: `small` muted "Nada coincide con «{q}»." |
| **Guardar como plantilla** | group "Más" | small | One input "Nombre" (prefilled with the group title) + primary small "Guardar". Toast "Plantilla «{name}» guardada". |
| **Ajustes del lienzo** | main menu | large, anchored to island A | Fields: "Descripción" (text area, 2 lines) · "Instrucciones para el asistente" (text area, min 3 lines, placeholder "Para qué es este lienzo y cómo debe ayudar el asistente", bound to the document's `communication.instructions`) · "Disposición" (the tiles above, for `document.layout`). For an example, first a `wash("aviso")` box: "Lienzo de ejemplo. Su contenido es ilustrativo y no viene de un asistente." |

Sections of the former inspector that have **no** replacement, by decision: identifiers and type
rows, numeric position and size fields, the list of a group's children (the canvas and Lista show
them), the list of groups to move into (drag into a group, §6.2; "Sacar del grupo" covers leaving).

### 5.4 Popovers of the Lienzo island

- **Lienzos** (title press; width large; anchored below A). First row: `Plus` "Nuevo lienzo"
  (primary-coloured icon, `bodyStrong`). Then `label` "Tus lienzos" and one row per own document,
  most recent first; then `label` "Ejemplos". Row (min 44): `Frame` 16 · serif `groupTitle` title +
  chip "Ejemplo" · `small` muted relative time ("hace 2 h") · `Check` 14 on the open one. A search
  input appears above the list when there are more than 8 own lienzos. Pressing a row opens it and
  closes the popover. Empty own list: `small` muted "Aún no hay lienzos propios."
- **Historial** (main menu; width medium). The last 8 `readHistory` rows: actor glyph 14 (`Bot`
  assistant, `User` person, `Cog` system) · `body` transaction label, one line · `small` muted
  relative time. Undo/redo entries in muted italics. No revision numbers. Empty: "Todavía no hay
  cambios."
- **Atajos de teclado** (main menu; width large). §12 as two-column rows: `body` action, `keys`
  shortcut; grouped under `label` headings Crear, Editar, Seleccionar, Ver, Asistente.


## 8. Direct manipulation: editing in place, `+` handles, quick-create

### 8.1 Editing text in place

Every text a person can author is edited where it is drawn, with `InlineText` (§4.7).

- **Start:** double-click (double-tap) on the text · `Enter` or `F2` with exactly one entity
  selected (starts on its first editable text) · typing a printable character with exactly one
  entity selected (replaces the first editable text, like a spreadsheet cell) · creating a block
  from island B, quick-create or a `+` handle (starts automatically). A double-click on a part of a
  card that is not text starts on the first editable text.
- **While editing:** the card keeps its selected border and gains a 2 px `accent` ring on the text's
  own line box is **not** drawn — the caret is the signal; the card's drag, hover and `+` handles
  are off; the contextual toolbar is hidden; canvas shortcuts are suspended.
- **Keys:** single-line — `Enter` commits; multi-line — `Enter` adds a line, `⌘/Ctrl Enter`
  commits. `Tab` / `⇧Tab` commit and move to the block's next / previous editable text (wrapping
  ends editing). `Esc` commits and ends editing (it does **not** discard: undo exists, and losing a
  paragraph to a reflex is worse). Pressing anywhere else commits.
- **Commit** writes one transaction per edit session and per field ("Editar título", "Editar
  texto"). An unchanged text writes nothing. A failed save keeps the text, re-enters editing and
  shows the block's "No se guardó · Reintentar" footer (§6.3).
- **Low zoom.** Below `zoomThresholds.inlineEditBelowZoomsTo` (0.5) text cannot be read, so
  starting an edit first animates the camera (280 ms) to scale 1 with the block centred in the safe
  area, then places the caret.
- **What is editable, in tab order:**

| Entity | Editable texts | Placeholder when empty |
| --- | --- | --- |
| Lienzo title (island A) | title, single-line | "Lienzo sin título" |
| Group | title (single-line, serif) · description | "Grupo sin título" · "Para qué sirve este grupo" |
| Any block | title (`heading`, single-line) — the title row is rendered while editing even if empty | "Título" |
| `note`, `text`, `callout`, `step` | `text`, multi-line | "Escribir aquí" |
| `node` | title · `summary` (multi-line, 2 lines at rest) · `details` in its side note (§15.2) | "Idea" · "Resumen en una línea" · "Explicación" |
| `code` | `code`, multi-line, `code` style | "Pegar o escribir código" |
| `checklist` | each item label; `Enter` commits and adds an item below, `⌫` on an empty item removes it | "Elemento" |
| `choice`, `quiz` | `question` · each option (same list behaviour) | "Pregunta" · "Opción" |
| `metric` | `value` · `label` | "0" · "Qué mide" |
| `image-ref` | `caption` | "Pie de imagen" |
| `preview-frame` | `description` | "Qué muestra" |
| Connection | label | "Qué pasa por aquí" |

Everything else (numbers, booleans, JSON, URLs, language, status) is edited in a toolbar popover
(§5.2 type slot, §5.3 Datos). A `diagram` block's nodes are edited by the assistant; its title and
caption are editable in place.

- **Empty texts at rest.** A selected block shows the placeholder of an empty title in
  `foregroundMuted`@0.55 so there is something to double-click; an unselected block omits the row.

### 8.2 `+` handles

A selected (exactly one) block or group shows up to three **`+` handles**: discs centred 14 px
outside the middle of its right, bottom and left edges. **The side occupied by the contextual
toolbar never has a handle** (top by default; if the toolbar is flipped below, the handle moves
from the bottom to the top). On pointer devices the handles also appear after 150 ms of hover over
an unselected block, so connecting does not require selecting first.

- **Anatomy.** 18 px disc, fill `surface1`, 1.5 px `accent` border, `Plus` 12 `accent`; hit area
  28 (44 touch). Hover: fill `accent`, icon `accentForeground`, scale 1.1 over 100 ms. Tooltip
  "Clic: añadir conectado · Arrastrar: conectar". Constant size on screen.
- **Zoom.** Hidden below scale 0.4; between 0.4 and 0.6 the disc is 12 px without the icon (hit
  area unchanged); from 0.6 up, full size. The resize grip (§17.2) is hidden below 0.4 as well.
- **Click** → creates a block of the source's type (a `node` when the source is a group or a type
  without a title-only form) on that side — `graph.gap.layer` away along the handle's direction,
  aligned to the source's centre, then moved by the usual collision rule — plus a `flow` connection
  source → new, in **one** transaction ("Añadir «{tipo}» conectado"). The new block is selected and
  its title is in edit mode. `Tab` while that title is still being edited commits it and repeats
  the gesture from the new block in the same direction, so a chain can be typed without the mouse.
- **Drag** (starts after 4 px) → the connection gesture of §15.6 / §17.3 with its magnetic targets.
  Release on a target creates the connection ("Conectar «A» → «B»"). **Release on empty canvas** at
  least 24 screen px from the handle creates a connected block there, exactly like a click but at
  the release point; closer than 24 px cancels. `Esc` during the drag cancels.
- **Accidental connections** are prevented by: the 4 px threshold; the dashed, 60 %-opacity preview
  until a target is acquired; the target ring and the chip that names the target ("Conectar con
  «…»"); never duplicating an existing `(from, to, kind)` (the existing connection is selected
  instead); and one-step undo with a toast "Conectado · Deshacer".
- Not shown: on compact, offline, while a write is pending, during any drag, for multi-selections,
  and on a block that is being edited.
- **Keyboard equivalent:** `⌘/Ctrl →`, `↓`, `←`, `↑` with one entity selected = click on that side's
  handle (`↑` works even though the toolbar hides that handle). `L` with two selected connects them.

### 8.3 Quick-create on empty canvas

**Double-click (double-tap, or long-press on touch) on empty canvas** creates a `node` at that
point, title in edit mode, placeholder "Idea".

- The block is a **local draft** until its first non-empty commit: nothing is written and nothing
  enters history while the title is empty. Leaving the editor with an empty title removes the
  draft silently. The first commit writes `block.create` with the title ("Añadir «{título}»").
- Inside a group frame's empty area the draft is created in that group. Positions snap to 8.
- Below scale 0.5 the camera first zooms to 1 centred on the point (as §8.1).
- While the draft's title is empty, a `small` muted line under it reads "`/` para elegir otro tipo".
  Typing `/` as the first character opens the picker (§9.1) anchored to the draft; choosing a type
  replaces the draft with that type at the same point.
- Double-click never creates anything on top of an entity: there it edits (§8.1).


## 9. Adding blocks, collections and the Lista view

### 9.1 Block picker (replaces the catalog rail)

The catalog is **not a place**; it is a `Popover` (width medium, max height 440) that opens where
something is about to be added. Data: `readCatalog`.

| Opened from | Anchor | Adds to |
| --- | --- | --- |
| `Plus` on island B (`K`, `⌘/Ctrl K`) | below the button | as island B's rule (§3.1) |
| "Añadir dentro" on a group's toolbar | below the button | that group |
| `/` in a quick-create draft (§8.3) | the draft | replaces the draft |
| `Plus` in the compact top bar | sheet | selected group, else root |

- **Search** input on top (autofocus, `Search` 14 leading, placeholder "Buscar bloques y
  plantillas"); accents and case are ignored; it searches names and descriptions.
- **Bloques.** A grid of tiles, 3 columns, gap 4. Tile: 92 × 64, radius 8, icon 20 in the type's
  tone colour above the type's `name` in `small` 600 (one line, centred); hover `foreground`@0.06.
  The type's `description` is the tile's tooltip. Order: Nota, Nodo, then the rest of the
  built-ins, then collection types under a `label` with the collection's name.
- **Plantillas.** `label` "Plantillas", then rows (min 44): the 40 × 28 miniature (1.5 px `border`
  rounded frame holding up to three 3 px bars in the `washStrong` of its first blocks' tones) ·
  `bodyStrong` name · `small` muted description, one line. Press = `template.insert`.
- **Footer row** (after a separator): `Package` "Colecciones…" → §9.2.
- `↑ ↓ ← →` move through tiles and rows, `Enter` adds. Adding closes the popover, selects the new
  entity and starts editing its first text. On pointer devices a tile can also be dragged onto the
  canvas (same ghost as island B).
- No results: `small` muted "Nada coincide con «{q}»." Catalog failed: `small` "No se pudieron
  cargar los bloques." + ghost small "Reintentar". Loading: six skeleton tiles.

### 9.2 Colecciones (host `Modal`, icon `Package`)

Importing and exporting JSON is rare, deliberate and file-shaped, so it is the one task that keeps
a modal. Title "Colecciones". Body: secondary full-width "Importar colección" (`FileInput`), then
one card per installed pack (radius 12, 1 px `border`, pad 12, gap 8): row 1 `Package` 16 +
`bodyStrong` name + chip "Ejemplo" for `frontend`, `learn` and `graph`; `small` muted description;
`small` muted "{a} tipos · {b} plantillas · {c} lienzos"; one row per document (`FileText` 12 +
title + ghost small "Crear lienzo" → `instantiatePack`); last row ghost small "Exportar"
(`FileOutput`) and ghost small "Quitar" (`pack.remove`; a refusal is toasted with the server's
message). The raw-JSON "define a type" editor sits at the very end behind a ghost small "Definir un
tipo propio".



### 9.4 Lista view

Kept, under the name **Lista**, for three reasons: it is the readable default on compact; it is
the linear, screen-reader-friendly reading of a canvas; and it is how to read a large canvas top to
bottom. It is a **view of the same lienzo, not a second editor**, so it is a main-menu toggle
("Ver como lista" / "Ver como lienzo", `⇧L`) and not a persistent control.

- Non-compact: the list replaces the canvas under the same islands; island B and D are hidden (no
  free placement, no zoom), A and C stay, and island A gains a trailing `Frame` button "Ver como
  lienzo" so the way back is visible.
- `ScrollView`, padding 16 (12 compact), top padding 68 on non-compact (clears island A), gap 16,
  content max width 720 centred.
- Header: serif `display` title, chip "Ejemplo", `small` description.
- Each root group is a section: header row on a `foregroundMuted`@0.05 strip, radius 12 (serif
  `groupTitle`, count, chevron); description; then its blocks (the **same block components** at
  width 100 %, no line clamps), then nested groups indented 12 with a 2 px `border` left rule.
- Root blocks last, under the `label` "Sueltos".
- Connections are sentences under each entity (§15.7).
- Tap selects (the contextual toolbar appears above the row; on compact, the action bar). In-place
  editing works exactly as §8.1. `+` handles and quick-create do not exist here; "Más" offers
  "Mover antes" / "Mover después" for order.


## 10. Assistant composer (island C)

One free-text field. **The selection is the context**; there are no intent or audience fields and
nothing to configure before writing.

### 10.1 Anatomy

```
 rest (no selection, empty)            with selection, typing
┌──────────────────────────────┐     ┌────────────────────────────────────────────┐
│ (●) Escribir al asistente… ↑ │     │ Sobre: [◉ Custodia ✕] [▢ Flujo ✕] +2       │
└──────────────────────────────┘     │ (●) ¿por qué pasa por aquí?              ↑ │
        360 × 44, radius 14          └────────────────────────────────────────────┘
                                              up to 560 wide, input up to 4 lines
```

- `Island`, radius 14, padding H 6. Bottom-centre, 12 from the bottom edge.
- **Status button** (leading, 32 px circle, `Bot` 16): fill `surface2`; an 8 px dot at its
  bottom-right with a 2 px `surface1` ring — `statusSuccess` idle, `accent` working,
  `statusDanger` error or closed, `foregroundMuted` when no assistant is connected (icon `Unplug`).
  Press → popover "Asistente" (§10.3). Tooltip: the assistant's title and its state in words.
- **Input.** `body`, grows from 1 to 4 lines (then scrolls), placeholder by state (below). `Enter`
  sends, `⇧Enter` adds a line. `Esc` blurs and returns focus to the canvas, keeping the text.
- **Send** (trailing, 32 px circle, `ArrowUp` 16): fill `accent`, icon `accentForeground`; with an
  empty input and no selection it is `surface2` with a muted icon and disabled. Tooltip "Enviar"
  + `Enter`.
- **Width.** 360 at rest; grows to its maximum (§3.3) over 160 ms when focused, when it holds text
  or when chips are shown; returns when all three are false.
- **Chips row** (above the input, pad top 6, gap 4, one line): `small` muted "Sobre:" then one
  context `Chip` (§4.6) per selected entity, up to 3, then "+{n}" (press → popover listing all,
  each removable). Removing a chip **deselects that entity** — chips and selection are the same
  thing, there is no separate context list. The row animates its height (160 ms) so the input does
  not jump under the pointer: the island grows upwards.
- **Status row** (under the input, 24 high, only when it has something to say): the delivery state
  of the last send (§10.2) or the no-assistant note.

| State | Placeholder | Notes |
| --- | --- | --- |
| No selection | "Escribir al asistente…" | Sends with no targets |
| One or more selected | "Preguntar sobre la selección…" | Send is enabled even with an empty input: it sends the selection alone |
| Empty canvas | "Pedir un lienzo: «explicar la fotosíntesis paso a paso»" | §11.1 |
| No assistant connected | "Escribir al asistente…" | Status row: `Unplug` 12 + `small` "Sin asistente. Se guarda en cola." + ghost small "Conectar" (§10.3) |
| Offline | input disabled | Status row: "Sin conexión con Paseo." |
| Sending | input read-only, send shows a 14 px ring (static under reduce motion) | |

Selecting never sends anything and never starts a turn; `setSelection` stays debounced 250 ms.

### 10.2 What is sent, and delivery

`agentAction` (`eventId` = `newId("evt")`, generated once per press and reused on retry):

| Press | `kind` | `targetIds` | `payload` | `delivery` |
| --- | --- | --- | --- | --- |
| Composer send | `selection.send` | selected ids (may be empty) | `{ note }` | `immediate` |
| Choice/quiz "Enviar respuesta" | `block.answer` | `[blockId]` | `{ answer }` | `immediate` |
| Form "Enviar" | `block.submit` | `[blockId]` | `{ values }` | `immediate` |
| Diagram "Preguntar por este paso" | `diagram.step` | `[blockId]` | `{ nodeId, label }` | `immediate` |
| Quiz "Ver pista" | `block.hint` | `[blockId]` | `{}` | `batched` |
| Prediction gate "Comprobar" (§18.13) | `block.predict` | `[blockId]` | `{ prediction }` | `immediate` |
| Learning block "Pedir arreglo" (§18.10) | `block.error` | `[blockId]` | `{ message }` | `immediate` |

Not sent: moving, editing, checklist toggles, collapsing, selecting, moving a slider (persisted or
local only).

Delivery state — always from the returned or polled `AgentEvent.status`, never assumed. Shown in
the composer's status row for composer sends, and in the block footer for block actions:

| Status | Icon | Text | Colour |
| --- | --- | --- | --- |
| request in flight | — | "Enviando…" | muted |
| `pending` | `Clock` 12 | "En cola" | muted |
| `sent` | `Check` 12 | "Enviado · {hh:mm}" | muted |
| `acked` | `CheckCheck` 12 | "Recibido por el asistente" | `statusSuccess` icon, muted text |
| `failed` | `CircleAlert` 12 | "No se envió" + `error` (1 line) + ghost small "Reintentar" | `statusDanger` |

The input clears only on `sent` or `pending`. The status row disappears 6 s after `acked`, or when
the next message is typed. There are no toasts for delivery: the row is the feedback.

### 10.3 Popover "Asistente"

Width medium, anchored above the status button.

- Current connection: `bodyStrong` assistant title, `small` muted provider and state in words
  ("inactivo", "trabajando", "con error", "cerrado", "iniciando"); or `small` "Ningún asistente
  recibe lo que se envía desde este lienzo."
- `label` "Asistentes de este espacio": option rows (title, `small` provider, status dot); pressing
  one calls `connectAgent`. Ghost small "Desconectar" under the list.
- `label` "Enviado": the last 5 `readAgentEvents` rows (state icon, `action.label`, relative time);
  if any is `pending`, ghost small "Enviar pendientes" (`flushAgentEvents`). Empty: `small` muted
  "Todavía no se envió nada."
- Footer row: ghost small "Configurar…" → the host modal with the sharing mode, tool injection and
  manual setup (its content is unchanged; its title is "Configurar asistente").

### 10.4 Compact

Docked at the bottom, full width, `surface1`, top border, padding 8; same anatomy with 44 px
targets; the chips row scrolls horizontally. It rises with the keyboard.
