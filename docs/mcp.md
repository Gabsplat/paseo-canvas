# Canvas backend v1.1

The frontend contracts are in `plugin/shared/model.ts` and `plugin/shared/rpc.ts`.
Import a named RPC and call `useRpc(contract)` from `plugin/client/host` (the plugin SDK's in Paseo, the desktop app's in `apps/desktop`; see `docs/desktop.md`).
For example, `useRpc(readDocument)({workspaceId, documentId})` returns a `DocumentView`.
`useRpc(mutateDocument)({workspaceId, documentId, expectedRevision, operations})`
returns the committed view. Invalidate or poll the document query after a mutation.
`watchDocument` takes `knownRevision` and `knownRuntimeVersion`; it returns a view only
when either changes. `setSelection` uses its own `expectedSelectionVersion`. No RPC sends
anything to an agent: the canvas is one-way (see Selection and block state below).

All document RPCs require `workspaceId`. Blocks use `typeId`, `title`, `data`, and optional
`position`, `parentGroupId`, and `communication`. Groups use `blockIds`, `groupIds`,
`title`, `description`, optional `communication`, `position`, `collapsed`, and `layout`.
Positions are relative to the parent group. Moving a group changes its own position; descendants
keep their local coordinates. The frontend must sum ancestor positions when drawing.
Create and update group membership through a transaction; the server maintains parent pointers.

## Learning runtime

`readRuntime` (`canvas.runtime.read`) takes `{workspaceId,documentId,blockIds?,scopeIds?}`.
`setRuntime` (`canvas.runtime.set`) takes `{workspaceId,documentId,blocks?,scopes?}`.
Each returns `{runtimeVersion,runtime:{blocks,scopes}}` for requested IDs only.
Each ID array has at most four entries. Block writes are `{id,state:object|null}` and
replace state; scope writes are `{id,values:{name:number|null}}` and patch current values.
Null removes an override. Document scope ID is `$document`.

MCP uses one `canvas_runtime` tool with `action:"read"|"set"` and the same inputs,
omitting authenticated workspaceId. There is no expectedRevision, history entry or undo.
Writes become visible immediately and persist with a 250 ms coalescing window; close or
normal content transactions flush pending writes. Abrupt exit can lose the recent window.
Limits are 4 KiB/block, 256 KiB/document, finite numeric values within declared ranges,
32 JSON nesting levels and reserved-key rejection. Responses retain the 24 KiB tool cap.
Blocks/groups/declarations deleted by content operations lose their runtime entries.
Old state/1 records default to empty runtime. `DocumentView.runtime` contains the complete
channel, and `runtimeVersion` also tracks selection and connection changes.

Documents/groups optionally declare `variables:[{name,value,min,max,label?,step?,unit?,type?,options?}]`
through normal revisioned document/group updates. Each scope has at most 24 unique names,
matching `[a-zA-Z_][a-zA-Z0-9_]{0,31}` and excluding prototype keys. Resolution uses the
nearest ancestor declaring a name, then the document; absent overrides use declared value.
`type` says how a person sees and edits the value; values stay numbers everywhere. `number` (the default, and what
every declaration without `type` is) is a range. `boolean` is on/off: `min:0,max:1`, value `0` or `1`. `choice` lists
2–12 unique `options` and stores the index: `min:0,max:options.length-1`, an integer value. Only `choice` carries
`options`. Runtime writes to a `boolean` or `choice` variable must be whole numbers; ranges apply as before.
Packs carry declarations, never runtime overrides. `controls` lists variable names in
`data.variables` with at most four names per block, shows a slider, a switch or option buttons by type, has an
optional guiding `data.question` and a visible reset. People declare and edit variables in Properties (on the Lienzo,
on each Frame and inside Controls); renaming or deleting one there also updates the `data.variables` of the Controls
that resolve that name to that scope, in the same transaction.
Renderer schemas validate JSON properties too. Registered renderer guidance appears in
catalog list/read results and integration instructions. See [learning-blocks.md](learning-blocks.md).

What an interactive block leaves is runtime state the agent reads; nothing is sent. The client's
`runtime.record(kind, payload, label)` writes the block's `lastInteraction: {kind, label, at, payload?}` next to the
renderer's own state, after flushing pending runtime writes; the payload is dropped first when the block would pass
4 KiB. Controls record the variable moved and its visited range, animated flows the playhead and explored interval,
shaders their values and time, a reset its kind; a quiz hint and a saved form record theirs too. Quiz answers and
form fields stay in block data. Later renderer writes keep the last interaction.

## Bindings

A block may carry `bindings`: a map from a bindable property to `{ variable, map?, expr?, hue?, steps?, template? }`
(`shared/bindings.ts`). The renderer draws the property from the variable's runtime value; the document stores only the
rule, so moving the variable (a slider, `canvas_runtime set`, an extension) never creates a revision. `variable`
resolves through the block's scope chain like a shader uniform: nearest Frame, then the Lienzo.

| Path | Blocks | Value |
| --- | --- | --- |
| `size.width`, `size.height` | all but `wb-text` | px, 8–4096; layout uses it, so links and Frames follow |
| `offset.x`, `offset.y` | all | px, ±4096; draws shifted, stored position, links and Frames stay |
| `rotation` | all | degrees around the centre |
| `opacity` | all | 0–1 |
| `stroke.color`, `fill.color` | `wb-shape` | a colour, from `hue` or `steps` (a bound fill paints even with fill `none`) |
| `stroke.width`, `corner.radius` | `wb-shape` | px, 0–48 and 0–512 (radius: rectangles) |
| `text.size` | `wb-text`, `wb-shape`, `node`, `note` | px, 6–240 |
| `text.template` | `wb-text`, `wb-shape`, `node` (summary), `note` | text: `template` with `{v}`, or `{v:0}`–`{v:4}` for decimals |

