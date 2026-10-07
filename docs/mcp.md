# Canvas backend v1.1

The frontend contracts are in `plugin/shared/model.ts` and `plugin/shared/rpc.ts`.
Import a named RPC and call `useRpc(contract)` from `@getpaseo/plugin/client`.
For example, `useRpc(readDocument)({workspaceId, documentId})` returns a `DocumentView`.
`useRpc(mutateDocument)({workspaceId, documentId, expectedRevision, operations})`
returns the committed view. Invalidate or poll the document query after a mutation.
`watchDocument` takes `knownRevision` and `knownRuntimeVersion`; it returns a view only
when either changes. `setSelection` uses its own `expectedSelectionVersion` and never sends
an agent message. `agentAction` needs a stable client-generated `eventId`, the current document
revision, and `{kind, label, payload, targetIds?, delivery?}`. Render its persisted status.

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
channel, and `runtimeVersion` also tracks existing selection/connection/feedback changes.

Documents/groups optionally declare `variables:[{name,value,min,max,label?,step?,unit?}]`
through normal revisioned document/group updates. Each scope has at most 24 unique names,
matching `[a-zA-Z_][a-zA-Z0-9_]{0,31}` and excluding prototype keys. Resolution uses the
nearest ancestor declaring a name, then the document; absent overrides use declared value.
Packs carry declarations, never runtime overrides. `controls` lists variable names in
`data.variables` with at most four names per block, has a declarative guiding `data.question` and a visible reset.
Renderer schemas validate JSON properties too. Registered renderer guidance appears in
catalog list/read results and integration instructions. See [learning-blocks.md](learning-blocks.md).

`agentAction.action.settled:true` requires batched delivery, a single block target and at
most 4 KiB payload. A newer pending settled event replaces an older one with the same
block/kind, except events already in an immutable outbound batch. Its context keeps only
the target block and ancestor groups; ordinary feedback still stores the full snapshot.
Settled actions capture current server revision without rejecting a stale supplied revision.
They do not change content revision. Runtime settled helpers flush writes before reporting
final value or visited range. The existing explicit feedback flush
mechanism delivers batched-only events.

## Graph canvas

`linkSchema` and its inferred type `CanvasLink` are exported from `plugin/shared/model.ts`.
Each strict link is `{id, from, to, label?, kind?, tone?}` on input. `kind` defaults to `flow`
and also accepts `depends` and `reference`. `label` is at most 200 characters; `tone` accepts
`neutro`, `acento`, `violeta`, `turquesa`, `aviso`, or `peligro`. Endpoints identify any existing
block or group. Link IDs must be unique and cannot collide with block/group IDs because reads,
history and conflict details use one ID namespace. Self links and duplicate directed
`(from,to,kind)` triples fail with `INVARIANT`. Reverse links and parallel links of different
kinds are valid.

Documents and templates have a `links` array, defaulting to `[]`, with at most 2,000 entries.
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

Duplication and template insertion remap links as `idPrefix.oldId`, including their endpoints,
and keep only links whose endpoints are both in the copied set. Duplicating a lone block copies
no incident links. Group export includes all internal subtree links, including links to groups,
and excludes boundary links. Portable packs preserve document/template links and document/group
layouts through validation, import, export, instantiation and reopening storage.

The built-in `node` type uses renderer `node` and four optional text properties: `kind`, `status`,
`summary`, `details`. Use the block title and a short summary for the compact card; longer
explanations belong in details. Build systems, flows and lessons with node blocks joined by links,
inside area groups with `layout.mode: "graph"`. Avoid stacking more than a few prose notes.
Teach by adding actual nodes
and links through confirmed transactions. `canvas_example {packId:"graph"}` creates the Spanish
"Ejemplo: cómo funciona Lienzo" document with three graph groups and flow/depends/reference
links, including cross-group connections. It has `example:true` and describes architecture,
not live agent activity.

`canvas_read` outline and full views include links and root/group layouts. An `ids` read can
retrieve links too; links have document communication instructions because they have no own
instruction field. Full UI RPC reads and feedback context snapshots retain graph data. Persisted
`paseo-canvas-state/1` and `paseo-canvas-pack` version 1 are unchanged. Strict pre-v1.1 documents,
templates, history snapshots and feedback contexts load with empty links and absent root layout.

