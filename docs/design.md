# Lienzo ; visual design specification (v7, floating interface and whiteboard)

Autoría: tokens y capítulos iniciales recuperados de Claude Opus 5.5 Medium.
Especificación completada y revisada por GPT 6.1 Sol High por autorización del dueño.
Una revisión posterior de Opus queda pendiente si el dueño la solicita.
v7 (§20, pizarra libre, y las enmiendas marcadas "v7"): Claude Opus 5.5 Medium.
Estado: objetivo de implementación, todavía no implementado en el plugin.
Audience: the engineers of `plugin/client/`. Normative. Field,
operation and RPC names are the ones in `plugin/shared/model.ts`, `rpc.ts` and `builtins.ts`; if
those files change, **they win on names and shapes, this file wins on how things look and behave**.

| Artifact | Role |
| --- | --- |
| `design/whiteboard-spec.md` | **Contract** for free text, shapes, SVG, freehand, tools and gestures: type IDs, data fields, limits. Wins over this file on those. |
| `design/tokens.json` (v7) | Numbers, colours, font styles and icon names. Transcribed into `plugin/client/tokens.ts`. |
| `design/floating/opus-draft.md` | Borrador parcial recuperado. Archivo histórico, sin autoridad sobre esta especificación. |
| `design/floating/contrast.py` | Contrast check of every new colour pair; must exit 0. |
| `design/demo.html` | Example content for the `preview` block, not a mock of the plugin. |
| `design/graph-harness/real/` | Real RN canvas components under react-native-web with example data. |
| `docs/design-audit.md` | Designer's review of the implemented UI. |

**Map of this file.** §1 identity · §2 platform · §3 regions and widths · §4 primitives and controls ·
§5 contextual toolbar and popovers · §6 canvas, blocks, groups · §8 direct
manipulation (in-place editing, `+` handles, quick-create) · §9 adding blocks and Lista ·
§10 the agent (one-way, no composer) · §11 states and first run · §12 keyboard · §13 accessibility · §15 graph ·
§16 dragging and motion · §17 media, sizes, link magnetism · §18 interactive learning blocks ·
§19 copy · §20 whiteboard (free text, shapes, SVG, freehand, tool and style islands, drag and
interaction rules) · §35 the screens around the canvas (Lienzos, guide, Settings, Extensions, History).

Not in the contract, therefore **not designed and must not be rendered**: per-block author glyphs,
per-block tone overrides, group resize handles. §18 describes block kinds whose data shapes are
still to be published by the backend; it fixes their look and behaviour, not their field names.

---

## 1. Identity

- **Name:** *Lienzo*. A document is called **un lienzo** everywhere in the interface.
- **Idea:** a drafting table shared by a person and an assistant. Paper surface, ink text, one
  blueprint-blue accent. Blocks are index cards; groups are frames. No gradients, no glows.
- **Three depths, one rule each.**
  1. *On the table* ; cards and frames: a surface step and a 1 px border, never a shadow.
  2. *In the hand* ; a card being dragged: lift shadow (§16).
  3. *Above the table* ; everything that is interface and not content (islands, the contextual
     toolbar, popovers, menus, tooltips): `elevation.*` shadows. **A shadow at rest always means
     "this is a control, not part of your canvas".**
- **Simplicity rules** (each one is checkable in review):
  - At rest the canvas shows four small islands and nothing else (§3). Nothing is docked. A fifth
    (style, §20.5) exists only while a creation tool or a whiteboard selection gives it a subject.
  - A control appears next to the thing it changes, and only while that thing is selected.
  - Canvas content changes use undoable transactions with Spanish labels. Pack replacement keeps its explicit review and replacement checkbox. Runtime gestures use the separate runtime channel and reset, not content undo.
  - No modes that outlive their visible control: *editing text* (a visible caret), a learning
    block's *pencil* (a pressed button), the active **canvas tool** (the pressed button of island
    B, §20.4) and a card's *interaction mode* (ring and chip, §20.2). `Esc` leaves each.
  - Never show identifiers, revision numbers, coordinates or pixel sizes.
  - Editable fields retain accessible names. Visible labels appear in forms and learning controls; a single-purpose inline editor uses its contextual title.
- **Language:** Spanish, sentence case, no exclamation marks, no emoji. Interface text is
  **impersonal**: buttons and menu rows are infinitives ("Añadir nota"), hints are noun phrases
  ("Doble clic para escribir una idea"). It never conjugates in the second person, so it reads the
  same for "tú" and "vos" readers. The complete string list is §19.
- **Vocabulary** (the only nouns the interface uses): lienzo · bloque · grupo · conexión ·
  asistente · instrucción · variable. Not used: documento, agente, nodo
  (except as the type name the catalog supplies), enlace, pack, inspector, catálogo, revisión.
- **Three typographic voices:**
  - **Serif** ; names people author: lienzo title, group title, empty-canvas headline, metric value;
    in italics, the hint annotations of the empty canvas.
  - **Sans (system)** ; everything you read or press, including `label` (11/15, 400, sentence
    case), which names types and sections.
  - **Mono** ; only what is literally code or keys: `code` (code, URLs, JSON, shader source) and
    `keys` (shortcuts in tooltips and menus).
- **Hand-drawn accent:** exactly one in the interface itself (what a person draws with the pencil is their content, §20), las flechas de orientación del lienzo vacío (§11.1). Se dibujan con el adaptador web existente o se sustituyen por texto en native; no requieren un archivo SVG. No aparecen junto al contenido de aprendizaje.
- **Honesty rules:**
  - `document.example === true` → chip "Ejemplo" (`FlaskConical` 12, tone `aviso`) after the title in
    the document island, the Lienzos list and the Lista header. Not dismissible.
  - Assistant activity is drawn only from real signals: `useAgent(...).status`, `AgentEvent.status`,
    `readHistory` transactions. No typing dots, no optimistic "Enviado".
  - An interactive block never plays, sounds or reveals by itself (§18.1).


## 2. Platform constraints (Paseo 0.10.3, RN 0.81)

- Client modules: `react`, `react-native`, `@getpaseo/plugin`, `@getpaseo/plugin/client`,
  `…/client/react-native`, `…/client/ui`, `@tanstack/react-query`, `zod`. Nothing else.
- No SVG dependency, no icon packages, no gesture/reanimated libraries, no `className`. Drawing uses the existing web adapters and a static native fallback. Build with `View`,
  `Text`, `Pressable`, `Image`, `PanResponder`, `Animated` and host `Icon`, `Modal`, `ScrollView`,
  `FlatList`, `TextInput`, `ExternalLink`, `useToast`, `copyText`.
- Host `Icon` renders nothing for unknown names → every icon sits in a fixed-size box.
- Colours come from `theme.colors` (`tokens.hostColorRoles`). Lienzo adds two hues (`violeta`,
  `turquesa`), each with a light and dark value. Only literal allowed: `#000` for scrims and dark shadows (the
  screens dim the canvas with it at 0.4 in dark, `foreground` at 0.4 in light).
- Fonts: `tokens.font.family` via `Platform.select`. No custom fonts.
- Popovers and menus use RN positioning on desktop. Lienzos, the guide, Settings, Extensions and History are
  screens drawn by the plugin over the canvas (§35), not host modals; small dialogs (Ventana address, SVG import, the
  agent dialog) stay host `Modal`; compact popovers become host sheets.
- **DOM is allowed only in `plugin/client/web.ts`**, guarded by `layout.platform === "web"` and
  `typeof document !== "undefined"`. Extend the existing drawing, input and viewport adapters in that module only. Every DOM entry checks Platform.OS and remains inert on native.

### 2.1 Colour helpers (`color.ts` ; already matches)

`parseColor`, `withAlpha`, `isDark(surface0)`, `toneColor(tone, theme)`. Derived, memoised per theme:

| Name | Value |
| --- | --- |
| `wash(tone)` / `washStrong(tone)` | tone at 0.10 / 0.16 |
| `toneBorder(tone)` | tone at 0.38 |
| `groupFill(tone)` | tone at 0.05 |
| `halo` | `accent` at 0.20 |
| `hover` / `pressed` | `foreground` at 0.06 / 0.10 |

Tone colour paints spines, icons, washes and borders ; **never body text and never meaning on its
own**. Text on a wash is `foreground`; labels are `foregroundMuted`.

### 2.2 Contributed themes

Register `tokens.contributedThemes` (**Lienzo Papel**, **Lienzo Tinta**) with `client.addTheme`.
Never activate one for the user. Lienzo must read correctly under any host theme.



## 3. Regions

Workspace panel (`context: "workspace"`). Title "Lienzo", icon `Frame`. Measure the root with
`onLayout`; never `Dimensions`. **The canvas fills the whole panel.** Nothing is docked on
non-compact layouts: there is no top bar, no side rail, no inspector and no tray.