The value `v` first goes through `map: { from:[a,b], to:[c,d], clamp? }` (linear; clamped to `to` unless
`clamp:false`) or `expr` (a formula), else stays as it is; numbers are then held inside the property's limits.
`expr` is parsed, never evaluated as code: numbers, `v`, `pi`, `+ - * / %`, parentheses and `min`, `max`, `clamp`,
`round`, `floor`, `ceil`, `abs`, `sqrt`, `sin`, `cos`; at most 160 characters, 80 tokens and 16 levels of nesting. A
result that is not a finite number (`v / 0`) draws the stored value. Colours take `hue: { from:[a,b], to:[h0,h1] }`
(degrees, lit for the theme) or `steps: [{ at, color }]` (ascending `at`; the colour of the last step at or below the
value, the first below all; `color` is a whiteboard colour name or `#rrggbb`). `map` and `expr`, and `hue` and `steps`,
exclude each other; `hue`/`steps` are only for colours and `template` only for text. At most 12 bindings per block.

```json
{ "type": "block.update", "id": "box", "patch": { "bindings": {
  "size.width": { "variable": "speed", "map": { "from": [0, 10], "to": [40, 400] } },
  "fill.color": { "variable": "speed", "steps": [{ "at": 0, "color": "verde" }, { "at": 7, "color": "rojo" }] } } } }
```

`block.update` replaces the whole map; `bindings: null` removes it. Validation refuses an unknown path (the error lists
the bindable ones), a path the block's renderer does not have, and a binding written in the transaction whose variable
the block cannot see (declare it with `document.update`/`group.update` first or in the same transaction). Renaming a
variable in Properties updates the bindings that resolve it, in the same transaction; deleting one leaves its bindings
inert (Properties marks them) and later edits of that block still pass. `canvas_read` returns bindings with the
block; the drawn values are not stored anywhere.

## Block type hints

Block type properties (`propertySchema`) accept three optional hints for the Properties panel, in built-in types and in
types an agent writes with `type.put`: `options` (up to 24 suggested values for a text property; any other text is
still valid), `advanced` (shown under "More options" until it holds a value other than the default) and `help` (one
line under the field, up to 200 characters). They change nothing in validation or in stored data. Built-in types use
them: node `status` and `kind` have suggestions, `details` is advanced; code `language` and media `mediaKind` have
suggestions; Window's `description` is no longer required. `controls.data.question` and `animated-flow.data.question`
are optional (old data that has one keeps it); flow `question`, `travelMs`, `links` and `propagation`, file-tree
`root` and `collapsed`, shader `builtins`, `maxPixelSize` and `staticSummary`, and the mini app's `height` are marked
advanced.

## Graph canvas

`linkSchema` and its inferred type `CanvasLink` are exported from `plugin/shared/model.ts`.
Each strict link is `{id, from, to, label?, kind?, tone?}` on input. `kind` defaults to `flow`
and also accepts `depends` and `reference`. `label` is at most 200 characters; `tone` accepts
`neutro`, `acento`, `violeta`, `turquesa`, `aviso`, or `peligro`. Endpoints identify any existing
block or group. Link IDs must be unique and cannot collide with block/group IDs because reads,
history and conflict details use one ID namespace. Self links and duplicate directed
`(from,to,kind)` triples fail with `INVARIANT`. Reverse links and parallel links of different
kinds are valid.

Documents (and stored templates) have a `links` array, defaulting to `[]`, with at most 2,000 entries.
The document also accepts optional `layout`. The existing `layoutSchema` now accepts mode
`graph` and optional `direction: "down" | "right"`. Direction controls graph rendering only;
omitting it means down in the client, with no coordinate calculation or direction materialization
on the server. Existing layout modes and coordinates retain their meaning. `document.update`
accepts `layout`, and its changes participate in history as `$document`.

`operationSchema` and `CanvasOperation` include `link.create {link}`, `link.update {id,patch}`
and `link.delete {id}`. `linkPatchSchema` permits optional `from`, `to`, `label`, `kind`, and
`tone`, and never inserts a default kind into an update. A label-only patch therefore preserves
an existing depends/reference link. Link changes/removals appear by ID in history, write results,
and revision conflict details. Deleting a block, group or subtree removes touching links in the
same transaction. Ungroup removes only links touching the deleted group, preserving its children
and their connections. Undo/redo restores links and layout; later edits to the same IDs block
undo, and a later link depending on an entity prevents undo from removing that endpoint.

Duplication remaps links as `idPrefix.oldId`, including their endpoints, and keeps only links
whose endpoints are both in the copied set. Duplicating a lone block copies no incident links.

The built-in `node` type uses renderer `node` and four optional text properties: `kind`, `status`,
`summary`, `details`. Use the block title and a short summary for the compact card; longer
explanations belong in details. Build systems, flows and lessons with node blocks joined by links,
inside area groups with `layout.mode: "graph"`. Avoid stacking more than a few prose notes.
Teach by adding actual nodes
and links through confirmed transactions. Lienzo ships no example documents, templates or example packs.

`canvas_read` outline and full views include links and root/group layouts. An `ids` read can
retrieve links too; links have document communication instructions because they have no own
instruction field. Full UI RPC reads retain graph data. Persisted
`paseo-canvas-state/1` and `paseo-canvas-pack` version 1 are unchanged. Strict pre-v1.1 documents,
templates and history snapshots load with empty links and absent root layout. State written before the UI pass may
carry local templates, packs with block types, templates and documents, documents marked `example` and groups with a
`templateId`: all of it loads and is written back unchanged. Stored pack block types stay in the catalog so their
blocks render; templates and pack documents are kept but no longer listed or offered.

## Intentional differences from architecture v1

The coordinator approved a smaller model. RPC export names in `shared/rpc.ts` are authoritative.
`canvas.mutate` is the transactional RPC and `canvas_apply` is its MCP equivalent. Arrays hold
blocks, groups and links, and each group's two child ID arrays define membership. This version has
no combined child reading order, frame resizing, server layout engine, or provenance labels.
The group layout field persists rendering intent; the frontend renders it. Instructions are the
same `communication` object at document, group, and block levels and concatenate from the most
specific entity through its ancestors. IDs can be supplied or generated; operations use concrete
IDs rather than `clientId` resolution. Duplication remaps IDs using a caller prefix. Block types describe fields
through typed property lists rather than arbitrary JSON Schema. The pack format (`format: "paseo-canvas-pack"`,
`version: 1`) survives only as the extension file container: its `blockTypes`, `templates` and `documents` must be
empty.
Unknown type IDs already present in documents are preserved; creating an unknown type fails.

