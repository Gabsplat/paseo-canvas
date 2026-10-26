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
- **Language:** (historical, v1–v12) Spanish, sentence case, no exclamation marks, no emoji. Interface text is
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
  screens drawn by the plugin over the canvas (§35), not host modals; small dialogs (Window address, SVG import, the
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
│  [Lens]                                                               │
│  [map]  [ V H │ P ▢ T ↗ E │ M W │ pinned… │ + ]          [ − 100% + ]  │  bottom toolbar
└────────────────────────────────────────────────────────────────────────┘
```

Every island floats over the one canvas with `pointerEvents: "box-none"` around it; nothing reserves space.

| Island | Position | Content |
| --- | --- | --- |
| Top-left | inset 12, 44 tall | `Menu` (main menu, §3.2) · **title** (serif `groupTitle`, max 280, 160 under 880, `ChevronDown` 12 after it; press → Lienzos) · chip "Example" · save dot. Stage 2 adds the Sheet menu after the title. |
| Top-right | inset 12, 44 tall | `Search` "Search and commands" (⌘K, §31) · `PanelRight` "Properties" (⌘\, active while the right panel shows) |
| Bottom toolbar | centred on the bottom edge, inset 12 (`face.toolbar.bottom`) | §24 |
| Right panel | right inset 12, under the top islands | §31 |
| Lens · minimap | bottom-left | §25, §29 |
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

**A Frame moves only by its header** (Sheets too). With the select tool:

| Press starts on | Click | Drag |
| --- | --- | --- |
| Header (title bar, outside the chevron and the Properties button) | select the Frame | move the Frame; Alt copies it, Shift keeps one axis |
| Anything inside (card, shape outline, drawing stroke, text, nested Frame's header) | select it | move it, never the Frame |
| Inside a hollow shape | select the shape | selection box |
| Empty body | clear the selection | selection box, as on the bare canvas (the hand tool pans) |

Children sit above their Frame, so they always win the press. The header shows the open hand of a card;
the body shows the canvas's own cursor and nothing else. A selected Frame still nudges with the arrow
keys and duplicates with ⌘D.

**Lock position** (`group.locked`, set from the Frame section of Properties or the lock button of the
selection bar; agents may set it with a group update). A locked Frame does not move by its header, the
arrow keys, align, distribute or flip; its header still selects it, shows no hand and carries a 12 px
`Lock` glyph after the title ("Position locked"). What is inside still moves and edits. No shortcut.


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
Keyboard arrows use declared step; Home/End reach bounds. Touch targets are 44. An on/off variable is a check row
(the label, checked when 1); a choice is a row of pill buttons, the chosen one in the accent; both save at once. A
missing variable shows "{name} is not declared on this Frame or the Lienzo. Declare it in Properties → Variables." and
disables only that control. A collapsed group may show a short variables strip, but no empty strip appears without
declarations.

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

A single declared fragment shader draws inside the existing WebGL adapter. Since §37.3 the card is the picture
alone by default; the question, title, sliders, Reset and autoplay are optional. Declared uniforms
produce only the few controls that support what is being explored. Uniform names matching numeric
scope variables bind to those values; local uniforms retain local defaults. Renderer-owned time
starts only after play. Never generate arbitrary source or HTML to build a control.

Compile and link errors appear as "The shader did not compile" plus the bounded compiler message
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

English, sentence case, short and concrete; Lienzo is the only Spanish word, and Frame, Sheet, Lens and Window
are used as names. User-facing labels never include raw IDs, revision numbers
or schema names. Technical documentation may use API names. Argentine flavour only where nobody needs it to use the
app: empty states, onboarding, a few confirmations ("Listo.", "Dale.").

| Context | Copy |
| --- | --- |
| Lienzos | Lienzos; New Lienzo; Untitled Lienzo; Search Lienzos; Recent; Name; Rename; Duplicate; Delete…; No Lienzos yet. |
| Adding | More tools; Search tools, embeds, blocks…; Nothing matches “{q}”; Manage extensions… |
| Selection | Wrap in a Frame; Unwrap Frame; Duplicate; Delete; Properties |
| Frame | Add inside; Layout; Take out of the Frame |
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
| Texto libre | Just the text in its colour role. `scale` s/m/l/xl = 14/20, 18/26, 28/36, 44/52; or its own `fontSize` 8–400 (a corner handle scaled it; line height keeps the step's ratio); `sans`, `serif` or `mono`, weight 400. | Auto-width (as wide as the longest line) up to 480 then wraps; a stored `width` wraps there. Width and height are the measured box. Empty text is never stored. |
| Forma | Outline in `weight` 1.5/2.5/4/7, fill none / colour@0.14 / colour@1 (then its text is `surface0`). Centred label 15/21 weight 500. | Rectángulo, Redondeado (radius 16), Elipse, Rombo, Triángulo, Hexágono, Cilindro, Línea; Flecha is a line with an open V head. Round joins and caps. |
| Imagen SVG | The sanitised image, aspect preserved, `currentColor` painted in the colour role. Optional caption `small` muted 4 below. | Painted as an image, never as inline DOM. Native without SVG support shows a dashed frame with the caption and "Imagen SVG; se ve en la versión web". |
| Dibujo | Strokes in their own colour and weight, round caps. Stroke width does not scale when resized. | One block per pencil stroke. An agent's illustration or an older drawing may hold up to 32; "Split strokes" (selection bar, Scissors) separates them. |

- **Paint order:** group frames · shapes and SVG · connections · cards · free text · drawings ·
  guides and handles. A shape can sit behind cards as a backdrop; a drawing annotates on top.
- **Layout:** always positioned, never auto-arranged, never pushed by or pushing a neighbour, in
  every group layout. No "Soltar posición" pin.
- **Hover** 1 px `foregroundMuted`@0.35 box 4 outside. **Selected** 1.5 px `accent` box 4 outside,
  no halo, plus square 8 px handles (`surface1`, 1.5 `accent` border; hit 20, touch 44): eight on
  shapes, SVG and drawings, four corners plus east/west on text, two round end handles on a line. Shift keeps
  proportion; SVG is always proportional; Alt resizes about the centre (twice the pull). On text a corner
  **scales** it (tldraw): font, box and any wrap width by one factor, font held within 8–400, nothing rewraps;
  east/west set the wrap width and the text reflows, height following. The handles are pointer events on web,
  so Alt and Shift reach them (react-native-web's responder drops Alt). A handle moves only its own edges: the opposite corner or
  side stays put (a proportional side handle grows the other axis evenly about the centre), sizes
  stay between 24 (8 for lines and drawings) and 4096, and nothing ever jumps. The box, its fill,
  stroke and label are drawn at the live size during the drag; release only saves. While a box
  shows its handles, the connect handle steps out past the middle one. While moving: opacity
  0.85, no lift shadow.
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
- **Texto**: click places a caret there; dragging a box sets a wrap width. `Enter` is a new line;
  `⌘/Ctrl Enter`, `Esc` or a click elsewhere saves (tldraw); an empty text leaves nothing behind.
  **Typing grows the box** on every key: an invisible copy of the draft in the saved text's own type sizes it
  and the field lies exactly over that copy, so it never scrolls inside and the saved text lands on the same
  lines, to the pixel. Trailing blank lines are dropped on save. Undo inside the field is the browser's.
- **Forma**: click drops the default 160 × 104; drag draws corner to corner (Shift 1:1; lines snap
  to 15°). Double-click a shape (anywhere inside, filled or not) or press Enter to write its label;
  typing with one shape selected starts the label with that key. A label is never text-selected by
  a press: press and drag on it moves the shape. While editing a hollow shape the line gets an
  `accent`@0.06 wash, an `accent` caret and a "Label" placeholder at 60 % of the text colour.
- **Hollow shapes** (tldraw's rule): their inside is empty canvas until it is the only thing under
  the pointer. A click there selects the smallest shape containing it, a double-click edits it, a
  drag still draws a selection box (so a big frame-like box never blocks marquee selection).
  Once selected, the whole inside drags the shape.
- **Lápiz**: every stroke is saved when the pointer lifts and is one undo step ("Dibujar trazo").
- **Goma** removes whole strokes it touches (hit along the stroke's path within 10 screen px, not
  its box), one undo step per gesture ("Borrar trazos"). While dragging, touched strokes fade to
  22 % opacity; release removes them, `Esc` restores them. Inside a multi-stroke drawing only the
  touched strokes go and the drawing is refitted; a drawing left without strokes disappears.
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

- **Label editing grows the shape.** The label wraps within the shape's inner width (minus `label.padding`
  each side); when its lines need more than the shape's height (plus padding above and below) the shape grows
  downward while typing and that height is saved with the label, in one step (tldraw). `Esc`, `⌘/Ctrl Enter`
  or a click elsewhere saves; `Enter` is a new line.
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
Arrow, Eraser ┃ Frame, Window ┃ pinned tools in pin order, each with its 1–9 badge ┃ `+`. Frame adds an empty
Frame in the middle of the view (inside the selected Frame, if any); Window asks for an address and adds a web
page, or a player for an image, video or sound link. On compact the toolbar is one horizontal scroller.

**`+` catalog** (`face.catalog`, `client/AddMenu.tsx`). A popover anchored to `+` (right edges aligned), 360 wide, up
to 480 tall. A search field on top, focused on open; then sections Pinned, Shapes & drawing, Embeds (Window, image,
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
| Resize handle | double arrow along the handle's axis (one drawing, turned 0/90/45/−45°) | centre | `ew-resize` / `ns-resize` / `nwse-resize` / `nesw-resize` |

Cards show the open hand with the select tool and the closed hand while carried; with any other tool its
cursor shows through them. Resize handles (whiteboard boxes and the card grip) show the double arrow of
their axis; a line's ends show the shape cross. Once a handle is pressed its cursor holds over everything
until release, whatever lies under the pointer. Buttons keep the system pointer. Verified with
`design/whiteboard-harness/cursors.cjs` and `resize.cjs`; sheet in `design/qa-shapes-legibility-2026-10-06/cursors.png`.

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

Lens is a way to colour the same canvas. The lenses that use history read what the server
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
of cards and Frames) without anyone choosing it, and switches to the canvas while a drawing tool or the hand is in
use. There is no view switcher, no alternative readings and no extension views.

## 31. Properties, the selection bar and ⌘K

**Right panel** (`face.rightPanel`, `client/RightPanel.tsx`). A floating island, 300 wide, right inset 12, its top
under the top islands, its height to above the zoom. It shows when something is selected, when the tool in hand has
options, or when an extension tool is open, with a tab per source: Properties (the selection), "<Tool> options", and
one tab per extension tool; picking a drawing tool brings its tab forward. The pin keeps it open with nothing
selected, showing the Lienzo (description, instructions for the agent, layout, Variables); ⌘\ and the `PanelRight` button hide
it or bring it back. It opens by itself only when it fits beside the canvas: panel 300 + both insets + `rightPanel.minCanvas`
680, so 1004 wide (`panelFits`). Narrower (chat and Lienzo side by side) it would cover what was just pressed, a mini app
or a control, so a selection, pinned or not, leaves it closed; it opens when asked: `PanelRight`, ⌘\, "Properties" in the
selection bar, a Frame's or a card's Properties, the resize corner, or an edit that needs it. Sections fold under 12 px headers. A block shows Content (title, the fields that matter, More
options and Raw data (JSON), §36),
Style for drawings, Instructions for the agent (with those it inherits), Connect (search a target) and Actions (edit
on the canvas, interact, reset, duplicate, export, release position, take out of the Frame, move
earlier/later, automatic size, delete). A Frame adds its title and purpose, Layout and Variables. A link shows label,
kind, colour, reverse and delete. A result still hidden behind a learning gate is never named. On compact the panel
is a sheet.

**Selection bar** (`face.selectionBar`). A small bar above the selection, below when there is no room: colour (for
drawings and links), Wrap in a Frame (Unwrap for a Frame), Duplicate, Delete;
32 buttons. A link gets colour, kind, reverse and delete. Detail lives in the right panel.

**Command palette** (`face.palette`, `client/CommandPalette.tsx`, model in `client/palette.ts`). ⌘K / Ctrl+K, or the
top-right button. Centred, 640 wide, its top at 18 % of the panel, a 52 px search field with a leading icon, results
under small-caps headers in rows of 40 (icon, title, muted subtitle, shortcut chips), the active row in a soft accent
fill. Footer: "↵ Open · ⌘↵ Run in background · Esc Close" and the active row's verb. Groups: Recent (on an empty
query), Tools, Actions, Sheets (every Sheet, the agent's latest, follow), Lienzos, Extensions, Settings. Nothing in it sends to the agent. Titles match fuzzily; keywords and subtitles
by whole words. Keyboard alone works fully; so does the mouse.

## 32. Extension tools

A person or their agent can add a tool without touching the plugin (contract in `docs/extensions.md`). Tools are
listed in the + catalog's Extensions section and open over the canvas the way their presentation asks (§45; by default
a panel on the right), working on the shared selection; several can be open at once. An imported tool that asks for a permission shows a warning-toned strip saying what it
asks for in words and a single "Allow". "Manage extensions…" opens the Extensions screen (§35.5).
Extensions take every colour from the theme they are given. Verified with `design/whiteboard-harness/extensions.cjs`.

## 33. Shortcuts, tooltips, words and small details

**Shortcuts** (`client/shortcuts.ts`). Tools: V Select, H Hand, P Pencil, R Rectangle, O Ellipse, T Text, A Arrow,
E Eraser, M Frame, W Window, L next Lens, Space held = Hand, 1–9 pinned tools. Navigation: ⌘K palette, [ / ]
previous / next Sheet, ⌘J jump to Sheet, F follow the agent, G the agent's latest (these five are registered now and
Sheets and the agent, see §34), Shift+1 fit all, Shift+2 fit selection, ⌘\ right panel, ⌘. hide all UI, ? the sheet. Editing: ⌘Z,
⌘⇧Z, ⌘D duplicate, ⌘G wrap in a Frame, ⌘⇧G unwrap, Delete / Backspace, Esc, ⌘A. The person's overrides win, then
ours, then extensions' in the order they register; a combination already taken is not assigned and is listed as
"unassigned" with whose keys they are. `?` opens Settings → Shortcuts, which lists everything and reassigns
in place: press the key chip, then the new keys (§35.4); overrides persist in the host's `interface` settings.

**Tooltips** (`tooltip`, `Tooltip` / `useTooltip` / `TooltipLayer` in `ui.tsx`). One layer per panel draws them above
everything. Name, then the shortcut in muted monospace ("Pencil  P"); a second line for glossary words. They appear
after 500 ms; once one has shown, the next appears at once for 800 ms. They sit 6 px from the control on the side
away from the nearest panel edge and never cover it; a press hides them; on touch a long press shows one for 1.6 s.

**Words.** The interface is in English. The only Spanish word is the name, Lienzo (the app, and each document;
explained once as "Spanish for canvas"). The rest are plain English names: Frame (holds things together), Sheet (a
chapter the agent adds while explaining), Lens (a way to colour the same canvas), Window (a web page, a video or a
mini app on the canvas). Argentine flavour lives only in the mate (empty states and the kettle) and small loading
winks. The agent still answers in the person's language.

**Small details** (`face.eggs`, `client/Eggs.tsx`). An empty canvas shows a hand-drawn mate with rising steam and
"Empty. Pour yourself a mate." Typing "mate" in ⌘K boils a small kettle in the bottom-right corner for 4 s ("80 °C.
Never boiling, for mate."). A loading Lienzo sometimes shows a small turning Sol de Mayo or a tango step. Some
confirmations say "Listo." or "Dale.". None of them covers content; under reduced motion the mate stays still and the
kettle and the loading details do not appear.

Verified with `design/whiteboard-harness/face.cjs` (RN-web, isolated omabox, example data, dark and light); captures
in `design/qa-face-2026-10/`.

## 34. Following the agent and Sheets (copilot, canvas side)

The top-left island ends, after a divider, with "Sheet 3 of 7 ▾" (only when the Lienzo has Sheets) and a magnet. A
Sheet is a top-level Frame the agent added as a chapter; its header shows "Sheet N" instead of an ordinal. The menu
lists every Sheet (number, title, the current one washed in the accent); `[` `]` step and ⌘J opens the menu; ⌘K lists
them under Sheets. The current Sheet is the one holding the centre of the view, read live from the camera.

The magnet is on by default: each new transaction of the agent flies the camera to what it changed, and that glows
for 3 s (2 px accent ring with a soft accent shadow, 6 px outside the entity). Moving the camera yourself (wheel,
middle button, Hand, two fingers) or jumping to a Sheet lets go. While not following, the agent's next change shows
a pill above the toolbar, "● Agent's latest · ‹label› →"; it and `G` take you there and follow again; `F` toggles.
The conversation chip's "Go to latest" and "Open Lienzo" open this panel on the right document and land the same
way. Logic in `plugin/client/Hojas.tsx` and `hojas-model.ts`; verified with `design/whiteboard-harness/copilot.cjs`.

## 35. The screens around the canvas

Lienzos, the guide, Help, Settings, Extensions and History are screens, not small modals (`client/Screen.tsx`, tokens
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
compact), 16 apart. Each card is a live thumbnail drawn from the Lienzo's real layout, like the minimap: Frames as
outlines (Sheets in the accent), cards as filled marks in their tones, drawings as faint marks, links as thin lines
between centres; a single small card is not blown up. Under it the serif title (two lines), "Edited 3 h ago · 24
blocks · 3 Sheets", and the agent working on it (dot and name; the accent while it works). The open Lienzo has an
accent ring. Search filters as you type (accents and case ignored, every word); sort is Recent · Name. Hovering a
card shows ⋯: Rename (in place), Duplicate, Delete… (a popover from the ⋯ button, `popover.width.small` wide, elevation `popover`: the danger-washed trash, “Delete “title” and its history? This cannot be undone.”, Cancel (focused) and Delete in red; Escape or a press outside cancels and that press opens nothing; the card and the grid never move). The ⋯ menu closes the same way. Choosing a card opens it and
closes the sheet. Empty: the mate, "No Lienzos yet." and "Start one, or ask your agent to draw something." There are
no examples; a stored document marked as an example keeps an "Example" chip by its meta line.

### 35.3 The guide

Four scenes on a large stage (60 % of the sheet; on top on compact) with the words on the right: the agent draws
while it works (a sentence types in a chat; cards and arrows appear and the camera settles), Sheets (three chapters
slide in along a strip, the "Sheet 2 of 3" pill counts, the magnet glows while the camera follows), point and ask in
your own chat (a cursor selects a card, "mirá esto" arrives in the chat, a dashed line shows the agent reading the
selection), and make your own tools (a code card types `lienzo.edit([...])`, folds into an icon and drops into the
toolbar; "Works in Paseo and the desktop app"). Each scene plays by itself for 6 s with a thin progress bar; Back,
Next, Skip and dots; the last button says "Let’s start". The stage is a picture: nothing on it is pressable.
Drawn with Animated views in the theme's colours, in a fixed 560 × 420 space scaled to fit. Under reduced motion each
scene shows its last frame and waits for Next. Shown once per host (§11.3), and from the menu and ⌘K.

### 35.4 Settings

A fixed frame, like a preferences window: 880 × 640 (less on a small panel, 24 from the edges), the same size and
place for every section, so switching never makes it jump (`screens.window`). The rail runs the full height on the left;
each section's header (24 px serif title, one muted line, a hairline under it) stays at the top and the body scrolls
beneath it. Compact panels keep the full-screen sheet with chips. Only sections that exist. **Appearance** (first, where Settings opens) — three cards side by side (stacked when the
sheet is narrow): System, Light, Dark. Each draws a small Lienzo in its theme (paper, two cards, an accent link, a
toolbar island); System is split down the middle, Papel left and Tinta right, and says what it follows ("Follows
Paseo's theme." / "Follows your computer."). The chosen card has a 2 px accent border and a soft accent ring, and a
filled radio; a keyboard-focused card shows the ring too. Under them one muted line: it changes at once, where it is
saved, and the key chip of "Switch light and dark" (⌘⇧L). Tokens in `face.sheet.appearance`. ⌘K has "Theme: System",
"Theme: Light" and "Theme: Dark"; the one in use says "In use". Light and Dark replace the host's theme with Papel or
Tinta for every surface of the panel at once (every `UIProvider`, so modals and sheets too); System is the host's own
theme, unchanged. In the desktop app the window's native theme follows as well (`nativeTheme.themeSource`), so the
title area, the menus and the background behind the page match, from the first frame after a restart.

**Shortcuts** — search, "Reset all", groups (Tools, Navigation, Editing, Extensions) as two
columns of 40 rows: label on the left, key chips on the right. Pressing a chip records in place (it pulses "Press
keys…", Escape cancels); keys another shortcut held move here and that row shows a small warning chip "Keys taken by
…"; an edited row shows a reset icon. **Toolbar** — the pinned tools in order with their keys 1–9, move earlier or
later, unpin, "Reset toolbar". **Copilot** (Paseo) — there are no stored copilot defaults, so it explains the chip in
the composer and the four cadences, with a link to the guide. **Agents** (desktop) — the MCP address, the commands
for Claude Code, Codex and Cursor, and the agents seen (the host's `AgentSettings` slot). **Extensions** — §35.5,
embedded. **About** — version, where it runs, the one file that holds every Lienzo (copyable), links to the docs; in the
desktop app also an Updates card (the host's `AboutUpdates` slot): a tone dot and the state in words, a 3 px accent
progress line while downloading, "Check for updates" (or a primary "Restart" when ready) on the right, and an
"Automatically check for updates" switch. When an update is ready the desktop shell shows a pill in the island
style, radius 20, in the bottom-left corner (centred above the toolbar on compact): accent dot, "Update ready", a
muted "·", "Restart" in the accent, and a quiet ✕ ("Later", until the next version).

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

### 35.7 Help

Help is the in-app wiki: menu → Help, ⌘K ("Help", and matching pages under a Help group while searching), the
`CircleHelp` button in the header of the Properties panel (the page of what is selected: its block type, a Frame or a
Sheet, a link, several things) and of an extension tool's tab, and Help on each extension card. It uses the sheet of
§35.1 with its own wider rail (`face.wiki`: 248, rows of 32) on `surface0`: the small-caps title, a search field, and
every page grouped under its section label (Start here, Drawing, Shapes, Text, Frames, Sheets, Windows & media,
Interactive blocks, Mini apps, Lenses, Shortcuts, Agents, Extensions, Make your own), scrolling on its own. While
there is a query the rail lists the matching pages instead ("3 pages"; "Nothing matches …"). The page is at most 720
wide: the section in accent small caps with its icon, the serif display title, the summary in 15/22 muted, the
shortcut as key chips (the keys in use, with the person's changes), and a 200-wide picture in a card beside the title
(above it below 560). Then the purpose in 14/22, **By hand** as numbered steps in accent-washed circles, **Ask your
agent** as prompt rows (a chat glyph, the prompt in quotes, a copy button; one line says the canvas never sends to
the agent), **Tips** with a lightbulb in the warning tone, longer Markdown, and **Related** as pill links. The
Keyboard shortcuts page lists the live registry. Compact: full screen; the index ("Help", search, topics) and the
page alternate, with "All topics" to go back.

Pictures are data (`shared/wiki/art.ts`, a 160 × 100 box of cards, boxes, ellipses, lines, strokes, windows, sliders,
keys) drawn with views in the theme's tones (`client/WikiArt.tsx`); they are hidden from screen readers. Markdown
(Help bodies and extension `docs`) is drawn by `client/Markdown.tsx`: headings in `title`/`heading`, paragraphs at
21 line height, notes on an accent wash with a 3 px rule, code in a bordered `surface0` box with its language and a
copy button, links in the accent. Installed extensions add pages under Extensions; one without `docs` says so.

The Extensions screen (§35.5) gains a segmented control, Installed · Discover. Discover: a search field and Refresh,
cards in the same grid (turquoise icon tile, name, "By …" or "From the catalog", description, permission chips,
Source, and Install… or an "Installed" chip or Update…), an offline strip in the warning tone with the age of the kept
list, an empty "out of reach" card with Try again, and a "Share yours here" card. Publish… on one's own card shows a
three-step card in the accent border (Checked, Saved extension.json, Propose it on GitHub with Open GitHub).
Verified with `design/whiteboard-harness/wiki.cjs` (dark, `papel`, compact); captures in `design/qa-wiki-2026-10/`.

## 36. Properties for people

Owner's direction: everything an agent can set, a person can set by hand, without JSON and without the docs. The
same data goes to the server; editors only change how it is entered. Logic in `client/property-model.ts`, components in
`client/PropertyEditors.tsx`, tokens in `face.properties`, audit in `docs/ux-audit-2026-10.md`.

**Content, in order.** Title (optional, placeholder "Untitled"); the fields that matter; "More options" with a count,
holding the fields a type marks `advanced` until they hold a value other than the default; "Raw data (JSON)" last.
Required fields carry `*` only while empty. A field's `help` is one muted line under its label. Fields a structured
editor writes together with another (a tree's closed folders) do not show on their own.

**Sections start collapsed.** Properties opens as its header (the kind, muted, and the title, e.g. "GLSL shader /
Color plano") over a column of section rows: Style, Content, Bindings, Frame, Layout, Variables, Instructions for the agent,
Connect, Actions, each a 12 px chevron (right when closed, turned down when open) and its name, muted when closed and
in the foreground when open. A closed section may say what it holds on the right: the number of variables or links,
"Written" for instructions, "2 bound" for bindings. What the person opens stays open only while that selection does: every new selection, and
coming back to an earlier one, starts collapsed (`sectionMemory` in `property-model.ts`). A flow that asks for a section
opens it for that selection too: Edit text when the card cannot take it (Content, or
Frame), Instructions for the agent from the menu, and a block whose data has a problem (a required field blank, data
the server would refuse, Controls with no variable or an undeclared one, a flow with no events) opens on Content. The
document's own panel ("This Lienzo") is its only section, so it starts open. Headers are buttons with
`aria-expanded`; Tab moves between them and Enter or Space toggles (Tab, Enter and Space inside the panel are the
page's, not the canvas shortcuts); a keyboard-focused header shows a 2 px inset accent ring.

**Disclosures.** A 28 px row (44 on compact): a 12 px chevron, a small muted semibold label, the count on the right.
Closed by default. They fold in place inside the section; nothing floats over the panel.

**List editors** (checklist, file tree, flow events, link settings, choices of a variable). Rows of 30 px (44 on
compact) with 2 px between them and a 6 px radius. Inputs in a row are borderless until the row is active; the
active row is washed in the foreground at 8 % and shows its tools on the right or on a second line: move up, move
down, remove (danger tone), and for trees outdent, indent, highlight, mute, starts closed and the card it opens. Small
tools are 24 px icon buttons with tooltips. Adding is a ghost button or an "Add an item and press Enter" field at the
end, so the list grows where the person is looking. A list never asks for an index or an ID.

**Pickers.** A 30 px field with the current choice and a chevron that opens a list in place under it (at most 280 px,
then it scrolls), never a floating menu that could clip in the panel. Rows show a name and a muted detail ("Number ·
Frame “Physics”", "Frame"). Links read "From → To · label".

**Words with a vocabulary.** Status is a wrap of pill chips: None, the type's statuses, Other…; each known word has
its tone's dot and, when chosen, its tone's border and wash, the same colour as the chip on the card. Other… opens a
one-line field. Kind, language and other text with `options` keep a free field; suggestions show as chips under it
while it is in use (always, when there are six or fewer), filtered by what is typed, and include words this Lienzo
already uses for that field.

**Numbers in human units.** Durations are typed in seconds next to a slider; they are stored in milliseconds. Small
number boxes carry a 11 px muted label above them ("Lowest", "Highest", "Step", "At (s)") and keep what is typed until
it is a number.

**Variables** (on the Lienzo, on every Frame, and inside Controls). A row per variable: its mark (the `viz.series`
colour and shape of its declaration order, §18.3), its label, a muted line with the type or range and how many
Controls show it, its current value in code type, a chevron. Opening a row edits it in place: Label; Type as segments
(Number · On / off · Choice); for numbers Lowest, Highest, Step, Unit and "Starts at" with a slider; for on/off
"Starts on"; for choices a radio and a field per choice, "Add a choice"; "Name in code" (filled from the label until
edited); "Now at …, moved by a control" with "Back to start" when the runtime value differs; "Delete variable".
"Number", "On / off" and "Choice" buttons add one. Renaming or deleting carries the Controls that show it.

**Controls.** "Variables shown, n of 4": a row per variable (mark, label, type and where it lives, move up/down,
stop showing), opening into the same variable form. "Show a variable…" lists what the block can reach; "New variable"
opens a small card: label, type, and "Shared by" (This Frame · The Lienzo) when the block sits in a Frame.

**Shader parameters.** Rows like variables; adding, renaming or removing one rewrites its declaration in the code;
"Use a shared variable" binds it by name. Resolution and time are two check rows.

**Raw data (JSON).** One line saying it is exactly what the agent reads and writes; a monospaced box (140–360 px);
while edited, a muted "Looks right." or the first problem in the danger tone; Apply (primary, only when valid) and
Revert. Applying replaces the whole object in one transaction.

**Saving.** Edits save 600 ms after the last keystroke, at once for structural actions (add, remove, move, tick,
choose), each as one labelled transaction with undo. Editing stays open while an earlier change is saving: edits
queue. A refusal says why in words under the editor ("Not saved · Two parameters have the same name.") with Retry;
the draft stays.

**On the canvas.** A selected checklist ends with a "+ Add an item" row: type and press Enter. A second press on a
selected card within 400 ms (a double click) turns its title into a field: Enter or leaving saves, Escape keeps the old
one. The field wraps and grows line by line in the title's own type (an invisible copy sizes it; no inner scroll); the
accent underline sits 2 px below the text box, so the card does not shift when the field opens or closes. An empty Controls card says where to pick variables.

Verified with `design/whiteboard-harness/ux.cjs` (headless Chromium, example data, dark and light); captures in
`design/qa-ux-2026-10/`.

## 37. Adding things: sheets, icons, shaders and screens that fit (October 2026)

Verified with `design/whiteboard-harness/ui-fixes.cjs` (RN-web, plain headless Chromium, dark, light and compact) and in the desktop preview; captures in
`design/qa-ui-fixes-2026-10/`.

### 37.1 The add sheets

A Window, an image, a video, a sound and an SVG are added through one compact sheet per kind (`client/AddSheets.tsx`,
tokens `face.addSheet`), in the language of the screens: the canvas dimmed, a 520 wide sheet at 14 % of the panel's
height (a bottom sheet on compact), radius 16, `surface1`, the screens' long shadow. Its header is a 36 accent tile
with the kind's icon, the name in `title` and one muted line saying what it adds. Its footer, on `surface0` under a
hairline, has the keys on the left ("↵ Add video · Esc Close") and Cancel and the primary action on the right; the
action is never full width.

- **Link sheets** (Window, Image, Video, Audio). A field labelled "Link" (label above, a leading link icon, focused on
  open; a link without a scheme is read as https). Under it, a 200 high preview of what the link will become, decided
  as you type by `describeLink` in `client/media.ts`: a YouTube or Vimeo link shows its thumbnail, the "YouTube ·
  Video" badge, a play glyph and the title (and, for Vimeo, the thumbnail) from the provider’s oEmbed (best effort, no key, omitted credentials); an
  image shows the image itself; a page or a file shows a small window with the site, the badge ("Web page", "Sound")
  and the address. Empty, the preview is a dashed box that says what to paste. A note or a warning in plain words sits
  under it: a link of another kind says what it becomes ("This is a YouTube video, so it becomes a video player"); a
  site known to refuse framing (GitHub, Google, X, LinkedIn…) says the Window will stay blank and can still be opened
  from its bar; plain http says it may be blocked; a page link in the Image, Video or Audio sheet says it may not play
  and will show as a link; an image that does not load says so. Then "Caption" (or "Title" for a Window, which names
  its bar) with "Optional" on the right of its label. A link dropped on the sheet fills the field. Files from the
  computer are not offered: Media and Windows store web links only.
- **Import SVG.** Three tabs in a segmented row: Paste code · File · URL (native shows Paste code only). Pasted code is
  checked as you type and drawn in a 168 high preview; what the static dialect refuses is said in words (scripts, links,
  images or animation; too large; not an SVG). File has a dashed drop row with "Choose file…"; an `.svg` dropped
  anywhere on the sheet loads into it. URL has its field and Load, then the preview. ⌘↵ inserts from Paste code; ↵
  from File and URL.

### 37.2 The icon library

"Icons" in the + catalog opens a 420 × 484 popover above the toolbar (`client/IconLibrary.tsx`, logic in
`client/icon-library.ts`, tokens `face.icons`): the title with "293 offline · open sets online", a search field
(focused), category chips (Recent, All, Systems, Data, People & places, Security, Flow, Status & shapes, Everyday), a
grid of 48 cells with 26 glyphs, eight to a row, paged 96 at a time ("Show 96 more"), and a footer naming the icon
under the pointer with its set and licence, beside "Import SVG…". Click adds at the centre of the view; dragging a cell
onto the canvas drops it there; ↵ in the search adds the first result; Escape closes.

- **Offline**: 293 Lucide icons (ISC; `client/assets/lucide-LICENSE` and `lucide-source.json`), generated by
  `scripts/lucide-set.mjs` from the installed `lucide-react` into `client/icon-set.ts` (64 KB), searched by name,
  extra words ("docker", "agent", "bank") and category, every query word matching the start of a word.
- **Online**: from two letters, after a 350 ms pause, the search also asks Iconify's public API
  (`api.iconify.design/search`, then one `<set>.json?icons=…` per set on the page) across fourteen open-licence sets
  (Lucide, Tabler, Phosphor, Material Design Icons, Material Symbols, Carbon, Remix, Heroicons, Fluent, SVG Logos,
  Simple Icons, Devicon, VSCode Icons, Skill Icons: MIT, ISC, Apache-2.0 or CC0). Results come under "Online ·
  Iconify" with "Load more"; icons the static SVG dialect refuses are left out. Offline or failing, the section says so
  in words and the offline set keeps working.
- Each inserted icon is a static `wb-svg` block whose `caption`, `source` (`lucide:server`,
  `iconify:logos:postgresql`) and `license` ("CC0-1.0 · SVG Logos (Gil Barbara)") carry where it came from.
- **Recent**: the last 16 icons used, in the host's `interface` settings (`recentIcons`; online ones keep their SVG up
  to 4 KB so they work offline). With recents, the popover opens on Recent, followed by all icons.

### 37.3 The shader block

A shader is a picture. By default its card has no header and no padding: the shader fills it edge to edge inside the
radius-10 border (`foreground` at 0.1, 0.22 on hover, accent when selected), and the whole picture is the handle to
drag it by; the wheel over it pans the canvas. What sits around it is chosen by the agent or the person, in the block's
data: `question` (a line above the picture), `showTitle` (the block's title on a small glass label in the top-left
corner), `controls` (`overlay`, the default: the sliders on a glass panel along the bottom edge while the block is
selected; `below`: a strip under the picture; `none`), `reset` (a Reset button with the controls) and `autoplay`
(starts `u_time` when it comes into view, never under reduced motion). A paused shader with time shows a small Play
button over its bottom-left corner. Errors cover the picture in words. A block stored before, with a question and none
of these choices, keeps its old face: question above, sliders and Reset below (`glslChrome` in
`shared/renderers/glsl-shader.ts`).

### 37.4 Screens that fit

A screen's sheet is as tall as its content, up to the usual 960 × 680 frame, so a short screen leaves no empty well at
the bottom. History stays centred. Settings, Extensions (Installed · Discover) and Lienzos keep their top edge still
while the section, the tab or the search changes their height. A longer content scrolls inside the frame as before; compact stays full screen; the
guide keeps its fixed stage.


## 38. Comments (October 2026)

Verified with `design/whiteboard-harness/comments.cjs` (RN-web, plain headless Chromium: dark and light at 1280, a
narrow 760 window, compact 420); captures in `design/qa-comments-2026-10/`. Tokens `face.comments`.

Comments are the person's notes pinned on the canvas, read by the agent with `canvas_comments` when the person asks
in their own chat. They sit beside the drawing, never in it: no revision, no History, no Undo. Nothing on the canvas
sends them anywhere.

### 38.1 Pins

- **Shape.** A 26 px speech bubble: a circle whose bottom-left corner is square (radius 3) and points at what it is
  about. A 2 px ring in `surface1` separates it from any card, plus the island's soft two-step shadow. Pins are drawn
  in screen space over the cards and under the selection toolbar, at a fixed size at every zoom.
- **Who.** The first author decides the pin: the person is ink (`foreground`) with a small head-and-shoulders figure
  cut out in `surface1`; the agent is the accent with its spark (`Sparkles`, the glyph History already uses for the
  agent). Same avatars, at 22 px, in the thread and 20 px in the list.
- **Where.** On a card or a Frame the tip sits 6 px outside the top-right corner (up and right), clear of the corner
  resize handle, the link handle and the card's content; several threads on one entity stand side by side 22 px apart,
  overlapping like an avatar stack. On an empty spot the tip is the spot. A pin follows its entity; if the entity is
  deleted, the thread stays where its pin was last drawn and says "Was on “…”, since deleted".
- **States.** A reply count badge (15 px, `surface1`, hairline) at the top-right when a thread has replies. Hover lifts
  it 5 % and shows a one-line preview (author, time, two lines of text) beside it; the open thread's pin is 10 % larger
  with an accent ring. Resolved pins are hidden; while the list shows Resolved they come back at 55 % with a check.
- **Never a drag.** Pins and the popover live in their own layer (`lienzo-tools-comments`), a sibling of the pan
  surface, so pressing or dragging them never moves a card, pans, or draws with the tool in hand.

### 38.2 The Comment tool

`C` (registry `tool.comment`, free before) or the Comment button, alone in the last toolbar group (`MessageSquarePlus`).
While it is on, the canvas shows a crosshair, a small island at the top ("Press a card, a Frame or an empty spot",
naming the target under the pointer) and a dashed accent outline around what a press would pin to: the smallest card
under the pointer, else the innermost Frame, else the spot. A press opens a new-comment popover there with a provisional
"+" pin; nothing is saved until it is sent. Esc or `C` again lets go. On a compact panel the tool also brings the canvas
out of the list view so a spot can be chosen.

### 38.3 The thread

One popover, 320 wide (radius 12, `surface1`, the popover elevation), beside the pin: on the right when it fits, else on
the left, clamped clear of the top islands, the bottom toolbar and the right panel.

- **Header** (44 high, hairline below): "Comment" in `heading` (or "New comment"), a green "Resolved" chip when it is,
  and one muted line saying where it is ("On “Servidor”", "On the canvas"). Actions on the right: ⋯ (Delete thread,
  with an inline confirmation that names the number of messages), ✓ Resolve (closes the popover) or ↺ Reopen, ✕ Close.
- **Messages** (12 padding, 12 apart, scrolling past 300): avatar, then the name in `bodyStrong` ("You", or the agent's
  label), "by your agent" in the accent for the agent, "via <extension>" when an extension wrote it, the relative time
  muted, and the text in `body`, selectable.
- **Reply box**: a rounded field on `surface0` that grows from one line to 120 px, with a round 28 px send button that
  fills with the accent once there is text. Enter sends, Shift+Enter is a new line, Esc closes. One muted line under it
  says so; past 1800 characters a counter appears (danger past 2000). A reply to a resolved thread reopens it. Pressing
  outside closes the popover unless a new comment has text in it.

### 38.4 The list

The Comments button in the top-right island (`MessageSquare`, with an accent count of open threads) opens a
"Comments" tab in the right panel; it is also in the menu and ⌘K (Comments, Hide comment pins, Comment). Open/Resolved
segments with counts, and an eye that hides or shows the pins. Rows (64 min, newest activity first): avatar, author and
time, two lines of the first message, then where it is and the reply count, in the accent when the agent answered.
Pressing a row frames its card clear of the panel (or centres the spot) and opens the thread. On a compact panel the row
opens the thread inline in the sheet, with a back arrow. Empty states: "No open comments" with how to add one and that
the agent reads them when asked; "Nothing resolved yet".

### 38.5 Copilot popover

The Lienzo chip's popover in Paseo says "N open comments on this Lienzo. Ask your agent to look at them when you are
ready." above Open, only when there are some. It is a reminder for the person; the agent's tool responses carry no
count.

## 39. Bound to a variable (October 2026)

A binding makes a property follow a variable (`shared/bindings.ts`, docs/mcp.md "Bindings"). The design rule: **the
rule is content, the value is live**. Editing a binding is an ordinary labelled transaction; moving the variable is
runtime only and never touches History, so a slider dragged for ten seconds leaves no trail.

### 39.1 Properties → Bindings

- A section of its own, under Style or Content, open by default only when the block has bindings. It never reaches
  into another section's fields, so it lives beside the collapsed-by-default Properties work without touching it.
- One row per bindable property: label left, the stored value muted in mono (or its swatch for a colour), and a
  24 px chain-link button (`Link2`) at the right edge. Width, Height, the two colours and Text are up front; shift,
  rotation, opacity, outline width, corner radius and text size wait under **More properties** until one is bound.
- A bound row swaps the stored value for a **variable pill** (22 px, radius 11, a 6 px dot in the variable's series
  colour from §18.3 and its label in 600 weight, on a 14 % wash of that colour) followed by what it gives now (`212 px`,
  `81°`, `92 %`, a swatch, or the quoted text), and the chain-link turns accent. The same colour marks the variable in
  the Variables section, so the eye can follow one value across the panel.
- An inert binding (its variable was deleted) shows the pill in `statusWarning` with a warning triangle and the word
  *inert*; its form explains why and offers another variable or Unbind. Nothing is removed silently.

### 39.2 The bind form

Pressing the chain-link opens the form in place under its row (the row gains a border and `surface1`), like Picker:
it never floats over the panel's scroll and never clips.

1. **Follows**: the variables the block can see, nearest scope first, each with its series dot, label, scope · name and
   current value; a name declared nearer hides the same name further out. Empty: one line on where variables live and
   **New variable**, which declares one on the Lienzo and binds it in one transaction.
2. **Mapping**, written as a sentence: *When Speed goes from [0] to [10] / width goes from [40] to [400]*, with
   **Stay inside that range** (clamp, on by default). Colours: *Hue along a range* (two ranges and a 12-step hue ramp
   preview) or *By thresholds* (rows of *From [n]* and the eight whiteboard swatches). Text: one field with `{v}`.
3. **Formula instead** (a Disclosure, closed unless used): a mono field for `v * 20 + 40`; the help line under it turns
   `statusDanger` with the parser's own message while it is wrong, and the values at both ends of the range show once
   it is right.
4. A `surface2` strip says **Now Speed 5 → 220 px** live, then Unbind (ghost) and Done.

A new binding starts with something visible: the variable's whole range onto half to one and a half times the stored
size, 0–360° for rotation, 20–100 % opacity, hue 200° → 0° (cool to warm) for colours, `Speed: {v}` for text.

### 39.3 On the canvas

- Bound values are drawn every frame the variable moves. Size feeds layout, so links leave from the bound edge and
  Frames grow; shift and rotation are drawn only, links and Frames keep the stored place (said in the row's help).
- Hues are lit for the theme: saturation 68 %, lightness 46 % on Papel and 64 % on Tinta, so a bound fill keeps
  the contrast of the whiteboard palette. A label on a solid bound fill takes paper or ink by the fill's luminance.
- A selected box whose size is bound shows **Bound to Speed** (a 20 px accent pill with the chain-link, 6 px under the
  box, kept at screen size) instead of resize handles: dragging a handle would fight the variable. Unbind gives the
  handles back. Moving the box still works.

Tokens: `face.bindings` (icon, button, pill, popover, hint, hue).

## 40. Images from the computer (October 2026)

A picture can come from the computer three ways: dropped on the canvas, pasted (⌘V with an image on the clipboard,
outside text fields), or from the Image sheet, whose preview area is also a drop zone with a "Choose file…" button.
PNG, JPEG, WebP, GIF and SVG, up to 10 MB each (SVG up to 64 KB, through the static SVG sanitizer), up to 12 at once.
The bytes decide the kind, never the name.

**Dropping.** While files hover, a 2 px dashed accent outline (inset 12, radius 16) over a 6 % accent wash covers the
panel, above every island, with one centred island: an accent image icon on a wash, "Drop to add the images here" and
the formats and size in muted small text. One image lands centred on the drop point; several lie in rows of up to three
from there (`media.upload`). They are selected afterwards, so Properties shows them. While they upload, a small island
under the top bar says "Adding images…". A file that is not an image, or is too large, is refused in words in a toast;
the others are still added.

**Storage.** The host keeps the file beside the Lienzo data, named by its SHA-256 (`canvas/media/<sha256>.<ext>`: the
desktop app's userData, the plugin's `~/.paseo/canvas`), and the block holds `lienzo-media:<sha256>.<ext>`. The same
picture is stored once. The card reads it back once per session into a blob URL (a data URL if blob images are refused).
A reference whose file is not on this computer (a document copied from elsewhere) draws a quiet placeholder: an
image-off icon and "This image is not stored here…". A host that cannot store files gets the image inline as a data
URL, up to 256 KB, with a warning toast that it was kept inside the Lienzo. Stored images have no "Open outside" button.

## 41. Sharing a Lienzo as a file (October 2026)

One Lienzo travels as a `.lienzo` file (docs/mcp.md, "Lienzo files"). Two dialogs, both in the add sheet's shell
(§37.1) at 560 wide (`face.lienzoFile`): dimmed canvas, a 36 px accent tile with the icon, the title and one line under
it, the body, and the footer with the keys on the left and Cancel and the primary action on the right.

**Where.** Export: the document menu (after Rename), `…` on a card in Lienzos (between Duplicate and Delete…), ⌘K
"Export this Lienzo…". Import: Import… in the Lienzos header (secondary, beside New Lienzo) and in its empty state,
Import… on the empty panel, ⌘K "Import a Lienzo…", a dropped `.lienzo` file anywhere a Lienzo could open (the canvas,
Lienzos, the empty panel), and the desktop app opening a file. While a file hovers outside a canvas, the drop cue of §40
says "Drop a .lienzo file to import it" with a file-input icon; on a canvas the image cue adds "A .lienzo file opens as
a new Lienzo."

**Summary card.** Both dialogs lead with the same card on `surface0`: the Lienzo's real thumbnail (132 × 88, the
Lienzos card drawing, radius 8, 1 px border) and beside it the title in the title face with two muted lines: what it
holds ("4 blocks · 1 Sheet · 1 image inside") and, in export, the file name in the code face; in the review, the image
size and, when the title is taken here, "Imports as “… (imported)”: you already have one with this name." in body
colour, since it is the one line that changes what happens.

**Export.** Under "Include", two options as whole-row toggles (min 52 tall, radius 10): an 18 px box (accent fill and a
check when on), a strong title and one muted line. Comments ("1 thread, open and resolved, with who wrote them";
disabled with "This Lienzo has no comments." when there are none) and "What people did with interactive blocks"
("Control values, quiz answers, mini app state and what extensions kept on this Lienzo. Off: the blocks start fresh.").
Both start off: sharing the drawing is the common case and the least surprising. On, the row takes a 6 % accent wash
and an accent border at 55 %. A quiet note (`surface2`, info icon) says history is not included and that images, custom
block types and extensions travel inside. Export (primary, file-output icon) saves with the system dialog on desktop
or downloads in the browser, closes, and a success toast names the file and its size.

**Review.** The subtitle says when and from what it was exported; the title names the file. After the card, two facts
side by side on `surface2` (Comments, Interactive state), the value strong when included and muted when not ("Not
included: blocks start fresh"). Then "Block types it brings" and "Extensions it brings", one 40 px row each: a 28 px
icon tile, the name and a muted line (the type id; what the extension asks to do, or "Reads and selects only"), and a
status chip centred on the row: **New** (acento), **Installed** (neutro), **Yours kept** (aviso) when this computer has
a different one. A muted line under extensions repeats that imported ones only read and select until allowed. Warnings
are amber notices in plain words. The footer hint adds the file size. The primary is "Import as a new Lienzo": there is
no overwrite, so there is no second choice to make. Loading is the egg and "Reading the file…"; a refused file is a red
notice with only Close. After importing, the new Lienzo opens and a toast says "Imported “…”".

Tokens: `face.lienzoFile` (width, thumb, card, option, row, status tones).


## 42. Power commands (October 2026)

tldraw and Figma habits, with the keys they use, where Lienzo had none (code: `client/arrange.ts`,
`client/clipboard.ts`; Help → Shortcuts → "Duplicate, copy and paste" and "Align, distribute and nudge").

**Pointer.** Alt-drag (Option on a Mac) duplicates: the originals stay, marked by a dashed accent outline (1.5 px,
accent at 70 %, a 5 % wash) at their place while the copies ride the hand. As in tldraw it follows Alt live: let go of
Alt before dropping and it is a plain move. On drop the copies (with the links among them) are one transaction and
become the selection; the originals jump home in the same frame the copies appear, nothing flies back. Shift-drag keeps
the larger axis and lets guides pull only along it. Alt while resizing a drawn shape keeps its centre; Shift already
kept proportions. Alt while drawing a rectangle or ellipse draws from the centre; Shift already made squares and circles.

**Keys.** ⌘D now offsets the copies 16 units (two grid steps) and copies the links among them. ⌘C, ⌘X, ⌘V use the
browser's own clipboard events, so the desktop Edit menu and selected text behave as before; a copy is JSON text marked
`lienzo-clipboard` and pastes into any Lienzo or window with fresh ids, centred under the pointer (else the view);
⌘⇧V pastes in place. Arrows nudge 1 unit, 10 with Shift, shown at once and written as one undo step when the keys rest.
Align (⌥A ⌥H ⌥D, ⌥W ⌥V ⌥S) and distribute (⌥⇧H, ⌥⇧V) sit in ⌘K and in a new "Align and distribute" button of the
selection bar (two or more things), which opens a row of ten icon buttons under the bar: six aligns, a hairline, two
distributes (disabled under three things), a hairline, two flips (⇧H, ⇧V: drawings mirror their strokes, lines swap
ends, several things mirror their places). ⌘/ joins ? for Settings → Shortcuts, which is the cheat sheet: it is already
searchable and lets keys be changed, so no second overlay. Two groups were added there: Arrange, and Pointer, which lists
the modifier gestures as fixed rows.

Not added: layer order (z is document order; there is no operation to reorder without a server change), lock (no lock
in the model), rotation (no rotation, so no 15° snap).

## 43. Text that grows as it is typed, and text that scales (October 2026)

- **One rule for every inline editor** (free text, shape labels, card titles): the field sits over an invisible copy
  of the draft set in the saved text's exact type (family, size, weight, line height, letter spacing, alignment,
  wrapping). The copy sizes the box on every key; the field fills it with `overflow: hidden`, no padding, no border,
  no resize grip. There is no inner scrollbar and the saved text takes the same lines at the same place (checked to
  1 px). Decoration that the editor adds (free text's accent box at `selection.outset`, the title's underline) is
  drawn outside the text box.
- **Free text** auto-sizes like tldraw: as wide as its longest line (at least `text.minWidth`), wrapping past
  `text.autoMaxWidth`; a stored `width` wraps there. The canvas lays it out at the box it measures, so the
  selection box, the editor and the saved text agree. `Enter` new line; `⌘/Ctrl Enter`, `Esc` or a click elsewhere
  saves; empty text is removed. The saved text is hidden (not unmounted) while edited.
- **Shape labels** wrap within the shape and grow the shape downward when they need more height (§21).
- **Card titles** keep `Enter` = save and `Esc` = keep the old title; newlines become spaces.
- **Scaling free text.** Corner handles scale it: `fontSize` (8–400, to 0.1) and any wrap width take the drag's
  factor, the opposite corner (or with Alt the centre) stays, and the preview is drawn live with no write until
  release ("Scale text", one undo step). A scaled size shows in Style → Size as a highlighted "36 px" chip beside
  S/M/L/XL; choosing a step clears it. East/west handles set the wrap width ("Resize text"). Shapes keep resizing
  their box only; labels keep their size.

Verified with `design/whiteboard-harness/text-edit.cjs` (headless Chromium, real keys and pointer, light and dark),
plus `power.cjs`, `shapes-strokes.cjs` and `frame-drag.cjs` for regressions.

## 44. Sharing with other computers (October 2026, desktop)

- **Where.** One block at the end of "Connect an agent", which Settings → Agents shows inline too; nowhere else to
  look. A switch row, "Let agents on other computers connect", with one muted line: "Over Tailscale, with an access
  token. Agents on this computer keep working as they are." Off by default. The local command above it does not
  change; its footnote says "Programs on this computer need no token" while sharing is on.
- **When on**, in reading order: Access token (masked `lz_AbCd••••••••••••wxyz` in the code face, Copy, then
  "Regenerate…", which asks once inline: the danger-tinted Regenerate plus Cancel, and a red line saying agents with
  the current token stop working). Then "On the other computer": the same Claude Code · Codex · Cursor segments as
  above drive a read-only field with the command for the best address, token masked; "Copy with token" copies it
  whole. The address and its kind ("tailscale serve, https", "Tailscale name", "Tailscale address", "local network")
  follow in small muted text, with the others after "Also:". One line on the other tailnet case (Machines → Share).
- **No address yet** is an amber wash card, not an error: what to install or open, that Lienzo starts listening by
  itself, and the `tailscale serve --bg <port>` alternative. Listener problems (port in use on an address) are single
  amber lines.
- **LAN** is a second, quieter switch row ("Also allow my local network (Wi-Fi/LAN)"). On, it shows a red wash card:
  anyone on the network can try, traffic is not encrypted, prefer Tailscale.
- **Indicator** (`tokens.sharing`): while on, an 8 px dot in the aviso tone with a 2 px ring of the panel colour sits
  on the Menu button's top-right corner and before the Agent row's presence, and the sheet's intro carries a
  "Shared on your network" chip (aviso, RadioTower). Aviso, not riesgo: it is a door opened on purpose, kept visible.
- **Agents seen** adds "from ana@example.com · " (the Tailscale login) or "from 100.88.1.2 · " before the time for
  agents on other computers.

## 45. How an extension appears (October 2026)

Extensions choose a presentation (`docs/extensions.md`, "Presentation"); the look of each is fixed here and in
`tokens.extensionUi`. Captures: `design/qa-extension-ui-2026-10/`.

- **One box per open tool.** Every open extension is one absolutely placed box in the Lienzo area
  (`ExtensionSurface`, `client/extension-ui.ts` `surfaceBox`). `lienzo.ui.set` only restyles it, so the frame never
  reloads. Tools no longer live as tabs of the right panel: the right panel is for Properties, tool options and
  comments, and a tool sits beside it, clear of it (fits avoid both).
- **Layers.** An overlay sits in DOM order under the islands and toolbar (z 0), so Lienzo's controls stay on top of an
  effect. Panels (z 26) and popovers (z 27) float over the islands like the right panel; fullscreen (z 39) covers the
  islands but not menus, ⌘K or screens. A `dimCanvas` scrim is ink `#0B0B0E` at 0–0.6 over the canvas, under the tool,
  in both themes.
- **Panel, full chrome.** The island look (popover elevation, 12 radius, 1 px border). A 40 px title bar: a 24 px tile
  with the tool's icon in its accent on a 14 % wash, the name in bodyStrong, Help (its description as the tooltip) and
  ✕. The frame paints `surface1`. Default 320 × 440 on the right, under the top islands, above the toolbar's strip;
  `left`, `bottom` and `center` use the same room. Several on one side cascade by 24 px.
- **Minimal.** The same card without a title bar; a 24 px round ✕ (surface1 at 94 %, 1 px border, 12 px glyph) sits 8 px
  into the top-right corner, always visible.
- **None.** Lienzo paints nothing: no card, no border, no shadow, a transparent frame. The page draws its own surface
  and usually its own close. The corner ✕ fades in on hover (and stays 400 ms after the pointer leaves, so it can be
  reached) or on keyboard focus; it is always there on touch. Esc closes.
- **Popover.** A small card (280 × 160 by default) 12 px above its anchor, centred on it, kept inside the canvas room;
  below when there is no room above. A 7 px diamond arrow points at the anchor's centre. Its border takes the accent at
  45 % so it reads as attached to that card, not as a panel. It follows the camera. Esc or the hover ✕ closes it.
- **Overlay.** Invisible apart from what the page draws. Its **chip** sits in the middle of the top row, level with the
  islands (under them on panels narrower than 880): a 30 px pill with the tool's icon on an 18 px accent-washed disc,
  its name, Allow when it waits for permission, and ✕ (Esc). It answers "what is drawing over my canvas" and is how to
  stop it. While the page holds the pointer the pill's border becomes 1.5 px in the accent.
- **Fullscreen.** The Lienzo area in `surface0`, the page on top, the hover ✕ in the top-right corner; Esc leaves.
- **Accent.** The manifest's `accent` (a canvas tone or `#rrggbb`) tints the tool's icon in its title tile, its chip,
  the + catalog tile and a pinned toolbar button. Without one, Lienzo's accent.
- **Restricted tools** keep the amber Allow strip under the title bar (panels, popovers, fullscreen) or an Allow
  button in the chip (overlays).
- **Snap (example).** Grains are 2–3 px cut out of a crisp picture of the card (a snapshot in the desktop app, a
  stand-in card drawn from the theme in a browser), released left to right with jitter over 1.3 s and drifting up and
  right; one grain in four turns 60 % toward the canvas' violet once it flies, so the dust reads on light and dark
  cards. The question card that follows uses the island look and the theme's accent for Delete.

## 46. Link bundles (October 2026)

Many links between the same two areas read as a tangle long before they are many. A bundle gathers them into one
strand of parallel lanes between two clips, the way wires are tied into a loom, and fans them out again at each end.
Each link stays a link (its colour, kind dash, label, arrowhead and meaning are its own); only its path changes.

**Drawing.** From its source, a lane leaves the side of the card that faces the first clip along the strand's axis
(a sideways strand makes every lane leave sideways, so the fan reads as one gesture) and curves softly into the clip,
arriving along the spine. Between the clips the lanes run parallel, 4 world units apart, so the strand scales with the
canvas exactly like every other line. Their order is fixed along the whole spine: by where the sources sit across the
entry, then by where the targets sit across the exit. A wiring whose two orders agree never crosses anywhere (tested);
when they disagree the crossing happens once, in the exit fan, never inside the strand. Out of the last clip each
lane curves to its target; several lanes reaching one card spread along its side in lane order. Labels of bundled
links sit near the target end, where the lane is its own again.

**Colour.** At rest a lane keeps its tone at 0.72, never the grey of a loose connector: a strand reads as neat
coloured wires, not a grey rope. In focus the lit lanes go to full tone and width 2, the rest fall to 0.12. The clips
are small capsules (6 units thick, rounded ends, two grip dots) across the strand, in the amber tone (`aviso`) with a
halo of the canvas colour, so they read as ties over the wires in both themes and never as a selection, which stays
blue. A selected bundle rings its clips in the foreground colour and lays a soft accent band under its lanes; hovering
the strand shows the band at a lower strength. Tokens: `graph.link.bundle`.

**Hands.** Shift-click links to pick several (the bar shows "N links" and Bundle, ⌘B), or hold ⌥ and drag a straight
cut across links (dashed accent line, solid once it crosses two). New clips land at about a third and two thirds of the
way between the two sides, inside the gap when there is one, level with its middle; a bundle whose ends all sit in one
Frame lives in that Frame and travels with it. A clip drags alone, the strand between the clips drags both; both
follow the hand live and write once on release. Click the strand to select the bundle: Unbundle, Delete (the bundle
with its links), and, with links Shift-clicked, add them or take them out. Double-click a clip to release. Hovering a
lane outside the strand lights that whole link; the strand itself belongs to the bundle. A selected bundled link
offers "Select its bundle" and "Leave bundle". Duplicating, copying and Alt-dragging cards copy a bundle only when
every one of its links comes along; otherwise the copies are loose.

**Not done.** The selection box does not catch links (Shift-click and the cut cover it); a spine with more than two
points can come from an agent (`bundle.update`) but has no hand gesture to add a bend yet. Native (non-web) draws
lanes as elbows and clips as plain capsules, and has no cut gesture.

QA (`design/whiteboard-harness/bundles.cjs`, real pointer and keys, light and dark): four sensors wired to four
targets by eight links; pick and ⌘B, drag a clip, the strand and a card, hover a lane, select and Unbundle, cut and
double-click. Screenshots in `design/qa-bundles-2026-10/`. The harness host now answers `canvas.selection.set` with the
selection result the real server returns (it returned a whole view, so every press that cleared a selection showed
"not saved"); with that, `power.cjs` passes, and `frame-drag.cjs` shows one check that also fails on the base
commit with the corrected host: a drawing inside a Frame does not drag after the hollow shape check.