## Intentional differences from architecture v1

The coordinator approved a smaller model. RPC export names in `shared/rpc.ts` are authoritative.
`canvas.mutate` is the transactional RPC and `canvas_apply` is its MCP equivalent. Arrays hold
blocks, groups and links, and each group's two child ID arrays define membership. This version has
no combined child reading order, frame resizing, server layout engine, or provenance labels.
The group layout field persists rendering intent; the frontend renders it. Instructions are the
same `communication` object at document, group, and block levels and concatenate from the most
specific entity through its ancestors. IDs can be supplied or generated; operations use concrete
IDs rather than `clientId` resolution. Template insertion/duplication remaps IDs using a caller
prefix. Packs have `format: "paseo-canvas-pack"` and `version: 1`, and describe fields through
typed property lists rather than arbitrary JSON Schema. Pack export returns portable JSON data.
Unknown type IDs already present in documents are preserved; creating an unknown type fails.

`blockTypeSchema.renderer` accepts the live renderer names plus `retiredRendererNames`
(`shared/renderers/index.ts`): renderers that no longer exist but may still be named by a
stored catalog, an imported pack or a custom type. State files and packs that carry them load,
import and export unchanged. The catalog view (`canvas.catalog.read`, `canvas_catalog`) leaves
out every type whose renderer is retired, so it cannot be inserted, and `type.put` rejects a
retired renderer or a retired built-in type ID. Blocks that carry such a type ID follow the
unknown-type rule above: they are preserved, can be moved, retitled and deleted, and cannot be
created again. A pack template or document that needs one fails with `UNKNOWN_TYPE` when
inserted or instantiated.

The `learn` pack teaches request states with a node, notes and a code example. References to
media remain links in this native first version; there is no embedded media playback contract.

The built-in `preview` type accepts `data.description` and optional `data.url`.
The `media` type accepts `data.url`, optional `data.caption` and `data.mediaKind`.
Both allow an empty URL for a labelled conceptual example. Nonempty URLs must be HTTP/HTTPS
without embedded credentials. The backend does not fetch them. The frontend can open native
links and apply its web-only preview policy. Packs contain no HTML, scripts or executable hooks.

The implementation and limits below describe the working backend. Installation and live daemon
verification are coordinator-owned and were not performed by this engineering task.

## Tools, storage and scope

MCP server name is `paseo-canvas`; plugin ID is `canvas`. The final MCP names are
`canvas_list`, `canvas_create`, `canvas_example`, `canvas_read`, `canvas_apply`, `canvas_group`,
`canvas_catalog`, `canvas_selection`, `canvas_events`, `canvas_history`, `canvas_undo`, `canvas_redo`, `canvas_runtime`.

Storage is `$PASEO_HOME/canvas/`, falling back to `~/.paseo/canvas/`. `state.json` is the single
atomic aggregate containing documents, up to 50 retained history entries per document, selection,
feedback events, catalog and owner bindings. `writer.lock` rejects a second live writer.
`canvas-mcp.cjs` is a dependency-free generated stdio shim. `bridge.json` contains the current
loopback port and random bearer token. Files are mode 0600; the directory is mode 0700.
This replaces architecture v1's separate per-document snapshots and journal. A failed batch never
writes anything. A crash before the atomic rename leaves the previous complete aggregate; a crash
after it leaves the next complete aggregate. Content, history and catalog commit together.

The MCP permission boundary is the authenticated agent's **workspace**, resolved through the
Paseo SDK. A connection selects the feedback recipient; it is not a document ACL. A bound agent
can read/edit any document in its workspace, including documents connected to another agent.
Unknown owners and other-workspace documents are refused. UI RPCs are trusted host plugin RPCs
and require an explicit workspace ID. Shared catalog writes are separate from document access
and are not automatically preapproved. New-agent injection is on for every workspace
(`"*"`) until the user turns it off in the agent dialog; an explicit choice is stored and respected.

Connection is automatic. A document-scoped tool call makes the caller the feedback recipient: a
read claims a document nobody receives, a write takes it over, and neither changes the document
revision. A recipient picked in the panel is stored with `pinned: true` and is never replaced.
A UI action on a document with no recipient goes to the most recently bound agent of that
workspace that is still open. Archiving an agent releases its documents.

