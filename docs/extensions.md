# Extensions

An extension adds a tool to Lienzo without changing the plugin. It is one self-contained HTML page with a
small manifest. It runs sandboxed in its own frame and reaches the canvas only through `window.lienzo`. It imports
nothing from the plugin, so a plugin update cannot break it.

## Manifest

```json
{ "id": "my-tool", "kind": "tool", "api": 1, "name": "My tool", "description": "The job it does.",
  "icon": "Wrench", "permissions": ["edit"], "html": "<script>…</script>",
  "docs": "## Use it\n\n1. Select some cards.\n2. Press **Go**.",
  "actions": [{ "name": "go", "description": "Does the job on the given cards.",
    "input": { "type": "object", "properties": { "ids": { "type": "array", "items": { "type": "string" } } } } }] }
```

- `kind`: `tool`, the only kind. A tool is listed in the Extensions section of the + catalog (and in ⌘K) and opens
  as a tab of the right panel; it usually acts on the selection. The canvas is the one way to look at a document, so
  the former kind `view` is retired: catalogs and files stored with views still load without them, a file that
  carries one imports without it, and a view can no longer be saved.
- `api`: always `1` today.
- `permissions`: any of `edit`, `network`, `view` (added to API 1: read and move the canvas camera). Reading the
  document, changing the selection, keys, the highlight and storage need none. A Lienzo older than `view` refuses a
  file that asks for it. There is no
  permission to reach the agent: the canvas never sends anything to it. A new extension that asks for `agent` is
  refused; a stored or imported one that carried it loads without it.
- `html`: up to 300 000 characters. No build step. Without `network` the page may only use inline code and `data:` URLs.
- `docs` (optional, added to API 1): the extension's own page in Help → Extensions. Either one Markdown text or up to
  12 sections `[{ "title", "body" }]`, at most 20 000 characters in all. The dialect is small (`shared/markdown.ts`):
  `#`–`###` headings, paragraphs, `-` and `1.` lists, fenced code, `>` notes, inline code, `**bold**`, `*italic*` and
  `[links](https://…)`. It is drawn as native text, never as HTML. HTML tags outside code are refused when the
  extension is saved or imported (put markup examples in a code block), and links may only go to http, https or
  mailto addresses. An extension without `docs` still gets a page in Help, made from its name, description and
  permissions. A Lienzo older than this field refuses a file that carries it, so leave it out for those.

- `actions` (optional, added to API 1): what the extension offers an agent. See "Actions" below. A Lienzo older than
  this field refuses a file that carries it.

A walkthrough for writing one with your agent, with a complete example, is in
[extensions-tutorial.md](extensions-tutorial.md) (the same pages as Help → Make your own).

## API 1

| Member | Permission | What it does |
|---|---|---|
| `lienzo.api` | — | `1`. |
| `lienzo.onContext(fn)` | — | Calls `fn(context)` now and on every change. Returns a function that stops listening. |
| `lienzo.context` | — | The last context, or `null` before the first one. |
| `lienzo.select(ids)` | — | Sets the shared selection. Unknown IDs are dropped. |
| `lienzo.open(id)` | — | Selects that thing. With `view` it also frames it (like `view.fit([id])`); without, the camera does not move. |
| `lienzo.close()` | — | Closes a tool panel. |
| `lienzo.edit(operations, label)` | `edit` | One transaction of canvas operations. Resolves `{ revision }`, rejects with the reason. Undoable. `selection.set` and `communication.set` are refused. At most 200 operations. |
| `lienzo.action(name, fn)` | — | Registers the handler of a declared action, `fn(input, context)`; it returns the result or a promise of it. See "Actions". |
| `lienzo.run(name, input)` | — | Runs a registered action here, in the page: resolves its result. The page's buttons use it, so the work is written once. |
| `lienzo.headless` | — | `false` in the frame, `true` when an action runs for an agent. |
| `lienzo.view.get()` | `view` | Resolves `{ scale, bounds, sheetId, visibleIds }`. See "The view". |
| `lienzo.view.fit(ids, { padding?, animate? })` | `view` | Flies the camera to frame those things. Resolves `true`, or `false` when none of them is on the canvas. |
| `lienzo.view.onChange(fn)` | `view` | Calls `fn(view)` when the camera or the layout changes, at most every 100 ms. Returns a function that stops listening. |
| `lienzo.keys.bind(keys, fn)` | — | While the tool is open, those keys go to `fn(key)` instead of the canvas. Returns `unbind()`. See "Keys". |
| `lienzo.highlight(ids, { dim?, tone? })` | — | Outlines those things on the canvas; `dim` fades every other card. Resolves `{ ids }`. Never saved. |
| `lienzo.highlight.clear()` | — | Removes this extension's highlight. |
| `lienzo.storage.get()` / `lienzo.storage.set(value)` | — | One JSON value for this extension on this Lienzo. See "Storage". |
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
  selection: [ids],
  view? }                                      // only with "view": see "The view"
