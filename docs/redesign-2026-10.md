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
│                         [ composer ]                                   │
└────────────────────────────────────────────────────────────────────────┘
```

- **Bottom toolbar**, centred, floating island, 44 px tall, 36 px buttons, 4 px gap, dividers between groups.
  Order: Select (V), Hand (H) | Pencil (P), Shape (R; chevron flyout: rectangle R, ellipse O, diamond, triangle,
  line), Text (T), Arrow (A), Eraser (E) | Marco (M), Ventana (W) | pinned tools | `+`. It sits above the composer
  and never overlaps it; on a short panel it moves the composer clearance into account.
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
  (group), duplicate, ask the agent, delete. 32 px buttons. Detail lives in the right panel.
- **Top-left island**: menu, document title ▾, and (stage 2) the Hoja menu. Remove the view button.
- **Top-right**: `⌘K` button and the right-panel toggle.
- Minimap stays bottom-left, zoom control bottom-right.
- Compact panel: Lista as today, toolbar becomes a horizontal scroller above the composer, right panel is a sheet.

### Tooltips

Every icon-only control in the plugin gets a tooltip: name, then the shortcut in muted monospace ("Pencil  P").
Appear after 500 ms; once one has shown, moving to another icon shows the next one instantly for 800 ms. Placement
away from the nearest panel edge; never covers the control. On touch, long-press. One shared `Tooltip` component in
`ui.tsx`; glossary words carry their explanation in the tooltip.

### Command palette (⌘K / Ctrl+K)

Raycast-like: centred, 640 px wide, top at 18 % of the panel, 52 px search field with a leading icon, results
grouped under small caps headers, each row 40 px with icon, title, muted subtitle, shortcut chips on the right; the
active row has a soft accent fill. Footer bar: "↵ Open · ⌘↵ Run in background · Esc Close", and the active row's
primary action on the right. Groups: Tools, Actions (on the selection), Hojas, Lienzos, Ask the agent (always
last: "Ask the agent: ‹query›", sends with the selection as context), Extensions, Settings. Empty query shows
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
  Turning it on queues a one-line notice to the agent through the existing event delivery (no extra turn).
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