`canvas.sharing` stores a per-workspace mode. `shared` is the default. With `agent`, MCP calls
reach a document only for its creating agent (`ownerAgentId`), its recipient, or any agent while
it has neither; `canvas_list` filters the same way. Panel RPCs always see every document.

The bridge starts when the plugin loads and `agent.turn_started` rebinds the SDK handle, so open
agents keep their tools across `paseo plugin reload`. The stdio entry sets
`ELECTRON_RUN_AS_NODE=1` because the packaged desktop daemon's `process.execPath` is Electron.
Agent history includes the real caller `agentId`; an agent can undo only its own edits, and later
related edits by any actor block undo. User undo is scoped to the user actor class because Paseo
0.10.3 does not expose separate human identities to a host plugin.

Checklist items accept strings or `{label: string, done: boolean}`. The exact public schema is
`checklistDataSchema`. No checklist completion is synthesized from agent activity.

RPC method names use the installed SDK's lowercase-only syntax. Stable TypeScript exports
`agentAction`, `readAgentEvents`, and `flushAgentEvents` map to `canvas.agent.action`,
`canvas.agent.events`, and `canvas.agent.events.flush`.
Shipped `frontend`, `learn` and `graph` pack exports are protected reference exports and cannot be imported
as replacements. User pack exports round-trip unchanged. To fork a shipped export, use a new pack
ID and namespace every exported type/template ID as `newPackId.entry`, updating references.

## Frontend RPC exports

| TypeScript export | RPC method | Input and result |
| --- | --- | --- |
| `listDocuments` | `canvas.list` | `{workspaceId}` returns document summaries |
| `createDocument` | `canvas.create` | `{workspaceId,id?,content}` returns a view |
| `readDocument` | `canvas.read` | `{workspaceId,documentId}` returns a view |
| `mutateDocument` | `canvas.mutate` | `{workspaceId,documentId,expectedRevision,operations,label?}` returns a view |
| `undoDocument`, `redoDocument` | `canvas.undo`, `canvas.redo` | Scoped document and expected revision return a view |
| `watchDocument` | `canvas.watch` | Scoped document, known revision/runtime version return versions and an optional changed view |
| `readRuntime`, `setRuntime` | `canvas.runtime.read`, `canvas.runtime.set` | Scoped bounded reads and non-revisioned block/scope overrides |
| `setSelection` | `canvas.selection.set` | Scoped document, expected selection version and IDs return a view |
| `readHistory` | `canvas.history` | Scoped document returns retained real transactions, including agent ID |
| `readCatalog`, `mutateCatalog` | `canvas.catalog.read`, `canvas.catalog.mutate` | Read is `{}`; mutation requires catalog revision and a typed action |
| `validatePack`, `importPack`, `exportPack` | `canvas.pack.validate`, `canvas.pack.import`, `canvas.pack.export` | Validate unknown JSON; import with revision/replace/dryRun; export by ID |
| `instantiatePack` | `canvas.pack.instantiate` | Workspace, pack ID and document index create a labelled example |
| `exportGroup` | `canvas.group.export` | Scoped document and group ID produce a portable template |
| `connectAgent` | `canvas.connect` | Scoped document and revision, connection or null return view and reload requirement |
| `agentSetup` | `canvas.agent.setup` | Workspace, agent ID and provider return a private manual MCP snippet |
| `agentAction` | `canvas.agent.action` | Scoped document, revision, stable event ID and action persist real feedback |
| `readAgentEvents`, `flushAgentEvents` | `canvas.agent.events`, `canvas.agent.events.flush` | Scoped document lists events or retries/flushes queued events |
| `readInjection`, `configureInjection` | `canvas.injection.read`, `canvas.injection` | Read enabled workspace IDs (`"*"` by default); change with preferences revision |

`DocumentView.document` contains content, workspace and revision. `connection` is separate runtime
metadata; connecting advances document revision but undo never changes connections. `selectedIds`
remain in the document DTO for a simple frontend while `selectionVersion` and `runtimeVersion`
advance independently on selection/feedback changes. `setSelection` does not add content history.
The legacy `selection.set` batch operation remains supported and counts as a content transaction;
new UI code should use the dedicated RPC.