### 3.1 Region map (not compact)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [≡ Title ▾ · Example]                                 [ ⌕ ] [ ◧ ]      │  top islands
│                                                     ┌───────────────┐  │
│                    canvas                           │ Properties │… │  │  right panel
│          ┌─────────────────────┐ ← selection bar    │               │  │  (floating)
│          │ ● ▢ ⧉ 🗑            │                    │               │  │
│                                                     └───────────────┘  │
│  [Lente]                                                               │
│  [map]  [ V H │ P ▢ T ↗ E │ M W │ pinned… │ + ]          [ − 100% + ]  │  bottom toolbar
└────────────────────────────────────────────────────────────────────────┘
```

Every island floats over the one canvas with `pointerEvents: "box-none"` around it; nothing reserves space.

| Island | Position | Content |
| --- | --- | --- |
| Top-left | inset 12, 44 tall | `Menu` (main menu, §3.2) · **title** (serif `groupTitle`, max 280, 160 under 880, `ChevronDown` 12 after it; press → Lienzos) · chip "Example" · save dot. Stage 2 adds the Hoja menu after the title. |
| Top-right | inset 12, 44 tall | `Search` "Search and commands" (⌘K, §31) · `PanelRight` "Properties" (⌘\, active while the right panel shows) |
| Bottom toolbar | centred on the bottom edge, inset 12 (`face.toolbar.bottom`) | §24 |
| Right panel | right inset 12, under the top islands | §31 |
| Lente · minimap | bottom-left | §25, §29 |
| Zoom | bottom-right | `Minus` · percent · `Plus` · fit |

- **Save dot.** 6 px, only when it has something to say: `statusWarning` while a write takes over 400 ms,
  `statusDanger` after a failed one. Labels "Saving" / "Not saved".
- **Hide all UI** (⌘.) hides every island but the zoom, and a `Minimize2` "Show the interface" appears top-right.
  Banners stay.
- **Z-order,** bottom to top: canvas · selection bar · islands · right panel · banners · menus and the + catalog ·
  command palette · tooltips · host `Modal` and toasts.

### 3.2 Main menu (`Menu` on the top-left island)

Anchored below the button, 288 wide; rows grouped by dividers: New Lienzo · Lienzos · Rename (F2) ┃ Undo · Redo ·
History ┃ Hide all UI · Agent (with its presence) · Instructions for the agent ┃ Extensions · Settings · Keyboard
shortcuts (?) · Lienzo guide. Lienzos, History, Extensions, Settings and the guide open screens (§35). There is no
view switcher.

### 3.3 Narrower panels (not compact)

Nothing docks. Under 880 the title shrinks to 160 and the zoom shows only its percent (a menu holds zoom in, zoom
out, fit and 100 %). The toolbar stays centred on the bottom edge, level with the minimap and the zoom. The right panel keeps its 300 and covers what is under it; ⌘\ hides it, and the
selection beacon keeps clear of it.

### 3.4 Compact (`layout.compact`)

```
┌ Top bar 52 (surface1, bottom border) ───────────┐
│ ☰   Title ▾ [Example]          ↶    ⌕    ◧      │
├─────────────────────────────────────────────────┤
│ Lista (scrolls) — or the canvas while a drawing │
│ tool or the hand is in use                      │
├ Selection bar 52, only with a selection ────────┤
├ Toolbar: one horizontal scroller, 44 buttons,  ─┤
│ docked at the bottom (6 above, 8 below)         │
└─────────────────────────────────────────────────┘
```

- Lista is what a compact panel shows; nobody chooses it. Picking Pencil, Shape, Text, Arrow, Eraser or Hand shows
  the canvas (one finger draws, two pan); Select returns to Lista.
- The right panel is a host sheet, opened from the selection bar's "Properties" or the top bar.
- Menus are sheets; the + catalog and ⌘K keep their content full width. Controls are 44.

### 3.5 Touch on a non-compact layout (tablets)

Detected per interaction (`pointerType === "touch"`, or native), not per device.

- Tooltips come from a long press (§33). Every icon-only action also exists, with its name, in a menu, Properties or ⌘K.
- Island and toolbar buttons use `sizeTouch` 44. `+` handles use `hitTouch` 44 and appear on
  selection only (there is no hover).
- Tap selects. Double-tap edits (§8.1). Long-press 500 ms on an entity adds it to the selection;
  long-press on empty canvas is quick-create (§8.3). Two-finger drag pans, pinch zooms where the
  platform delivers it.
- A numeric value may open a bounded stepper on touch; the visible slider remains the default control (§18.3).


## 4. Primitives and controls

Seven primitives are built once in `ui.tsx` and reused by everything in §3, §5, §8-§10 and §18.
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
  on light surfaces, `border` on dark) plus the layers of `elevation.island` ; light
  `0 1px 2px ink@.06, 0 6px 16px ink@.08`; dark `0 2px 4px #000@.30, 0 8px 24px #000@.40`. Light or
  dark is `isDark(surface0)`; ink is `theme.colors.foreground`. Where `boxShadow` is unavailable:
  1 px `border` + `elevation` 3.
- Props: `elevation?: "island" | "popover"` (the contextual toolbar, popovers and menus use
  `popover`: light `0 2px 6px ink@.08, 0 12px 32px ink@.12`; dark `0 4px 8px #000@.35,
  0 16px 40px #000@.50`), `vertical?`, `style`.
- `Island.Divider`: 1 × 20, `border`, margin H 4.
- An island never scrolls and never wraps. If its content cannot fit, §3.3 says what is dropped.
- a labelled toolbar container with RN-supported accessibility roles with an `accessibilityLabel` ("Lienzo", "Añadir", "Asistente",
  "Vista"). `pointerEvents="box-none"` on its positioning wrapper so the canvas stays reachable
  around it.

### 4.2 `IconButton` (with tooltip)

One component (`ui.tsx`): 32 square (36 in the top islands, 44 on compact), radius 6, icon 16 `foregroundMuted`,
`foreground` when active. Props: `icon`, `label` (accessibility label and tooltip), optional `shortcut`, `detail`
(a second tooltip line, used for glossary words), `active`, `disabled`. Every IconButton carries the shared tooltip
(§33); other icon-only controls wrap themselves in `Tooltip` or use `useTooltip`.

### 4.3 `Toolbar`

A row of actions inside an `Island`: `IconButton`s, `Toolbar.LabelButton` (icon 16 + `button`
text, pad H 10, height 36, same states), `Toolbar.Swatch` (a 20 px colour chip in a 36 box, §5.2)
and `Island.Divider`. Keyboard: the toolbar is one tab stop; `←`/`→` move between its items,
`Home`/`End` jump, `Enter`/`Space` activate. It is used by island A, B, D, the contextual toolbar
(§5), the compact action bar and a learning block's transport (§18.4).

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
  pressed again · the selection changes · a drag or resize starts. Text fields commit on blur; Esc cancels a pending inline edit. If a transaction was already confirmed, content undo remains available.
- **Header** (optional): `bodyStrong` title, and nothing else ; no close button on non-compact.
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
- A menu has at most 12 action rows, excluding separators, and no nested menus; a row may open a popover that replaces the menu at
  the same anchor.

### 4.6 `Chip`

One component, two uses.

| Use | Height | Fill | Content |
| --- | --- | --- | --- |
| Status ("Ejemplo", "Estático", counts) | 20 | `wash(tone)` | optional icon 12 in tone + `label` muted |
| Toggle (quick types) | 24 | off transparent + 1 px `border`; on `wash` of its colour + 1 px of its colour @0.38 | optional leading icon 12 + `small` 600; `accessibilityState.checked` |

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
- accessible text at rest with hint "Doble clic para editar"; a `TextInput` with the
  field's name as label while editing.

### 4.8 Controls inside cards and popovers

`Pressable` + `accessibilityRole/Label/State`. States as in the shared list above.

| Control | Height | Pad H | Radius | Fill | Border | Label |
| --- | --- | --- | --- | --- | --- | --- |
| Button primary | 32 (44 compact) | 12 | 8 | `accent`; disabled `surface2` @0.7 | ; | `button`, `accentForeground`; disabled `foregroundMuted` |
| Button secondary | 32 (44) | 12 | 8 | `surface2` | 1 `border` | `button`, `foreground` |
| Button ghost | 32 (44) | 8 | 8 | transparent | ; | `button`, `foreground` |
| Button small | 26 | 8 | 8 | per variant | per variant | `small` 600 |
| Segmented | 28 in a 32 track | 10 | 6 in 8 | track `surface2`; active `surface1` + 1 `border` | ; | `small` 600; inactive muted |
| Input | 32 (44) | 10 | 8 | `surface2` | 1 `border`; focus 2 `accent` | `body` |
| Text area | min 64 | 10 / 8 | 8 | `surface2` | as input | `body` (`code` for JSON) |
| Option row | min 36 | 10 | 8 | transparent; selected `washStrong(violeta)` | 1 `border`; hover `foregroundMuted`@.5; selected 1.5 violeta | `body` + 16 radio |
| Check row | min 28, pad V 5 | 6 (bleeds −6) | 6 | hover `foreground`@.06 | ; | 16 box aligned to the **first line** of a wrapping label + `body` |

There is no danger button: deleting is an icon in the toolbar or a danger row in a menu, and it is
always undoable. One primary button per card or popover. Icon+label: icon 14, gap 6. Radio/check
glyphs are Views: 16×16, 1.5 px ring in `foregroundMuted`@0.7; checked = tone fill + host `Check`
12 in `surface1`; radio radius 8 with a 6 px dot.

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
  selection, 100 ms). Hidden ; unmounted, not faded to a disabled state ; while a drag, resize, pan,
  zoom animation, connection gesture or in-place edit is in progress; it returns 120 ms after the
  gesture ends. It never appears during a rubber-band selection until release.
- **Never under the pointer on arrival:** if it would appear under the pointer that just made the
  selection, it uses the opposite side.
- **Offline or mutation in flight:** actions that write are disabled (0.45).
- **Compact:** the same items as a docked **action bar** (48 high, `surface1`, top border, 44 px
  targets, horizontal scroll when they do not fit), directly above the toolbar.
- At most six items plus "Más" (`Ellipsis`). Everything in the toolbar is also reachable from the
  keyboard (§12) and, by name, from "Más".

### 5.2 Items by selection

Order is left → right. `▾` opens a popover (§5.3) anchored to the button. There is no "ask" item:
the canvas never messages the agent (§10); the person mentions the selection in their own chat.

