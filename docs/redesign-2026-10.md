# Lienzo redesign, October 2026

Lienzo becomes the visual copilot of a Paseo conversation: while the agent works, it draws on one canvas what it
is explaining, because the person learns by seeing. There is one way to look at a document, the canvas, like
tldraw. Everything else is tools, and tools are extensible.

This file is the brief for the four stages. Visual decisions here are final unless the reviewer changes them.

## Decisions

- **One view.** Remove "Cambiar vista", Foco, Lecturas, Matriz, Órbita, Estratos, Cauce, Relieve, `Pannable`, and the
  extension kind `view`. Keep **Lista** only as what a compact panel shows automatically (no menu to choose it).
  Keep **Lentes**. Mini apps (`html` blocks) stay; so does `lienzo.onFrame`.
- **English UI** with a small Spanish glossary, used as brand words. Each glossary word is explained in English the
  first time it appears in a surface (tooltip, subtitle or catalog description), e.g. "Marco — a frame that holds
  things together (Spanish for *frame*)". The agent still answers in the person's language.

  | Word | Meaning |
  |---|---|
  | Lienzo | the app, and each document |
  | Marco | a container that groups things (today: area / group) |
  | Hoja | a chapter the agent adds while explaining (a zone of the canvas, not a page) |
  | Lente | a lens: a way to colour the same canvas |
  | Ventana | an embed: a web page, a video, a mini app (today: iframe / preview) |

  Everything else is plain English: Select, Hand, Pencil, Shape, Rectangle, Ellipse, Text, Arrow, Eraser,
  Properties, Extensions, Settings.
- **Argentine flavour** only in small places nobody needs to understand to use the app: empty states, onboarding,
  some confirmations ("Listo.", "Dale, drawing…"). Easter eggs: an animated hand-drawn **mate** in the empty
  canvas ("Empty. Pour yourself a mate."), typing `mate` in ⌘K boils a small kettle in a corner, and the odd small
  sun (Sol de Mayo) or a tango step in a loading state. Small, never on top of content, off under reduced motion.

## Stage 1 — new face (agent A)

### Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ [≡ Lienzo title ▾  · Hoja 3/7 ▾ ]                      [ ⌘K ] [ ◧ ]   │  top islands
│                                                                        │
│                                                     ┌───────────────┐  │
│                    canvas                           │ Properties │… │  │  right panel
│          ┌─────────────────────┐ ← selection bar    │               │  │  (floating)
│          │ ■ ■ ▢ ⧉ ✦ 🗑        │                    │               │  │
│                                                     └───────────────┘  │
│  [map]                                                                 │
│        [ V H P ▢ T ↗ M W │ pinned… │ + ]          [ − 100% + ]        │  bottom toolbar
└────────────────────────────────────────────────────────────────────────┘
```

- **Bottom toolbar**, centred, floating island, 44 px tall, 36 px buttons, 4 px gap, dividers between groups.
  Order: Select (V), Hand (H) | Pencil (P), Shape (R; chevron flyout: rectangle R, ellipse O, diamond, triangle,
  line), Text (T), Arrow (A), Eraser (E) | Marco (M), Ventana (W) | pinned tools | `+`. It sits on the bottom
  edge, 12 px up, level with the minimap and the zoom control. There is no composer: the canvas is one-way.
- **`+` catalog**: a popover anchored to `+`, 360 × up to 480 px. A search field on top (focused on open), then
  sections: Pinned, Shapes & drawing, Embeds (Ventana, image, video, audio, mini app, file tree…), Blocks (every
  catalog block type, as today's palette), Extensions (tools contributed by extensions), and at the bottom
  "Manage extensions…". Each row: 28 px icon tile, name, one-line description, shortcut on the right. Hover shows
  a pin toggle; pinned tools appear in the toolbar in pin order and get `1`–`9`. This replaces the left dock, the
  block palette flyout and the "Herramientas propias" button.
- **Right panel** (`Properties`): floating island, 300 px wide, right inset 12 px, top under the top islands, max
  height to above the zoom control. Appears when something is selected or the active tool has options; tabs when
  there is more than one source (Properties of the selection, the active tool's options, and later extension
  panels). A pin keeps it open; `⌘\` toggles. Collapsible sections with 12 px headers, like Figma. What today's
  inspector and style island show moves here (fill, stroke, text size, link kind, block fields, instructions).
- **Selection bar**: small floating bar above the selection (or below when there is no room): colour, Marco
  (group), duplicate, delete. 32 px buttons. Detail lives in the right panel.
- **Top-left island**: menu, document title ▾, and (stage 2) the Hoja menu. Remove the view button.
- **Top-right**: `⌘K` button and the right-panel toggle.
- Minimap stays bottom-left, zoom control bottom-right.
- Compact panel: Lista as today, toolbar becomes a horizontal scroller docked at the bottom, right panel is a sheet.

### Tooltips

Every icon-only control in the plugin gets a tooltip: name, then the shortcut in muted monospace ("Pencil  P").
Appear after 500 ms; once one has shown, moving to another icon shows the next one instantly for 800 ms. Placement
away from the nearest panel edge; never covers the control. On touch, long-press. One shared `Tooltip` component in
`ui.tsx`; glossary words carry their explanation in the tooltip.

### Command palette (⌘K / Ctrl+K)

Raycast-like: centred, 640 px wide, top at 18 % of the panel, 52 px search field with a leading icon, results
grouped under small caps headers, each row 40 px with icon, title, muted subtitle, shortcut chips on the right; the
active row has a soft accent fill. Footer bar: "↵ Open · ⌘↵ Run in background · Esc Close", and the active row's
primary action on the right. Groups: Tools, Actions (on the selection), Hojas, Lienzos, Extensions, Settings. Empty query shows
Recent. Fuzzy match on titles and keywords. Keyboard only works fully; mouse too.

### Shortcuts

Registry in one place (`client/shortcuts.ts`): id, label, default keys, group, `when` (canvas focused, selection
present…). Defaults:

- Tools: V, H, P, R, O, T, A, E, M (Marco), W (Ventana), L (cycle lens), Space held = hand, `1`–`9` pinned tools.
- Navigation: ⌘K palette, `[` / `]` previous / next Hoja, ⌘J jump to Hoja, F follow the agent on/off, G go to the
  agent's latest, Shift+1 fit all, Shift+2 fit selection, ⌘\ right panel, ⌘. hide all UI, `?` shortcut sheet.
- Editing: ⌘Z, ⌘⇧Z, ⌘D duplicate, ⌘G wrap in a Marco, Delete, Esc, ⌘A.

Extensions (stage 3) register their own shortcuts through the same registry. A conflict is not assigned and is
listed as "unassigned" in the sheet. **Settings → Shortcuts** (and the `?` sheet) lists every shortcut, ours and
extensions', and lets the person reassign one by pressing the new keys; overrides persist in plugin settings and
show "Reset". Hoja shortcuts and F/G are registered now and wired in stage 2.

### Copy

All plugin UI strings in English, including errors (`friendlyError`), onboarding, empty states, the example
documents and catalog names/descriptions. The MCP guidance is already English. Keep it short and concrete.

### Out of scope for stage 1

The chip, Hojas data, following the agent (stage 2); the extension API v2 (stage 3); the extensions screen beyond
a "Manage extensions…" row that opens today's collections view (stage 4).

## Stage 2 — copilot (agent B, server side first)

- **Lienzo tools for every agent.** At `agent.create`, every agent gets the Lienzo MCP server and short instructions,
  with copilot mode **off**. The instructions say: only draw when the copilot is on for this conversation; read the
  mode from any canvas tool response.
- **Copilot state per agent** (our store, keyed by agent id): `enabled`, `cadence` (`thinking` = after reasoning
  or each tool use, `step` = after finishing each step worth showing — default, `task` = once at the end of a task,
  `custom` + `rule` text), `remind` (default false), `documentId` (the conversation's Lienzo, created on first
  enable). RPCs to read and set it. Every canvas MCP response includes `copilot: { enabled, cadence, rule }`.
  Nothing is sent when it changes: the agent reads the mode from the next tool response.
- **Reminder** (`remind: true`): on `agent.turn_ended`, if the copilot is on, the cadence is `step` or `task`, the turn
  changed things (tool calls / edits in the timeline) and no Lienzo tool was used, send one short follow-up asking
  it to update the canvas. Never twice in a row, never for `thinking`.
- **Composer pill** per agent (`client.addComposerPill`): "Lienzo" with a status dot (off / on / drawing now, the
  last while a Lienzo tool call is in flight or within 3 s of one). Popover, compact (≤ 320 × 360): on/off switch,
  cadence (segmented + rule field for custom), remind toggle, "Go to latest" with a small preview of what the agent
  added last, recent Lienzos to attach to this conversation, "Open Lienzo". When the agent has no Lienzo tools
  (created before), the popover says so and offers "New agent with Lienzo".
- **Hojas** in the document: a Hoja is a top-level Marco with `sheet: { number, createdAt, source }`. New Hojas are
  placed to the right of the last one on the same horizontal strip. MCP: create a Hoja (returns its id and number),
  list Hojas, update its title; ordinary edits target it with `parentGroupId`. The agent is told: one Hoja per new
  explanation, revisit an existing Hoja when it is the same topic.
- **Latest from the agent**: the document view exposes the ids and time of the last agent transaction (from history)
  so the client can fly there.
- **Remove** extension kind `view` from the model, catalog, MCP guide and tests.

The canvas side of stage 2 (Hoja menu "Hoja 3 of 7 ▾" in the top island, `[` `]` ⌘J, follow magnet F with the
"Agent's latest →" pill and a 3 s glow on what was just added, G) is built after stage 1 lands, on top of it.

## Stages 3 and 4 (later)

Extension API v2: extensions contribute **shapes** (stored data validated by their schema, drawn with primitives
we render natively: rect/ellipse/polygon, freehand and SVG path, text, image, video, audio, arrow/connector, group,
and a sandboxed Ventana for heavy UI), **tools** (pointer modes whose logic runs sandboxed and receives pointer
events in document coordinates, returning drawing and edits), **panels** (tabs in the right panel) and **actions**
(on the selection), plus shortcuts. Our own tools are rewritten on the same API, rectangle and Ventana first.
Stage 4: an Extensions screen (Installed / Add: link, file, later a marketplace) with a permissions step before
activation; extensions made by the person's agent install directly.

## UI pass, October 2026 — screens

Owner's direction: the screens around the canvas must feel premium and be easy to understand. Examples, templates
and collections leave the app entirely. Visual decisions below are final unless the reviewer changes them.

### Shared language for screens

- **Screens, not small modals.** Lienzos, Settings, Extensions and History open as one large floating sheet over the
  canvas: up to 960 × 680, 24 px from the panel edges on smaller panels, radius 16, `raised` surface, 1 px border, a
  soft long shadow, the canvas dimmed 40 % behind. Escape or the close button returns. Compact panels: full screen.
- **Two columns** where there is navigation: a 220 px left rail (section list, 36 px rows, icon + label, active row
  washed in the accent at 12 %) and the content on the right with 32 px padding. One serif display title per screen
  (the `display` font), one muted line under it saying what the screen is for.
- **Rows and cards:** 12 px radius cards on `surface0` inside the sheet, 16–20 px padding, hover lifts the border to
  `foreground` at 20 % and raises 1 px (160 ms ease-out). Small-caps muted section labels (11 px, 0.06 em tracking).
- **Motion:** 180–240 ms ease-out on open (scale 0.98 → 1, fade), staggered 30 ms list entrance, nothing that loops
  unless it explains something. All off under reduced motion.

### Lienzos

The home of the app. A grid of cards (3–4 columns by width, 16 px gap): each card is a live thumbnail of the
Lienzo drawn from its real layout (Marcos as outlines, blocks as filled marks in their tones, links as thin lines,
like the minimap), then title (serif, 2 lines max), "Edited 3 h ago · 24 blocks · 3 Hojas", and the agent working
on it if any (small dot + name). The open one has an accent ring. Top: title "Lienzos", search field (filters as
you type), sort (Recent · Name), primary "New Lienzo". Card hover reveals a ⋯ menu: Rename, Duplicate, Delete
(with confirmation). Empty state: the mate and "No Lienzos yet. Start one, or ask your agent to draw something."
Selecting a card opens it and closes the sheet. No examples section anywhere.

### Onboarding

Replaces the current tour. A sheet with a large animated stage on the left (≈ 60 %) and short copy on the right,
four scenes that play by themselves (≈ 6 s each, a thin progress bar per scene, Back / Next / Skip, dots):

1. **The agent draws while it works.** A chat bubble types a sentence on the side; on the stage, cards and an
   arrow appear one by one and the camera eases onto them.
2. **Hojas.** Three chapters slide in along a strip; the "Hoja 2 of 3" pill updates; the magnet glows as the
   camera follows.
3. **Point and ask in your own chat.** A cursor selects a card (accent ring); a chat bubble outside the canvas
   reads "mirá esto"; a line shows the agent reading the selection. Copy: the canvas never talks; your chat does.
4. **Make your own tools.** A short code card (`lienzo.edit([...])`, typing out) turns into a new icon that drops
   into the toolbar. Copy: extensions are small pages you or your agent write; they work in Paseo and in the
   desktop app.

Non-interactive (no fake canvas to click), dynamic. Drawn with RN Animated views (and SVG paths where needed), using
theme colours, light and dark. Shown once, reopenable from the menu ("Lienzo guide") and ⌘K.

### Settings

Two columns. Rail sections, only what really exists:
- **Shortcuts:** search field; groups (Tools, Navigation, Editing, Extensions) as two columns of compact rows —
  label on the left, key chips on the right. Clicking a chip records the new keys in place (the chip pulses
  "Press keys…", Escape cancels); conflicts show a small warning chip on the row that lost its keys. "Reset all"
  top-right; a row edited from its default shows a reset icon. No "Change" buttons.
- **Toolbar:** pinned tools (reorder, unpin) and "Reset toolbar".
- **Copilot** (Paseo only): default cadence for new conversations and the reminder default — only if these are
  stored settings; otherwise a short explanation of the chip with a link to the guide.
- **Agents** (desktop only): MCP address, copy commands, agents seen.
- **Extensions:** the Extensions screen below, embedded.
- **About:** version, where the data lives (path), links to docs.

### Extensions (replaces collections)

Installed extensions as cards (icon, name, description, "Made by you / your agent" or the file it came from,
permissions as chips, Remove, Export). "Add from file…" imports an extension file (the pack format stays the
container underneath, without types, templates or documents), with the existing permission review. "Export all
mine". Short explanation with a link to docs/extensions.md for writing one.

### History (Activity)

A timeline grouped by day ("Today", "Yesterday", dates). Each entry: actor (You, or the agent's name with a small
coloured dot), what happened in words (the transaction label), time, and chips for the changed things — pressing a
chip closes the sheet and flies the camera there. Undo / Redo at the top. Empty: "Nothing yet."

### Removed

Example documents and example packs, templates (save as template, insert template, the templates tab and their
MCP actions and guidance), collections (packs tab, import/export of packs as a user feature, "Use a template",
"Import a collection", "Export this Lienzo"), and "Duplicate as my own" if it only existed for examples. Stored
data that carries templates or packs must still load. The extension examples move out of the UI; the agent guide
keeps a short inline example instead.