## MCP usage

Write responses are compact acknowledgements, never complete document copies. After
`canvas_apply`, use `canvas_read` with entity IDs to retrieve changed content and resolved
communication instructions. A `block.update` data merge patch follows RFC 7396 semantics:
objects merge recursively, null deletes a property, and arrays replace. Every batch has one
required optimistic revision and either commits all operations or none.

`canvas_group` actions are `create`, `update`, `insert_template`, `ungroup`, `export_template`.
Deletion through `group.delete` deletes the subtree by default; `ungroup:true` retains children
and converts their local positions into positions relative to the former group's parent.
Template insertion and duplication use `idPrefix.oldId` for every copied entity and link. Exporting a
template does not save it automatically; save with `canvas_catalog` action `save_template`.

`canvas_catalog` actions are `list`, `read`, `import_pack`, `export_pack`, `save_type`,
`save_template`, `remove_pack`. Library mutation revisions are independent of document revisions.
User pack entries require `packId.` namespaces. Pack namespaces cannot overlap, and imports
cannot shadow local types/templates. An existing user pack needs explicit `replace:true`.
Import does not alter existing document content. Removing a pack preserves its blocks and their
raw data; the frontend displays unknown types until the catalog definition returns. New blocks,
changed type IDs and new pack documents must reference known types.

`canvas_events` returns the latest 10 event payloads by default, with `limit` up to 20 or an
`eventIds` filter. It includes selection and document communication captured at the event.
Pass `ack:[eventId]` after handling the action. Acknowledgement is terminal, even if it arrives
before the SDK send promise resolves. The UI distinguishes `pending`, `sent`, `failed`, `acked`;
an acknowledgement means the agent acknowledged the event, not that all user goals are complete.

## Connection, delivery and reload

Enable `configureInjection({workspaceId,enabled:true,expectedRevision})` before creating new
agents in that workspace. The create hook preserves existing MCP entries and task policies,
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
session. Connecting feedback does not change the saved tool policy.

For an existing agent, use `agentSetup` and merge the returned private configuration into that
agent's provider/project configuration. The plugin never changes global provider configuration or
reloads a session itself. Paseo 0.10.3's typed agent handle has no MCP reconfiguration method, so
this manual setup is intentional. Connecting feedback alone does not install MCP tools.

The stdio shim rereads `bridge.json` on every call. Reopening the backend changes the loopback
port and bearer token; existing shims keep working with the new endpoint and persistent owner
binding. Changed tool definitions require reloading the agent's MCP session. The backend cleanup
closes its own listener, waits for pending writes and releases its writer lock; it never restarts
the daemon. A deleted/archived agent cannot authenticate through the SDK scope check.

Actions persist before delivery. With no connection they stay pending. While the connected agent
is running/initializing, they queue and retry on `agent.turn_ended`. Immediate delivery includes
pending batched events; batched-only events wait for `flushAgentEvents`. Failed sends remain
failed until explicit retry. Before SDK send, one atomic store transaction prepares a private
outbound batch with its recipient, immutable event IDs, a unique `messageId` and the exact prompt.
If send is accepted but its local status write is lost, reopening the backend replays that same
message ID and prompt. New arrivals form a separate batch with another message ID; completing
the older batch can only mark its original events sent. Acknowledged events remain acknowledged.
The private outbox adds no frontend or shared RPC fields. Unresolved batches and their events stay
retained until delivery or acknowledgement resolves them. Events assigned to another agent are
not silently rerouted when the connection changes.

Transport acceptance and local persistence are separate operations. The inspected Paseo 0.10.3
`MessageReceipts` implementation stores receipts keyed by agent ID and message ID and fingerprints
the request payload. A completed receipt with the same fingerprint returns without resending;
changing the payload under that ID rejects with `agent_request_key_conflict`. An existing pending
receipt rejects with `agent_request_outcome_unknown`, because the provider may have accepted the
message before receipt completion. The plugin preserves the batch on these uncertain failures,
reports delivery as unconfirmed, and does not substitute a new ID for the old batch. New events
have their own IDs and can be delivered separately when the agent is available.