| Selection | Items | Behind "Más" |
| --- | --- | --- |
| **One block** | *type slot* · `Compass` Instrucción ▾ · `CopyPlus` Duplicar (`⌘D`) · `Trash2` Eliminar (`⌫`) · Más | Editar texto (`Enter`) · Datos… (when the type slot is something else) · Conectar con… · Sacar del grupo (if grouped) · Soltar posición (if pinned) · Tamaño automático (if sized) · Mover antes / Mover después (in `stack`, `grid`, `flow`) |
| **One group** | `Plus` Añadir dentro ▾ (picker, §9.1) · *layout icon* Disposición ▾ · `Compass` Instrucción ▾ · `Ungroup` Desagrupar (`⇧⌘G`) · Más | Editar título (`Enter`) · Plegar / Desplegar · Variables… (§18.3, only if the group has any) · Conectar con… · Duplicar · Guardar como plantilla… · Reordenar automáticamente (if any child is pinned) · Sacar del grupo (if nested) · **Eliminar grupo y contenido** (danger) |
| **One connection** | `Type` Etiqueta · *line glyph* Tipo ▾ · *swatch* Color ▾ · `ArrowLeftRight` Invertir · `Trash2` Eliminar (`⌫`) | ; (no "Más") |
| **Several entities** | `Group` Agrupar (`⌘G`) · `Spline` Conectar (`L`; only with exactly two; tooltip "Conectar «A» → «B»") · `CopyPlus` Duplicar · `Trash2` Eliminar · Más | Soltar posiciones (if any is pinned) · Sacar del grupo (if all share a parent group) |
| **Nothing** | no toolbar | Lienzo-wide settings are in the main menu (§3.2) |

- **Type slot** (one item, chosen by renderer, so the most likely edit is one press away):
  `preview-frame` and `image-ref` → `Link` "Cambiar enlace" ▾ (a `small` popover with one `code`
  input, placeholder `https://…`, helper for an invalid URL "Hace falta un enlace http o https.");
  `code` → `Code` "Lenguaje" ▾ (one input); `node` → `CircleDot` "Estado" ▾ (one input for `status`, with named chips Listo, En curso, Bloqueado and Nuevo);
  interactive learning blocks → `RotateCcw` "Reiniciar"; every other type with properties that
  cannot be edited in place → `SlidersHorizontal` "Datos" ▾; otherwise the slot is omitted.
- **Several entities** shows only actions valid for all of them; a mixed selection of blocks and
  groups gets exactly the row above. A connection is never part of a multi-selection.
- **Deleting** shows a toast "Eliminado · Deshacer" (the toast action undoes); no confirmation,
  including "Eliminar grupo y contenido".
- **Etiqueta** (connection) starts the inline editor on the label, or on an empty label placed at
  the connection's midpoint (placeholder "Qué pasa por aquí").
- **Tipo ▾** ; `Menu` with three rows, each drawing its real line style as a 28 px sample before
  the name: Flujo ("sigue o envía a") · Depende ("necesita a") · Referencia ("menciona a"); the
  meaning is the row's muted second line. `Check` on the current one.
- **Color ▾** ; a `small` popover holding one row of seven 24 px swatches (radius 12, gap 8):
  "Automático" (half ink, half `surface2`, a diagonal split) and the six `graph.tones`. Selected =
  2 px `accent` ring at 2 px distance. Each swatch has an `accessibilityLabel` with the colour name.
  The toolbar's own swatch shows the current colour.

### 5.3 Popovers that replace the inspector

| Popover | Opened from | Width | Content |
| --- | --- | --- | --- |
| **Instrucción** | toolbar `Compass` | medium | One text area (min 3 lines, grows to 8, placeholder "Cómo debe hablar el asistente sobre esto") bound to `communication.instructions`. Below it, when ancestors carry instructions: `small` muted "También se aplica:" and one row per level (`Compass` 12 + "Grupo «…»" / "Todo el lienzo"; press selects that level and reopens this popover there). When `intent` or `audience` hold text written elsewhere, they are shown read-only under the field as `small` muted lines "Intención: …" / "Audiencia: …". Footer, only when anything is filled: ghost small "Vaciar" (`Eraser`) → writes three empty strings, toast "Instrucción vaciada · Deshacer". The `Compass` toolbar button is *active* (accent) whenever `hasCommunication` is true. |
| **Disposición** | group toolbar; Ajustes del lienzo | medium | A row of five 56×48 tiles (icon 20 over `small` label; selected = `accent`@0.14 fill, 1.5 px `accent` border): Grafo `Workflow` · Pila `Rows3` · Rejilla `Grid2x2` · Flujo `ArrowRightFromLine` · Libre `Move`. Under it, only the option of the chosen mode: Grafo → segmented "Hacia abajo \| Hacia la derecha"; Rejilla → "Columnas" with `Minus` *n* `Plus` (1-4). While no layout is stored, the tile of the mode in effect is outlined (1 px dashed `border`) and a `small` muted line reads "Automático: se ordena como {modo}." The toolbar button's icon is the icon of the mode in effect. |
| **Datos** | type slot or "Más" | medium | Header = the type's name. One field (§4.8 field pattern) per `BlockType.properties` entry **that is not editable in place** (§8.1): number → input with numeric keyboard; boolean → check row; json → `code` text area, min height 120, validated on blur ("No es JSON válido", not sent). `required` adds " *". For a type missing from the collections: the unknown-type message of §6.3 and no fields. |
| **Conectar con…** | "Más" | medium | Search input (autofocus, placeholder "Buscar por título"), up to 8 result rows (type icon + title + `small` muted group name). `Enter` or press creates a `flow` connection from the selection to that row, selects it and closes. No results: `small` muted "Nada coincide con «{q}»." |
| **Ajustes del lienzo** | main menu | large, anchored to island A | Fields: "Descripción" (text area, 2 lines) · "Instrucciones para el asistente" (text area, min 3 lines, placeholder "Para qué es este lienzo y cómo debe ayudar el asistente", bound to the document's `communication.instructions`) · "Disposición" (the tiles above, for `document.layout`). For an example, first a `wash("aviso")` box: "Lienzo de ejemplo. Su contenido es ilustrativo y no viene de un asistente." |

Sections of the former inspector that have **no** replacement, by decision: identifiers and type
rows, numeric position and size fields, the list of a group's children (the canvas and Lista show
them), the list of groups to move into (drag into a group, §6.2; "Sacar del grupo" covers leaving).

### 5.4 Popovers of the Lienzo island

- **Lienzos** (title press) opens the Lienzos screen (§35.2). **History** and **Keyboard shortcuts** open the History
  screen and Settings → Shortcuts (§35).


## 6. Canvas, cards and groups

### 6.1 Viewport

The panel is the viewport; a single transformed world contains the document. Persisted positions
are parent-relative. Camera state is local, never a document edit. Pan adds pointer deltas;
zoom preserves its screen anchor. Wheel pans, command-wheel zooms at the pointer. **Middle mouse
(and held Space) always pans, wherever the press starts**, including over cards, controls and
interactive stages (§20.2 states the one iframe boundary).
A background tap clears selection; panning preserves it. Inputs and drawing controls consume their
own gestures. Canvas keyboard commands never run while an input owns the focus.

Camera fitting uses the safe area in §3.1. First open keeps readable 80-100% scale, places the
first content `canvas.initialZoom.topInset` 76 below the panel top (48 in compact, measured below
the docked bar) so it clears islands A and B, and avoids fitting a tall document into illegible text. Full fit is an
explicit action. There is no decorative grid; placement snaps to 8 world units.

### 6.2 Geometry and movement

Default card widths remain standard 288, wide 592 and node as defined by `graph.node`; a stored
block size wins. Height follows measured content unless fixed by a stored size. Groups enclose
their children, with header 36 and padding 16; nested headers are 32 with padding 12.

| Disposición | Behaviour |
| --- | --- |
| Pila | One column, default gap 12. Unsized cards stretch to the widest sibling. |
| Rejilla | 1-4 columns, default two. Wide cards span the row. |
| Flujo | One row in reading order, default gap 28. |
| Libre | Parent-relative stored positions, unplaced cards below the placed ones. |
| Grafo | Layered nodes following real links, down by default, optionally right. Cycles remain readable. |
| Automático | Existing layout inference from links and card sizes. |

Resolve sibling collisions after measurement, placing pinned entities first. Move only overlapping
siblings along the shorter right/down clearance. Keep groups around their children. Dragging
pins the moved entity while unpinned siblings continue to arrange automatically. Selection moves
together; a selected descendant travels once with its ancestor. Drop into the innermost open group
under the pointer, excluding descendants and closed groups. Target uses a dashed accent border and
"Soltar aquí". A completed drag writes one transaction, never a per-frame stream.

### 6.3 Cards

Card fill is surface1, border 1, radius 10, padding 12/14 with a 3-unit concept-tone spine. Type
label is sans sentence case; title is heading. No raw type identifier, author avatar, revision,
coordinate or pixel-size field appears. Unknown types preserve their data and say "This block’s type is not in your
catalog any more. Its content is kept; the agent can still read it."

Hover changes the border. Selection adds an accent border and halo without shifting content.
Keyboard focus adds a visible ring. Dragging lifts the card using existing motion tokens. No
persistent ellipsis button remains inside each card; contextual actions live in §5. Content
in-flight and failed-save states remain visible, with "No se guardó" and "Reintentar" as needed.
Instruction and save-state footers appear only when they have real content. Every renderer retains
its own content controls, using the type registry and §18 for learning blocks.

### 6.4 Groups

A group is a frame with editable title and description, disclosure chevron, child count and
optional instruction marker. Graph groups use a dashed region border; prose groups a solid frame.
Collapsed groups preserve membership and connections; links attach to their visible frame. Group
controls live in the selection toolbar. There are no group resize grips or manual pixel fields.


## 8. Direct manipulation: editing in place, `+` handles, quick-create

### 8.1 Editing text in place

Every text a person can author is edited where it is drawn, with `InlineText` (§4.7).

- **Start:** double-click (double-tap) on the text · `Enter` or `F2` with exactly one entity
  selected (starts on its first editable text) · typing a printable character with exactly one
  entity selected (replaces the first editable text, like a spreadsheet cell) · creating a block
  from island B, quick-create or a `+` handle (starts automatically). A double-click on a part of a
  card that is not text starts on the first editable text.
- **While editing:** the card keeps its selected border; the caret indicates editing and no extra ring surrounds the text; the card's drag, hover and `+` handles
  are off; the contextual toolbar is hidden; canvas shortcuts are suspended.