```

`extension.permissions` is what the extension actually holds, which for an imported one is empty until granted.

`layout` is in absolute world coordinates (the canvas' own units, the same ones `view.bounds` uses), not relative to
a parent. It has every block and every group, Frames and Sheets included, for the whole document whatever is on
screen; the only things left out are those folded inside a collapsed group.

### The view

Added to API 1 with the `view` permission, for tools that present or tour a Lienzo. Feature-detect it:
`if (lienzo.view)`, and check `context.extension.permissions` (calls reject without the permission).

```
view = { scale,                                 // camera zoom, 1 = 100 %
         bounds: { x, y, width, height },       // the world rectangle the canvas shows (the whole canvas area)
         sheetId,                               // the Sheet under the centre of the view, or null
         visibleIds }                           // groups and blocks whose rectangle overlaps bounds, document order
```

- `view.fit(ids, { padding, animate })` uses the canvas' own fit-and-fly animation; `padding` is screen pixels
  (0–400, default the canvas' fit inset), `animate: false` jumps. It frames them in the part of the canvas not covered
  by the floating panel. Any pan, zoom or drag by the person stops a fit in flight and wins.
- `view.onChange(fn)` and `context.view` are updated at most every 100 ms, on camera moves and layout changes.
  A camera change alone updates `context.view` and calls `onChange`, not `onContext`.
- Moving the camera never creates a revision or a history entry, and nothing about it is saved.

### Keys

`lienzo.keys.bind(keys, fn)` → `unbind()`. Needs no permission. While the tool's panel is open, a bound key pressed
anywhere in Lienzo, inside the tool's own page or on the canvas, calls `fn(key)` and does not reach the canvas'
shortcuts. Keys typed into a field (input, textarea, select, contenteditable) are never taken.

- Allowed: `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Space`, `PageUp`, `PageDown`, `Home`, `End`, `Enter`,
  `Escape`, `a`–`z`, `0`–`9`, each alone or as `Shift+…` (`"Shift+ArrowRight"`, `"Shift+n"`). Letters are lower case.
  Anything else throws `TypeError`. ⌘, Ctrl and Alt combinations stay Lienzo's and are never routed.
- `Escape` keeps closing and deselecting as usual unless the tool binds it.
- Closing the tool (or reloading its page) drops every binding.

### Highlight

`lienzo.highlight(ids, { dim, tone })` draws an outline and glow (the one the canvas uses for what the agent just
drew) around those things, in `tone` `accent` (default), `success`, `warning` or `violet`. With `dim: true` every card
outside them is faded. One highlight per extension; a new call replaces it, `[]` or `highlight.clear()` removes it, and
closing the tool removes it. It is never saved and creates no revision. No permission: it only changes what is shown.

### Storage

`lienzo.storage.get()` resolves the stored value or `null`; `lienzo.storage.set(value)` stores any JSON value (`null`
clears it) and resolves it back. One value per extension and per Lienzo, at most 4 KiB of JSON, kept by the server
beside the document (like mini-app runtime state: no revision, no history, not in `canvas_read`, not shown to the
agent). A Lienzo holds storage for at most 64 extensions. No permission.

### Comments

`lienzo.comments` (added to API 1; feature-detect it) reads and writes the person's notes pinned on the canvas, the same
threads the Comment tool makes and `canvas_comments` reads. `list({ status })` (`"open"` by default, `"resolved"` or
`"all"`) resolves `[{ id, status, anchor, messages: [{ author: "person"|"agent", name, text, at }] }]`; the anchor is
`{ kind: "block"|"group", id }` or `{ kind: "point", x, y }` in world units. Reading needs no permission, like the
context. `create(anchor, text)` resolves `{ id }`; `reply(id, text)` and `resolve(id)` resolve `{ id }`. Writing needs
the existing `edit` permission (no new permission: a comment changes what the agent will read, as an edit does) and is
signed as the person "via" the extension's name. Comments have no revision and no undo. Headless actions have no
`lienzo.comments`: they run for the agent, which has `canvas_comments`.

### Fullscreen

The frame is created with `allow="fullscreen"`, so `document.fullscreenEnabled` is true where the host page allows it
and the page may call `document.documentElement.requestFullscreen()` from a press. The sandbox is otherwise unchanged.

### The kit

`lienzo.kit.stage({ layout(context) → [{ id, x, y, w, h }], draw(g, view), onMove?, onOpen?, onHover?, canvas?, padding?, maxFit? })`

It creates a canvas that fills the page (or uses `canvas`) and gives it the canvas' own behaviour: the wheel pans,
command-wheel zooms around the pointer, a press selects, shift adds, a drag on nothing box-selects, a drag on a thing
moves the selection (only when `onMove(ids, dx, dy)` is given), a double press opens it on the canvas (or calls
`onOpen`), Escape clears, command-A selects everything, Space or the middle button drags the view. Selection is the
shared one. `draw` runs in world units with `view = { scale, width, height, items, selected: { [id]: true }, hover,
drag, theme, context }`. It returns `{ canvas, fit(), redraw(), items(), selection(), at(x, y) }`.

A tool that shows things should use the kit: it is what keeps interactions the same everywhere.

## Actions

An action is a job the extension offers an agent: the agent calls `canvas_extension_run { extension, action, input,
documentId? }` (docs/mcp.md) and gets the result back. One extension file serves both the person and the agent, with
the work written once:

- The manifest declares each action: `name` (a letter, then up to 39 letters, digits or `_`), a plain-text
  `description`, an optional `input` and an optional `returns`, both in a small JSON Schema subset (`type` object,
  array, string, number, integer or boolean; `properties`, `required`, `additionalProperties`, `items`, `enum`,
  `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `description`; up to 6 levels). `input` is an
  object schema, closed unless `additionalProperties: true`, so a misspelt argument is an error. Up to 20 actions.
