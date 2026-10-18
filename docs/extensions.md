# Extensions

An extension adds a tool to Lienzo without changing the plugin. It is one self-contained HTML page with a
small manifest. It runs sandboxed in its own frame and reaches the canvas only through `window.lienzo`. It imports
nothing from the plugin, so a plugin update cannot break it.

## Manifest

```json
{ "id": "my-tool", "kind": "tool", "api": 1, "name": "My tool", "description": "The job it does.",
  "icon": "Wrench", "permissions": ["edit"], "html": "<script>…</script>",
  "docs": "## Use it\n\n1. Select some cards.\n2. Press **Go**." }
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
- `docs` (optional, added to API 1): the extension's own page in Help → Extensions. Either one Markdown text or up to
  12 sections `[{ "title", "body" }]`, at most 20 000 characters in all. The dialect is small (`shared/markdown.ts`):
  `#`–`###` headings, paragraphs, `-` and `1.` lists, fenced code, `>` notes, inline code, `**bold**`, `*italic*` and
  `[links](https://…)`. It is drawn as native text, never as HTML. HTML tags outside code are refused when the
  extension is saved or imported (put markup examples in a code block), and links may only go to http, https or
  mailto addresses. An extension without `docs` still gets a page in Help, made from its name, description and
  permissions. A Lienzo older than this field refuses a file that carries it, so leave it out for those.

A walkthrough for writing one with your agent, with a complete example, is in
[extensions-tutorial.md](extensions-tutorial.md) (the same pages as Help → Make your own).

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
index.json                       built by CI: per file its name, description, extensions, permissions, SHA-256, size
schema/                          JSON Schemas of extension.json and index.json
scripts/build-index.mjs          the checks and the builder (Node, no dependencies)
.github/workflows/catalog.yml    --check on every pull request; rebuild and commit index.json on main
```

- **Discover** (a tab of the Extensions screen, web and desktop) downloads `index.json` from
  `https://raw.githubusercontent.com/<repository>/<branch>/index.json`, without credentials, bounded and with a
  10 s timeout, and keeps the last good copy in the browser's storage. Offline it shows the kept list and says when it
  was read; with nothing kept it says the catalog is out of reach. **Install…** downloads the entry's file, checks its
  size, its SHA-256 against the index (where Web Crypto exists) and its id, then shows the same review as **Add from
  file…**. An installed catalog file holds no permission until allowed, like any file. A card whose published
  extensions differ in name, description, permissions or Help page from the installed file says **Update…**.
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
same one the catalog ships as `extensions/title-case`. `docs` was added to API 1 as an optional field. (The kind `view` was retired
with the one-canvas redesign; the frame API itself did not change.)

## Not in API 1

- Extension-backed block types (a block whose body is an extension, with its own stored data).
- Pointer tools that act on the canvas surface (a brush over cards). Planned for extension API 2.
- Native (mobile) rendering: extensions run on web and desktop.