- **Keys:** single-line ; `Enter` commits; multi-line ; `Enter` adds a line, `⌘/Ctrl Enter`
  commits. `Tab` / `⇧Tab` commit and move to the block's next / previous editable text (wrapping
  ends editing). `Esc` cancels the uncommitted edit and restores the last confirmed value. Content undo remains available after a successful commit. Pressing anywhere else commits.
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
| Any block | title (`heading`, single-line) ; the title row is rendered while editing even if empty | "Título" |
| `note`, `text`, `callout`, `step` | `text`, multi-line | "Escribir aquí" |
| `node` | title · `summary` (multi-line, 2 lines at rest) · `details` in its side note (§15) | "Idea" · "Resumen en una línea" · "Explicación" |
| `code` | `code`, multi-line, `code` style | "Pegar o escribir código" |
| `checklist` | each item label; `Enter` commits and adds an item below, `⌫` on an empty item removes it | "Elemento" |
| `quiz` | `question` · each option (same list behaviour) | "Pregunta" · "Opción" |
| `metric` | `value` · `label` | "0" · "Qué mide" |
| `image-ref` | `caption` | "Pie de imagen" |
| `preview-frame` | `description` | "Qué muestra" |
| Connection | label | "Qué pasa por aquí" |

Everything else (numbers, booleans, JSON, URLs, language, status) is edited in a toolbar popover
(§5.2 type slot, §5.3 Datos).

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
- **Zoom.** Hidden below scale 0.25; from 0.25 to below 0.5 the disc is 12 px without the icon (hit
  area unchanged); from 0.5 up, full size. The resize grip (§17) is hidden below 0.25 as well.
- **Click** → creates a block of the source's type (a `node` when the source is a group or a type
  without a title-only form) on that side ; `graph.gap.layer` away along the handle's direction,
  aligned to the source's centre, then moved by the usual collision rule ; plus a `flow` connection
  source → new, in **one** transaction ("Añadir «{tipo}» conectado"). The new block is selected and
  its title is in edit mode. `Tab` while that title is still being edited commits it and repeats
  the gesture from the new block in the same direction, so a chain can be typed without the mouse.
- **Drag** (starts after 4 px) → the connection gesture of §15 / §17 with its magnetic targets.
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


## 9. Adding blocks and the Lista view

### 9.1 Adding

Everything is added from the bottom toolbar and its `+` catalog (§24); ⌘K runs the same entries. There are no
templates and no collections: a structure the person wants again is duplicated (⌘D) or drawn by the agent.
"Manage extensions…" at the foot of the catalog opens the Extensions screen (§35.5).

### 9.3 Lista view

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
- Connections are sentences under each entity (§15).
- Tap selects (the contextual toolbar appears above the row; on compact, the action bar). In-place
  editing works exactly as §8.1. `+` handles and quick-create do not exist here; "Más" offers
  "Mover antes" / "Mover después" for order.

## 10. The agent: one-way, no composer

Lienzo is one-way. The agent draws and reads; **the canvas never sends anything to it**. The person talks to the
agent in their usual chat (the Paseo conversation, or a terminal for the desktop app) and says "look at what I
selected"; the agent reads the selection with `canvas_selection`. So there is no composer island, no "Ask the agent"
item in the selection bar, Properties or ⌘K, no delivery chips ("Queued", "Sent", "Received by the agent"), no
queue counter and no queue toasts. Selecting never sends anything and never starts a turn; `setSelection` stays
debounced 250 ms.

### 10.1 Bottom of the panel

The bottom toolbar sits centred, 12 from the bottom edge (`face.toolbar.bottom`),
level with the minimap and the zoom control, in light and dark alike. What floated above the toolbar keeps its
offset from the toolbar: the "Agent's latest →" pill and the SVG library sit `face.toolbar.height + 12` above it,
the + catalog `face.catalog.offset` above it. On a compact panel the toolbar is the last row, docked with 6 above
and 8 below (`face.toolbar.compactPadding`); the selection bar docks above it.

### 10.2 What an interaction leaves

Interactions are stored, never sent. The agent reads them as the block's state:

| Press | Stored as |
| --- | --- |
| Quiz "Answer" | `data.answer` (a document edit; the explanation appears once answered) |
| Quiz "Show hint" | runtime `lastInteraction` `quiz.hint` |
| Form "Save" | the typed fields in `data`, then `lastInteraction` `form.save` |
| Controls, animated flow, shader (move, release, pause, reset) | their runtime state, plus `lastInteraction` |
| Mini app `lienzo.setState(value)` | runtime `{ state: value }` |

Block footers show only "Has instructions", "Saving…" and "Not saved · Retry". There is no "Ask for a hint" button on
the shader: a hint is something the person asks for in their chat.

### 10.3 The agent in the menu

The main menu's "Agent" row shows the agent working on this Lienzo (its title and, in Paseo, its status dot) and opens
the agent dialog: in Paseo, choose or pin the agent, sharing mode, tool injection and manual setup; in the desktop
app, "Connect an agent" with the MCP setup and the agents seen. Neither says anything about queues or waking.

## 11. States and first run

### 11.1 Empty canvas hints

Four persistent islands are the desktop limit at rest. With a selection, the contextual toolbar
is the fifth floating element. Hints are local text overlays, not saved blocks and not fake
assistant output. Show only the hint relevant to the current state.

| State | Hint and action |
| --- | --- |
| No document | "Un espacio para pensar con el asistente" and "Nuevo lienzo". Creation needs no form. |
| Empty document | "Doble clic para escribir una idea" at the centre; "Añadir un bloque" near B. |
| First block, no links | "Seleccionar para editar o conectar" near the block. Disappear after the first selection. |
| One selected block | Toolbar explains actions. No separate tutorial note obscures the content. |
| At least one connection | Hide empty-canvas hints. |
| Compact | Plain short hint in Lista and the same creation action; no hover arrows. |

Hints disappear during gestures, menus and input focus. Decorative arrows only orient users on an
empty canvas; there are no illustrations beside learning content.

### 11.2 Loading, offline, conflicts and errors

Document loading uses an honest loading label and a few placeholder cards; it never displays
simulated content. Existing content remains readable during refresh. A failed first read shows
"No se pudo abrir el lienzo" and "Reintentar". Catalog failure belongs inside the picker.
Offline banner says "Sin conexión con Paseo. El lienzo sigue disponible para leer." Disable writes
and preserve text drafts. Reconnect does not replace drafts silently.
A content conflict says "El lienzo cambió mientras se editaba. Este cambio no se guardó." Offer
"Reaplicar el cambio" and "Descartar" with the real rejected draft. Reapply uses the fresh revision.
Unknown errors use friendlyError; no credentials, paths, stack traces or raw server messages appear.

### 11.3 Guide once per host

The guide (§35.3) opens by itself once per host and from the menu ("Lienzo guide") and ⌘K. Save guideSeen
with the SDK host settings revision before opening it. Only a successful claim opens the guide.
Loading, invalid settings and errors keep it closed. Failed settings save offers retry; another
client's successful claim does not reopen it. Workspace switches and native/web client changes
share the same host preference. The menu always permits a manual opening.


## 12. Keyboard

Every shortcut lives in one registry, `plugin/client/shortcuts.ts` (§33): id, label, default keys, group and `when`
(always, a document, the canvas, a selection). The panel resolves the person's overrides against it and runs what
a key press spells. Keys typed into a field, a frame or an interactive control are left alone, except ⌘K and ⌘\.
A few contextual keys stay outside the registry because they depend on focus: Enter / F2 edit a selected text or
enter interaction mode, Tab / Shift+Tab walk the entities, arrows nudge 8 (Shift 32),
0 / + / − zoom. ⌘ on Apple platforms, Ctrl elsewhere.

## 13. Accessibility and quality

Text pairs in Papel/Tinta require at least 4.5:1; controls and marks at least 3:1 where applicable.
The contrast script checks the categorical palettes, washes and islands against both contributed
themes. Other host themes retain host text roles. Colour is accompanied by names, shapes or line
styles. Every text has an explicit theme colour. Tooltips are supplemental; accessible labels
remain on buttons. Touch actions have 44-unit targets. No state requires hover.

Focus order follows the visible interface, not hidden panels. Menus restore trigger focus.
A selected entity is keyboard reachable and editable. Native static fallbacks state their limit
and explain the current values. Reduced motion removes UI transitions and pulses; concept
animations remain paused by default and have a static stepping path. Do not auto-play audio.


## 15. Graphs and connections

Keep existing graph inference, node geometry, connector bundling and labels from the implemented
canvas. Real links attach to frame edges and follow dragging. Graph regions group related nodes;
collapsed regions keep external links visible. A node shows title, optional kind/status, summary
and expandable details. Status always includes words. Long explanations belong in details, not a
stack of notes around the graph.

Creating, deleting, relabelling and reversing connections use existing transactions. Type choices
are Flujo, Depende and Referencia with their real line styles. An automatic tone removes the stored
override through the supported transaction, never an unsupported null patch. Selection of a
connection clears entity selection. Clicking bundled connections cycles through the bundle.
Toolbar actions are specified in §5; creation handles and empty-drop behaviour in §8.2.
Lista expresses outgoing and incoming connections as labelled sentences and lets the user select
either endpoint or the connection. It never displays identifiers as labels.


## 16. Motion and dragging

Retain existing camera, overlap, group-target and magnetic port logic. No animated reflow during
a drag. Live positions and connectors follow every pointer frame; the persisted edit occurs at
release. **v7:** a drag may start anywhere on a card, not only its header; §20.2 lists which
controls keep their own drag. Dragging never captures an active input or a learning stage. Resize keeps stored content
and size separate. Hover/selection toolbars hide during dragging, resizing, panning and editing.
Animations use existing motion tokens and become immediate under reduced motion.


## 17. Media, sizes and magnetic links

Direct images keep zoom/pan and reference opening. Audio/video require a user action; embedded
providers show "Cargar reproductor". Unsafe or unsupported URLs show the friendly error. Web
frames and players stay inside web.ts, with external-opening or static native alternatives.