- The page registers the handlers in a script marked `<script data-lienzo="actions">`, with
  `lienzo.action(name, function (input, context) { … })`. That script is plain JavaScript that uses `lienzo` and never
  the page (no `document`, no buttons): in the frame it runs like any other script, so the page calls
  `lienzo.run(name, input)`; for an agent, the server extracts the marked scripts and runs them headless. An extension
  that declares actions without such a script is refused when it is saved or imported.

The Title Case example (Help → Make your own) does exactly this: its button calls `lienzo.run('titleCase', {})`, and the
agent runs `titleCase { ids? }`, the same function, on the selection or on the cards it names.

### Headless runtime

For an agent the actions script runs in **QuickJS compiled to WebAssembly, inside the plugin server process** (the
Paseo plugin server, or the desktop app's main process): no new server, port or process. `server/sandbox.ts` is the
interpreter wrapper, `server/actions.ts` the headless `lienzo`, `CanvasService.runExtension` the commit. Each call:

1. checks the input against the action's schema (16 KiB at most);
2. starts a **new WebAssembly instance, runtime and context**, evaluates a prelude, then the actions scripts, then calls
   the handler; nothing persists between calls except what the extension writes to the document;
3. gives it the headless `lienzo`: `api`, `headless: true`, `context` (as in the frame without `theme` and `layout`:
   `extension`, `document`, `selection`), `onContext(fn)` (calls `fn` once), `action`, `run`, `select(ids)` and
   `edit(operations, label)`; both return promises like in the frame; `console.log` lines come back as `logs`;
4. checks each `lienzo.edit` against a working copy of the document (the frame's rules: `edit` held, at most 200
   operations in all, `selection.set` and `communication.set` refused, the canvas' own validation), so a bad operation
   rejects there with the reason and `lienzo.context` shows the edits so far;
5. when the handler settles, commits every edit of the run as **one transaction**, actor agent, labelled
   `‹extension name› (agent): ‹label of the first edit›`, which History shows and Undo (the agent's `canvas_undo`)
   reverses; then applies its last `lienzo.select`. If the handler fails, or the document changed meanwhile, nothing is
   written.

There is no DOM, no network, no timers (`setTimeout` and friends do not exist), no module loader and no host object:
the only bridge is a function the prelude receives as an argument (never a global) that carries JSON strings both
ways; the host parses and validates everything it receives (`safeJson`: no `__proto__`, `constructor` or `prototype`
keys, 32 levels at most). Limits per call: **2 s** (the run is synchronous, so this is CPU time; the interrupt handler
also stops catastrophic regular expressions), **64 MiB** of interpreter memory, a **64 KiB interpreter stack** (about 370
plain nested calls; QuickJS must stop recursion before the host's stack does, and a host stack overflow or a WebAssembly
trap is caught too and only drops that instance), **100 000** promise jobs, **20** edit and select calls, a
**16 KiB** JSON result. Permissions are the frame's: an extension that came in a file holds none until the person
allows it, so its actions can read and select but `lienzo.edit` is refused with "ask the person to allow it in
Extensions"; one that never declared `edit` cannot edit at all.

Tested in `tests/extension-actions.test.ts`: the Title Case action end to end through MCP, the listing, permissions,
input validation, and escapes (globals, constructor chains, dynamic import, prototype pollution, unsafe keys),
infinite loops, memory and buffer bombs, huge results, deep recursion (calls, the parser, nested data), promise floods,
never-settling promises, partial edits that then throw, and bad operations, each leaving the document and history
untouched.

### Packaging

The interpreter is `quickjs-emscripten-core` with the variant `@jitl/quickjs-singlefile-browser-release-sync` (both
0.32.0, MIT, by Jake Teton-Landis; QuickJS itself is MIT, 2025-09-13). The variant embeds the WebAssembly in its
JavaScript, which matters twice: Paseo compiles the plugin server with esbuild into one CommonJS bundle that it
evaluates from a string (no file beside it, no `__dirname`, no `import.meta.url`), and the desktop app bundles
everything into `dist/` inside an asar. No packaging step is needed in either. The "browser" build is the one that
survives Paseo's compiler: the CommonJS build's exports are read before they are assigned once the compiler rewrites
esbuild's interop getters into values, and the Node ES module build calls `createRequire(import.meta.url)`. The
browser build needs neither Node modules nor `import.meta` and decodes its own base64, so it runs the same in Node.
Size: about 920 KiB more in the plugin server bundle (283 → 1201 KiB unminified), about 3.8 MB in `node_modules`
(most of it source maps). It is a runtime dependency of `plugin/package.json`.

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
installs it; **Export** on a card saves that one extension as its own file (its id becomes `<file id>.<name>`, the file id
a slug of its name); **Export all mine** saves every extension made here (by the person or their agent) in one file.
The same file works in Paseo and in the desktop app.

## Catalog

Extensions others published are in a public catalog repository on GitHub. Its contents live in `marketplace/` of this
repository until the owner publishes them as their own repository (see "Publishing the catalog" below).

```
extensions/<id>/extension.json   one extension file, exactly as Export writes it; <id> is the file's id
extensions/<id>/README.md        optional
extensions/<id>/screenshot.png   optional, up to 512 KB
index.json                       built by CI: per file its name, description, extensions, permissions, actions,
                                 SHA-256, size, content hash
schema/                          JSON Schemas of extension.json and index.json
scripts/build-index.mjs          the checks and the builder (Node, no dependencies)
.github/workflows/catalog.yml    --check on every pull request; rebuild and commit index.json on main
```

- **Discover** (a tab of the Extensions screen, web and desktop) downloads `index.json` from
  `https://raw.githubusercontent.com/<repository>/<branch>/index.json`, without credentials, bounded and with a
  10 s timeout, and keeps the last good copy in the browser's storage. Offline it shows the kept list and says when it
  was read; with nothing kept it says the catalog is out of reach. **Install…** downloads the entry's file, checks its
  size, its SHA-256 against the index (where Web Crypto exists) and its id, then shows the same review as **Add from
  file…**. An installed catalog file holds no permission until allowed, like any file. A card says **Update…** when the published file differs from the installed one in anything, code included:
  the index carries a `contentHash` per entry (SHA-256 of the file's extensions as canonical JSON, the defaults filled
  in, so formatting does not count), the server keeps the same hash of each installed file (`packHashes` in the
  catalog), and Discover compares them. An index without hashes falls back to names, descriptions, permissions, Help
  pages and action names.
- **Publish…** (on the card of an extension made here) checks it (only local extensions, a valid file under 1 MB;
  suggestions when it has no description or no `docs`, or asks for `network`), saves it as `extension.json`, and
  offers **Open GitHub**: a short file opens GitHub's new-file page at `extensions/<id>/extension.json` with the
  content filled in; a longer one (over about 7 500 characters of link) opens the folder's upload page for the saved
  file. GitHub forks the catalog for the person and offers the pull request. The app holds no GitHub token and calls
  no GitHub API.

The logic is in `shared/marketplace.ts` (index schema, URLs, download checks, submission) and `client/screens.ts`
(`publishPlan`, `entryStatus`); the screen in `client/Discover.tsx`. Tested in `tests/marketplace.test.ts`, which also
runs the CI builder on the example.

### Publishing the catalog

1. Create a public repository (for example `Gabsplat/lienzo-extensions`) and copy the contents of `marketplace/`
   into its root, `.github/` included. Its default branch is `main`.
2. In the repository settings, Actions → General → Workflow permissions: allow read and write, so CI can commit
   `index.json`. Protect `main` so changes arrive by pull request and require the `Catalog` check.
3. To point the app at another repository or branch, change `MARKETPLACE` in `plugin/shared/marketplace.ts`
   (`{ repository: "owner/name", branch: "main" }`); every URL (index, files, Publish) derives from it. Run
   `pnpm help:docs` if the example changed.

## Compatibility promise

API 1 grows: members and context fields are added, not renamed. One member was removed: `lienzo.ask` (with the
`agent` permission), because the canvas is one-way; no shipped or known extension used it. Calling it now fails in
the page like any missing function. A future API 2 would live beside
it. Nothing ships with Lienzo. The find-and-replace tool in `tests/fixtures/find-replace.ts` is written against API 1
only and is the contract example; `tests/extensions.test.ts` runs the runtime itself. If it breaks, the contract
broke. The guide the agent gets ends with the complete example of Help → Make your own (`shared/wiki/tutorial.ts`), the
same one the catalog ships as `extensions/title-case`. `docs` and `actions` were added to API 1 as optional fields (with `lienzo.action`, `lienzo.run` and `lienzo.headless`); so were the `view` permission, `context.view`, `lienzo.view`, `lienzo.keys`, `lienzo.highlight` and `lienzo.storage`, and `lienzo.open` framing what it opens with `view`. (The kind `view` was retired
with the one-canvas redesign; the frame API itself did not change.)

## Not in API 1

- Extension-backed block types (a block whose body is an extension, with its own stored data).
- Pointer tools that act on the canvas surface (a brush over cards). Planned for extension API 2.
- Native (mobile) rendering: extensions run on web and desktop.
