# Lienzo — visual design specification (v5, aligned with `plugin/shared`)

Owner: visual designer (Opus). Audience: the frontend implementer of `plugin/client/` and
`plugin/index.client.tsx`. Normative. Field, operation and RPC names below are the ones in
`plugin/shared/model.ts`, `rpc.ts` and `builtins.ts`; if those files change, **they win on names
and shapes, this file wins on how things look**.

| Artifact | Status | Role |
| --- | --- | --- |
| `design/tokens.json` (v5) | ready | Numbers, colours, font styles and icon names. Transcribed into `plugin/client/tokens.ts`. v3 adds graph geometry; v4 adds gesture, camera, layout and accessibility motion (§16); v5 adds resize, media navigation, onboarding and link magnetism (§17). |
| `design/demo.html` | ready | A small real interactive profile/settings page in the Lienzo palette. It is *example content* for the `preview` block (served under `/design/demo.html`), not a mock of the plugin. |
| `docs/design-audit.md` | rolling | Designer's review of the implemented UI with concrete fixes. |
| `design/graph-harness/real/` | ready | Real RN canvas components mounted under react-native-web, with example data and stand-in host/controller. Verification scope and reproduction in its README. |

Not in the contract, therefore **not designed and must not be rendered**: per-block author/provenance
glyphs, locked/gated groups, per-block tone overrides and group resize handles.
Optional block sizes are now part of the contract, by explicit user authorization (§17.2).
Canvas links are part of the contract and are specified in §15.

---

## 1. Identity

- **Name:** *Lienzo*. "Paseo Canvas" appears only as the mono subtitle of the no-documents state.
- **Idea:** a drafting table shared by a person and an agent. Paper surface, ink text, one
  blueprint-blue accent. Blocks are index cards; groups are frames with a labelled header. No
  gradients or glows. At rest, depth is a surface step plus a 1 px border. A shadow appears only
  while an object is picked up (§16).
- **Language:** Spanish (neutral "tú"), sentence case, no exclamation marks, no emoji. Verbs on
  buttons. Identifiers stay mono and untranslated (`REV 14`, ids, URLs).
- **Three typographic voices** (strict):
  - **Serif** — names people author: document title, group title, empty-state headline, metric value.
  - **Sans (system)** — everything you read or press.
  - **Mono uppercase 10.5, +0.6 tracking** (`label`) — machine metadata: type names, revision, ids,
    counts, eyebrows. Mono 12 (`code`) for code, URLs, JSON.
- **Honesty rules:**
  - `document.example === true` → chip `EJEMPLO` (`FlaskConical` 12, tone `aviso`) beside the title
    in the top bar, the documents list and the outline header. Not dismissible.
  - Agent activity is drawn only from real signals: `useAgent(...).status`, `AgentEvent.status`,
    `readHistory` transactions. No typing dots, no optimistic "Enviado".
  - `progress` blocks show declared numbers; never animate them as if work were happening.

## 2. Platform constraints (Paseo 0.10.3, RN 0.81)

- Client modules: `react`, `react-native`, `@getpaseo/plugin`, `@getpaseo/plugin/client`,
  `…/client/react-native`, `…/client/ui`, `@tanstack/react-query`, `zod`. Nothing else.
- No SVG, no icon packages, no gesture/reanimated libraries, no `className`. Build with `View`,
  `Text`, `Pressable`, `Image`, `PanResponder`, `Animated` and host `Icon`, `Modal`, `ScrollView`,
  `FlatList`, `TextInput`, `ExternalLink`, `useToast`, `copyText`.
- Host `Icon` renders nothing for unknown names → every icon sits in a fixed-size box.
- Colours come from `theme.colors` (`tokens.hostColorRoles`). Lienzo adds two hues (`violeta`,
  `turquesa`), each with a light and dark value. Only literal allowed: scrim `#000` at 0.45.
- Fonts: `tokens.font.family` via `Platform.select`. No custom fonts.
- Overlays are host `Modal`s (dialog on wide, sheet on compact).
- **DOM is allowed only in `plugin/client/web.ts`**, guarded by `layout.platform === "web"` and
  `typeof document !== "undefined"`. Its whole surface (see §9.3, §6.3, §5):
  `downloadJson`, `pickJsonFile`, `WebFrame`, `attachWheel`, `attachKeys`, `attachMiddlePan`,
  `isTextTarget`, `isDragHandle`, `swallowClick` and `mountLinkLayer`. Each stays inert on native.

### 2.1 Colour helpers (`color.ts` — already matches)

`parseColor`, `withAlpha`, `isDark(surface0)`, `toneColor(tone, theme)`. Derived, memoised per theme:

| Name | Value |
| --- | --- |
| `wash(tone)` / `washStrong(tone)` | tone at 0.10 / 0.16 |
| `toneBorder(tone)` | tone at 0.38 |
| `groupFill(tone)` | tone at 0.05 |
| `halo` | `accent` at 0.20 |
| `hover` / `pressed` | `foreground` at 0.06 / 0.10 |

Tone colour paints spines, icons, washes and borders — **never body text and never meaning on its
own**. Text on a wash is `foreground`; labels are `foregroundMuted`.

### 2.2 Contributed themes

Register `tokens.contributedThemes` (**Lienzo Papel**, **Lienzo Tinta**) with `client.addTheme`.
Never activate one for the user. Lienzo must read correctly under any host theme.

## 3. Layout

Workspace panel (`context: "workspace"`). Title "Lienzo", icon `Frame`. Measure the root with
`onLayout`; never `Dimensions`.

**Wide** (width ≥ 980, not compact):

```
┌ TopBar 48 ───────────────────────────────────────────────────────────┐
├ Catalog 288 ┬ Canvas (surface0)                     ┬ Inspector 328 ─┤
│ surface1    │                              [zoom]   │ surface1       │
│             ├ Context tray ≥56 (surface1) ──────────┤                │
└─────────────┴───────────────────────────────────────┴────────────────┘
```

Panels are flush (radius 0), divided by 1 px `border`. The inspector is always present on wide; with
no selection it shows the document (and its communication). Catalog toggles from the top bar.

**Medium** (not compact, < 980): catalog and inspector are mutually exclusive side overlays inside
the panel (absolute, below the top bar, same widths, scrim behind closes them). Selecting does not
open the inspector; the tray offers "Inspeccionar".

**Compact** (`layout.compact`): default view **Esquema** (§8). Top bar 52. Catalog, inspector and
documents are `Modal` sheets. Controls 44 high, `hitSlop` to 44 on icon buttons, body text 14/21
(`font.compactBump`). The free canvas remains selectable from the view toggle, read-mostly
(pan, zoom buttons, tap to select; no dragging).

## 4. Controls

`Pressable` + `accessibilityRole/Label/State`. Pressed = `pressed` overlay; web hover = `hover`.
Disabled = opacity 0.45. Keyboard focus = 2 px `accent` border replacing the 1 px one.

| Control | Height | Pad H | Radius | Fill | Border | Label |
| --- | --- | --- | --- | --- | --- | --- |
| Button primary | 32 (44 compact) | 12 | 6 | `accent`; disabled `surface2` @0.7 | — | `button`, `accentForeground`; disabled `foregroundMuted` (a washed accent slab reads as an error, a quiet control reads as "not yet") |
| Button secondary | 32 (44) | 12 | 6 | `surface2` | 1 `border` | `button`, `foreground` |
| Button ghost | 32 (44) | 8 | 6 | transparent | — | `button`, `foreground` |
| Button danger | 32 (44) | 12 | 6 | transparent | 1 `statusDanger`@.38 | `button`, `statusDanger` |
| Button small | 26 | 8 | 6 | per variant | per variant | `small` 600 |
| Icon button | 32×32 | — | 6 | transparent; hover `foreground`@.06; active `surface2` | — | icon 16 `foregroundMuted`; active `foreground` |
| Segmented | 28 in a 32 track | 10 | 4 in 6 | track `surface2`; active `surface1` + 1 `border` | — | `small` 600; inactive muted |
| Input | 32 (44) | 10 | 6 | `surface2` | 1 `border`; focus 2 `accent` | `body` |
| Text area | min 64 | 10 / 8 | 6 | `surface2` | as input | `body` (`code` for JSON) |
| Chip | 20 | 6 | 4 | `wash(tone)` | — | `label` muted; optional 12 icon in tone |
| Option row | min 36 | 10 | 6 | transparent (outlined on the card); selected `washStrong(violeta)` | 1 `border`; hover `foregroundMuted`@.5; selected 1.5 violeta | `body` + 16 radio |
| Check row | min 28, pad V 5 | 6 (bleeds −6) | 6 | hover `foreground`@.06 | — | 16 box aligned to the **first line** of a wrapping label + `body` |

One primary per region. Icon+label: icon 14, gap 6. Radio/check glyphs are Views: 16×16, 1.5 px
ring in `foregroundMuted`@0.7 (the host `border` colour can vanish on `surface2`); checked = tone fill + host `Check` 12 in `surface1`; radio radius 8 with a 6 px dot.
Progress bar: 6 high, radius 3, track `surface2`, fill `toneColor("exito")`,
`accessibilityRole="progressbar"`.

## 5. Top bar

48 high, pad H 12, gap 8, fill `surface1`, bottom border 1. Left → right:

1. Catalog toggle — `LibraryBig`.
2. Document switcher — serif `title`, one line, max 360; `EJEMPLO` chip if example; `ChevronDown` 14.
   Opens "Documentos" (§11.1).
3. Revision chip — `REV {document.revision}` with a 6 px dot: `statusSuccess` in sync,
   `statusWarning` mutation in flight, `statusDanger` last mutation failed/conflicted. Press →
   inspector "Historial".