Stored block sizes remain undoable content. Selected desktop cards show a corner resize grip,
with a 44-unit touch target. Shift preserves aspect ratio. "Tamaño automático" clears the stored
size without changing data. The grip is hidden below 25% zoom. Groups size themselves to children.
Magnetic connections retain screen-space acquisition and release hysteresis. A visible target
ring and named destination distinguish a candidate from a committed connection. No feedback event
is emitted just because a link target was hovered.

## 18. Interactive learning blocks

### 18.1 Shared frame and purpose

Every manipulable block has one idea, a visible guiding question or goal, a stage and very few
controls. Default to at most three controls; a fourth needs a clear relation to the goal. Larger
parameter sets go in an optional popover. A bare slider is incomplete. The block title identifies
the idea; a sans question above the stage tells the learner what to investigate. A visible
"Reiniciar" resets the local experiment to its declared defaults. "Pedir una pista" asks for a
hint about the current attempt; it does not ask for the answer.

Use learn.frame, learn.stage and the existing card shell. Stage is surface0, radius 8, border 1,
with 16:10 default ratio, 16:9 for shaders. Stage height ranges from 160 to 420. Controls sit below
it and stay outside the camera gesture layer. There are no illustrations, gradients, decorative
motion or controls unrelated to the concept. Compact/native shows the same question and a static
summary with the chip "Estático" and "La interacción está disponible en la versión web".

### 18.2 Spec, current state and what the agent reads

Renderer data is declarative JSON validated by its shared schema. No agent-provided JavaScript,
HTML, evaluation functions or dynamic imports run. GLSL fragment
source is the only programmable exception; shader errors remain visible inside the block.

Document and group variable declarations are content and use revisions and undo. Current values,
playheads, attempts and bounded learner annotations use the runtime contract in learning-blocks.md.
Runtime is separate from content revisions. Reset clears relevant runtime overrides and returns
to declared defaults; it does not rewrite the authored figure. Do not reset sibling parameters
unless the block explicitly represents the shared controls of that scope.

Renderers update their own stage and sibling scope subscribers on every pointer/input frame.
Transport may debounce; visible feedback must not wait for pointer release or a server reply.
Nothing is sent to the agent. After the runtime flush succeeds, a settled move records the block's
`lastInteraction` with the final value and the explored range; the agent reads it with the block's state
when the person mentions the block in their chat. Never record animation frames, hover coordinates,
pointer moves or intermediate slider values.

A stored interaction is not a correct answer, and no label claims the agent has seen it. Hints refer to
the learner's attempt and guiding question; reveal a solution only if the learner explicitly asks the agent.

### 18.3 Variables and sliders

One declared name resolves to the nearest ancestor group, then to the document. A shared value
has the same colour and shape in controls, marks and legends; its identity follows declaration
order, not the consuming block. Local parameters use neutral ink. Use viz.series light/dark values;
a name or symbol accompanies every colour. Above six series, repeat colour with a distinct dash
style. Prefer four or fewer series per figure.

Slider row has a visible name, value with unit, bounded track and default tick. Values use
value typography with tabular numerals. While dragging the current value updates every frame.
Keyboard arrows use declared step; Home/End reach bounds. Touch targets are 44. Missing variables
show "Falta declarar la variable {name}" and disable only the affected control. A collapsed group
may show a short variables strip, but no empty strip appears without declarations.

### 18.4 Transport and readouts

Default to manual stepping. Prev/next flank "Paso {current} de {total}" with a caption. Play is
optional, clearly labelled and never starts automatically. A timeline scrubber updates continuously;
the recorded interaction holds the final position and explored interval. Leaving the document, hiding
its stage or unmounting stops timers. Reduced motion leaves a manual step path.
Hover/trace readouts use axis/value typography inside the stage, not floating cards over controls.
A pin action preserves a readout; keyboard navigation can reach the same sample without hover.

### 18.5 Renderer ownership and registration

The shared authoring and client runtime contract in [learning-blocks.md](learning-blocks.md) owns field names and
accepted shapes. This design fixes presentation and interaction. Each engineer owns one shared
renderer file, one client renderer file and its tests; the coordinator adds registry entries and
any required core integration after review. No engineer modifies another renderer or the core.
Use only web/desktop interactive adapters, plus an honest static native fallback.

The renderer briefs below fix presentation and interaction for the registered learning
renderers. Their schemas live in `plugin/shared/renderers/`.

### 18.9 Animated flow over canvas links

Animate events with t, from, to, payload and kind over real document nodes and connections.
The figure refers to existing IDs; it does not redraw a disconnected imitation of the graph.
A timeline scrubber and play/pause control advance tokens along active links. Token shape and
label identify its kind. A textual event row describes what moved. A deleted endpoint or missing
connection shows "La ruta ya no existe en este lienzo" and pauses that event.

Causal sign and delay must use an explicit validated schema. The current link contract has only
flow/depends/reference and must not receive unsupported keys. Store per-link simulation metadata
in the renderer's declarative spec keyed by real link IDs, or ask the coordinator for a separately
validated core extension. Show + / minus signs and delay labels on the active path so causal loops
can be inspected. Reset clears playhead and transient tokens, preserving graph content.

### 18.10 GLSL shader

A single declared fragment shader draws inside the existing WebGL adapter. Declared uniforms
produce only the few controls that support the guiding question. Uniform names matching numeric
scope variables bind to those values; local uniforms retain local defaults. Renderer-owned time
starts only after play. Never generate arbitrary source or HTML to build a control.

Compile and link errors appear as "No se pudo compilar el shader" plus the bounded compiler message
as code. Keep the control panel and reset available. If WebGL is unavailable, show "WebGL no está
disponible" and a declared static reference if present. Cap resolution, source size and uniforms;
release programs and drawing resources on unmount. Do not auto-start continuous rendering when
the stage is offscreen.

### 18.12 Freehand stroke layer

Store strokes as bounded declarative points, colour-role and width, with an anchor to the figure
or canvas. Learner strokes are solid; assistant strokes are dashed and labelled by author. The
pencil is a visible toggled tool; Esc exits it. Pencil, eraser and reset are the only persistent
controls. Drawing consumes pointer input, while the rest of the card still selects normally.

Simplify points and cap counts before storing. Current runtime has a 4 KiB block cap and 256 KiB
document cap; it is not an unlimited storage escape. Persistent document data has a 1 MiB cap.
If a complete layer cannot fit, show "La capa alcanzó su límite de tamaño" and preserve the prior
layer. A separate attachment/storage design requires coordinator review. Reset removes only the
learner's current experiment layer, preserving assistant and authored strokes. Nothing is sent; the agent
reads the strokes as blocks, and `canvas_selection` summarises them without points.

## 19. Copy and event honesty

English, sentence case, short and concrete, with the five glossary words of §33 (Lienzo, Marco, Hoja, Lente,
Ventana) used as names and explained where they appear. User-facing labels never include raw IDs, revision numbers
or schema names. Technical documentation may use API names. Argentine flavour only where nobody needs it to use the
app: empty states, onboarding, a few confirmations ("Listo.", "Dale.").

| Context | Copy |
| --- | --- |
| Lienzos | Lienzos; New Lienzo; Untitled Lienzo; Search Lienzos; Recent; Name; Rename; Duplicate; Delete…; No Lienzos yet. |
| Adding | More tools; Search tools, embeds, blocks…; Nothing matches “{q}”; Manage extensions… |
| Selection | Wrap in a Marco; Unwrap Marco; Duplicate; Delete; Properties |
| Marco | Add inside; Layout; Take out of the Marco |
| Link | Label; Kind (Flow, Needs, Mentions); Colour; Reverse |
| Agent | Agent; Works on this Lienzo; Connect an agent; Talk to the agent in its own app |
| Extensions | Add from file…; Export all mine; Export; Remove; Allow; Review “{file}”; Install; Read the guide |
| Settings | Shortcuts; Toolbar; Copilot; Agents; Extensions; About; Press keys…; Keys taken by {name}; Reset all; Reset toolbar |
| History | History; Today; Yesterday; Undo; Redo; Nothing yet. |
| Learning | Answer; Show hint; Save |
| Playback | Play; Pause; Reset |
| Persistence | Saving; Not saved; Retry; Apply my change again; Discard |
| Static fallback | Static; The interactive version is available on desktop and web. |

Lienzo ships no example documents. A stored document marked `example` keeps its "Example" chip (on its card and
title) and says that the data is illustrative. A result, agent status, successful
save is shown only after a confirmed tool/RPC response or live host signal. Nothing claims the agent saw anything. No renderer
fabricates an agent hint, answer or completed job.


## 20. Whiteboard: free text, shapes, SVG and freehand (v7)

Contract (type IDs, fields, limits, sanitising boundary, props): `design/whiteboard-spec.md`.
Numbers: `tokens.whiteboard`. This section fixes look and behaviour. Reference was a tldraw
screenshot; Lienzo keeps its own identity: paper and ink, system and serif type instead of a
hand-written face, eight theme-derived colour roles instead of a fixed palette, flat fills, no
sticky notes, no sketchy jitter.

### 20.1 The four elements

They are ordinary blocks (`wb-text`, `wb-shape`, `wb-svg`, `wb-draw`): they move, group, link,
duplicate, undo, export in packs and are reachable by the assistant exactly like cards. They are
**not cards**: no fill, border, spine, header, type label, footer or shadow, at any depth, inside
or outside a group.

| Element | At rest | Notes |
| --- | --- | --- |
| Texto libre | Just the text in its colour role. `scale` s/m/l/xl = 14/20, 18/26, 28/36, 44/52; `sans`, `serif` or `mono`, weight 400. | Auto-width up to 480 then wraps; a stored `width` wraps there. Height always measured. Empty text is never stored. |
| Forma | Outline in `weight` 1.5/2.5/4/7, fill none / colour@0.14 / colour@1 (then its text is `surface0`). Centred label 15/21 weight 500. | Rectángulo, Redondeado (radius 16), Elipse, Rombo, Triángulo, Hexágono, Cilindro, Línea; Flecha is a line with an open V head. Round joins and caps. |
| Imagen SVG | The sanitised image, aspect preserved, `currentColor` painted in the colour role. Optional caption `small` muted 4 below. | Painted as an image, never as inline DOM. Native without SVG support shows a dashed frame with the caption and "Imagen SVG; se ve en la versión web". |
| Dibujo | Strokes in their own colour and weight, round caps. Stroke width does not scale when resized. | One block per pencil session, at most 32 strokes. |