`blockTypeSchema.renderer` accepts the live renderer names plus `retiredRendererNames`
(`shared/renderers/index.ts`): renderers that no longer exist but may still be named by a
stored catalog, a stored pack or a custom type. State files that carry them load and are written back unchanged. The catalog view (`canvas.catalog.read`, `canvas_catalog`) leaves
out every type whose renderer is retired, so it cannot be inserted, and `type.put` rejects a
retired renderer or a retired built-in type ID. Blocks that carry such a type ID follow the
unknown-type rule above: they are preserved, can be moved, retitled and deleted, and cannot be
created again.

References to media remain links in this native first version; there is no embedded media playback contract.

The built-in `preview` type accepts `data.description` and optional `data.url`.
The `media` type accepts `data.url`, optional `data.caption` and `data.mediaKind`.
Both allow an empty URL for a labelled conceptual example. Nonempty URLs must be HTTP/HTTPS
without embedded credentials. The backend does not fetch them. The frontend can open native
links and apply its web-only preview policy. Packs contain no HTML, scripts or executable hooks.

The implementation and limits below describe the working backend. Installation and live daemon
verification are coordinator-owned and were not performed by this engineering task.

## Tools, storage and scope

MCP server name is `paseo-canvas`; plugin ID is `canvas`. The final MCP names are
`canvas_list`, `canvas_sheet`, `canvas_create`, `canvas_read`, `canvas_apply`, `canvas_group`,
`canvas_catalog`, `canvas_extension_run`, `canvas_selection`, `canvas_comments`, `canvas_history`, `canvas_undo`,
`canvas_redo`, `canvas_runtime`. Every response also carries the caller's `copilot` (see Copilot below).

Storage is `$PASEO_HOME/canvas/`, falling back to `~/.paseo/canvas/`. `state.json` is the single
atomic aggregate containing documents, up to 50 retained history entries per document, selection,
block state, catalog, owner bindings and per-agent copilot state. `writer.lock` rejects a second live writer.
`canvas-mcp.cjs` is a dependency-free generated stdio shim. `bridge.json` contains the current
loopback port and random bearer token. Files are mode 0600; the directory is mode 0700.
This replaces architecture v1's separate per-document snapshots and journal. A failed batch never
writes anything. A crash before the atomic rename leaves the previous complete aggregate; a crash
after it leaves the next complete aggregate. Content, history and catalog commit together.

The MCP permission boundary is the authenticated agent's **workspace**, resolved through the
Paseo SDK. A connection marks the agent working on a canvas; it is not a document ACL. A bound agent
can read/edit any document in its workspace, including documents connected to another agent.
Unknown owners and other-workspace documents are refused. UI RPCs are trusted host plugin RPCs
and require an explicit workspace ID. Shared catalog writes are separate from document access
and are not automatically preapproved. Every new agent (Codex, Claude, OpenCode; not internal agents)
gets the tools at creation, with the copilot off. The stored injection preference is legacy and no
longer filters agents.

Connection is automatic. A document-scoped tool call makes the caller the canvas's connected agent: a
read claims a document nobody holds, a write takes it over, and neither changes the document
revision. An agent picked in the panel is stored with `pinned: true` and is never replaced.
Archiving an agent releases its documents. The connection says who works on a canvas (the panel shows it, sharing
mode `agent` scopes by it); it never routes a message, because the canvas sends none.

`canvas.sharing` stores a per-workspace mode. `shared` is the default. With `agent`, MCP calls
reach a document only for its creating agent (`ownerAgentId`), its connected agent, or any agent while
it has neither; `canvas_list` filters the same way. Panel RPCs always see every document.

The bridge starts when the plugin loads and `agent.turn_started` rebinds the SDK handle, so open
agents keep their tools across `paseo plugin reload`. The stdio entry sets
`ELECTRON_RUN_AS_NODE=1` because the packaged desktop daemon's `process.execPath` is Electron.
Agent history includes the real caller `agentId`; an agent can undo only its own edits, and later
related edits by any actor block undo. User undo is scoped to the user actor class because Paseo
0.10.3 does not expose separate human identities to a host plugin.

Checklist items accept strings or `{label: string, done: boolean}`. The exact public schema is
`checklistDataSchema`. No checklist completion is synthesized from agent activity.

RPC method names use the installed SDK's lowercase-only syntax.

## Frontend RPC exports