The plugin does not promise transport exactly-once delivery or that SDK acceptance means the agent
finished processing an event. Replay assumes the receiver honors its receipt contract while the
receipt remains available. The regression simulates a receiver with completed-ID suppression,
loses the local completion write, then reopens with newer events waiting. It verifies byte-identical
replay and separate delivery of the new events. If receipts are lost or a receiver accepts a repeat,
the repeated prompt still contains only the original batch. Explicit event acknowledgements remain
the handling signal. There is no fake activity or completion output.

## Limits and errors

Documents and packs are limited to 1 MiB; a pack has at most 200 entries. Each document has up to
1,000 blocks, 200 groups, 2,000 links and four group levels. Batches contain 1..200 operations. JSON nesting
is limited to 32 levels, and prototype-mutating keys are rejected. History retains up to 50
transactions and 8 MiB per document. Total atomic storage is capped at 64 MiB. There are at most
100 pending/failed and 100 recent sent/acked events per document; terminal events belonging to an
unresolved outbound batch remain retained until that batch resolves.

The listener binds only `127.0.0.1` on an ephemeral port, requires a random bearer token and a
bound owner token, refuses browser Origin requests, and caps request bodies at 1 MiB. No host
config, Tailscale mapping, public endpoint or file-serving route is added. Tool responses have a
24 KiB limit; large reads return a clear truncation hint. Feedback prompts have an 8 KiB cap and
refer to event IDs when payloads do not fit. UI RPC read/export can retrieve full content.

MCP errors have stable `code`, `message`, `details`. Revision conflicts use HTTP 409, other-workspace
requests 403, missing objects 404, invalid input 400, group invariants/unknown types 422, and size
limits 413. RPC errors include the code in `Error.message` because the installed SDK transports
the message rather than arbitrary Error properties. Credentials, private configuration and stack
traces are not returned by bridge failures.

## Whiteboard blocks

Four built-in types use the existing CRUD, group, selection, template, pack, history and
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

Normalization runs at document creation, block creation/update, local type defaults,
template writes, and pack validation/import. Validation follows renderer identity, including
custom types that reuse a whiteboard renderer. Rejected data rolls back the transaction,
revision, history and disk write. Unrelated blocks are not normalized during validation.
Packs keep the SVG bytes and attribution locally and carry drawing geometry as block data.
Undo/redo and revision conflicts use the existing block IDs and snapshots.
Explicit feedback target summaries include drawing stroke counts and extent, or SVG
caption/source; they omit SVG markup and drawing points. Selection creates no agent action.

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
per-agent undo and related-edit blocking, checklists/media URL validation, retired renderer names in stored state, pack import
dry-run/collision/roundtrip, missing types, truthful large-write acknowledgements, feedback queues
and terminal acknowledgement, plus immutable outbound batch replay after accepted-send/lost-mark
recovery with new event arrivals. The official MCP SDK stdio client verifies real initialize/list/call,
shared RPC/MCP state, auth/scope/409 behavior and bridge/store reopen with the existing client.
Tests use temporary private directories and loopback listeners; they do not launch a GUI or
touch the daemon's installed plugin state.

Graph regressions cover old state/1 compatibility, link schema defaults and patch omission,
link invariants and rollback, directed parallel kinds, block/subtree/ungroup cascades,
remapped subtree links, boundary-free group exports, packs and persistent graph context,
layout/link undo and redo, later endpoint dependencies, optional node text properties,
the labelled graph example, and graph guidance with Codex's existing preapproval workaround.
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
subtree or template is copied.

## Mini app block

`html` holds one self-contained page: `data: { html (1..200000 characters), height? (80..1600) }`. Any HTML,
CSS and JavaScript is allowed; there are no preset components. It runs sandboxed without access to the
canvas page; scripts and network requests are allowed. The injected `lienzo` object is the only channel:
`lienzo.send(kind, payload)` arrives as a canvas event of kind `html.event` with
`payload: { event, data }`; `lienzo.onContext(fn)` gives `{ theme: { dark, colors }, block, document,
selection }`; `lienzo.select(id)`; `lienzo.resize(height)`. Update the page with `block.update` on
`data.html`. For projects with several files or a server, run them and use a `preview` block with `data.url`.