- **Paint order:** group frames · shapes and SVG · connections · cards · free text · drawings ·
  guides and handles. A shape can sit behind cards as a backdrop; a drawing annotates on top.
- **Layout:** always positioned, never auto-arranged, never pushed by or pushing a neighbour, in
  every group layout. No "Soltar posición" pin.
- **Hover** 1 px `foregroundMuted`@0.35 box 4 outside. **Selected** 1.5 px `accent` box 4 outside,
  no halo, plus square 8 px handles (`surface1`, 1.5 `accent` border; hit 20, touch 44): eight on
  shapes, SVG and drawings, east/west only on text, two round end handles on a line. Shift keeps
  proportion; SVG is always proportional. While moving: opacity 0.85, no lift shadow.
- **Hit area:** the box for text, SVG and filled shapes. For unfilled shapes, lines and drawings
  only an 8-screen-px band around the ink (plus a shape's label): the empty inside lets the
  pointer through to whatever is beneath.
- **Lista view and compact:** one row, type icon + text, caption, "Forma: rombo" or "Dibujo
  (3 trazos)". No miniature.
- **Assistant:** nothing is sent by drawing or placing. A drawing in selection context is
  summarised by stroke count, never by points.

### 20.2 Dragging, clicking and interaction mode

One rule with the Seleccionar tool: **a short press activates; moving more than 4 px before
release moves the element.** It holds over the whole card.

| Press starts on | Short click | Drag |
| --- | --- | --- |
| Card body, title, plain text, image | select | move |
| Button, checkbox, option, chip, connection row | the control | move; the control does not fire |
| Slider, scrub, drawing/shader stage with its own pointer, resize and connection handles | the control | the control |
| Text being edited | caret | text selection |
| Read-only selectable text (code) | select card | move, unless in interaction mode |
| Embedded page or player (`iframe`, video, audio) | select card | move, unless in interaction mode |
| Region with its own scroll | select card | move; wheel scrolls it only in interaction mode |

**Interaction mode** exists for the three things that cannot share a drag: selecting a text
range, using an embedded page, scrolling inside a card. Enter by double-click on that content,
`Enter` on the selected card, or "Interactuar" (`MousePointerClick`) in the contextual toolbar,
which appears only on cards that need it. While on: 2 px `accent` ring inside the card border and
a chip "Interactuando · Esc" (height 24, `label`, `surface1`, island elevation) 6 above the card's
top-right corner; the chip is a button that leaves. **The contextual toolbar is hidden while a
card is in interaction mode** (same rule as text editing), so the two never share that strip. The
card then moves only by its title row.
Leave with `Esc`, the chip, a click outside, or selecting anything else. It is view state, never
saved.

**Honest iframe boundary.** A browser does not deliver pointer events from inside an embedded
page to its host. Outside interaction mode the frame is therefore covered by a transparent shield
and behaves like an image: drag, middle-button pan and wheel all work over it. In interaction mode
the shield is gone and those gestures belong to the page; a middle-button press or `Esc` inside it
cannot reach Lienzo, which is why the chip stays outside the frame. Lienzo does not pretend
otherwise.

Learning controls that are a single click (bet, option, transport, layer chip) never need
interaction mode.

### 20.3 Tools

Seleccionar `V` · Mano `H` · Texto `T` · Forma `R` · Lápiz `D` · Goma `E`; `Esc` returns to
Seleccionar; held Space is a temporary Mano.

- **Mano** pans from anywhere and never selects.
- **Texto**: click places a caret there; dragging a box sets a wrap width. Confirm with
  `⌘/Ctrl Enter` or a click elsewhere; `Esc` cancels; an empty text leaves nothing behind.
- **Forma**: click drops the default 160 × 104; drag draws corner to corner (Shift 1:1; lines snap
  to 15°). Double-click a shape to write its label.
- **Lápiz**: every stroke is saved when the pointer lifts and is one undo step ("Dibujar trazo").
- **Goma** removes whole strokes it touches, one undo step per gesture ("Borrar trazos"); a
  drawing left without strokes disappears.
- After placing a text, shape or SVG the tool returns to Seleccionar with the new element
  selected. Double-clicking a tool button locks it (4 px `accent` dot under the icon) until `Esc`.
  Lápiz and Goma always stay until left.
- While a creation tool is active the whole canvas is its surface: cards neither press nor move.
  Cursors: `text`, `crosshair`, `crosshair`, `cell`; Mano `grab`/`grabbing`.
- New elements go into the innermost open group under the pointer, otherwise the canvas root.
- Offline or read-only: creation tools are disabled (opacity 0.45); Seleccionar and Mano remain.

### 20.4 Drawing tools

The drawing tools are in the bottom toolbar (§24): Pencil, Shape (its flyout: Rectangle, Ellipse, Diamond, Triangle,
Line), Text, Arrow, Eraser. Active tool: `accent`@0.14 fill, `accent` icon. A double press on the tool in hand keeps
it (a 4 px accent dot); Text, Shape and Arrow otherwise return to Select after one use. Rounded rectangle, hexagon
and cylinder are in the + catalog under Shapes & drawing, with the architecture icons and SVG import.

### 20.5 Style

Colour, size, fill, fill colour, stroke, font, alignment and arrowheads are a "Style" section of the right panel
(§31): in the Properties tab for selected drawings, in the tool's options tab ("Pencil options", "Shape options"…)
while a drawing tool is in hand. Only the sections that apply show. "Clear my strokes" sits in the Pencil and
Eraser options. The selection bar's colour button sets the stroke colour of selected drawings.

### 20.6 Narrow and compact

Compact draws with one finger and pans with two once a drawing tool is picked from the toolbar scroller; Select
returns to Lista. Moving and resizing stay off in compact, as for cards. Touch on a wider panel uses the 44 hit and
long-press 500 ms to add to the selection.

### 20.7 Drawing keys

From the registry (§33): V Select, H Hand, P Pencil, R Rectangle, O Ellipse, T Text, A Arrow, E Eraser, Space held =
Hand. Enter / F2 edits a selected text or shape label; Esc leaves, in order: text editing, interaction mode, the
tool in hand, the selection.

## 21. Shape labels and dense graphs (v8)

- **Label editing in place.** A shape's label is edited where it is drawn: the editor covers the shape,
  is transparent and borderless, centred both ways, in the label's own colour and size. The saved label is
  hidden while editing, so nothing moves or changes colour between editing and saved.
- **Fill colour.** `fillColor` (same eight colour roles) is independent of the outline; absent, the fill
  follows the outline. On a solid fill the label takes paper or ink, whichever contrasts.
- **One size step.** S/M/L/XL sets outline weight and label size together: 13/18, 15/21, 20/28, 28/36.
- **Calm dense graphs.** With more than 12 connectors between different containers
  (`graph.link.calm.threshold`), those connectors rest at alpha 0.16 and all labels are hidden until a
  node, group or link is hovered or selected; the focused links then show at full weight with labels.
  Connectors inside one area are unchanged.

Verified in RN-web (isolated omabox, light and dark): `design/whiteboard-harness/shape-label.cjs` (3 checks)
and `dense.cjs`; captures in `design/qa-shapes-legibility-2026-10-06/`. Not verified in installed Paseo or native.
- **Node cards follow their container.** `graph.node.density`: with up to 4 blocks in the same container a
  node card is 304 wide and shows up to 6 summary lines; up to 9, 256 wide and 4 lines; beyond that the
  compact card (224, 2 lines). Counted per container, so a crowded area does not shrink a quiet one. A card
  with a stored size shows as much summary as fits. Verified with `design/whiteboard-harness/cards.cjs`.

## 22. Clean block chrome, menu and picker (v9)

- **No obligatory labels.** A titled block shows no type eyebrow; its content says what it is. Only an
  untitled block keeps icon + type name, because nothing else names it. A node shows its eyebrow row only
  when `kind`, `status` or an instruction exists; `kind` no longer falls back to "Nodo". Qualifiers that
  repeat the obvious (`text` as a code language, "Web") are dropped; a meaningful one sits right of the title.
- **No card menu.** Cards carry no three-dot menu and never expand to show actions. Duplicate, delete,
  move and details live in the selection toolbar, which appears for whatever is selected.
- **Detail popover.** The selected card rises above its neighbours (z 3) and its detail note is an opaque
  popover with the `popover` elevation, so it never shows through other cards.
- **Menu.** "Más acciones" opens a 288 wide dropdown under the title island on wide panels (a sheet on
  compact). Rows are 34 high (44 compact), icon 16 + name on one left edge, shortcut right-aligned, groups
  separated by 1 px dividers without headings: document · history · selection (only with a selection) ·
  view · assistant · catalog · settings. Escape or a click outside closes it.
- **Add a block.** Search, then sections "Básicos", "Interactivos", "Pizarra" as a two-column list of
  icon 28 + name rows (one column on compact). Descriptions are not in the rows: the hovered block's
  description shows in a fixed footer. Group, media by URL and SVG import are rows of "Básicos".

Verified in RN-web (isolated omabox): `design/whiteboard-harness/chrome.cjs`; captures `chrome-*.png` in
`design/qa-shapes-legibility-2026-10-06/`. Not verified in installed Paseo or native.

## 23. File tree block (v10)

`fileTree` tokens: rows 26 (36 compact), 16 per level with a 1 px guide in `border`, chevron 12, icon 14,
gap 6. Names in the code face, 600 for directories and highlighted entries; the note follows the name in
`small` muted on the same line, truncated. A highlighted row has an accent wash (0.14) and accent name; a
muted entry and everything under it is at 0.5. A closed directory shows its child count on the right.
An entry paired with a card (explicit `ref`, or a card titled after its path) shows a 12 px arrow at the
right; pressing the row selects that card (pressing again clears it) and, on a paired folder, the chevron
alone opens and closes it. While its card is selected the row has a stronger accent wash (0.24) and an
accent name. Unpaired rows are pressable only when they are directories with children. Verified with `design/whiteboard-harness/tree.cjs`
(RN-web, isolated omabox); capture `design/qa-shapes-legibility-2026-10-06/file-tree.png`.

## 24. Bottom toolbar and the + catalog

**Toolbar** (`face.toolbar`, `client/Toolbar.tsx`). A floating island centred on the bottom edge, 12 from it (`face.toolbar.bottom`),
44 tall with 36 buttons (44 on compact), icon 18, 4 apart, 1 × 20 dividers between groups. Order: Select, Hand ┃
Pencil, Shape (chevron; pressing it again opens the flyout: rectangle R, ellipse O, diamond, triangle, line), Text,
Arrow, Eraser ┃ Marco, Ventana ┃ pinned tools in pin order, each with its 1–9 badge ┃ `+`. Marco adds an empty
Marco in the middle of the view (inside the selected Marco, if any); Ventana asks for an address and adds a web
page, or a player for an image, video or sound link. On compact the toolbar is one horizontal scroller.

**`+` catalog** (`face.catalog`, `client/AddMenu.tsx`). A popover anchored to `+` (right edges aligned), 360 wide, up
to 480 tall. A search field on top, focused on open; then sections Pinned, Shapes & drawing, Embeds (Ventana, image,
video, audio, mini app, file tree), Blocks (every catalog block type), Extensions (tools from
extensions); "Manage extensions…" at the bottom opens the Extensions screen (§35.5). Rows are 44: a 28 tile in the type's
tone, the name, one line of description, the shortcut on the right; hovering shows the pin toggle. Pins persist in
the host's `interface` settings and give keys 1–9. Search matches names fuzzily and keywords and descriptions by
whole words; arrows move, Enter adds, Esc closes. Verified with `design/whiteboard-harness/face.cjs` and
`chrome.cjs`; captures in `design/qa-face-2026-10/`.

## 25. Wayfinding: minimap and selection beacon (v12)

- **Minimap** (`canvas.minimap`). Bottom-left island, 184 × 116, on non-compact panels at least 720 wide
  with four or more visible entities. Areas are 1 px outlines, cards are filled marks in muted ink,
  selected entities are accent. The part on screen is an accent frame with a 0.1 wash that follows the
  camera every frame. Pressing a point flies the view there (the zoom step duration); dragging moves it
  directly. It never changes the document.
- **Selection beacon** (`canvas.beacon`), for a single selection.
  - Out of sight: a chip sits on the edge of the safe area (insets 72 top and right, 148 bottom, 76 left,
    clear of the islands) on the side the entity lies: accent border, a 20 px arrow badge rotated towards
    it, its title. Pressing it frames the entity. It enters in 160 ms from 0.92 scale and leaves in 100 ms.
  - In sight but selected from elsewhere (a file tree row, a list, not by pressing the card): one accent
    ring opens around the card from 1 to 1.12 and fades over 700 ms. Pressing the card itself gives no
    ring. No ring with reduced motion.

Verified with `design/whiteboard-harness/wayfinding.cjs` (RN-web, isolated omabox); captures
`wayfinding-chip.png` and `wayfinding-map.png` in `design/qa-shapes-legibility-2026-10-06/`.

## 26. Box selection (v13)

With a pointer (web, non-compact) and the select tool, dragging over the canvas draws a selection box:
1 px accent border, accent wash 0.1, radius 2. On release it selects every card it touches and only the
areas it fully contains; a card inside a contained area is not selected separately. Shift, Ctrl or Cmd
adds to the current selection; a box over nothing clears it. The view does not move: panning is the hand
tool, Space + drag, the middle button, or the wheel/trackpad. Touch and compact keep one-finger panning.
A plain click anywhere on a card (its text or padding, not only its title) selects it.
Verified with `design/whiteboard-harness/marquee.cjs` and `basic.cjs`; capture `marquee.png`.

## 27. Lienzo cursors (v14)

On the web the canvas uses its own cursors (`plugin/client/cursors.ts`, `whiteboard.tools.cursor`): 24 px
drawings in the theme's ink (line 1.5) over a paper halo (+2.5) so they read on any surface, with the
accent marking the exact acting point. Each carries its hot spot and falls back to the system cursor.

| Tool | Drawing | Hot spot | Fallback |
|---|---|---|---|
| Select | filled ink arrow, paper outline | tip (5, 3) | `default` |
| Hand | open hand; closed hand while the button is held | centre | `grab` / `grabbing` |
| Text | I-beam | centre | `text` |
| Shape | cross with a 4 px gap and an accent point | centre | `crosshair` |
| Pencil | ring of 5.5 with an accent point where the ink lands | centre | `crosshair` |
| Eraser | ring of its 10 px reach | centre | `cell` |

Cards show the open hand with the select tool and the closed hand while carried; with any other tool its
cursor shows through them. Buttons keep the system pointer. Verified with
`design/whiteboard-harness/cursors.cjs`; sheet in `design/qa-shapes-legibility-2026-10-06/cursors.png`.

## 28. Windows and mini apps (v15)

- **Windows.** A web page (`preview`), media (`media`) and a mini app (`html`) are drawn as a window, not as
  a card: radius 10, a 1.5 border in muted ink at 0.55 (0.8 on hover, accent when selected), a 28 high bar
  (36 compact) with the name in `small` 600 muted, and the content edge to edge beneath it. There is no type
  label, no address row and no hint text. The bar is the handle to drag it by; an untitled page is named by
  its host. The only button is "Abrir fuera del lienzo" when there is a link. A media caption sits under the
  content.
- **Mini app (`html`).** `data.html` is a complete page with any HTML, CSS and JavaScript, shown in a
  sandboxed frame (`allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups`, no
  `allow-same-origin`, so an opaque origin with no access to the canvas page). Double click enters it, as
  with other deep content. A `lienzo` object is injected before the page. It never reaches the agent: `setState(value)` stores
  plain JSON up to 3000 characters on the block (resolving once saved, rejecting otherwise) for the agent to read,
  and `state` gives it back; a legacy `send(kind, payload)` only records the block's `lastInteraction`;
  `onContext(fn)` receives theme colours, the block, its stored state, the document and up to 20 selected
  entities, now and on change; `select(id)` selects an existing entity; `resize(height)` is
  clamped to 80..1600. Native shows a plain notice.

Verified with `design/whiteboard-harness/windows.cjs` (RN-web, isolated omabox); capture
`design/qa-shapes-legibility-2026-10-06/windows.png`.

## 29. Lenses

Lente (Spanish for lens) is a way to colour the same canvas. The lenses that use history read what the server
stores, the 50 most recent changes, and say so.

A control above the minimap names the lens in use; each press, or L, moves to the next: none, Who changed it, How
fresh, The agent's version. A lens keeps every card in place and lays a mark over it (`lens`:
2 px border, 0.2 fill, radius 12, 2 px outset; neutral states at half fill). Who changed it: accent for the person,
violet for the agent, neutral without a stored change. How fresh: changed within 2 revisions (risk tone), within 10
(warning), earlier (turquoise), not stored (neutral). The agent's version: as the agent left it where the agent
changed it last (success), "You changed it since" where the person edited it after the agent's last edit (warning),
not touched by the agent otherwise (neutral); it is derived from stored changes and claims nothing more. There is no
lens built on messages to the agent, because there are none. Marks hide while dragging. Logic in `plugin/client/lenses.ts`, tested
in `tests/lenses.test.ts`.