4. Spacer.
5. Undo / Redo — `Undo2` / `Redo2`, enabled by `view.canUndo` / `view.canRedo`.
6. View toggle — segmented `Lienzo | Esquema`.
7. Agent chip — from `view.connection` + `useAgent`: `Bot` 12 + agent title (max 140) + dot
   (`statusSuccess` idle, `accent` running, `statusDanger` error/closed); or `Unplug` + "Sin agente".
   Press → "Agente conectado" (§11.2).
8. Inspector toggle `PanelRight` (medium only).

Web shortcuts are attached through `web.ts attachKeys` (§12).

## 6. Canvas

### 6.1 Viewport, pan, zoom (one transform)

- Viewport: `View`, `overflow: "hidden"`, fill `surface0`. One child, the **world**:
  `position: "absolute", left: 0, top: 0, width: B.w, height: B.h, transformOrigin: "top left",
  transform: [{translateX: o.x + s*B.x}, {translateY: o.y + s*B.y}, {scale: s}]`.
- `B` = bounding box of all root-level rects inflated by 600 on every side (so Android delivers
  touches; children must stay inside the world). Children are placed at `(x − B.x, y − B.y)`.
  Recompute `B` only when a gesture ends or the document changes — never mid-gesture.
- View state `{ s, o }` means `screen = s · world + o`. Pan adds the gesture delta to `o`. Zoom to
  `s'` around screen anchor `a` (default viewport centre): `o' = a − (a − o) · s'/s`.
- Pan: `PanResponder` on the viewport background; the world is `pointerEvents="box-none"`.
  Movement < 4 px remains a tap. Empty background taps clear selection; panning preserves it.
  The camera lives in refs and `Animated.Value`s; moving it does not render the card contents.
  Middle mouse pans over cards as well as background. Wheel (web): `attachWheel` → pan; with
  ⌘/Ctrl → zoom at the pointer. Trackpad pinch follows small deltas directly; wheel notches ease.
- Zoom control: bottom-right, inset 12, one `surface1` card (1 px border, radius 8, padding 2),
  **horizontal** so it takes one control row instead of a column over the content:
  `Minus` · mono `label` percent (min width 48, press = 100 %) · `Plus` · 1×16 divider · `Maximize`
  (fit). `Minus`/`Plus` disable at the zoom limits. The "Solo lienzo" exit button (top-right) uses the
  same card. Steps
  `canvas.zoomSteps`. Fit = `min((vw−96)/cw, (vh−96)/ch)` clamped to `[0.25, 1]`, content centred.
  First open of a document: `s = clamp((vw − 96) / contentWidth, 0.8, 1)`, content centred
  horizontally when it fits and otherwise left-aligned at 48 px, its top at 48 px (fit-all on a tall
  stack made text unreadable). Fit and fit-selection animate for 280 ms. Native pinch is not implemented.
- No drawn grid. Positions snap to 8. Z-order: groups by depth < connector lines < blocks < connector labels < link handle < banners/zoom (§15).

### 6.2 Geometry (what must result; nested flex or computed rects are both fine)

Positions are **relative to the parent group** (root = world). Blocks can store an optional
`size: { width, height }`; groups continue to size themselves around their children (§17.2).

- **Block width:** `standard` 288, or `wide` 592 for renderers `diagram` and `preview-frame`
  (`tokens.renderers[*].width`). These are defaults. Height is content height (measure with
  `onLayout`); an explicit block size takes precedence over both default dimensions.
- **Group box:** header 36 on top, then padding 16 around its content (nested: header 32, padding 12).
  Content is laid out by `group.layout.mode`; children are `blockIds` in order, then `groupIds`.

| `layout.mode` | Label | Result |
| --- | --- | --- |
| `stack` | Pila | One column, gap `layout.gap ?? 12`. Column width = widest child; children without an explicit size stretch to it. |
| `grid` | Rejilla | `layout.columns ?? 2` columns (max 4) of 288, gap `?? 12`, items top-aligned. Default `wide` blocks span the full row. Explicitly sized blocks span the needed columns, bounded by the column count, and keep their own width. |
| `flow` | Flujo | One row left→right, gap `?? 28`, items top-aligned, a `ChevronRight` 14 (`foregroundMuted`) centred in each gap at y = 20. Reads as a sequence. |
| `free` | Libre | Children absolute at their `position` (subject to the collision and enclosure rules below). Inner size = max(child.x + width), max(child.y + height); min inner width 288. Children without `position` are stacked below the positioned ones, gap 12. |
| *(absent)* | — | Infer by §15.1. A few pinned children do not change the automatic layout of their siblings. |

- **Collisions (client-side, never persisted).** Content, neighbours and stored sizes can change.
  After sizes are known, `resolveOverlaps` runs over
  each family of siblings, in every mode: pinned siblings are visited first, nearest-the-origin;
  one that intersects an already placed sibling moves **right or down,
  whichever is shorter**, to clear it by the family gap (root 32 = `canvas.groupGap`; in a group, its
  `layout.gap ?? 12`), snapped up to 8. Siblings that do not intersect are never moved, so deliberate
  free positioning is kept. Root siblings therefore never overlap.
- **Frames enclose children.** A child stored left of the padding or above the
  content top (header + padding + description) is clamped back inside; the frame is sized after
  collisions are resolved.
- **Group description** is measured (`heights[descriptionKey(groupId)]`, max 2 lines = 34) and
  followed by a 12 gap; the content top is `header + padding + description + 12`.
- **Root:** entities with `position` sit there. Root entities without one go on an *unplaced shelf*:
  a row-wrap strip (max width 1400, gap 48, top-aligned) at x = 0, y = (bottom of positioned content
  + 64), or (0, 0) if nothing is positioned. They are client-placed only; the first drag persists a
  position.
- `group.collapsed === true` → the box is the header alone (width kept, min 320).
- **Dragging** (wide/medium): the whole node card, a prose card's header/title, or a group's header.
  Every layout permits dragging. Selection moves together; selected descendants travel once with
  their selected ancestor. Dragging pins an entity with `entity.move` (`{id, parentGroupId,
  position}`); unpinned siblings continue to arrange automatically. The transaction also preserves
  sibling order and freezes unplaced siblings when a manual container needs that (§16.1).
  Inputs, selectable body text, embedded previews and action buttons keep their own interaction.
  While held, a card stays opaque, lifts to scale 1.02 and its connectors follow directly.
- Drop on the innermost open group under the pointer → parent-relative `entity.move`; release on
  background → root. Own descendants and collapsed groups are excluded. Target feedback: 2 px
  dashed `accent` border, "Soltar aquí" and `accent` fill at 0.08, entering over 120 ms.

### 6.3 Block card

```
┌─┬──────────────────────────────────────────┐
│ │ [icon14] PREGUNTA · 3 OPCIONES        ⋯  │  header: mono label
│s│ Comprobar comprensión                    │  heading 14/20 600
│p│ …renderer body…                          │
│ │ [Compass] instrucción   · En cola        │  footer (optional)
└─┴──────────────────────────────────────────┘
```

- Fill `surface1`, 1 px `border`, radius 10, `overflow: "hidden"`, min height 72.
- **Spine:** absolute left strip 3 px, full height, `toneColor(tone)`; for `neutro` use `border`.
- Padding 12 vertical, 14 right, 17 left (14 past the spine). Row gap 8; the title pulls 4 closer to
  its label row so label + title read as one heading unit.
- Header (**fixed 20 high**, 24 compact — the options button must never change the measured height,
  or hovering a card would re-flow the canvas): type icon 14 in tone colour; `label` = `BlockType.name` uppercased + optional
  ` · QUALIFIER`; spacer; `Ellipsis` 14 when selected/hovered (menu: Duplicar, Subir, Bajar,
  Eliminar → as a `Modal` on compact, inline row list otherwise).
- Title `heading`, max 3 lines. Empty title → omit the row.
- Footer (only when it has content): 1 px `border` hairline above, padding-top 8; left `Compass` 12 `accent` + `small` "Con instrucción" if
  `block.communication` exists; right = delivery state of the latest `AgentEvent` whose
  `action.targetIds` includes this block (§10.1).
- Icon/tone/width come from `tokens.renderers[type.renderer]`; type without renderer → `generic`.

Bodies by renderer. Built-in types first (keys exactly as in `builtins.ts`):

| typeId · renderer | `data` | Body |
| --- | --- | --- |
| `note` · note | `text` | `body` text, max 8 lines on canvas, unlimited in outline. |
| `code` · code | `code`, `language?` | Qualifier = language. Box: `surface2`, radius 6, pad 8/10, `code`, `selectable`, horizontal `ScrollView`, max 12 lines then mono row "… {n} líneas más". `Copy` icon button (26) top-right. No syntax colours. Never executed. |
| `checklist` · checklist | `items: (string \| {label, done?})[]` | Qualifier `{done}/{n}` when any item is an object. Check rows. Toggling rewrites `items` as `{label, done}` objects in one `block.update` (label "Marcar «…»"); done = muted + line-through. |
| `choice` · choice | `question`, `options: string[]`, `answer?` | `body` question, option rows (single choice). Small primary "Enviar respuesta", disabled until a choice differs from `answer`. On press: `block.update {data.answer}` then `agentAction` (§10.1). Stored `answer` shows as the selected row plus footer state. |
| `progress` · progress | `current`, `total` | Progress bar + `small` "{current} de {total}". Clamp to [0, total]; `total ≤ 0` → bar empty, text "Sin total". |
| `preview` · preview-frame | `description`, `url?` | §6.4. |
| `media` · image-ref | `url`, `caption?`, `mediaKind?` | §6.5. |
| `diagram` · diagram | `DiagramData` | §7. |

Other renderers in the enum (reached only through pack-defined types). Read the listed keys if
present; whatever is missing falls through to **generic rows**:

| Renderer | Keys | Body |
| --- | --- | --- |
| `text` | `text` | Like note. |
| `callout` | `text`, `severity?` (`info`/`success`/`warning`/`danger`) | Whole card body on `wash(tone)`; tone + icon by severity: `Info` acento, `CircleCheck` exito, `TriangleAlert` aviso, `CircleAlert` riesgo. |
| `metric` | `value`, `unit?`, `label?` | Serif `display` value + `small` unit; `label` below in `small` muted. |
| `step` | `text`, `status?` (`todo`/`doing`/`done`) | 20 px circle marker (ordinal within its group, mono `label`): done = exito fill + `Check`; doing = 1.5 `accent` border; todo = 1.5 `border`. Text beside it. |
| `quiz` | `question`, `options`, `answer?`, `hint?`, `explanation?` | As choice + ghost small "Ver pista" revealing a `wash(turquesa)` box; `explanation` appears only once `answer` is stored. |
| `form` | the type's `properties` | Each property as an editable field (§10 field pattern) on the card + small primary "Enviar". |
| **generic** (no renderer / missing keys) | every `properties[]` entry | Rows: mono `label` (property `label`) above the value — text → `body`; number → `code`; boolean → read-only check glyph + "Sí"/"No"; json → `code` box, max 4 lines. |
| **unknown** (typeId not in catalog) | raw | Icon `PackageOpen`, label = raw `typeId`, body "Este tipo no está en tu catálogo. Importa el pack que lo define." + ghost small "Abrir packs". Data is preserved, never editable here. |

Block states:

| State | Rendering |
| --- | --- |
| Hover (web) | Border `foregroundMuted`@0.5. |
| Dragging | Opacity 0.92, 2 px `accent` border, drawn above its siblings (a dragged group lifts its children with it). |
| Selected (`selectedIds`) | Halo wrapper (padding 3, radius 13, fill `halo`) + 2 px `accent` border; reduce inner padding by 1 so content does not shift. |
| Keyboard focus | Same wrapper with `foregroundMuted`@0.3, border unchanged. |
| Mutation in flight | Opacity 0.7 on the affected block; footer right "Guardando…". |
| Mutation failed | 1 px `statusDanger` border; footer `CircleAlert` 12 + "No se guardó" + ghost small "Reintentar". |
| Changed by agent (optional, from `readHistory`: id in `changed` of an `actor: "agent"` transaction newer than the last revision this client rendered) | 6 px `accent` dot at the header's right, cleared on selection or after 8 s visible. |

### 6.4 Preview block (`preview`: `{ description, url? }`)

Default wide card (592); a saved size overrides it. Only safe `http:`/`https:` URLs count
(use `safeUrl`); anything else is treated as absent.

- **With URL:**
  - URL bar: 28 high, radius 6, fill `surface2`, pad H 8: `Globe` 12 muted · URL in `code`, one
    line, middle-ellipsised · `ExternalLink` icon button 26 (host `ExternalLink` / workspace browser).
  - Frame: height 360 (240 compact), radius 6, 1 px `border`, `surface0` fill, `overflow: hidden`.
    - **Web:** `WebFrame` from `web.ts` (an `<iframe>` created with `createElement`,
      `referrerPolicy="strict-origin-when-cross-origin"`, `loading="lazy"`, title = block title).
      The page is interactive immediately: input, buttons and scrolling stay inside the iframe.
      Loading feedback never intercepts the pointer. Baseline sandbox = `allow-scripts allow-forms`.
      A cross-origin page additionally gets `allow-same-origin allow-popups
      allow-popups-to-escape-sandbox`, so its own storage and sign-in popups can work. A URL on
      Paseo's own origin keeps the baseline sandbox. This does not bypass embedding, cookie or
      browser restrictions. After 8 s without `load`, show the honest timeout message and retain
      the external-open action. A `load` event is not evidence that the embedded app works.
    - **Native:** no web view. The frame shows a centred column: `AppWindow` 24 muted, `small`
      "La vista en vivo se abre en el navegador.", secondary small "Abrir vista previa".
  - Description below the frame in `body`.
  - A sized card fills its remaining space with the frame, keeping a 200 px frame minimum and
    scrolling its body if necessary. Move the card by its header; resize it by its corner.
- **Without URL (conceptual reference):** no URL bar, no frame. A box min-height 96, 1 px dashed
  `border`, radius 6, pad 12: mono `label` "REFERENCIA CONCEPTUAL" + description in `body`. It must
  not look like a running app.
- Qualifier: `Web` when a URL is present, otherwise none. In an example document the header
  also carries the `EJEMPLO` chip.

### 6.5 Media block (`media`: `{ url, caption?, mediaKind? }`)

- Accept links first; there is no local media upload. Infer familiar image/video/audio file
  extensions; `mediaKind` can identify a URL without an extension. Unknown URLs remain references.
- **Image:** RN `Image`, default height 180, `resizeMode="contain"`, fill `surface2`, radius 6.
  Press to open `ImageViewer`: zoom 1–4× in 0.5 increments, reset-to-fit, and local image panning.
  Viewer height 440 desktop / 320 compact. Its gesture never reaches the canvas.
- **Direct video/audio on web:** browser-native controls in `web.ts`; video default height 200,
  audio 48. `preload="none"`, inline playback, no autoplay. Controls handle playback, seeking,
  fullscreen or picture-in-picture where the browser offers them. Direct media pauses when
  offscreen or when the page becomes hidden; no React playback loop.
- **YouTube/Vimeo on web:** show a quiet provider tile and `Cargar reproductor` first. Only that
  explicit press mounts a player. Build the embed URL from a validated provider ID; YouTube uses
  `youtube-nocookie.com` and preserves start times, Vimeo preserves valid unlisted `h` hashes.
  Original query strings cannot enable autoplay. `Cerrar reproductor` unmounts it. Provider
  permissions, availability and embedding policies still apply.
- **Native video/audio/web:** open the original URL in the browser; no unprovided native WebView
  or player dependency is assumed. Image viewing uses RN primitives.
- Unknown or failed media shows its host, original URL and an honest fallback message.
  Keep `Abrir referencia` and the optional caption visible. Invalid URLs explain how to supply
  a valid HTTP/HTTPS link in the inspector. A sized card grows its media area without stretching
  the image or scaling text; a short card scrolls its body.

