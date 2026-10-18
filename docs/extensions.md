# Extensions

An extension adds a tool to Lienzo without changing the plugin. It is one self-contained HTML page with a
small manifest. It runs sandboxed in its own frame and reaches the canvas only through `window.lienzo`. It imports
nothing from the plugin, so a plugin update cannot break it.

## Manifest

```json
{ "id": "my-tool", "kind": "tool", "api": 1, "name": "My tool", "description": "The job it does.",
  "icon": "Wrench", "permissions": ["edit"], "html": "<script>…</script>" }
```

- `kind`: `tool`, the only kind. A tool is listed in the Extensions section of the + catalog (and in ⌘K) and opens
  as a tab of the right panel; it usually acts on the selection. The canvas is the one way to look at a document, so
  the former kind `view` is retired: catalogs and files stored with views still load without them, a file that
  carries one imports without it, and a view can no longer be saved.
- `api`: always `1` today.
- `permissions`: any of `edit`, `network`. Reading the document and changing the selection need none. There is no
  permission to reach the agent: the canvas never sends anything to it. A new extension that asks for `agent` is
  refused; a stored or imported one that carried it loads without it.
- `html`: up to 300 000 characters. No build step. Without `network` the page may only use inline code and `data:` URLs.

## API 1

| Member | Permission | What it does |
|---|---|---|
| `lienzo.api` | — | `1`. |
| `lienzo.onContext(fn)` | — | Calls `fn(context)` now and on every change. Returns a function that stops listening. |
| `lienzo.context` | — | The last context, or `null` before the first one. |
| `lienzo.select(ids)` | — | Sets the shared selection. Unknown IDs are dropped. |
| `lienzo.open(id)` | — | Goes to the canvas on that thing. |
| `lienzo.close()` | — | Closes a tool panel. |
| `lienzo.edit(operations, label)` | `edit` | One transaction of canvas operations. Resolves `{ revision }`, rejects with the reason. Undoable. `selection.set` and `communication.set` are refused. At most 200 operations. |
| `lienzo.kit.stage(options)` | — | A 2D surface that behaves like the canvas. See below. |
| `lienzo.kit.card(g, item, view, options)` | — | Draws a thing with the standard selection, hover and drag look. |

`context`:

```
{ api, extension: { id, kind, name, permissions },
  theme: { dark, colors: { background, surface, foreground, muted, border, accent, flow, needs, mentions, areas[] } },
  document: { id, title, description, revision,
    blocks: [{ id, title, typeId, renderer, data, parentGroupId }],
    groups: [{ id, title, description, blockIds, groupIds, parentGroupId }],
    links:  [{ id, from, to, kind, label }] },
  layout: { [id]: { x, y, width, height } },   // where each thing is on the canvas
  selection: [ids] }
```

`extension.permissions` is what the extension actually holds, which for an imported one is empty until granted.

### The kit

`lienzo.kit.stage({ layout(context) → [{ id, x, y, w, h }], draw(g, view), onMove?, onOpen?, onHover?, canvas?, padding?, maxFit? })`

It creates a canvas that fills the page (or uses `canvas`) and gives it the canvas' own behaviour: the wheel pans,
command-wheel zooms around the pointer, a press selects, shift adds, a drag on nothing box-selects, a drag on a thing
moves the selection (only when `onMove(ids, dx, dy)` is given), a double press opens it on the canvas (or calls
`onOpen`), Escape clears, command-A selects everything, Space or the middle button drags the view. Selection is the
shared one. `draw` runs in world units with `view = { scale, width, height, items, selected: { [id]: true }, hover,
drag, theme, context }`. It returns `{ canvas, fit(), redraw(), items(), selection(), at(x, y) }`.

A tool that shows things should use the kit: it is what keeps interactions the same everywhere.

## Trust

- An extension saved locally (by the person, or by their assistant through `canvas_catalog save_extension`, which
  needs the person's approval) holds the permissions it declares.
- An extension that arrives in an imported file holds none. It can read and select. The first time it is opened (or on
  its card in the Extensions screen) it says what it asks for and the person allows it or not. Replacing the file with
  different code drops the grant.
- Every extension runs in a frame with an opaque origin: no access to Paseo, the plugin page, storage or files.

## Sharing

An extension travels as an **extension file**: JSON in the pack container, holding extensions and nothing else.

```json
{ "format": "paseo-canvas-pack", "version": 1, "id": "workshop", "name": "Workshop tools", "description": "…",
  "blockTypes": [], "templates": [], "documents": [],
  "extensions": [{ "id": "workshop.timer", "kind": "tool", "api": 1, "name": "Timer", "html": "…" }] }
```

Every extension ID starts with the file's `id` and a dot. A file that carries block types, templates or documents is
refused (those left Lienzo); one stored before still loads. The Extensions screen (menu → Extensions, Settings →
Extensions, or "Manage extensions…" in the + catalog) does the rest: **Add from file…** reads a file and shows a
review before anything is saved — what each extension does, what it asks for, whether it is new or replaces one — then
installs it; **Export** saves one extension as its own file; **Export all mine** saves every extension made here (by
the person or their agent) in one file. The same file works in Paseo and in the desktop app.

## Compatibility promise

API 1 grows: members and context fields are added, not renamed. One member was removed: `lienzo.ask` (with the
`agent` permission), because the canvas is one-way; no shipped or known extension used it. Calling it now fails in
the page like any missing function. A future API 2 would live beside
it. Nothing ships with Lienzo. The find-and-replace tool in `tests/fixtures/find-replace.ts` is written against API 1
only and is the contract example; `tests/extensions.test.ts` runs the runtime itself. If it breaks, the contract
broke. The guide the agent gets ends with a short inline example. (The kind `view` was retired
with the one-canvas redesign; the frame API itself did not change.)

## Not in API 1

- Extension-backed block types (a block whose body is an extension, with its own stored data).
- Pointer tools that act on the canvas surface (a brush over cards). Planned for extension API 2.
- Native (mobile) rendering: extensions run on web and desktop.