## 30. One view

The canvas is the only way to look at a Lienzo. A compact panel shows Lista (the same document as a scrolling list
of cards and Marcos) without anyone choosing it, and switches to the canvas while a drawing tool or the hand is in
use. There is no view switcher, no alternative readings and no extension views.

## 31. Properties, the selection bar and ⌘K

**Right panel** (`face.rightPanel`, `client/RightPanel.tsx`). A floating island, 300 wide, right inset 12, its top
under the top islands, its height to above the zoom. It shows when something is selected, when the tool in hand has
options, or when an extension tool is open, with a tab per source: Properties (the selection), "<Tool> options", and
one tab per extension tool; picking a drawing tool brings its tab forward. The pin keeps it open with nothing
selected, showing the Lienzo (description, instructions for the agent, layout); ⌘\ and the `PanelRight` button hide
it or bring it back. Sections fold under 12 px headers. A block shows Content (title and every field of its type),
Style for drawings, Instructions for the agent (with those it inherits), Connect (search a target) and Actions (edit
on the canvas, interact, reset, duplicate, export, release position, take out of the Marco, move
earlier/later, automatic size, delete). A Marco adds its title and purpose, Layout and Variables. A link shows label,
kind, colour, reverse and delete. A result still hidden behind a learning gate is never named. On compact the panel
is a sheet.

**Selection bar** (`face.selectionBar`). A small bar above the selection, below when there is no room: colour (for
drawings and links), Wrap in a Marco (Unwrap for a Marco), Duplicate, Delete;
32 buttons. A link gets colour, kind, reverse and delete. Detail lives in the right panel.

