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
Reserve the in-block `diagram` for small self-contained figures. Teach by adding actual nodes
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

The `diagram` built-in type uses renderer `diagram`. Its exact contract is `diagramDataSchema`:
`{nodes: [{id, label, description?, position?: {x,y}}], edges: [{id, from, to, label?}], caption?}`.
Node and edge IDs are unique, and both edge endpoints must exist. Positions are optional;
the frontend uses the Opus-designed automatic layout when absent. Render visual node cards and
connectors, not raw JSON. `block.update` merge patches replace the `nodes` and `edges` arrays,
so a teaching agent can show one node first and commit further nodes/connections as the lesson
progresses. The `learn` pack includes a request-state diagram. References to media remain links
in this native first version; there is no embedded media playback contract.

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
`canvas_catalog`, `canvas_selection`, `canvas_events`, `canvas_history`, `canvas_undo`, `canvas_redo`.

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

## Validation

Run `pnpm test` for headless backend and protocol tests, and `pnpm typecheck` for server/shared,
tests and the frontend's own no-DOM config when it exists. Tests import the entire RPC module and
server entry through the actual installed SDK. They cover atomic rollback, persistence and abrupt
process exit, stale writer recovery, optimistic concurrent conflicts, selection versions,
group cycles/depth/parent consistency, omitted-patch defaults, subtree movement/duplication/export,
per-agent undo and related-edit blocking, diagrams/checklists/media URL validation, pack import
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