Provider URL decisions follow the [YouTube player parameters](https://developers.google.com/youtube/player_parameters),
[YouTube embedding guidance](https://support.google.com/youtube/answer/171780?expand=PrivacyEnhancedMode&hl=en)
and [Vimeo's unlisted embed guidance](https://help.vimeo.com/hc/en-us/articles/12426470858001-Embedded-player-displays-This-video-does-not-exist-message).

### 6.6 Group frame

```
┌───────────────────────────────────────────────────────────────┐
│ ▾ 01  Una lección paso a paso        5 · LECCIÓN PROGRESIVA ⋯ │ 36
├───────────────────────────────────────────────────────────────┤
│  Concepto, ejemplo, pregunta y recapitulación.                │ description (optional)
│  …children…                                                   │
└───────────────────────────────────────────────────────────────┘
```

- Box: 1.5 px `border`, radius 14, fill `groupFill("neutro")` (= `foregroundMuted`@0.05).
  Groups have no tone in the contract; they are neutral so that block tones carry the colour.
  Nested: radius 10, 1 px border.
- Header (36, pad H 12, gap 8, bottom 1 px `border`, none when collapsed): chevron
  (`ChevronDown`/`ChevronRight` 14, toggles `collapsed` via `group.update`, label "Plegar grupo");
  mono `label` ordinal `01` (index among siblings, 2 digits) in `foregroundMuted`; serif `groupTitle`;
  spacer; mono `label` child count; template chip (template `name` uppercased) if `templateId`
  resolves; `Compass` 12 `accent` if `group.communication`; `Ellipsis` when selected/hovered (Duplicar,
  Guardar como plantilla, Desagrupar, Eliminar).
- `description` (if non-empty): first content row, `small` muted, max 2 lines on canvas.
- Empty group: content is one dashed box, height 56: `small` muted "Grupo vacío. Suelta un bloque o
  añade uno desde el catálogo."
- Count: mono `label` inside an 18-high outlined pill (1 px `border`, radius 9, min width 20) so a
  lone digit reads as a count. Title shrinks with an ellipsis before any chip does; the template chip
  is capped at 112.
- Content inset = group padding on all sides (16, nested 12); the description never touches the
  header rule. Empty box: radius 6.
- Hover (web): border `foregroundMuted`@0.5.
- Drop target: 2 px dashed `accent` border + `halo` fill, header rule tinted `accent`@0.38 and the
  count replaced by mono `label` "SOLTAR AQUÍ" in `accent`.
- Selected: 2 px `accent` border + `halo` wrapper (radius 17; nested 13). Pressing the header or empty frame
  area selects the group, not its children.

## 7. Diagram block (`renderer: "diagram"`, `DiagramData`)

`{ nodes: [{id, label, description?, position?}], edges: [{id, from, to, label?}], caption? }`.
Arrays are replaced whole on each update. Wide card (592 → inner width ≈ 565). All numbers are in
`tokens.diagram`. Layout must be a pure function `(data, innerWidth) → { nodes: Rect[], edges:
Segment[][], size }` in `logic.ts` so it can be unit-tested.

### 7.1 Node

Fixed box **136 × 44**, radius 8, pad H 8, fill `surface0`, 1 px `border`. Label: `small` 600,
`foreground`, centred, max 2 lines, tail ellipsis. The description is **not** inside the node (keeps
every node the same size, so connectors need no measuring); it appears in the detail strip (§7.5).
A node is a `Pressable` (`accessibilityLabel="Nodo {i} de {n}: {label}"`).

### 7.2 Automatic layout (top → bottom layers)

Use it unless **every** node has `position` (then §7.4).

1. **Layers.** Walk edges in array order; an edge is a *back edge* if it closes a cycle (DFS from
   nodes in array order) or is a self-loop. Ignoring back edges, `layer(n) = 0` for nodes without
   incoming edges, else `1 + max(layer(pred))`. If no node has layer 0, the first node is the root.
2. **Order inside a layer** = node array order. (Stable: when the agent appends a node, existing
   nodes do not swap places.)
3. **Columns.** `cols = max(1, floor((innerWidth + 24) / (136 + 24)))`, capped at 3. A layer with
   more nodes than `cols` wraps into consecutive rows.
4. **Coordinates.** Row *r* top = `12 + r · (44 + 40)`. A row with *k* nodes is centred:
   `x_i = (innerWidth − (k·136 + (k−1)·24)) / 2 + i · 160`. Area height = `rows·44 + (rows−1)·40 + 24`.
5. **List fallback** (§7.6) replaces all of this when `innerWidth < 296` (one column) or
   `nodes.length > 30`.

### 7.3 Connectors (Views only)

A line is a `View` 1.5 px thick, colour `foregroundMuted`@0.7. All routing is orthogonal.

| Case | Route |
| --- | --- |
| Target in the **next row** | From source bottom-centre down to `midY` (source bottom + 20), horizontal to the target's centre x, down to target top. Three Views (one if centres align). |
| **Same row** | Straight horizontal from the facing side-centres (right→left or left→right). |
| **Skips rows downward** | Right rail: out of the source's right-centre, horizontal to `x = contentRight + 10 + lane·8`, vertical, back into the target's right-centre. Lanes 0–3 assigned in edge order, then reused. |
| **Back edge / upward / self-loop** | Same as the rail but on the **left** side and `borderStyle: "dashed"` (draw each segment as a zero-size-axis View with a dashed 1.5 px border). Self-loop: omit; show it in the detail strip instead. |

The diagram area reserves 10 + 4·8 = 42 px on a side only if that side has rail edges (subtract it
from `innerWidth` before step 3).

- **Arrowhead:** at the target end, a 6×6 `View` with `borderRightWidth` and `borderBottomWidth`
  1.5 in the line colour, rotated so the corner points along the direction of travel (45° down,
  −45° right, 135° left, 225° up), positioned so its corner touches the node edge.
- **Edge label:** `small` 11/14 muted, one line, in a pill (pad 1/4, radius 4, fill `surface1`)
  that masks the line behind it. Next-row edges: centred on the **target's centre x**, max width
  136, so the labels of a fan-out never touch. When any edge has a label, `gapY` is 48: the
  horizontal run sits at source bottom + 16, the label centre at source bottom + 30, the arrowhead
  in the last 7 px. Same-row and rail edges: centred on their longest horizontal segment, max 120.
- Edges render under nodes. Several edges leaving one node share its stub; that is intended.

### 7.4 Explicit positions

If every node has `position`: treat it as the node's top-left in dp, normalised so the minimum is
(12, 12). Area size = extent + 12. If wider than `innerWidth`, wrap the area in a horizontal
`ScrollView`. Routes: target top ≥ source bottom + 16 → the next-row elbow (V-H-V); otherwise an
H-V-H elbow between facing side-centres. Nodes are not draggable in v1.

### 7.5 Teaching: current step, progressive expansion, detail strip

There is **one highlighted node at a time**: the *current step*.

- **Where it comes from.** (a) When an update arrives whose node ids ⊋ the previous ones (and the
  previous list was non-empty), the current step becomes the **last added node**; added nodes and
  added edges play the enter animation (opacity 0→1, translateY 6→0, 260 ms; none under reduce
  motion). (b) The user taps a node. (c) The stepper. On first load nothing is current.
  This is client view state; it is not persisted and not invented by the client beyond these rules.
- **Current node:** 2 px `accent` border, fill `wash("acento")`, inside a `halo` wrapper (padding 3,
  radius 11). Edges **into** the current node: 2 px, `accent`, arrowhead `accent`, label
  `foreground`.
- **Stepper** (footer row of the block, 1 px `border` hairline above; prev · centred label (min 92) ·
  next sit together on the left, the 184-wide `Todo | Paso a paso` segmented on the right): ghost icon buttons `ChevronLeft` / `ChevronRight`
  around mono `label` `PASO {i} DE {n}` (order = node array order); spacer; segmented small
  `Todo | Paso a paso`.
  - `Todo` (default): every node solid.
  - `Paso a paso`: nodes after the current index become **ghosts** — same box, 1 px dashed `border`,
    transparent fill, no label, opacity 0.5; edges touching a ghost are hidden. Layout does not
    change, so the shape of what is coming stays visible. Entering this mode with no current step
    sets step 1. `ChevronRight` on the last step is disabled.
- **Detail strip** (below the area, only when a step is current): radius 6, pad 8/10, fill
  `wash("acento")`: mono `label` `PASO {i} DE {n}` · `bodyStrong` node label · `body` description (if
  any) · then one `small` muted row per outgoing edge: `CornerDownRight` 12 + "{edge.label ?? "Sigue"}
  → {target label}". Trailing ghost small "Preguntar por este paso" → `agentAction` (§10.1).
- **Caption:** `small` muted under everything, max 3 lines on canvas.
- **Qualifier** in the block header: `{n} NODOS`.
- **Empty** (`nodes.length === 0`): dashed box height 96, centred `small` muted "Diagrama vacío. El
  agente puede añadir nodos paso a paso." No stepper.
- Invalid `data` (fails `diagramDataSchema`): render the **generic** body with a `CircleAlert` row
  "Datos de diagrama no válidos"; never crash the canvas.

### 7.6 Compact / narrow fallback: connected list

Used on compact outline, in 288-wide contexts, and above 30 nodes. One row per node in array order,
row gap 10:

- Left rail 24 wide: an 18 px circle marker (1.5 `border`, mono `label` ordinal; current = `accent`
  fill with `accentForeground` number) and a 1.5 px vertical line (`foregroundMuted`@0.7) joining
  consecutive markers.
- Right column: `bodyStrong` label; `small` muted description (2 lines; unlimited when current);
  then outgoing edges as `small` muted rows: `CornerDownRight` 12 + "{label ?? "Sigue"} → {target}".
- Current row: fill `wash("acento")`, radius 6, pad 6/8. `Paso a paso` ghosts = opacity 0.5 and
  label replaced by "Paso {i}".
- Same stepper and caption. No detail strip (the row is the detail).

## 8. Outline view (Esquema) — default on compact

`ScrollView`, padding 16 (12 compact), gap 16, content max width 720 centred.

- Header: serif `display` title, `EJEMPLO` chip, `small` description.
- Each root group is a section: header row on a `foregroundMuted`@0.05 strip, radius 10 (ordinal,
  serif `groupTitle`, count, chevron); description; then its blocks (the **same block components**
  at width 100 %, no line clamps), then nested groups indented 12 with a 2 px `border` left rule.
  Every layout mode reads as a single column here.
- Root blocks last, under the mono eyebrow "SUELTOS".
- Tap selects. Reorder through `Ellipsis` → "Subir"/"Bajar".

## 9. Catalog (left rail / sheet)

Header (pad 12, gap 8): eyebrow "CATÁLOGO LOCAL"; search input (`Search` 14); segmented
`Bloques | Plantillas | Packs`. Body: `ScrollView`, pad 12, gap 8. Data: `readCatalog`.

- **Block type card** — min height 76, radius 10, 1 px `border`, fill `surface0`. 32×32 tile (radius
  6, `wash(tone)`, icon 16 in tone colour) · gap 10 · `bodyStrong` `name`, `small` muted
  `description` (2 lines), mono `label` `id`. Trailing `Plus`. Press = `block.create` with
  `defaults`, into the selected group if exactly one group is selected, else at the viewport centre
  (root); then select it. Label `"Añadir {name}"`.
- **Template card** — same shell; the tile is a 56×40 miniature: 1.5 px `border` rounded frame with
  up to 3 bars (4 high, radius 2, `washStrong` of each of the first three blocks' tones). Text:
  `name`, `description`, mono `label` "{n} BLOQUES · {m} GRUPOS". Press = `template.insert`
  (`idPrefix` = `newId("t")`).
- **Pack card** — radius 10: `Package` 16 + `bodyStrong` `name` + mono `label` `id`; `small`
  `description`; mono `label` "{a} TIPOS · {b} PLANTILLAS · {c} DOCUMENTOS"; if it has documents,
  one row each: `FileText` 12 + title + ghost small "Crear documento" (`instantiatePack`); actions:
  ghost small "Exportar" (`FileOutput`), danger ghost small "Quitar" (`pack.remove`; if the server
  refuses, toast its message). Packs `frontend` and `learn` carry the `EJEMPLO` chip.
- Above the pack list: secondary full-width "Importar pack" (`FileInput`).
- No search results: `small` "Nada coincide con «{q}»." + ghost "Limpiar búsqueda".
- No block types (catalog failed/empty): §11 error/empty patterns, never a blank rail.

### 9.1 Import pack (`Modal` "Importar pack", icon `FileInput`)

1. **Origen.** Text area (`code`, min height 160, placeholder
   `{ "format": "paseo-canvas-pack", "version": 1, … }`). Helper `small`: "Pega el JSON del pack. Se
   guarda solo en este equipo." **Web only**, above the text area: secondary small "Elegir archivo…"
   (`FolderOpen`) → `pickJsonFile()` fills the text area (rejects > 1 MiB with toast "El archivo
   supera 1 MB."). Secondary "Revisar" → `JSON.parse` locally (failure: inline danger "No es JSON
   válido: {message}"), then `validatePack`, then `importPack { dryRun: true, replace }`.
2. **Revisión** (replaces the helper, text area collapses to 3 lines): serif `title` pack name,
   mono `label` id, then the real diff: `Plus` 14 `statusSuccess` "Nuevo: {id}" per `added`;
   `RotateCw` 14 `statusWarning` "Reemplaza: {id}" per `replaced`; `Minus` 14 muted "Sin cambios:
   {id}" per `unchanged` (collapsed behind "y {n} sin cambios" beyond 5). If `replaced.length > 0`:
   check row "Reemplazar los que ya existen" bound to `replace` (re-runs the dry run). Primary
   "Importar pack" (`dryRun: false`), ghost "Cancelar".
3. **No válido:** danger wash box (radius 6, pad 10): `CircleAlert` + "No es un pack válido" + each
   `issues[]` string in `code`, max 6 lines + "y {n} más". The text area keeps its content.

Success: close, toast success "Pack «{name}» importado", switch to Packs.

### 9.2 Export pack (`Modal` "Exportar pack", icon `FileOutput`)

Data: `exportPack({ id })`. Body: serif `title` name, mono `label` id + size ("2,4 KB"); read-only
`code` box (`surface2`, max height 240, own `ScrollView`, `selectable`) with the 2-space-indented
JSON. Actions:

- **Web:** primary "Descargar JSON" (`Download`) → `downloadJson("{id}.lienzo-pack.json", text)`;
  secondary "Copiar".
- **Native:** primary "Copiar JSON" (`Copy`); helper `small` "En el móvil no se descargan archivos:
  copia el JSON o selecciónalo."
- Copy success toast "Pack copiado"; failure toast "No se pudo copiar. Selecciona el texto."
  `downloadJson` returning `false` → fall back to copy with toast "No se pudo descargar; se copió
  al portapapeles."

"Guardar como plantilla" (group menu/inspector) → small `Modal`: Nombre (input) → `exportGroup`
(`templateId` = slug of the name + short id) → toast "Plantilla «{name}» guardada" and it appears in
Plantillas.

### 9.3 `web.ts` contract (visual behaviour)

| Helper | Behaviour |
| --- | --- |
| `downloadJson(filename, text): boolean` | `Blob` (`application/json`) → object URL → temporary `<a download>` click → revoke. `false` if no DOM or it throws. |
| `pickJsonFile(maxBytes = 1048576): Promise<string \| null>` | Temporary `<input type="file" accept=".json,application/json">`; resolves text, `null` on cancel, rejects over the limit. |
| `WebFrame({ url, height, title })` | §6.4. |
| `WebMedia({ url, height, title, kind })` | §6.5. Browser-native video/audio controls; inert on native. |
| `guideWasDismissed(scope)`, `dismissGuide(scope)` | Personal guide preference, separate from shared document state (§17.1). |
| `attachWheel`, `attachKeys` | Return an unsubscribe. No-ops off web. |

## 10. Inspector and context tray

Inspector header 48: mono eyebrow (`DOCUMENTO` / `BLOQUE` / `GRUPO` / `{n} SELECCIONADOS`) + name
in `heading`; `X` on medium/compact. Body `ScrollView`, pad 16; sections separated by 20 + a 1 px
rule, each opening with a mono `label` eyebrow.

**Field pattern:** label `small` 600 above the control (gap 4), helper `small` muted below; fields
gap 12. Commit on blur or 600 ms idle, one `mutateDocument` each with a Spanish `label`
("Editar título", "Editar «{prop}»"). In flight: 6 px `statusWarning` dot after the label. Failure:
helper becomes `statusDanger` "No se guardó" + ghost small "Reintentar".

- **Document** (no selection): *Documento* — Título (serif input), Descripción (text area) →
  `document.update`; for examples a `wash("aviso")` box "Documento de ejemplo. Su contenido es
  ilustrativo y no proviene de tu agente." *Comunicación* — the communication editor →
  `communication.set`. *Actividad* — last 5 `readAgentEvents` rows: state icon, `action.label`,
  relative time; if any is `pending`: ghost small "Enviar pendientes" (`flushAgentEvents`).
  *Historial* — last 8 `readHistory` rows: mono `REV n`, actor glyph (`Bot` agent, `User` user,
  `Cog` system) , `label`, relative time; `undo`/`redo` kinds in muted italics.
- **Block:** *Contenido* — Título, then one field per `BlockType.properties` (text → text area
  auto-growing from 1 line; number → mono input, numeric keyboard; boolean → check row; json → `code`
  text area, validated with `JSON.parse` on blur: invalid = danger helper "JSON no válido", not
  sent). `required` adds " *" to the label. *Ubicación* — Grupo: option rows of groups + "Sin grupo"
  (`entity.move`). *Instrucción para el agente* — communication editor → `block.update
  {communication}`. *Datos* — read-only `ID`, `TIPO` rows, `selectable`, `Copy` on ID. Footer:
  secondary "Duplicar" (`entity.duplicate`), danger "Eliminar" (`block.delete`; no confirm — undo
  exists; toast "Bloque eliminado").
- **Group:** *Grupo* — Título (serif), Descripción ("Propósito" helper: "Una frase: para qué sirve
  este grupo."), Disposición: segmented `Pila | Rejilla | Flujo | Libre` + for Rejilla a stepper
  `Minus` n `Plus` (1–4). *Contenido* — child rows (type icon + title; press selects) with
  `ChevronUp`/`ChevronDown` icon buttons to reorder. *Instrucción para el agente*. Footer:
  secondary "Guardar como plantilla", secondary "Desagrupar" (`group.delete {ungroup: true}`),
  danger "Eliminar grupo y contenido".
- **Multi-selection:** list of selected rows; secondary "Agrupar" (`group.create` with
  `layout: {mode: "stack"}` + moves, one transaction, label "Agrupar {n} elementos"), danger
  "Eliminar".

**Communication editor** (one component, three scopes). Container radius 10, 1 px
`toneBorder("acento")`, fill `wash("acento")`, pad 12, gap 12. Header: `Compass` 14 `accent` +
`bodyStrong` "Instrucción" + mono `label` scope. Fields, exact labels and contract keys:

| Label | Key | Control | Placeholder |
| --- | --- | --- | --- |
| Intención | `intent` | input | "Para qué se usa esto: enseñar, revisar, decidir…" |
| Audiencia | `audience` | input | "A quién le habla el agente" |
| Instrucciones | `instructions` | text area, min 3 lines, counter `small` muted "{n}/8000" | "Cómo debe comunicarse el agente a través de este lienzo" |

Below, when ancestors also carry communication: `small` muted "También se aplican:" + one row per
level from `instructionLevels` (`Compass` 12 + "Grupo «…»" / "Documento"; press selects it). On
blocks/groups with none: collapsed behind secondary small "Añadir instrucción".

The schema cannot remove `communication` from an entity, so there is no "Quitar". Instead, on block
and group scope only, when any of the three fields is non-empty: ghost small "Vaciar instrucción"
(`Eraser` 14) at the bottom of the editor → one update with `communication: { instructions: "",
intent: "", audience: "" }`, label "Vaciar instrucción", toast "Instrucción vaciada", no confirm
(undoable). **A communication whose three fields are empty after trim is treated as absent
everywhere**: editor collapsed to "Añadir instrucción", no `Compass` marker on the block footer or
group header, not listed under "También se aplican". Use one shared `hasCommunication` helper.

### 10.1 Context tray and delivery

Bottom of the canvas column, min 56, fill `surface1`, top border 1, pad H 12, gap 8.

- **No selection:** `small` muted "Selecciona bloques o grupos para darle contexto al agente."
  Selection itself is shared through `setSelection` (debounced 250 ms) and never starts a turn.
- **With selection:** mono `label` "CONTEXTO" · removable chips (max 3 + "+{n}"): type icon 12 +
  title (max 160) + `X` · input (flex 1, grows to 4 lines; placeholder "Añade una nota para el
  agente (opcional)") · primary "Enviar al agente" (`SendHorizontal`). Tray max height 220.
- **Queue chip:** if any event is `pending`, chip `Clock` "{n} en cola" before the button
  (press → inspector Actividad).
- **No connection** (`view.connection === null`): the button is replaced by chip `Unplug` "Sin
  agente" + ghost small "Conectar" (§11.2). Actions still persist as `pending`; say so: `small`
  "Se guardará en cola hasta que conectes un agente."

`agentAction` usage (`eventId` = `newId("evt")`, generated once per user press and reused on retry):

| Press | `kind` | `targetIds` | `payload` | `delivery` |
| --- | --- | --- | --- | --- |
| Tray "Enviar al agente" | `selection.send` | selected ids | `{ note }` | `immediate` |
| Choice/quiz "Enviar respuesta" | `block.answer` | `[blockId]` | `{ answer }` | `immediate` |
| Form "Enviar" | `block.submit` | `[blockId]` | `{ values }` | `immediate` |
| Diagram "Preguntar por este paso" | `diagram.step` | `[blockId]` | `{ nodeId, label }` | `immediate` |
| Quiz "Ver pista" | `block.hint` | `[blockId]` | `{}` | `batched` |

Not sent: moving, editing, checklist toggles, collapsing, selecting (persisted only).

Delivery state, shown in the block footer and in Actividad — always from the returned/polled
`AgentEvent.status`, never assumed:

| Status | Icon | Text | Colour |
| --- | --- | --- | --- |
| request in flight | — | "Enviando…" | muted |
| `pending` | `Clock` 12 | "En cola" | muted |
| `sent` | `Check` 12 | "Enviado · {hh:mm}" | muted |
| `acked` | `CheckCheck` 12 | "Recibido por el agente" | `statusSuccess` icon, muted text |
| `failed` | `CircleAlert` 12 | "No se envió" + `error` (1 line) + ghost small "Reintentar" | `statusDanger` |

Tray send: button reads "Enviando…" while in flight; on resolve toast by status ("Contexto enviado"
/ "En cola: el agente está ocupado o no conectado" / error toast); the note clears only on
`sent`/`pending`.

## 11. States

| State | Where | Design |
| --- | --- | --- |
| Loading | Canvas | One skeleton frame holding three skeleton cards (288×96, radius 10, `surface2`, opacity pulsing 0.5↔1 over 900 ms; static under reduce motion). Inspector/tray: two skeleton lines. After 4 s add `small` "Sigue cargando…". No spinner. |
| Empty document | Canvas centre, max 380 | 56×56 tile (radius 14, `wash("acento")`, `Frame` 24 `accent`); serif `display` "Un lienzo en blanco"; `body` muted "Añade un bloque desde el catálogo o pide al agente que empiece. Los grupos enmarcan bloques que van juntos."; primary "Añadir primer bloque", secondary "Usar una plantilla". |
| No documents | Panel | Same composition; headline "Lienzo", mono `label` "PASEO CANVAS"; primary "Crear documento"; below, eyebrow "EJEMPLOS" + one ghost row per pack document ("Ejemplo: revisión de una pantalla", "Ejemplo: aprender el estado de una interfaz"), each with the `EJEMPLO` chip. |
| Load error | Canvas centre | Tile `wash("riesgo")` + `CircleAlert`; serif "No se pudo abrir el documento"; the real message in a `code` box (selectable, 4 lines); primary "Reintentar", ghost "Copiar detalle". |
| Revision conflict (mutation rejected: stale `expectedRevision`) | Banner, top of canvas, inset 12, max width 560, centred | `surface1`, 1.5 px `statusWarning` border, radius 10, pad 12: `GitCompareArrows` 16; `bodyStrong` "El lienzo cambió mientras editabas"; `small` "Tu cambio se hizo sobre REV {a}; el documento ya va en REV {b}. No se aplicó."; primary small "Reaplicar mi cambio" (same operations, new revision), ghost small "Descartar". The view behind is already the reloaded one. Never auto-dismiss. A conflict that touched none of the same entities may be retried once silently. |
| Save failed (other errors) | Same slot | `statusDanger` border; "No se guardó el cambio" + server message; "Reintentar" / "Descartar". |
| Undo/redo | Toast | "Deshecho" / "Rehecho" + the transaction label when known. |
| Daemon unreachable (watch failing) | Banner | `Unplug`; "Sin conexión con Paseo. Puedes seguir leyendo; los cambios se desactivan." Mutating controls at 0.45. |
| `requiresReload` after connecting | Banner, info (`accent` border) | "Conexión guardada. Recarga el agente para que reciba las herramientas de Lienzo." + ghost small "Entendido". |

Banners stack with gap 8, at most 2; the rest collapse into "+{n} avisos".

### 11.1 Documents modal

Rows (min 52): `Frame` 16 · serif `groupTitle` title + `EJEMPLO` chip · `small` muted "REV {n} ·
{relative updatedAt}" · `Check` on the open one. Eyebrows "TUS DOCUMENTOS" (empty: `small` "Aún no
tienes documentos propios.") and "EJEMPLOS". Footer primary "Nuevo documento" (asks a title inline;
default "Lienzo sin título").

### 11.2 Agent modal ("Agente conectado", icon `Plug`)

- Current connection row or "Ningún agente recibe las acciones de este lienzo."
- Eyebrow "AGENTES DE ESTE ESPACIO": option rows (agent title, mono `label` provider, status dot);
  choosing one calls `connectAgent`; "Desconectar" danger ghost sends `connection: null`.
- Check row "Dar las herramientas de Lienzo a los agentes nuevos de este espacio"
  (`configureInjection`), helper `small` "No da acceso a un documento hasta que lo conectes aquí."
- Disclosure "Configurar un agente existente" → `agentSetup`: `instructions` in `body`,
  `configuration` in a `code` box with `Copy`; if `requiresReload`, the §11 banner text inline.

## 12. Keyboard (web, through `attachKeys`)

`Esc` clear selection/close overlay · `⌘/Ctrl Z`, `⇧⌘/Ctrl Z` undo/redo · `⌘/Ctrl G` group ·
`Delete`/`Backspace` delete selection (no input focused) · arrows / `⇧` arrows nudge entities in
every layout 8 / 32, pinning them without animation · `⌘/Ctrl Enter` Enviar al agente · `⌘/Ctrl K` catalog search · `Tab` /
`⇧Tab` next/previous entity in reading order (groups' `blockIds` then `groupIds`, root last) ·
`Enter` open inspector · inside a focused diagram: `←`/`→` previous/next step · `L` with exactly two
entities selected: link the first to the second · `Delete`/`Backspace` with a link selected: delete
the link · `1` fit the document · `2` fit selection · `0` reset zoom to 100 % · `+` / `−` zoom steps.

Blocks and groups are focusable, `accessibilityRole="button"`,
`accessibilityLabel="{Tipo}: {título}. {i} de {n} en {grupo}"`.

## 13. Accessibility and quality bar

- Lienzo Papel/Tinta: every text pair ≥ 4.5:1, tone icons ≥ 3:1 on `surface1` and on their wash
  (computed). Under other host themes §2.1 keeps text on `foreground`/`foregroundMuted`.
- Nothing by colour alone: selection thickens the border, states have words, the current diagram
  step has a thicker border *and* the detail strip.
- Every `Text` sets `color`. Truncation always uses `numberOfLines`. `selectable` on ids, URLs,
  code, JSON, error details.
- Reduce motion → durations 0, no pulse.
- Recreate styles on `theme` / `layout.compact` change.

## 14. Requests to the backend (non-blocking)

1. `checklist.items`: confirm the client may store `{label, done}` objects (§6.3).
2. A `"Workflow"`-style `icon`/tone per type is **not** needed; the client maps `renderer`.
3. Built-in `preview` example may point `url` at `/design/demo.html` on the Tailscale host so the
   frontend example shows a real rendered page (labelled example).

## 15. Graph canvas (architecture §13) — tokens `graph.*`, `layout.graph`, `layout.rows`

**Intent.** A document should read as a map, not as a scroll: compact cards spread in two
dimensions, joined by connectors, with groups as quiet dashed regions around what belongs together.
Paper and ink stay: connectors are ink until something is in focus, and colour appears only to answer
"what does this touch?".

### 15.1 Which layout a container gets (`logic.ts` `graphIndex().mode`)

Applies to the document root (`document.layout`) and to every group (`group.layout`).

| Condition, first match wins | Mode |
|---|---|
| explicit `layout.mode` | that mode (`graph`, `stack`, `grid`, `flow`, `free`) |
| a link joins two direct children (links are lifted: a link between cards in two different child groups joins those groups) | `graph` |
| every direct child in a nonempty group has a stored `position` | `free` |
| group holding groups, or holding only `node` cards (2+ children) | `rows` (client-only) |
| otherwise | `stack` for a group, `free` for the root |

- **graph**: layered, `direction` `down` (default) or `right`. Cycles are broken on DFS back edges;
  layer = longest path; a source drops to just above its nearest target; order inside a layer by
  barycentre sweeps keeping the best crossing count; position by averaging towards neighbours. Gaps
  `graph.gap.node` 32 / `graph.gap.layer` 80 (containers of groups: 48 / 120). An edge that skips
  layers reserves a lane `graph.gap.lane` 20 wide and its connector follows that lane around the
  cards. Children without links are packed in rows `graph.gap.unlinkedOffset` 40 under the graph.
- **rows**: left to right, wrapping at the wrap width, tops aligned. Gap `layout.rows.gap` 24
  (root: 48). Wrap width = `max(graph.wrap.min 960, (viewport − 96) / 0.8)`, i.e. what fits at the
  smallest first-open zoom; 1400 when the viewport is unknown; a nested group gets its parent's width
  minus padding. The root's unplaced entities use the same wrap, so an old document without links or
  positions is rows of groups, never one column.
- A stored `position` wins in every mode (`stack`, `grid`, `flow`, `rows`, `graph`, `free`);
  automatic placement only arranges unpinned siblings. Afterwards
  `resolveOverlaps` separates what intersects, settling hand-placed entities first so the layout's
  placements move out of their way. Dragging or nudging stores a position without changing the
  container's explicit mode; nothing else is persisted by the layout.
- Prose blocks keep their 288 / 592 widths; a `node` card is `graph.node.width` 224.

### 15.2 Node card (`renderer: "node"`, data `kind`, `status`, `summary`, `details`)

```
┌──────────────────────────────┐  224 wide, radius 10, 1 px border, surface1, no tone spine
│ MODULE              ( ready )│  eyebrow: mono label, muted · status pill
│ Credential custody           │  heading 14/600, max 2 lines
│ Guarda y renueva los tokens. │  small muted, max 2 lines (optional)
└──────────────────────────────┘  padding 10 × 12, gap 4, min height 64
```

- Eyebrow = `data.kind`, else the type name. `Compass` 12 `accent` before the pill if the block has
  an instruction.
- Status pill: radius 999, wash of its tone, text in the tone, mono 10.5/600, not uppercased, max
  width 96. Tone by word (`graph.status`, case-insensitive, Spanish and English): `exito` (ready,
  listo…), `aviso` (wip, review, pendiente…), `riesgo` (blocked, error, bloqueado…), `acento` (new,
  planned…); anything else neutral. The word is always shown, so the pill never speaks by colour
  alone.
- The whole card is the press target and the drag handle. Hover: border `foregroundMuted`@0.5.
  Selected: 2 px `accent` border + halo, exactly like a block.
- `details` never changes the card's size (a card that grows on selection would reshuffle the graph
  under the pointer). With exactly one node selected it appears as a **side note**: 288 wide,
  `surface1`, 1 px border, radius 10, 8 px from the card, on the side the graph does not flow to
  (right of the card in a `down` graph, below it in a `right` graph), max 14 lines, with
  "Inspeccionar". In the outline the details are printed in full inside the card.
- Saving / not saved / delivery states use the same footer row as every block.

### 15.3 Regions

A group that is laid out as a graph, or that sits in a graph container, is drawn as a **region**:
1.5 px **dashed** border `foregroundMuted`@0.45, fill `foregroundMuted`@0.025, no header rule, no
ordinal. Chevron, serif title, count pill, selection, hover and drop-target states are unchanged, and
header heights stay 36 / 32 so geometry is shared with framed groups. Groups elsewhere keep the solid
frame of §6.6.

### 15.4 Connectors

- One connector per ordered pair of **visible** frames. A link whose end is inside a collapsed group
  attaches to the outermost collapsed group; links wholly inside a collapsed group are not drawn; a
  link between a group and its own descendant is not drawn (it is still listed in the inspector and
  outline).
- Sides: inside a graph container, along its direction (bottom → top for `down`, right → left for
  `right`). Otherwise the axis with the clear gap (`graph.link.sideGap` 20; vertical wins ties).
  Several connectors on one side fan out along it, `graph.link.port.spacing` 16 apart within 60 % of
  the side, ordered by where the other end is, so they do not cross at the frame.
- Shape: cubic Béziers leaving and arriving perpendicular to the frame, control reach
  `clamp(distance / 2, 28, 120)`; through lane waypoints for edges that skip layers. Arrowhead: filled
  triangle 9 × 8 at the target, its tip on the frame.
- Kind → line: `flow` solid, `depends` dashed `6 5`, `reference` dotted `1.5 5`. Width 1.5.
- Colour comes only from the tone system (`color.ts` `toneColor`). At rest: `foregroundMuted`@0.5.
  A link with an explicit `tone` keeps that tone at 0.85 even at rest. The schema's `peligro` is
  Lienzo's `riesgo`. In focus: full tone, width 2.25; default tone by kind when none is set — `flow`
  `acento`, `depends` `violeta`, `reference` `turquesa`.
- Label: sans 11, on the path with a `surface0` halo (5 px stroke, painted under the glyphs), max 32
  characters; on a sideways connector it sits 10 px above the line so a long label never hides a
  short link. Labels and counts are drawn **over** the cards; lines under them.
- Bundles: parallel links in the same direction share one connector with a count disc (radius 8,
  mono 10/700, `surface2`; `foreground` when lit) at 24 % of the path, or at its middle when no link
  has a label; labels are joined with " · ". When the bundle is lit and holds ≤ 4 links it opens into
  one strand per link, 5 px apart, each in its own tone and line style.
- Web: one DOM `<svg>` for lines (under the cards) and one for labels (over them), created and
  updated only by `web.ts` `mountLinkLayer`; each connector also has an invisible 14 px stroke as
  pointer target. Native: the same routes as three-segment elbows made of `View`s (dashed/dotted via
  border style), a chevron arrowhead, and the label as a pressable chip at the midpoint — the chip (a
  6 px dot when there is no label) is how a link is selected by touch.

### 15.5 Focus and dimming

Focus, strongest first: connector under the pointer · linked entity under the pointer (web; leaving
is delayed 90 ms so crossing between cards does not flash) · selected link · selection. If the
focused thing has no links, nothing changes. Otherwise its connectors are lit, both ends of each stay
at full strength, every other block drops to `graph.dim.node` 0.34 opacity and every other connector
to 0.14. Region frames are never dimmed; a block inside a lit group stays lit. No focus while
dragging.

### 15.6 Making and editing links (all through `c.edit`)

- **Handle.** The hovered or single-selected block (and a single-selected group) shows a 16 px disc
  (`surface1`, 1.5 px `accent`, `Plus` 10) centred on the edge the graph flows out of (bottom; right
  in a `right` graph), hit area 28. Dragging from it draws an `accent` connector to the pointer
  (dashed and 60 % until it is over a valid target) with a chip "Conectar con «…»" / "Suelta sobre un
  nodo o grupo"; the target gets a 2 px `accent` ring. Release on a target → `link.create` (`flow`),
  history label "Conectar «A» → «B»"; release elsewhere → nothing. Not offered on compact, offline
  or while a write is pending.
- **Without dragging.** Inspector → "Conexiones" → "Conectar con…" (search by title, 8 results);
  two entities selected → "Conectar «A» → «B»" in the inspector and in "Más acciones", or `L`.
- An existing `(from, to, kind)` is never duplicated: the existing link is selected instead.
- **Selecting a link** (press the connector; pressing again cycles through a bundle) clears the
  entity selection — a link is not part of `selectedIds`, the highlight is view state like hover. The
  inspector then shows "Enlace · A → B": Desde / Hacia (select that end), Etiqueta, Tipo (segmented
  Flujo / Depende / Referencia with a one-line meaning), Color (Auto + six swatches; Auto replaces
  the link by itself without a tone in one transaction because a patch cannot unset it), the other
  links of the same pair, ID, "Invertir dirección", "Eliminar enlace". `Delete` removes it, `Esc`
  deselects.
- Group and document inspector: "Disposición" gains **Grafo** and, when the mode is graph,
  "Dirección del grafo" (Hacia abajo / Hacia la derecha). While no layout is stored a muted line says
  which automatic mode is in effect.

### 15.7 Outline and compact

There is no canvas there, so links are sentences. Under every block and group with links:
`→ conecta con **Título** · etiqueta`, `← llega desde …`; `depends` reads "depende de" / "lo
necesita", `reference` "menciona a" / "mencionado por". The arrow carries the link's tone; pressing
a row selects the other end. The same rows open the inspector's "Conexiones" section, where pressing
one selects the link.

### 15.8 Visual harness

`design/graph-harness/` runs the real layout, tokens and `mountLinkLayer` with plain-DOM stand-ins
for the cards. `design/graph-harness/real/` additionally mounts the real `Canvas`, `BlockCard`,
`LinkLayer` and motion code under react-native-web. Its controller parses operations with the real
schema and applies the real reducer, with simulated latency and rejection. Host UI, transport,
polling and panel chrome are stand-ins; this does not verify an installed Paseo panel. See the
[real-component harness README](../design/graph-harness/real/README.md).

## 16. Free dragging and motion — tokens v4

This completes the direct-manipulation design from the Path, Rauno, Cosmos and Soumya references.
Keep Lienzo's paper/ink palette; use motion to explain picking up, moving and placing an object.
No sound or coloured glow. The parameters below are the implemented Opus motion choices.

### 16.1 Positions and automatic layouts

- A stored `position` pins an entity in its parent group's coordinate system, including the
  header/padding inset. Root coordinates are world coordinates. Dragging never changes the
  container's explicit layout mode.
- In `stack`, `grid`, `flow`, inferred `rows` and `graph`, unpinned siblings arrange in their
  original reading order around pins. Pins keep their intended positions subject to the existing
  enclosure and overlap rules (§6.2). Dropping a pin onto occupied space may separate it to avoid
  covering another card; rendered collision adjustments are not persisted automatically.
- In `free`, moving or removing an entity first pins unplaced siblings where they are already
  drawn. This happens in both the source and destination container, preserving their reading
  order. Switching a partly pinned container to Libre freezes all remaining children before
  changing its mode, including offsets that are not multiples of 8.
- A multi-selection translates by one shared delta. Grid snapping uses the grabbed entity as
  anchor and preserves spacing between selected entities. A selected child of a selected group
  travels with the group and keeps its local coordinates; it is not moved twice.
- **Soltar posición** releases an entity to its container's automatic placement. The selected
  or hovered pinned entity in an automatic layout also shows a small `Pin` control. A container's
  **Reordenar automáticamente** releases direct-child positions; it keeps the container's explicit
  mode. In an explicit Libre container, the unplaced shelf becomes the fallback arrangement.
- The current reducer has no operation to unset `position`. Release therefore deletes and
  recreates the same ID without the position in one transaction, restoring its contents, members,
  order and links. A group temporarily detaches its direct children before recreation. This is
  tested against the actual schema, reducer, persistence and undo/redo; releasing a pin adds no
  server operation. Selection is restored by the controller after successful release.
- Transactions are limited to 200 operations. A large release is split into consecutive complete
  entity transactions, with one undo step per batch. An entity whose release alone exceeds the
  limit, or whose block type is absent from the catalog, reports an error before release. A drag
  whose sibling freezing exceeds the budget prioritises the actual moves and membership order.

### 16.2 Gesture behaviour

On web, marked grab zones claim the initial press before their nested `Pressable` can swallow
subsequent movement. They still select on a tap and add/toggle selection on a 500 ms long press.
Dragging starts after 4 screen px, with the full press-to-pointer delta preserved. On native,
move negotiation is used; compact mode retains the existing outline/read-mostly interaction.
Nested action buttons, inputs, selectable body text and embedded pages keep their own controls.
The click generated after a drag or pan is consumed; the next deliberate press works normally.

While held, offsets follow the pointer directly, without a timing animation or document mutation.
Connectors use the same offsets. A group travels with all descendants; frames around a moving
child make room without recomputing the document layout on every pointer move. The innermost
open group under the pointer is the drop target; its 8 screen px edge tolerance prevents flicker.
A dragged group and its descendants are excluded as targets. Background drops return to root.

Positions settle on the 8 world px grid. A sibling edge or centre within 6 screen px supplies an
alignment guide instead of grid snapping on that axis. Guides are 1 screen px wide and fade out
over 100 ms. Inside the viewport's last 48 screen px, auto-pan increases quadratically to a
maximum of 900 screen px/s, while keeping the grabbed point under the hand.

A rejected edit springs back to the saved position. Gesture epochs prevent a late rejection of
an older edit from resetting an entity already picked up again. Persisted changes go through
`c.edit`; the drag preview is local presentation until the transaction succeeds.

### 16.3 Motion parameters

All timed responses use `Easing.bezier(0.22, 1, 0.36, 1)`. The token set also reserves the
`[0.65, 0, 0.35, 1]` curve; current canvas transitions do not use it.

| Response | Implemented parameters |
| --- | --- |
| Icon-button press | scale `0.97`, 100 ms; hit area stays fixed |
| Pick-up | scale `1.02`, 140 ms; opaque card; shadow `0px 14px 32px`, alpha `0.24`, derived from host ink/surface colours |
| Put-down | lift/shadow return over 180 ms; position uses the spring below |
| Gesture settle / rejected save | stiffness `380`, damping `32`, mass `1`; carry velocity in world px/s, clamped to ±`500`; rest distance `0.25` px, rest speed `2` px/s |
| Automatic placement change | position offsets ease to zero over 240 ms |
| Group-frame resize | width/height ease over 220 ms with the JS driver, preserving border/radius geometry |
| New entity | opacity and scale `0.96 → 1`, 180 ms; move from 12 px toward its linked neighbour or parent header when available |
| Drop target | opacity enters over 120 ms; accent wash alpha `0.08` |
| Fit / fit selection | one progress value drives scale and offset together over 280 ms |
| Zoom button / reset | 160 ms, anchored at viewport centre |
| Command-wheel notch | 120 ms, anchored at pointer; notch threshold `40`; small trackpad-pinch deltas follow directly |
| Pan momentum | velocity in screen px/ms; start above `0.2`, multiply by `0.995^dt`, stop below `0.02`; middle-button velocity uses a 0.6/0.4 filter and becomes zero after 80 ms idle |

Transform and opacity use the native driver where available. Frame dimensions are the one layout
property exception, so the frame's border, radius and label stay readable while its size changes.
Springs and momentum finish at their rest thresholds, not at a fixed 280 ms deadline. Repeated
arrow-key nudges are immediate. `AccessibilityInfo.isReduceMotionEnabled` and the shared live
`reduceMotionChanged` subscription make subsequent motion instant and disable momentum; direct
pointer following still works.

### 16.4 Rendering and verification

Camera state and gesture offsets live in refs/Animated values. Web connector geometry updates
imperatively; unchanged SVG draws are skipped. Card contents are memoised separately from their
position/dimming wrappers. RPC replies reuse unchanged block, group and link references so a
saved move does not invalidate every card. Selection-count changes only invalidate selected
cards that may show a detail note. Layout recalculates on document/measurement/viewport changes.

`tests/frontend.test.ts` covers pin/release semantics in all modes, parent-relative moves, source
and destination freezing, selected ancestor/child handling, sibling order, target exclusion,
grid/guides, camera anchors and edge-pan. Service/store tests exercise real persisted pin/release,
undo/redo and stale-revision rejection without losing links. The real-component harness drives
pointer events, live connectors, repeated reparenting, groups, rejected saves, the `+` link handle,
reduced-motion changes and a 150-node document in an isolated omabox. Exact commands, frame
measurements and the limits of that validation are recorded in its README.

## 17. Guide, interactive media, block sizes and link magnetism — tokens v5

The user requested this extension and authorized the narrow model change needed to persist
block sizes. Reuse the existing paper/ink palette, control geometry and motion curves. No new
plugin dependencies, DOM in RN components, native player assumptions or decorative glows.

### 17.1 Onboarding and feature reference

`Onboarding.tsx` uses the host modal and RN controls. Six short steps cover documents/catalog,
arrangement/groups/resize/navigation, connections, interactive material, agent communication,
and revisions/packs/conflicts. A searchable **Todas las opciones** view includes the real
catalog's type names and the existing keyboard shortcuts. Search ignores accents and case.
Actions open the actual document, catalog, inspector or agent UI; they do not create example
documents or send agent feedback automatically. Without a document, document-specific actions
open the document list first.

Show the guide once per host after the catalog and persisted settings finish loading.
Use Paseo 0.10.3 `defineSettings` with `scope: "host"`, `server.registerSettings` and
`useSettings`. Save `guideSeen: true` before opening the tour; only a successful save
opens it, so concurrent clients cannot show it twice. Loading, invalid data, read
errors and save failures never open the guide automatically. Failed saves offer retry.
The preference survives workspace changes, web/native clients and host restarts.
It is separate from document metadata and browser storage. **Guía de Lienzo** always
reopens it from the desktop bar or **Más acciones**.

Documentos opens a plain list. **Nuevo lienzo** creates "Lienzo sin título" with empty
communication and opens it immediately, including from the empty-workspace state.
The title edits in the top bar. Catalog starts closed; Detalles renders only for a
selection. Document settings open from Más acciones. The context tray stays hidden
unless there is a selection or queued context. The guide describes a single
"Indicaciones para el asistente" field and uses Lista, Detalles and Colecciones.
Long steps use the host modal's scrolling; progress steps are also directly selectable.
The tour's new content enters with opacity/scale over 180 ms, using the existing ease-out curve.
Keyboard canvas commands pause while the guide is open. UI copy is conversational Spanish.

### 17.2 Persistent sizes and automatic placement

`CanvasBlock.size` is optional and nullable, outside the type-specific `data` object:

```ts
size?: { width: number; height: number } | null
```

Both dimensions are finite world-pixel numbers. Schema bounds: width **160–4096**, height
**104–4096**. Missing or `null` means automatic. The exact numeric inspector accepts these
bounds and rounds to integer pixels. Dragging the corner uses readability minima from
`canvas.resize.minimum`: node **160×104**, prose/other **224×144**, web **320×288**, media
**240×320**. A size changes the frame; text, controls and images keep their normal scale.
Body scrolling retains content when the frame is small.

Select exactly one block in the canvas to reveal a **28 px** corner hit area with a **10 px**
square grip, radius **3 px**. Drag in screen space converted by the current zoom. Shift keeps
the starting aspect ratio, within the maximum bound. Normal release snaps both dimensions to
the **8 world-pixel** grid; proportional release retains the ratio instead. The inspector
offers width, height and **Tamaño automático** for keyboard and compact use.

One release writes one `block.update` with `patch.size` through `c.edit`. While held, only the
card's Animated width/height and its ancestor frames change; the document and sibling layout
do not recompute on every pointer move. Live connector ports use those drawn dimensions.
On confirmation, automatic placement and collision resolution run once; neighbours and group
frames animate to accommodate the result. A rejected or cancelled resize restores confirmed
geometry. Snap/rollback use the existing spring **380 / 32 / 1**; frame changes use **220 ms**
and bezier **[0.22, 1, 0.36, 1]**. Dimensions use the JS driver so borders and content reflow
correctly; feedback effects continue to animate transform/opacity.

Size and pin state are independent. Resizing does not create or remove a position, change a
container's layout mode or stretch other cards. Stack/grid/flow/graph use saved dimensions;
stack stretching and grid spanning never overwrite a saved width. **Soltar posición** and
**Reordenar automáticamente** preserve sizes. **Tamaño automático** writes `size: null` and
preserves the pin. Duplicates, templates, JSON packs, persisted reopen and undo/redo preserve
sizes through the existing schemas/reducer/store; no reducer or RPC operation is added.
Groups still derive their frames from children and have no manual resize handle.

### 17.3 Magnetic connection gesture

While dragging the existing `+` handle, evaluate visible midpoint ports on all four sides.
Acquire within **28 screen px**, retain within **40 screen px** to prevent flicker. Keep the
side stable while inside a card; prefer a card to its containing group, with the innermost group
as fallback. Exclude the source, its ancestors/descendants and hidden entities. Tolerances stay
constant at every zoom level and port geometry includes live positions/sizes.

An unsnapped endpoint follows the hand directly. On acquisition it springs to the port using
the existing **stiffness 380, damping 32, mass 1**, hand velocity converted to world px/s and
clamped to **±500**; rest thresholds **0.25 px / 2 px/s**. The marker is a restrained **10 px**
accent ring with a surface fill. One burst emits **four 2×4 px marks**, starting 6 px from the
port and travelling another **12 px**, with transform/opacity over **180 ms**, ease-out
**[0.22, 1, 0.36, 1]**. Cooldown **240 ms**. There is no particle loop, glow, sound or shader.
Reduced motion makes attraction immediate and suppresses the burst; the destination ring stays.

Only target changes enter React state. Web updates one pointerless SVG preview path
imperatively rather than rebuilding every stored connector on each pointer move. The scan is
linear in visible endpoints, independent of layout calculation. Release creates the existing
reducer-validated connection transaction; hovering or attracting never writes a link.

### 17.4 Verification and delivery scope

`pnpm test` passes **82 tests** and `pnpm typecheck` passes against the installed 0.10.3 SDK.
New pure tests cover media URL rebuilding, sizes/bounds/ratio/grid, automatic layout geometry,
live ports and magnet target hysteresis/exclusion. Real reducer/service/store checks cover
persisted resize, size reset, duplicate/unpin, packs, reopen, undo/redo and revision conflicts.

The isolated real-component harness tests corner resize (including Shift), ports following
before save, one save per release, rejection rollback, magnetic acquisition outside a card,
spring arrival, and link creation on release. It also mounts the actual guide, image viewer
and media components: six guide steps, search, dismissal/reload, direct video play/pause,
cross-origin web input/form/storage/scroll, image zoom/pan/reset and provider loading intent.
Compact verification is RN-web at 390×844 with a stand-in host modal, not an iOS/Android run.

External YouTube/Vimeo playback is not verified in the isolated network; provider recognition,
validated embed URLs and lazy mounting are verified. Actual native touch/player behavior,
Paseo modal portals, onboarding activation, inspector editing and Panel shortcuts through the
live host/RPC are still unverified. The harness retains its explicit example label and has no
live agent. Exact commands, measurements and host stand-ins are documented in the
[harness README](../design/graph-harness/real/README.md).

Changes remain local source changes. To load them, the coordinator reloads the installed
`canvas` plugin (`paseo plugin reload canvas`) and refreshes the client panel. This version
needs the shared size schema loaded as well as the client. Stored documents require no reset.