**Command palette** (`face.palette`, `client/CommandPalette.tsx`, model in `client/palette.ts`). ⌘K / Ctrl+K, or the
top-right button. Centred, 640 wide, its top at 18 % of the panel, a 52 px search field with a leading icon, results
under small-caps headers in rows of 40 (icon, title, muted subtitle, shortcut chips), the active row in a soft accent
fill. Footer: "↵ Open · ⌘↵ Run in background · Esc Close" and the active row's verb. Groups: Recent (on an empty
query), Tools, Actions, Hojas (every Hoja, the agent's latest, follow), Lienzos, Extensions, Settings. Nothing in it sends to the agent. Titles match fuzzily; keywords and subtitles
by whole words. Keyboard alone works fully; so does the mouse.

## 32. Extension tools

A person or their agent can add a tool without touching the plugin (contract in `docs/extensions.md`). Tools are
listed in the + catalog's Extensions section and open as a tab of the right panel, working on the shared selection;
several can be open at once. An imported tool that asks for a permission shows a warning-toned strip saying what it
asks for in words and a single "Allow". "Manage extensions…" opens the Extensions screen (§35.5).
Extensions take every colour from the theme they are given. Verified with `design/whiteboard-harness/extensions.cjs`.

## 33. Shortcuts, tooltips, words and small details

**Shortcuts** (`client/shortcuts.ts`). Tools: V Select, H Hand, P Pencil, R Rectangle, O Ellipse, T Text, A Arrow,
E Eraser, M Marco, W Ventana, L next Lente, Space held = Hand, 1–9 pinned tools. Navigation: ⌘K palette, [ / ]
previous / next Hoja, ⌘J jump to Hoja, F follow the agent, G the agent's latest (these five are registered now and
Hojas and the agent, see §34), Shift+1 fit all, Shift+2 fit selection, ⌘\ right panel, ⌘. hide all UI, ? the sheet. Editing: ⌘Z,
⌘⇧Z, ⌘D duplicate, ⌘G wrap in a Marco, ⌘⇧G unwrap, Delete / Backspace, Esc, ⌘A. The person's overrides win, then
ours, then extensions' in the order they register; a combination already taken is not assigned and is listed as
"unassigned" with whose keys they are. `?` opens Settings → Shortcuts, which lists everything and reassigns
in place: press the key chip, then the new keys (§35.4); overrides persist in the host's `interface` settings.

**Tooltips** (`tooltip`, `Tooltip` / `useTooltip` / `TooltipLayer` in `ui.tsx`). One layer per panel draws them above
everything. Name, then the shortcut in muted monospace ("Pencil  P"); a second line for glossary words. They appear
after 500 ms; once one has shown, the next appears at once for 800 ms. They sit 6 px from the control on the side
away from the nearest panel edge and never cover it; a press hides them; on touch a long press shows one for 1.6 s.

**Words.** The interface is in English with five Spanish brand words, each explained in English where it appears in
a surface: Lienzo (this canvas, and each document), Marco (a frame that holds things together), Hoja (a chapter the
agent adds while explaining), Lente (a way to colour the same canvas), Ventana (a window onto a web page, a video or
a mini app). The agent still answers in the person's language.

**Small details** (`face.eggs`, `client/Eggs.tsx`). An empty canvas shows a hand-drawn mate with rising steam and
"Empty. Pour yourself a mate." Typing "mate" in ⌘K boils a small kettle in the bottom-right corner for 4 s ("80 °C.
Never boiling, for mate."). A loading Lienzo sometimes shows a small turning Sol de Mayo or a tango step. Some
confirmations say "Listo." or "Dale.". None of them covers content; under reduced motion the mate stays still and the
kettle and the loading details do not appear.

Verified with `design/whiteboard-harness/face.cjs` (RN-web, isolated omabox, example data, dark and light); captures
in `design/qa-face-2026-10/`.

## 34. Following the agent and Hojas (copilot, canvas side)

The top-left island ends, after a divider, with "Hoja 3 of 7 ▾" (only when the Lienzo has Hojas) and a magnet. A
Hoja is a top-level Marco the agent added as a chapter; its header shows "Hoja N" instead of an ordinal. The menu
lists every Hoja (number, title, the current one washed in the accent); `[` `]` step and ⌘J opens the menu; ⌘K lists
them under Hojas. The current Hoja is the one holding the centre of the view, read live from the camera.

The magnet is on by default: each new transaction of the agent flies the camera to what it changed, and that glows
for 3 s (2 px accent ring with a soft accent shadow, 6 px outside the entity). Moving the camera yourself (wheel,
middle button, Hand, two fingers) or jumping to a Hoja lets go. While not following, the agent's next change shows
a pill above the toolbar, "● Agent's latest · ‹label› →"; it and `G` take you there and follow again; `F` toggles.
The conversation chip's "Go to latest" and "Open Lienzo" open this panel on the right document and land the same
way. Logic in `plugin/client/Hojas.tsx` and `hojas-model.ts`; verified with `design/whiteboard-harness/copilot.cjs`.

## 35. The screens around the canvas

Lienzos, the guide, Settings, Extensions and History are screens, not small modals (`client/Screen.tsx`, tokens
`face.screens`). They share one language; the logic behind them lives in `client/screens.ts` and is tested on its own
(`tests/screens.test.ts`). Verified with `design/whiteboard-harness/screens.cjs` (dark, `papel`, compact) and
`desktop-screens.cjs` (the desktop preview); captures in `design/qa-screens-2026-10/`.

### 35.1 Shared language

- **The sheet.** One floating sheet over the canvas, up to 960 × 680, 24 from the panel edges, radius 16, `surface1`
  (raised) with a 1 px `border` and a soft long shadow (`face.screens.shadow`); the canvas behind is dimmed 40 %
  (`#000` in dark, `foreground` in light). It opens in 220 ms ease-out (scale 0.98 → 1 and fade). Escape, the close
  button in the corner or a press on the dimmed canvas closes it. Compact: full screen, no radius.
- **Two columns** where there is navigation (Settings): a 220 rail on `surface0` (small-caps title, 36 rows, icon and
  label, the active row washed in the accent at 12 %) and the content with 32 padding. On compact the rail becomes a
  row of chips under the close button.
- **Header.** One serif display title per screen (30/36, −0.4 tracking; 24 on compact), one muted line saying what the
  screen is for, the screen's actions on the title row, and its controls (search, sort) under it at full width.
- **Cards.** Radius 12 on `surface0`, 18 padding. A pressable card lifts on hover: the border goes to `foreground` at
  20 % and it rises 1 px (160 ms ease-out). Actions sit beside a pressable card, never inside it. Section labels are
  11 px small caps, 0.06 em tracking, muted.
- **Motion.** Lists come in 30 ms apart (fade and 6 px lift, at most 12 steps). Nothing loops unless it explains
  something (the key chip waiting for keys, the guide's scenes). Everything is instant under reduced motion.

### 35.2 Lienzos

The home of the app, from the title, the menu and ⌘K ("All Lienzos"). A grid of cards, 3–4 columns by width (2 on
compact), 16 apart. Each card is a live thumbnail drawn from the Lienzo's real layout, like the minimap: Marcos as
outlines (Hojas in the accent), cards as filled marks in their tones, drawings as faint marks, links as thin lines
between centres; a single small card is not blown up. Under it the serif title (two lines), "Edited 3 h ago · 24
blocks · 3 Hojas", and the agent working on it (dot and name; the accent while it works). The open Lienzo has an
accent ring. Search filters as you type (accents and case ignored, every word); sort is Recent · Name. Hovering a
card shows ⋯: Rename (in place), Duplicate, Delete… (a confirmation inside the card). Choosing a card opens it and
closes the sheet. Empty: the mate, "No Lienzos yet." and "Start one, or ask your agent to draw something." There are
no examples; a stored document marked as an example keeps an "Example" chip by its meta line.

### 35.3 The guide

Four scenes on a large stage (60 % of the sheet; on top on compact) with the words on the right: the agent draws
while it works (a sentence types in a chat; cards and arrows appear and the camera settles), Hojas (three chapters
slide in along a strip, the "Hoja 2 of 3" pill counts, the magnet glows while the camera follows), point and ask in
your own chat (a cursor selects a card, "mirá esto" arrives in the chat, a dashed line shows the agent reading the
selection), and make your own tools (a code card types `lienzo.edit([...])`, folds into an icon and drops into the
toolbar; "Works in Paseo and the desktop app"). Each scene plays by itself for 6 s with a thin progress bar; Back,
Next, Skip and dots; the last button says "Dale, let’s start". The stage is a picture: nothing on it is pressable.
Drawn with Animated views in the theme's colours, in a fixed 560 × 420 space scaled to fit. Under reduced motion each
scene shows its last frame and waits for Next. Shown once per host (§11.3), and from the menu and ⌘K.

### 35.4 Settings

Only sections that exist: **Shortcuts** — search, "Reset all", groups (Tools, Navigation, Editing, Extensions) as two
columns of 40 rows: label on the left, key chips on the right. Pressing a chip records in place (it pulses "Press
keys…", Escape cancels); keys another shortcut held move here and that row shows a small warning chip "Keys taken by
…"; an edited row shows a reset icon. **Toolbar** — the pinned tools in order with their keys 1–9, move earlier or
later, unpin, "Reset toolbar". **Copilot** (Paseo) — there are no stored copilot defaults, so it explains the chip in
the composer and the four cadences, with a link to the guide. **Agents** (desktop) — the MCP address, the commands
for Claude Code, Codex and Cursor, and the agents seen (the host's `AgentSettings` slot). **Extensions** — §35.5,
embedded. **About** — version, where it runs, the one file that holds every Lienzo (copyable), links to the docs.

### 35.5 Extensions

Installed extensions as cards (two columns when there is room): icon tile, name, "Made by you or your agent" or the
file it came from, the description, permissions as chips ("Changes the canvas", "Loads from the internet", or "Reads
and selects only"), a warning strip with "Allow" while an imported one waits for permission, Export and Remove (with a
confirmation; an extension that came in a file is removed with its file). "Add from file…" reads an extension file
and shows a review before anything is saved: what the file brings, what each extension asks for, whether it is new
or replaces one, and a "Replace the installed file" box when it is already there; then "Install". "Export all mine"
saves the ones made here in one file. "Write your own" says what an extension is and links to `docs/extensions.md`.
Errors are said in words ("This file carries block types, templates or documents, which Lienzo no longer imports.").

### 35.6 History

The stored transactions of the open Lienzo as a timeline grouped by day ("Today", "Yesterday", "Friday 16 October").
Each entry: a round glyph on a thin rail, the actor ("You", or the agent's name after a dot in its own tone), what
happened (the transaction label) and the time; undo and redo entries show their own glyph. Chips name the changed
things that still exist; pressing one closes the sheet, selects it and flies the camera there. Undo and Redo sit on
the title row. Empty: "Nothing yet."