| TypeScript export | RPC method | Input and result |
| --- | --- | --- |
| `listDocuments` | `canvas.list` | `{workspaceId}` returns document summaries with `blockCount`, `groupCount`, `hojaCount` and the connected `agentId` |
| `deleteDocument` | `canvas.delete` | `{workspaceId,documentId}` deletes a Lienzo and its history; a copilot that pointed at it forgets it |
| `readAbout` | `canvas.about` | `{}` returns `{version, dataFile, host}` for Settings → About |
| `createDocument` | `canvas.create` | `{workspaceId,id?,content}` returns a view |
| `readDocument` | `canvas.read` | `{workspaceId,documentId}` returns a view |
| `mutateDocument` | `canvas.mutate` | `{workspaceId,documentId,expectedRevision,operations,label?}` returns a view |
| `undoDocument`, `redoDocument` | `canvas.undo`, `canvas.redo` | Scoped document and expected revision return a view |
| `watchDocument` | `canvas.watch` | Scoped document, known revision/runtime version return versions and an optional changed view |
| `readRuntime`, `setRuntime` | `canvas.runtime.read`, `canvas.runtime.set` | Scoped bounded reads and non-revisioned block/scope overrides |
| `extensionStorage` | `canvas.extension.storage` | `lienzo.storage`: `{workspaceId,documentId,extensionId,action:"get"\|"set",value?}`, one JSON value (4 KiB) per installed extension and document; no revision, history or MCP tool |
| `setSelection` | `canvas.selection.set` | Scoped document, expected selection version and IDs return a view |
| `readHistory` | `canvas.history` | Scoped document returns retained real transactions, including agent ID |
| `readCatalog`, `mutateCatalog` | `canvas.catalog.read`, `canvas.catalog.mutate` | Read is `{}`; mutation requires catalog revision and a typed action |
| `validatePack`, `importPack` | `canvas.pack.validate`, `canvas.pack.import` | An extension file: validate unknown JSON; import with revision/replace/dryRun (the Extensions screen's review is a dry run) |
| `connectAgent` | `canvas.connect` | Scoped document and revision, connection or null return view and reload requirement |
| `agentSetup` | `canvas.agent.setup` | Workspace, agent ID and provider return a private manual MCP snippet |
| `readInjection`, `configureInjection` | `canvas.injection.read`, `canvas.injection` | Legacy: still stored and readable, but every new agent gets the tools regardless |
| `readCopilot`, `setCopilot` | `canvas.copilot.read`, `canvas.copilot.set` | `{workspaceId,agentId}` (+ `patch`, optional `title`) return the agent's copilot view |
| `listCopilot` | `canvas.copilot.list` | `{agentIds}` returns `{enabled,drawing,hasTools}` per agent, for composer pills |
| `createSheet`, `listSheets` | `canvas.sheet.create`, `canvas.sheet.list` | Create a Sheet (user source) with revision, or list Sheets in order |

`DocumentView.latestAgent` is the agent's most recent transaction from history, or `null`:
`{transactionId, revision, at, agentId?, label, kind, ids, removed}`. `ids` are the changed
entities that still exist (blocks, groups, links; `$document` excluded); `removed` is what it deleted.
It is what "go to latest" flies to. A user edit afterwards does not move it.

`DocumentView.document` contains content, workspace and revision. `connection` is separate runtime
metadata; connecting advances document revision but undo never changes connections. `selectedIds`
remain in the document DTO for a simple frontend while `selectionVersion` and `runtimeVersion`
advance independently on selection and runtime changes. `setSelection` does not add content history.
The legacy `selection.set` batch operation remains supported and counts as a content transaction;
new UI code should use the dedicated RPC.

## MCP usage

Write responses are compact acknowledgements, never complete document copies. After
`canvas_apply`, use `canvas_read` with entity IDs to retrieve changed content and resolved
communication instructions. A `block.update` data merge patch follows RFC 7396 semantics:
objects merge recursively, null deletes a property, and arrays replace. Every batch has one
required optimistic revision and either commits all operations or none.

`canvas_group` actions are `create`, `update`, `ungroup`.
Deletion through `group.delete` deletes the subtree by default; `ungroup:true` retains children
and converts their local positions into positions relative to the former group's parent.
Duplication (`entity.duplicate`) uses `idPrefix.oldId` for every copied entity and link.

`canvas_catalog` actions are `list`, `read`, `save_type`, `save_extension`, `remove_extension`, `help`. Library mutation
revisions are independent of document revisions. `list` returns block types and extensions (no templates or packs);
each block type names its Help page (`help`).
Extension files are imported by the person in the Extensions screen, not by the agent: every extension in a file
uses the file's `id.` namespace, namespaces cannot overlap, a file cannot take an ID held locally or by another
file, and an installed file needs explicit `replace:true`. Removing a stored pack (`pack.remove`, from the panel)
preserves the blocks of any type it carried, with their raw data; they show as unknown types. New blocks and changed
type IDs must reference known types.

## Selection and block state

The canvas is one-way. The agent draws and reads; nothing the person does on the canvas is sent to it. The person
talks to the agent in their own chat (the Paseo conversation, or a terminal for the desktop app) and says "look at
what I selected". The tool descriptions and system instructions tell the agent to call `canvas_selection` whenever
the person says "this", "what I selected", "mirá esto" or similar.

`canvas_selection {documentId?}` returns `{documentId, title, revision, selectionVersion, selectedAt?, ids,
entities, hasMore?, note?}`. Without `documentId` it reads the reachable Lienzo of the workspace whose selection the
person changed most recently (`selectedAt`, recorded when the person selects; an agent's `selection.set` does not set
it). Each entity is `{entity, effectiveInstructions, state?}`: the block or group, its instructions most specific
first, and for a block its runtime state, which is what its interaction left (controls and simulations, a mini app's
`state`, the `lastInteraction` record). Strings over 2000 characters and drawing points are summarised so the result
always fits; at most 40 entities are described. With nothing selected it says so in `note`.

`canvas_read` with `ids` returns `state` for blocks that have it, and the outline marks them `hasState: true` and
includes `selectedIds`. `canvas_runtime read` returns the same per-block state with scope values.

State files written while the canvas still queued the person's actions carry `events` and `outboundBatches` on each
document. They load with both dropped and are written back without them.

## Comments

Comments are the person's notes pinned on the canvas (`shared/comments.ts`). A thread is `{id, anchor, status:
open|resolved, createdAt, updatedAt, resolvedAt?, orphanedFrom?, messages}`; a message is `{id, author, text,
createdAt}` with `author` `{kind:"person", via?}` or `{kind:"agent", agentId, label}`. The anchor is a block or a group
(`{kind, id, dx, dy, at?}`: the pin sits at the entity's top-right corner plus `dx`/`dy`, so it follows the entity;
`at` is the last world point it was drawn at) or a free point (`{kind:"point", x, y}`, world units). Limits: 2000
characters per message, 50 messages per thread, 200 threads and 1 MiB of comments per Lienzo.

They are stored in the document's record (`comments: {version, threads}`, absent in older state files) but are not
drawing content: a comment never bumps the document revision, never breaks an `expectedRevision`, is not a History
transaction and cannot be undone. `commentsVersion` is their own counter: it is in every document view, and
`canvas.watch` takes `knownCommentsVersion` and returns a view when it moved, so the panel reads them again
(`canvas.comments.list`). Deleting an anchored entity (an edit, an undo or the agent) turns its threads into free
points at `at` (or the entity's explicit position) and sets `orphanedFrom: {kind, id, title}`; nothing is lost. A
reply reopens a resolved thread.

Panel RPCs (no revision): `canvas.comments.list`, `.create {anchor, text}`, `.reply {threadId, text}`, `.resolve`,
`.reopen`, `.delete {threadId}`, each answering `{documentId, commentsVersion, threads, threadId?}`; and
`canvas.comments.locate {points: [{threadId, x, y}]}`, the panel's note of where it draws pins on entities (a hint
for orphaning; it changes no counter). `canvas.copilot.read` carries `document.openComments` for the person's
popover; tool responses never carry a count.

`canvas_comments` (one tool, by `action`):

- `list {documentId?, status?: open|resolved|all}` (default `open`). Without `documentId`: the caller's copilot
  Lienzo, else the reachable one the person selected in most recently. Returns `{documentId, title, threads: [{threadId,
  status, anchor: {kind, id, title, type?, sheet?} | {kind:"point", x, y, wasOn?}, messages: [{author: "person" |
  "you" | "agent: <label>", text, at}]}], counts}`.
- `create {documentId, anchor, text}`, `reply {threadId, text}`, `resolve {threadId}`. The agent's messages are signed
  `{kind:"agent", agentId, label}`; the label is the conversation title (or provider) the host reports, else the MCP
  client name, else "Agent". The panel shows them as "<label> · by your agent".

`canvas_selection` adds `openComments` to a selected entity with open threads and to the result when the Lienzo has
any, with a one-line hint. The guide (canvas_list) says when to use comments: read the open ones when the person
mentions them or before revising a Sheet, answer in the conversation, reply in a thread only briefly, resolve what was
handled, and leave a comment only for a decision or an open question worth keeping beside the drawing, never to
narrate. The system-prompt part says nothing about comments (it stays under 1500 characters).

## Connection and reload

The create hook preserves existing MCP entries and task policies,
excludes internal/unsupported providers, and catches failures without blocking agent creation.
The owner token allocated before creation is bound to the real agent ID in the session-open hook.
The bridge resolves that ID through the SDK for every tool call. It does not trust caller-supplied
workspace IDs or `PASEO_AGENT_ID` alone.

Paseo 0.10.3's Codex `applyCodexToolPolicy` translates each server's preapproved tools into
`enabled_tools`, so a partial list hides every unlisted tool. The mixed read/write
`canvas_catalog` cannot safely receive an automatic grant just to expose its read actions.
Codex injection therefore adds no Canvas preapprovals and removes stale Canvas grants from a
cloned create request, preserving unrelated grants and the agent's permission mode. All existing
Canvas tool names remain visible, including catalog reads; normal agent permissions govern all
Canvas calls. This does not require lazy tool discovery. Claude and OpenCode retain document-tool
preapprovals and leave catalog calls to normal permissions. No new catalog write grant is added.
An explicit existing same-name MCP entry remains untouched. The typed SDK provides no separate
Codex visibility override, and its strict provider options do not accept raw MCP tool settings.
An already-created Codex session retains its saved policy: plugin reload alone cannot remove its
old allowlist. Create a new opted-in agent after the coordinator reloads the plugin, or remove that
agent's Canvas preapproval entries through coordinator-owned configuration and reload the idle
session. Connecting a canvas does not change the saved tool policy.

For an existing agent, use `agentSetup` and merge the returned private configuration into that
agent's provider/project configuration. The plugin never changes global provider configuration or
reloads a session itself. Paseo 0.10.3's typed agent handle has no MCP reconfiguration method, so
this manual setup is intentional. Connecting a canvas alone does not install MCP tools.

The stdio shim rereads `bridge.json` on every call. Reopening the backend changes the loopback
port and bearer token; existing shims keep working with the new endpoint and persistent owner
binding. Changed tool definitions require reloading the agent's MCP session. The backend cleanup
closes its own listener, waits for pending writes and releases its writer lock; it never restarts
the daemon. A deleted/archived agent cannot authenticate through the SDK scope check.

## Limits and errors

Documents and extension files are limited to 1 MiB; a file has at most 50 extensions. Each document has up to
1,000 blocks, 200 groups, 2,000 links and four group levels. Batches contain 1..200 operations. JSON nesting
is limited to 32 levels, and prototype-mutating keys are rejected. History retains up to 50
transactions and 8 MiB per document. Total atomic storage is capped at 64 MiB.

The listener binds only `127.0.0.1` on an ephemeral port, requires a random bearer token and a
bound owner token, refuses browser Origin requests, and caps request bodies at 1 MiB. No host
config, Tailscale mapping, public endpoint or file-serving route is added. Tool responses have a
24 KiB limit; large reads return a clear truncation hint. UI RPC read/export can retrieve full content.

MCP errors have stable `code`, `message`, `details`. Revision conflicts use HTTP 409, other-workspace
requests 403, missing objects 404, invalid input 400, group invariants/unknown types 422, and size
limits 413; a failing extension action is 422 (`EXTENSION_FAILED`). RPC errors include the code in `Error.message` because the installed SDK transports
the message rather than arbitrary Error properties. Credentials, private configuration and stack
traces are not returned by bridge failures.

## Whiteboard blocks

Four built-in types use the existing CRUD, group, selection, history and
MCP operations. Their renderer names equal their IDs: `wb-text`, `wb-shape`, `wb-svg`,
and `wb-draw`. Each shared renderer spec has `interactive:false`; there are no new host
APIs, tools, dependencies, or document overlays. Catalog reads include renderer guidance.
Use text for loose labels, shapes for boxes and simple arrows, SVG library icons for
architecture, and normal links for relationships. Create drawings only on explicit request.

`plugin/shared/whiteboard.ts` exports `wbTextDataSchema`, `wbShapeDataSchema`,
`wbSvgDataSchema`, `wbDrawDataSchema`, their `Wb*Data` types, `WbColor`, `WbScale`,
`WbShape`, `WbStroke`, `WB_COLORS`, `WB_SCALE`, `WB_SHAPES`, `WB_LIMITS`,
`isWhiteboardRenderer`, `whiteboardMinSize`, `simplifyStroke` and `appendStroke`.
The schemas are strict. Colors are the roles `tinta`, `gris`, `azul`, `turquesa`,
`verde`, `naranja`, `rojo`, `violeta`; scales are `s`, `m`, `l`, `xl`.

| Type | Data | Size semantics |
| --- | --- | --- |
| `wb-text` | `text` up to 4000 characters, `color`, `scale`, `font:sans\|serif\|mono`, `align:left\|center\|right`, optional `width:24..4096` | No block size object; absent/null is accepted. Text may be empty in the schema. |
| `wb-shape` | `shape:rect\|rounded\|ellipse\|diamond\|triangle\|hexagon\|cylinder\|line`, `color`, `fill:none\|wash\|solid`, optional `fillColor` (same colour roles; interior colour, defaults to the outline colour), `stroke:solid\|dashed\|dotted`, `weight` (sets outline thickness and label size together), `text` up to 1000 characters | Minimum 24×24, or 8×8 for lines. `from:nw\|ne\|sw\|se` and `heads:none\|end\|start\|both` are allowed only on lines. |
| `wb-svg` | `svg`, authoritative `viewBox:[x,y,width,height]`, `color`, `caption`, optional `source`, `license`. Metadata strings up to 200 characters. | Minimum 24×24. SVG and viewBox are rewritten by the server. A valid client viewBox is ignored; it can be omitted on creation. |
| `wb-draw` | `extent:{width,height}` in 1..4096; `strokes:[{points:[x0,y0,x1,y1,…],color,weight}]` | Requires block size, minimum 8×8. Points lie inside extent. Render size scales coordinates, not line weight. |

Every whiteboard object requires finite `position` coordinates in ±100,000, relative to
its parent group. The wire size envelope is 8..4096 in each axis; ordinary and custom
cards retain a 160×104 floor and registered renderer minima. Old documents need no
migration. Frontend auto-layout leaves positioned whiteboard blocks in place.

Drawings persist 1..32 strokes, 2..512 points per stroke, and at most 4000 points overall.
The creation boundary accepts at most 8192 raw points per drawing before simplification.
`simplifyStroke(flatPoints,tolerance=0.75)` rounds to half units, applies iterative
Ramer-Douglas-Peucker with at most 65,536 comparisons per pass, and uniformly resamples
to 512 points when needed. One final pass on the sampled points makes the result stable
on revalidation. There are at most two passes and no recursive RDP traversal. Extent is
rounded outward to half units. `appendStroke({position,size,data},worldPoints,{color,weight})`
returns a new structure with the united box and rebased prior points, including when the
old drawing was resized. Its world coordinates use the same space as position, so callers
inside a group pass group-local coordinates. Limits throw before altering inputs.

Normalization runs at document creation, block creation/update and local type defaults. Validation follows renderer identity, including
custom types that reuse a whiteboard renderer. Rejected data rolls back the transaction,
revision, history and disk write. Unrelated blocks are not normalized during validation.
Undo/redo and revision conflicts use the existing block IDs and snapshots.
`canvas_selection` summarises drawings (stroke count, extent, author, anchor) and never returns their points;
`canvas_read` ids returns everything. Selecting creates nothing for the agent; it reads the selection when asked.

## Safe static SVG

The shared `sanitizeSvg(raw)` helper in `plugin/shared/svg.ts` returns
`{svg:string, viewBox:[x,y,width,height]}` or throws a validation error. It rebuilds
static inline SVG without DOM APIs, network requests, dependencies, or script execution.
Raw and canonical output are each limited to 64 KiB UTF-8. Limits also include
2000 elements, 16 nested levels, 24 attributes per element, 8,192 characters per path,
and 8,192 numeric values per geometry attribute. Coordinates are finite and bounded
to ±100,000. Paths need valid command arity and arc flags.

Accepted elements are `svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`,
`polyline`, `polygon`, `text`, `tspan`, `defs`, `linearGradient`, `radialGradient`,
`stop`, `clipPath`, `mask`, `title`, and `desc`. The root needs a positive `viewBox` or
positive numeric width and height. Paint accepts `none`, `currentColor`, `transparent`,
hex colors, `black`, and `white`. Local `url(#id)` paint/clip/mask references and gradient
fragment references require declared IDs and an acyclic reference graph no deeper than 16.
IDs are preserved, decorative classes and valid comments are removed. The standard XLink
namespace is accepted only on the root, and local gradient `xlink:href` is converted to
`href`; the alias declaration is then removed. Safe styles use a
fixed presentation-property list and are converted to attributes. CSS resource URLs,
escapes, imports, custom properties and other declarations fail. Only the five predefined
XML escapes are accepted; DTDs, custom/numeric
entities, processing instructions other than an initial XML 1.0 UTF-8 declaration,
and malformed markup fail validation.

Scripts, event attributes, `foreignObject`, images, animation, `use`, links,
external resource attributes/paint URLs, and alternate namespaces are rejected.
The input must be SVG markup; HTTP, data, file, and JavaScript URLs are never fetched
or treated as imports. The deliberately narrow subset accepts local Tabler outline
icons and plain static geometry. Unsupported SVG must be converted to this subset
before import. Canonical output is stable when validated again.

## Validation

Run `pnpm test` for headless backend and protocol tests, and `pnpm typecheck` for server/shared,
tests and the frontend's own no-DOM config when it exists. Tests import the entire RPC module and
server entry through the actual installed SDK. They cover atomic rollback, persistence and abrupt
process exit, stale writer recovery, optimistic concurrent conflicts, selection versions,
group cycles/depth/parent consistency, omitted-patch defaults, subtree movement/duplication/export,
per-agent undo and related-edit blocking, checklists/media URL validation, retired renderer names in stored state, extension
file dry-run/collision/refusal of types, templates and documents, old state with templates and packs, missing types, truthful large-write acknowledgements, state files with the retired event
queue loading clean, the selection and block state read through MCP, mini app state persisted across a restart, the
retired extension permission, and that no RPC sends to an agent (`tests/one-way.test.ts`, `tests/host.test.ts`).
The official MCP SDK stdio client verifies real initialize/list/call,
shared RPC/MCP state, auth/scope/409 behavior and bridge/store reopen with the existing client.
Tests use temporary private directories and loopback listeners; they do not launch a GUI or
touch the daemon's installed plugin state.

Graph regressions cover old state/1 compatibility, link schema defaults and patch omission,
link invariants and rollback, directed parallel kinds, block/subtree/ungroup cascades,
remapped subtree links on duplication, persistent graph context,
layout/link undo and redo, later endpoint dependencies, optional node text properties, and graph guidance with Codex's existing preapproval workaround.
Real MCP stdio tests exercise graph schema discovery, outline/full/ID reads, link create/update/delete,
undo/redo, errors without writes, and bridge/store reopening with the original client.

## Legibility report

`canvas_create`, `canvas_apply` and `canvas_group` add `legibility: { links, crossAreaLinks, warnings[] }`
to their result when the document has become hard for a person to follow; a clean write carries no such
field. It never rejects a transaction. Warnings (limits in `plugin/shared/legibility.ts`): more than 12
block-to-block links between different areas, an area with more than 9 items, a node with more than 6
links, more than 16 labelled links, and numbered areas linked high-to-low (the canvas then shows the last
area first, because the `from` end of a link is always drawn before the `to` end). Each warning names the
restructuring: link whole areas with group IDs, split the area, or link in reading order.

## File tree block

`file-tree` shows a folder structure; use it instead of ASCII trees inside `code` blocks.
`data: { root?, entries: [{ path, note?, highlight?, muted? }], collapsed?: [path] }`. `entries` is a flat
list of relative paths (1..200, at most 8 levels, no `..` or leading `/`) in reading order; a trailing
slash marks a directory and unlisted parents are implied. `note` (≤120 characters) says what the entry is
for, `highlight` marks the few entries the explanation is about, `muted` marks generated or vendored ones
(children inherit it), and `collapsed` lists directories that start closed. Opening and closing is local to
the reader and never written to the document.
An entry may carry `ref`, the ID of the block or group that explains it: pressing the entry selects that
card, and selecting the card lights the entry. Without `ref`, an entry pairs with the card or group whose
title is its path (`lib/`, `db/migrations/`, or `spine/ · bases/` for two). `ref` is remapped when a
subtree is duplicated.

## Mini app block

`html` holds one self-contained page: `data: { html (1..200000 characters), height? (80..1600) }`. Any HTML,
CSS and JavaScript is allowed; there are no preset components. It runs sandboxed without access to the
canvas page; scripts and network requests are allowed. The injected `lienzo` object is the only channel, and it
never reaches the agent. `lienzo.setState(value)` stores plain JSON of at most 3000 characters on the block (null
clears it) and resolves once saved; it is runtime state `{ state: value }`, so the agent reads it as `state.state`
with `canvas_selection` or `canvas_read` ids, the outline marks the block `hasState`, and it survives restarts.
`lienzo.state` (also `context.state`) gives the stored value back so the page restores itself. Pages written before
setState may still call `lienzo.send(kind, payload)`: it only records the call as the block's `lastInteraction`
(payload up to 1000 characters, otherwise dropped). `lienzo.onContext(fn)` gives `{ theme: { dark, colors }, block,
document, state, selection }`; `lienzo.select(id)`; `lienzo.resize(height)`; `lienzo.onFrame(fn)` gives `{ x, y, width, height, others }` in
screen pixels, this window and the other mini apps, on every move. Update the page with `block.update` on
`data.html`. For projects with several files or a server, run them and use a `preview` block with `data.url`.

## Copilot

Lienzo is the visual copilot of a conversation. Every new agent gets the tools and short system
instructions (`integrationInstructions`): draw only when the copilot is on for this conversation, read
the mode from any canvas tool response, one Sheet per new explanation and revisit a Sheet for the same
topic. The longer drawing guide (`drawingGuide`) is returned by `canvas_list` as `guide` instead of
living in every system prompt.

While the copilot is on, the server paces the agent instead of only asking it to (`plugin/server/pacing.ts`):
a `canvas_apply` or `canvas_create` that adds more than 6 blocks is rejected with a `VALIDATION` error that
says to send the next stage only, and nothing is applied. A `canvas_apply` result carries `variety` when a
Sheet it touched holds 5 or more blocks and all are cards (`node`, `note`, `wb-text`), suggesting a drawing,
shapes, animated-flow, controls, a mini app or a checklist for the next stage. With the copilot off, a drawing
the person asked for is not paced.

State is per agent, in `state.json` under `copilot[agentId]`; state files written before it load with
every agent off. Fields: `enabled` (default false), `cadence` (`thinking` after reasoning or each tool
use, `step` after each step worth showing — default, `task` once at the end of a task, `custom` with
`rule`, up to 500 characters and required while custom is on), `remind` (default false), `documentId`
(the conversation's Lienzo). Private fields: `reminded` (the last ended turn got a reminder),
`workspaceId`, `updatedAt`. Archiving an agent deletes its entry.

- `canvas.copilot.read {workspaceId, agentId}` returns `{agentId, copilot, hasTools, drawing,
  lastToolAt, document: {id,title}|null, latest}`. `hasTools` is false for an agent with no bound
  owner token (created before the plugin gave every agent its tools). `drawing` is true while a Lienzo
  tool call of that agent is in flight or ended less than 3 s ago (in memory, not persisted). `latest`
  is the agent's `latestAgent` on its Lienzo plus `documentId` and up to three entity titles.
- `canvas.copilot.set {workspaceId, agentId, patch, title?}` verifies the agent belongs to the
  workspace. Turning on without a `documentId` creates the conversation's Lienzo (titled `title`) and
  connects it to the agent; attaching an existing `documentId` moves that document's connection to the
  agent. Nothing is sent to the agent: it learns the mode from the `copilot` field of its next canvas
  tool response.
- `canvas.copilot.list {agentIds}` is the cheap status for composer pills.

Every successful canvas MCP response, truncated acknowledgements included, carries
`copilot: {enabled, cadence, rule, documentId}` for the calling agent. Errors keep their error shape.

The client registers a "Lienzo" composer pill per agent (`plugin/client/copilot/`). "Go to latest" and
"Open Lienzo" open the `canvas` workspace panel and leave a `CanvasIntent` (`workspaceId`, `documentId`,
`kind`, `ids`) in `copilot/intent.ts`; the panel takes it with `takeCanvasIntent(workspaceId)` and
listens with `onCanvasIntent`. Intents expire after 60 s.

Reminder (optional, off by default): on `agent.turn_ended`, one short follow-up is sent through
`agents.ref(id).send` only when the copilot is on, `remind` is true, the cadence is `step` or `task`,
the turn completed, its timeline has a tool call that is not a Lienzo tool (Claude
`mcp__paseo-canvas__canvas_*`, `paseo-canvas.canvas_*` or a bare `canvas_*` name; a Lienzo call seen
by the bridge during the turn also counts as drawing), and the agent is not busy with another turn
(a send would interrupt it). Never for `thinking` or `custom`, and never twice in a row: the turn after
a reminder never gets one. This is Paseo nudging the agent to draw; it is the only message the plugin sends to an
agent, and nothing on the canvas triggers it.

### Sheets

A Sheet is a chapter the agent adds while explaining: a top-level group with
`sheet: {number, createdAt, source: "agent"|"user"}`. Validation keeps Sheets top-level and numbers
unique; a duplicate of a Sheet is an ordinary group. New Sheets take the next number
(never reused while higher ones exist) and sit to the right of the last Sheet at the same `y`, one
horizontal strip. The server estimates widths (explicit child positions, else a grid guess, at least
1200) plus a 320 gap; the first Sheet goes to the right of existing loose content, or at the origin.

`canvas_sheet` actions: `create {documentId, expectedRevision, title, description?, id?, layout?}`
returns `{documentId, revision, id, number}`; `list {documentId}` returns `{revision, sheets: [{id,
number, title, description, createdAt, source, position, blockCount, groupCount}]}` in number order;
`update {documentId, expectedRevision, id, title?, description?}` retitles one. Content goes into a Sheet
with ordinary `canvas_apply` operations using `parentGroupId`. Outline reads include `sheet` on groups.

## Extensions

`canvas_catalog` also lists, reads, saves and removes extensions: `list` returns `extensions` (ID, kind, name,
description, permissions, source, `allowed`, and for one from a file that waits for the person `missingPermissions` and
a note; with `actions`, each action's name, description, input schema and optional returns) and `extensionGuide`, the
whole frame API as text; `read { id }` returns one with
its page; `save_extension { expectedRevision, extension }` adds or replaces a local one; `remove_extension` deletes a
local one. Like every catalog write it needs the person's approval. The guide ends with the complete example of Help →
Make your own (`shared/wiki/tutorial.ts`). An extension may carry `docs`, its own Help page in safe Markdown (no HTML;
refused otherwise). The contract is in `docs/extensions.md`.

### Running an extension's action

`canvas_extension_run { extension, action, input?, documentId? }` runs one of the actions an extension declares
(`docs/extensions.md`, "Actions"). Without `documentId` it runs on the reachable Lienzo the person selected in most
recently (else the most recently changed). The input is checked against the action's schema first; then the
extension's `<script data-lienzo="actions">` runs in a fresh QuickJS instance inside the server process
(`server/sandbox.ts`, `server/actions.ts`) with the headless `lienzo`. Its `lienzo.edit` calls are validated one by one
against a working copy and committed together, after it finishes, as one agent transaction labelled
`"<extension name> (agent): <first label>"`, undoable with `canvas_undo` and shown in History; its last `lienzo.select`
sets the shared selection. If the document changed while it ran, nothing is applied (`REVISION_CONFLICT`).

Result: `{ documentId, extension, action, result, revision, committed, transactionId?, label?, changed?, removed?,
selection?, logs? }` (`logs`: up to 10 console lines). Errors, all leaving the document untouched:

| Code | When |
|---|---|
| `NOT_FOUND` | unknown extension or action (the message lists the actions), or a declared action the script does not register |
| `VALIDATION` / `TOO_LARGE` | the input does not match the schema (each problem named) or is over 16 KiB |
| `FORBIDDEN` | it tried to edit without holding `edit`: from a file and not allowed yet ("ask the person to allow it in Extensions"), or not declared |
| `EXTENSION_FAILED` | it threw, or hit a limit; `details.reason` is `error`, `timeout`, `memory`, `recursion`, `jobs`, `unfinished`, `output` or `crashed`, `details.logs` its console lines |
| `REVISION_CONFLICT` | the Lienzo changed while it ran |

Limits per run: 2 s, 64 MiB, a 64 KiB interpreter stack, 100 000 promise jobs, 200 operations over at most 20
`lienzo.edit` calls, 20 `lienzo.select` calls, a 16 KiB result. The tool is preapproved like `canvas_apply`: what it can
change is bounded by the permissions the person gave the extension.

## Help pages

`canvas_catalog help` reads the person's Help, the same data the Help screen shows (`plugin/shared/wiki`), so the agent
can say how something is done by hand instead of guessing: without arguments it returns the contents (sections, page
ids, titles, summaries); `{ query }` returns up to eight matching pages; `{ page }` returns one page as Markdown (what
it is for, steps by hand, example prompts, tips, longer text). Installed extensions add their pages (`ext:<id>`).
Nothing is duplicated: the drawing and extension guides keep the technical rules, Help keeps the person's view.
`docs/help.md` is generated from the same pages (`pnpm help:docs`).
Only kind `tool` exists; catalogs and packs stored with the retired kind `view` still load and drop those
entries.
