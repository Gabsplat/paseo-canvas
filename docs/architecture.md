# Paseo Canvas — Architecture contract

Status: **v1 as built — reconciled with the backend contract**. Owner: architecture agent.
Target runtime: Paseo **0.10.3** (`@getpaseo/plugin` 0.10.3, verified against the installed SDK
types and `/tmp/paseo-canvas-plugin-reference.md`).
Interactive explainer (Spanish): `architecture/index.html`.

Words used with a fixed meaning: **must** is contract, **should** is the default an engineer may
deviate from with a note in their own doc, **open** is a point to verify during implementation.

---

## 0. v1 as built (read this first)

`plugin/shared/model.ts` and `plugin/shared/rpc.ts` are **authoritative** for every name, field and
limit; `docs/mcp.md` records the approved simplifications. Where sections 2–9 below differ from
this table, this table wins: sections 2–9 keep the original design rationale and mark the larger
design that v1 deliberately did not build.

| Topic | Original design (sections 4–9) | v1 as built |
|-------|-------------------------------|-------------|
| Product name | Paseo Canvas | UI name **Lienzo**; "Paseo Canvas" is the subtitle and package name |
| Identifiers | `docId`, `ops`, `op:` | `documentId`, `workspaceId` (required on every document RPC), `operations`, `type:` |
| Containers | `blocks`/`groups` records, `rootOrder` | `blocks[]` and `groups[]` arrays; membership is `group.blockIds` + `group.groupIds`; server maintains `parentGroupId` |
| Block | `type`, `typeVersion`, `props`, `state`, `frame`, `meta` | `typeId`, `title`, `data`, optional `position {x,y}` (relative to parent group), `parentGroupId`, `communication` |
| Group | `purpose`, `childOrder`, `frame`, `locked` | `description`, `blockIds`, `groupIds`, optional `position`, `collapsed`, `layout` (persisted intent, rendered by the client), `templateId`, `communication` |
| Instructions | `Instructions { text, onAction }` | `communication { instructions, intent, audience }` at document, group and block level; concatenated from the entity through its ancestors |
| Selection | separate `runtime.json` | `document.selectedIds`, own `selectionVersion`; RPC `canvas.selection.set` with `expectedSelectionVersion`; never messages the agent |
| IDs | server-generated + `clientId` mapping | concrete IDs supplied by the caller (or generated); `template.insert` / `entity.duplicate` remap with `idPrefix` |
| Operations | see §6 | `document.update`, `communication.set`, `selection.set`, `block.create/update/delete`, `group.create/update/delete`, `entity.move`, `entity.duplicate`, `template.insert` |
| Write result | `TransactionResult` | a full `DocumentView { document, connection, canUndo, canRedo, selectionVersion, runtimeVersion }` |
| RPC names | `canvas.doc.*` | `canvas.list/read/create/mutate/watch/undo/redo/history`, `canvas.selection.set`, `canvas.connect`, `canvas.agent.action`, `canvas.agent.events(.flush)`, `canvas.catalog.read/mutate`, `canvas.pack.validate/import/export/instantiate`, `canvas.group.export`, `canvas.agent.setup`, `canvas.injection(.read)` |
| Watch | `canvas.doc.watch` | `canvas.watch { knownRevision, knownRuntimeVersion }` → versions, plus `view` only when something changed |
| MCP write | `canvas_apply` + `canvas_group` etc. | `canvas_apply` ≡ `canvas.mutate`; exact tool list in `docs/mcp.md` |
| Feedback | `FeedbackEvent`, `delivers` per action spec | `canvas.agent.action { eventId, expectedRevision, action: { kind, label, payload, targetIds?, delivery: immediate \| batched } }` → `AgentEvent` with `status: pending \| sent \| failed \| acked` and a `context` copy of the document; batched events leave with `canvas.agent.events.flush` |
| Agent connection | `connectedAgentId`, automatic injection | explicit `canvas.connect` from the UI (`DocumentView.connection`) chooses the feedback recipient; MCP callers are bound to a real agent and workspace, with injection **opt-in per workspace** (`canvas.injection`); connection is not a per-document access control |
| Catalog | JSON-Schema props, slots, three layers | own `revision`; block types declare typed `properties` (`text/number/boolean/json`) + `defaults` + optional `renderer`; templates are plain `blocks` + `groups`; mutations `type.put`, `template.put`, `pack.import`, `pack.remove` |
| Pack | `schema: "paseo-canvas.pack/1"` | `{ format: "paseo-canvas-pack", version: 1, id, name, description, blockTypes, templates, documents }`; `canvas.pack.import` supports `dryRun` and returns `{ diff, committed }` |
| History | inverse ops per actor class | `canvas.history` entries `{ id, revision, actor: user \| agent \| system, label, at, changed, removed, kind: edit \| undo \| redo }`; `UNDO_BLOCKED` when undo is unsafe |
| Errors | as §7 | same codes plus `UNAVAILABLE` |
| Built-in diagram | — | `diagram` block type (`nodes`, `edges`, `caption`); `block.update` replaces the arrays, enabling step-by-step teaching |

**Planned, not in v1** (must stay labelled as such in UI and docs): persisted links/connectors
between blocks, frame resizing, a server-side automatic layout engine, provenance labels,
`clientId` resolution and template slots, the in-conversation timeline card (D11), and everything
in §10 "future". The integration decisions in §2 otherwise stand; D10's attachment source and D11
are optional extras, not part of the verified v1. Section 0 overrides integration names and storage
proposals in sections 2–3 as well. See `plugin/server/tools.ts` for the current MCP names.

The interactive explainer (`architecture/index.html`) uses the as-built names throughout.

---

## 1. What the product is

A persistent canvas that sits next to an agent conversation. The agent builds and edits the canvas
through MCP tools; the user reads it, selects things, and acts on it; those selections and actions
flow back to the agent as structured context. The canvas is a *shared working surface*, not a
drawing tool: everything on it is a typed block the agent can read back and reason about.

Five ideas carry the design:

1. **Document** — one persistent canvas with a monotonic revision.
2. **Block** — a typed, self-describing unit of content.
3. **Group** — a first-class container with its own purpose, layout and instructions.
4. **Instructions** — text that tells the agent how to communicate through this canvas.
5. **Catalog** — the local library of block types, group templates and JSON packs.

Two flows connect them: **transactions** (agent or user → document) and **feedback**
(user → agent).

---

## 2. Integration decisions (Paseo 0.10.3)

Each decision names the installed API it relies on.

| # | Decision | Paseo API used | Why |
|---|----------|----------------|-----|
| D1 | Plugin ID `canvas`; manifest `requirements.paseo: ">=0.10.3 <0.11.0"`. MCP server name `paseo-canvas`. | `paseo-plugin.json` | Upper bound because 0.x minors break plugin APIs. |
| D2 | The canvas is a **workspace panel**, `context: "workspace"`, `locations: ["workspace"]`, id `canvas`. | `client.addWorkspacePanel` | A document belongs to a workspace and outlives any single agent. An agent-context panel would tie the tab to one agent ID. |
| D3 | The panel picks its **connected agent** itself (stored per document as `connectedAgentId`). | `useAgent`, `paseo.agents.list()` | The workspace panel gets no `agentId` prop. |
| D4 | Entry points: Command Center item "Open canvas" (workspace context) and a composer pill per agent that opens the panel. | `addCommandCenterItem`, `addComposerPill`, `client.openPanel("canvas", { workspaceId })` | Discoverable from where the conversation happens. |
| D5 | The daemon subprocess is the **single writer**. All state lives under `$PASEO_HOME/canvas/` (fallback `~/.paseo/canvas/`), written by tmp-file + `rename`. | `index.server.ts`, Node `fs` | Plugin settings documents are whole-document, host-scoped and meant for preferences; canvas documents need journals and per-document files. |
| D6 | MCP reaches agents through a **loopback HTTP bridge** in the subprocess plus a generated **stdio shim** script, injected with `server.before("agent.create")`. | `before("agent.create")` → `config.mcpServers`, `config.toolPolicy.preapproved`, `config.systemPrompt` | Same proven shape as the Theme Studio reference. stdio works across claude/codex/opencode; the bridge binds `127.0.0.1` on an ephemeral port with a random bearer token in a `0600` file. |
| D7 | Caller identity: each injected shim carries an **owner token** (env var set in `agent.create`, bound to the real `agentId` in `before("agent.session_open")` when `reason === "create"`). | `before("agent.session_open")` `request.env` / `request.agentId` | `agent.create` runs before the agent ID exists. **Open:** the daemon sets `PASEO_AGENT_ID` after hooks; if the provider passes it to stdio MCP children the shim should prefer it and skip the token dance. |
| D8 | Server → client updates use **revision polling** over plugin RPC (`canvas.doc.watch`, ~800 ms while the panel is focused, backing off when idle). | `defineRpc` / `useRpc` + TanStack Query `refetchInterval` | 0.10.3 has no plugin-owned push channel to clients. The RPC returns only `{ revision }` when nothing changed, so the cost is small. **Open:** a held (long-poll) RPC is a drop-in upgrade if request lifetimes allow it. |
| D9 | User actions reach the agent with `paseo.agents.ref(agentId).send(prompt, { messageId: eventId })` from the **server**. | `PluginHandlerContext.paseo` | Starts a real turn; `messageId` makes delivery idempotent. Runs on the daemon so it works from any client including mobile. |
| D10 | Selection does **not** start a turn. It is stored server-side and exposed three ways: `canvas_read_selection`, embedded in every action event, and a composer **attachment source** "Canvas selection". | `client.addAttachmentSource` + `defineAttachmentSource` | Selecting is cheap and frequent; a turn per click would be noise. The attachment source lets the user explicitly send "what I selected" with their own message. |
| D11 | Significant agent edits may post one **timeline card** per document ("Canvas updated · open"), replaced in place. | `agent.timeline.append({ type: "plugin", id: docId, kind: "canvas-update", version: 1 })` + `addTimelineRenderer` | Links the conversation to the canvas. Payload is a summary only (limit 64 KiB); never the document. |
| D12 | Never block agent startup: every hook catches its own errors and returns the unmodified request. | hook contract (a throwing `before` hook fails the operation) | A broken canvas must not stop agents from being created. |
| D13 | No DOM in client code. Pan/zoom uses React Native `PanResponder` + `Animated` transforms; wheel/keyboard are gated in `client/web.ts`. No `react-native-svg`. | Cross-platform rules | The host forbids DOM and SVG imports; connectors are drawn as rotated `View`s. |
| D14 | The plugin does not restart the daemon, install itself, or touch Tailscale. | project AGENTS.md | Coordinator-only. |

Rejected alternatives: **Paseo settings documents as storage** (single document, no journal,
last-write-wins by whole value); **`type: "http"` MCP entry pointing at the bridge** (the port
changes on every plugin reload while `mcpServers` is persisted in the agent config — the stdio shim
re-reads the endpoint file on each call, so reloads heal); **client-side agent messaging** (would
lose events when the app is backgrounded).

---

## 3. Runtime topology

```text
 Agent (claude/codex/opencode)
   │ stdio MCP
 canvas-mcp.cjs  (shim, generated; reads bridge.json per call)
   │ HTTP 127.0.0.1:<ephemeral>, Bearer token, x-canvas-owner
 ┌─────────────── plugin subprocess (index.server.ts) ───────────────┐
 │ Bridge → ToolRouter ─┐                                            │
 │ RPC handlers ────────┼→ CanvasService → Store (fs, single queue)  │
 │ Hooks (agent.create, │        │                                   │
 │  session_open,       │        ├→ Catalog (types, templates, packs)│
 │  agent.archived)     │        └→ FeedbackDispatcher → paseo SDK   │
 └──────────────────────┴────────────────────────────────────────────┘
   ▲ plugin RPC (zod-validated, both directions)
 Paseo app — plugin client (index.client.tsx)
   workspace panel `canvas` · command item · composer pill · attachment source · timeline renderer
```

One `CanvasService` serves both doors. MCP tools and UI RPCs **must** call the same service
methods so that a user drag and an agent edit are the same kind of transaction.

Suggested module split (backend engineer decides final names):

```text
plugin/shared/   model.ts  ops.ts  rpc.ts  pack.ts  events.ts  errors.ts
plugin/server/   store.ts  service.ts  reducer.ts  history.ts  catalog.ts  packs.ts
                 bridge.ts  bridge-source.ts  tools.ts  agent-integration.ts  feedback.ts
plugin/client/   panel.tsx  canvas/…  inspector/…  catalog/…  web.ts
```

`shared/` holds Zod schemas and the **pure reducer inputs** (op types). The reducer itself may
live in `shared/` if the frontend wants optimistic application; it must stay free of Node imports.

---

## 4. Data model

All IDs are opaque strings generated by the server (`doc_`, `blk_`, `grp_`, `txn_`, `evt_`
prefixes + random base36). Clients and agents may supply a **`clientId`** in create ops; the
transaction result maps `clientId → id`. Agents can then create a group and its children in one
transaction.

```ts
interface CanvasDocument {
  schema: "paseo-canvas.document/1";
  id: string;
  workspaceId: string;
  title: string;
  revision: number;               // +1 per committed transaction, never reused
  createdAt: string; updatedAt: string;
  example?: { label: string };    // present on shipped example docs → UI must badge them
  connectedAgentId: string | null;
  instructions: Instructions;     // document-level communication instructions
  blocks: Record<string, Block>;
  groups: Record<string, Group>;
  rootOrder: string[];            // ids (blocks or groups) at top level, back-to-front
  links: Record<string, Link>;    // optional connectors between blocks/groups
}

interface Block {
  id: string;
  type: string;                   // catalog key, e.g. "core/note", "learn/quiz"
  typeVersion: number;
  title?: string;
  props: Record<string, JsonValue>;   // validated against the block type's schema
  frame: { x: number; y: number; w: number; h: number };  // canvas units; relative to parent group
  parentGroupId: string | null;
  instructions?: Instructions;
  state?: Record<string, JsonValue>;  // user-mutable runtime state (answers, toggles)
  meta: Provenance;
}

interface Group {
  id: string;
  title: string;
  purpose: string;                // one sentence the agent reads: why this group exists
  layout: { mode: "free" | "stack" | "grid" | "flow"; gap?: number; columns?: number };
  frame: { x: number; y: number; w: number; h: number };
  parentGroupId: string | null;   // nesting allowed, max depth 4
  childOrder: string[];           // blocks and groups, in reading order
  templateId?: string;            // catalog template this came from
  collapsed: boolean;
  locked: boolean;                // agent edits allowed, user drag disabled
  instructions?: Instructions;
  meta: Provenance;
}

interface Link { id: string; from: string; to: string; label?: string; kind: "flow" | "reference" }

interface Instructions {
  text: string;                   // markdown, ≤ 4 000 chars per level
  onAction?: "respond" | "update-canvas" | "silent";  // default expectation for feedback
  updatedBy: Actor; updatedAt: string;
}

type Actor = { kind: "agent"; agentId: string } | { kind: "user" } | { kind: "system" };
interface Provenance { createdBy: Actor; createdAt: string; updatedBy: Actor; updatedAt: string;
                       sourcePack?: string }
```

### Why groups are first-class

A group is not a selection rectangle. It **must**:

- own its children (`childOrder`), so reading order is defined without geometry;
- carry `purpose` and `instructions`, so the agent can read *one group* and know what it is for;
- lay out children itself in `stack | grid | flow` modes — the agent supplies content, not
  coordinates; `free` keeps manual frames;
- be addressable in every tool (`read`, `update`, `move`, `duplicate`, `delete`, `export as template`);
- move, collapse, duplicate and delete as a unit; deleting a group deletes its subtree unless the
  op says `ungroup: true`.

Invariants the reducer **must** enforce: an entity has exactly one parent; no cycles; every id in
`childOrder`/`rootOrder` exists and appears once; depth ≤ 4; a `Link` endpoint exists.

### Instructions (communication instructions)

Three levels — document, group, block — resolved **most-specific first** and *concatenated*, not
overridden, when the agent reads an entity (`effectiveInstructions`). They answer "how should the
agent use this surface with this user": tone, what to do when a block is selected, whether an
action expects a chat reply or a canvas update. The static MCP usage guidance (how tools work) is
separate and lives in the injected system prompt.

---

## 5. Catalog, templates and packs

```ts
interface BlockType {
  key: string;                    // "<namespace>/<name>"
  version: number;
  title: string; description: string; icon: string;   // Lucide name
  renderer: string;               // one of the built-in renderer ids (see below)
  propsSchema: JsonSchemaSubset;  // validated server-side; drives the inspector form
  defaultProps: Record<string, JsonValue>;
  defaultSize: { w: number; h: number };
  actions: BlockActionSpec[];     // declared user actions → feedback events
  agentHint: string;              // when to use it; returned by canvas_catalog
}
interface BlockActionSpec { id: string; label: string; kind: "button" | "submit" | "choice" | "toggle";
                            delivers: "immediate" | "batched" | "state-only" }

interface GroupTemplate {
  key: string; version: number; title: string; description: string;
  slots: { name: string; description: string; required: boolean }[];
  build: TemplateNode;            // group + children tree with {{slot}} placeholders in props
  agentHint: string;
}

interface CanvasPack {
  schema: "paseo-canvas.pack/1";
  id: string; version: string; title: string; description: string; author?: string;
  blockTypes: BlockType[]; groupTemplates: GroupTemplate[];
  examples?: { title: string; label: string; document: Omit<CanvasDocument, "id" | "workspaceId" | "revision"> }[];
}
```

Decisions:

- **Packs are data, never code.** A pack block type selects one of a fixed set of built-in
  *renderers* (`text`, `note`, `code`, `checklist`, `choice`, `form`, `metric`, `image-ref`,
  `step`, `callout`, `preview-frame`, `quiz`, `progress`) and configures it with props. This is what
  makes JSON import safe and removes any build step. New renderers ship with the plugin.
- Catalog layers, later wins on key collision: **built-in** (`core/*`, shipped in `shared/`) →
  **installed packs** (`$PASEO_HOME/canvas/packs/<id>.json`) → **local** user-saved types and
  templates (`…/catalog/local.json`).
- **Import** validates the whole pack (schema, key namespace = pack id, size ≤ 1 MiB, ≤ 200
  entries), reports a diff (`added / replaced / unchanged`) and commits atomically; a `dryRun` flag
  returns the diff only. Import never touches existing documents: blocks keep their `typeVersion`;
  a missing type renders the "unknown block" state with raw props preserved.
- **Export** produces a pack from a selection of local types/templates, or turns an existing group
  into a template (`canvas_group` with `saveAsTemplate`).
- Two example packs ship as built-ins and install their example documents on demand, both badged
  `example`: **`frontend`** (screen spec, component tree, states, preview frame, review checklist)
  and **`learn`** (progressive-learning: concept → worked example → quiz → recap, with reveal steps).

---

## 6. Transactions, revisions, undo

**Every mutation is a transaction.** There is no other write path.

```ts
interface TransactionRequest {
  docId: string;
  expectedRevision: number;       // required; -1 is rejected, there is no "force"
  label: string;                  // human sentence, shown in history: "Add onboarding flow"
  ops: Op[];                      // 1..200, applied in order, all-or-nothing
}
type Op =
  | { op: "block.create"; clientId?: string; type: string; props?; frame?; parentGroupId?; index?; title?; instructions? }
  | { op: "block.update"; id: string; props?: JsonPatchMerge; title?; frame?; instructions? }
  | { op: "block.setState"; id: string; state: JsonPatchMerge }
  | { op: "group.create"; clientId?: string; title; purpose; layout?; frame?; parentGroupId?; childIds?: string[]; index? }
  | { op: "group.update"; id: string; title?; purpose?; layout?; frame?; collapsed?; locked?; instructions? }
  | { op: "group.insertTemplate"; clientId?: string; template: string; slots: Record<string, JsonValue>; parentGroupId?; frame? }
  | { op: "entity.move"; id: string; parentGroupId: string | null; index?: number; frame? }
  | { op: "entity.delete"; id: string; ungroup?: boolean }
  | { op: "entity.duplicate"; id: string; clientId?: string }
  | { op: "link.create" | "link.delete"; … }
  | { op: "doc.update"; title?; instructions?; connectedAgentId? };

interface TransactionResult {
  docId: string; revision: number; transactionId: string;
  created: Record<string /*clientId*/, string /*id*/>;
  changed: string[]; removed: string[];
  warnings: string[];             // e.g. "frame ignored: parent group uses stack layout"
}
```

Rules:

- `props` updates are **merge patches** (RFC 7396 semantics); arrays replace whole. Props are
  validated against the block type after merging.
- Ops inside one transaction may reference earlier `clientId`s wherever an id is accepted.
- The reducer is pure: `(document, ops, actor, now) → { document, inverseOps, summary }`. It is the
  single place invariants live and the thing to unit-test hardest.
- **Conflict**: `expectedRevision !== doc.revision` → error `REVISION_CONFLICT` (HTTP 409 on the
  bridge) carrying `{ currentRevision, changedSince: string[], removedSince: string[] }` computed
  from the journal. Nothing is applied. The caller re-reads (ideally only `changedSince`) and
  retries. The MCP tool result text must tell the agent exactly that.
- **UI gestures** (drag, resize) send one transaction at gesture end, never per frame. The client
  may apply optimistically and roll back on conflict; on conflict caused only by entities the
  gesture did not touch, the client should transparently rebase and retry once.
- **Undo** never rewinds history. `canvas_undo` appends a new transaction whose ops are the stored
  `inverseOps` of the target, marked `undoes: <txnId>`. Redo is the inverse of that. v1 scope:
  linear — undo targets the most recent not-yet-undone transaction **by the same actor class**
  (user undo does not silently revert the agent's work, and vice versa) and fails with
  `UNDO_BLOCKED` if a later transaction by anyone touched the same entities.
- Feedback events and selection changes are **not** transactions and do not bump `revision`
  (selection has its own `selectionVersion`). `block.setState` *is* a transaction (it is content).

### Persistence layout

```text
$PASEO_HOME/canvas/
  bridge.json                       { port, token }            0600, rewritten each start
  canvas-mcp.cjs                    generated stdio shim       0600
  owners/<token>.json               owner token → agentId
  documents/<docId>/document.json   current snapshot
  documents/<docId>/journal.ndjson  one line per transaction: { id, revision, at, actor, label,
                                    ops, inverseOps, changed, removed, undoes? }
  documents/<docId>/runtime.json    selection, pending feedback events (not revisioned)
  index.json                        doc list per workspace
  catalog/local.json  packs/<id>.json
```

Write order per transaction: append journal line → write `document.json.tmp` → `rename`. On load,
if the journal's last revision is ahead of the snapshot, replay the tail. Journal is capped (keep
last 500 transactions; older lines are dropped and become non-undoable). All writes go through one
in-process promise queue per document.

---

## 7. MCP surface (guidance for `docs/mcp.md`)

The backend engineer owns exact schemas. The contract here is the **shape and behaviour**.
Tool names are prefixed `canvas_`. All read tools return `revision`; all write tools require
`expectedRevision` and return the `TransactionResult`.

| Tool | Purpose | Notes |
|------|---------|-------|
| `canvas_list` | Documents in the caller's workspace | Marks the one whose `connectedAgentId` is the caller. |
| `canvas_create` | Create a document (optionally from an example or with initial ops) | Sets `connectedAgentId` to the caller when free. |
| `canvas_read` | Read a document | `view: "outline"` (default: tree of ids, types, titles, purposes — cheap) \| `"full"`; `ids: []` to read specific entities with `effectiveInstructions`; `sinceRevision` for a delta. |
| `canvas_apply` | **The** transactional write: `{ docId, expectedRevision, label, ops[] }` | Create/update/move/delete blocks and groups, set instructions. |
| `canvas_group` | Convenience over `canvas_apply`: group existing ids, insert a template with slots, ungroup, save a group as template | Exists because grouping is the operation agents get wrong with raw ops. |
| `canvas_catalog` | `action: list \| read \| import_pack \| export_pack \| save_type \| save_template \| remove_pack` | `list` returns keys + `agentHint` only; `read` returns the schema. |
| `canvas_selection` | Current user selection with resolved entities and instructions | Never starts a turn. |
| `canvas_events` | Pending/recent user feedback events; `ack: [eventId]` | Lets an agent pull batched events and confirms handling. |
| `canvas_history` | Recent transactions (`label`, actor, changed ids) | For orientation and before undo. |
| `canvas_undo` / `canvas_redo` | As in §6 | Requires `expectedRevision`. |

Requirements:

- **Preapproval**: read tools and `canvas_apply`/`canvas_group`/`canvas_undo` are added to
  `toolPolicy.preapproved`. `canvas_catalog` with `import_pack`/`remove_pack` is **not**
  preapproved (it changes the shared library).
- **Scope**: a caller may only touch documents of its own workspace (resolve via the SDK from the
  bound `agentId`). Unknown caller → read-only refusal with an actionable message.
- **Errors** are structured and stable: `REVISION_CONFLICT`, `NOT_FOUND`, `VALIDATION` (with a path
  and the expected shape), `INVARIANT` (cycle, depth), `UNKNOWN_TYPE` (with nearest catalog keys),
  `UNDO_BLOCKED`, `FORBIDDEN`, `TOO_LARGE`. Bridge HTTP status: 409 / 404 / 400 / 422 / 403 / 413.
- **Result size**: tool results ≤ ~24 KiB of text; `canvas_read full` on a large doc must truncate
  with a clear "read by ids" hint rather than overflow the agent's context.
- **System prompt block** (marker `[Paseo Canvas]`, appended once, idempotent): what the canvas is,
  read-outline-first, always pass `expectedRevision`, prefer templates and layout groups over
  coordinates, never claim canvas content the tools did not confirm, how feedback events arrive.
  Keep it under ~900 characters; details belong in tool descriptions.
- Do not inject into `config.internal` agents or unsupported providers; preserve a user-defined
  `mcpServers["paseo-canvas"]` that differs from the managed one.

---

## 8. Selection and user feedback

Two channels with different costs.

**Selection (ambient, no turn).** The client reports `{ docId, ids[], selectionVersion }` through
RPC `canvas.selection.set` (debounced ~250 ms). The server stores it in `runtime.json`. The UI
shows a persistent "context the agent can see" chip listing the selection, so the user knows what
is shared. The agent reads it with `canvas_selection`; the user can attach it to their own message
through the "Canvas selection" attachment source (its `text` is a compact rendering: titles, types,
key props, effective instructions).

**Actions (explicit, may start a turn).** Anything the user does that is meant for the agent:
pressing a block's declared action, submitting a form/quiz, "Ask about selection", "Send feedback"
with a free-text note, approving/rejecting a proposal block.

```ts
interface FeedbackEvent {
  id: string;                     // evt_…, also used as messageId
  docId: string; revisionAtEvent: number; occurredAt: string;
  kind: "block.action" | "selection.ask" | "note" | "group.action";
  targetIds: string[]; actionId?: string;
  payload: Record<string, JsonValue>;   // form values, chosen option, note text
  selection: string[];                  // selection at the time
  status: "pending" | "delivered" | "failed" | "acked";
  deliveredToAgentId?: string; error?: string;
}
```

Delivery rules (`FeedbackDispatcher`, server-side):

- `delivers: "state-only"` → only a `block.setState` transaction; no event.
- `"immediate"` → persist event, then `agents.ref(connectedAgentId).send(prompt, { messageId: evt.id })`.
- `"batched"` → persist; flushed together when the user presses **Send to agent** or after an
  immediate event (so the agent sees the whole picture in one turn).
- If the agent is `running`, events queue and flush on `agent.turn_ended` (hook), collapsed into one
  message. If there is **no connected agent**, the event stays `pending` and the UI says so — the
  UI must never show an action as delivered when it was not.
- The prompt is short, in plain language, and ends with one fenced JSON object
  `{ "type": "canvas.feedback", events: [...] }` including resolved titles/types of targets and the
  effective instructions' `onAction`. It states that the JSON is user interaction data, not
  instructions. Hard cap 8 KiB; larger payloads are referenced by id and read via `canvas_events`.
- The agent acknowledges by `canvas_events { ack }` or implicitly by its next `canvas_apply`
  in the same turn. Status is visible on the block ("sent · agent responding · done / failed").
- Honesty rule from AGENTS.md: the client renders agent activity only from real signals
  (`useAgent(...).status`, real transactions). No simulated typing, no fake "done".

---

## 9. Client contract (for the frontend engineer; visuals come from `docs/design.md`)

Plugin RPCs (`shared/rpc.ts`, names start `canvas.`): `doc.list`, `doc.create`, `doc.read`,
`doc.watch` (`{ docId, knownRevision, knownSelectionVersion }` → `{ revision }` or full delta),
`doc.apply` (same `TransactionRequest`, actor = user), `doc.undo`, `doc.redo`, `doc.history`,
`doc.delete`, `selection.set`, `feedback.send`, `feedback.list`, `catalog.read`, `pack.import`
(`dryRun`), `pack.export`, `examples.install`, `agent.setup` (manual MCP config snippet for
pre-existing agents).

State model: TanStack Query cache keyed by `["canvas", docId]` holds the server snapshot; a local
overlay holds in-flight gestures. Required UI states: no document (empty, offers examples —
clearly labelled *example data*), loading, load error with retry, conflict toast with "reloaded
latest", unknown block type, no connected agent, agent offline/closed, feedback pending/failed.
Keyboard (web): arrows nudge, `Cmd/Ctrl+G` group, `Cmd/Ctrl+Z` undo, `Esc` clear selection,
`Tab` cycles in reading order (group `childOrder`). Compact layout: canvas becomes a vertical
outline of groups (reading order is defined by the model, so no geometry is needed); inspector and
catalog become modals (`Modal` from `@getpaseo/plugin/client/react-native`).

---

## 10. Multiplayer: what is real today, what is future

**Today (v1, real):**

- Several Paseo clients (desktop, browser, phone) connected to the same daemon see the same
  document, because the daemon is the single source of truth and each client polls revisions.
- Several agents in the workspace can read and write the same document; each write is serialized
  and revision-checked. One agent is the *connected* agent that receives feedback.
- Concurrency control is **optimistic, whole-document revision**. A stale writer gets
  `REVISION_CONFLICT` and retries. Nothing is merged automatically.
- Latency is the poll interval (~1 s), not real time.

**Not built (future, must not be implied by UI or docs):**

- Presence, live cursors, per-user selections, "X is editing" indicators.
- Per-entity or CRDT merging of concurrent edits; offline editing.
- Server-pushed updates (needs a Paseo plugin push channel that 0.10.3 lacks).
- Per-user identity and permissions — Paseo settings/plugin scope is per *host*; the plugin cannot
  tell two human users of one daemon apart, so `Actor` is just `user`.
- Cross-host sync.

The data model keeps the door open: `Actor` is a union that can gain `userId`, transactions are an
ordered op log (rebase-able), and selection is already stored separately from content.

---

## 11. Validation checklist

Backend tests (headless, `pnpm test`) **must** cover: reducer invariants (cycles, depth, orphan
ids); transaction atomicity (op 3 of 5 fails → nothing changes, revision unchanged); conflict
payload (`changedSince`); undo/redo round trip equals original snapshot; `UNDO_BLOCKED`; crash
recovery (journal ahead of snapshot); template insertion with slots and `clientId` mapping; group
delete vs ungroup; pack import dry-run, collision, oversize, and export→import round trip; unknown
block type survives a round trip; MCP bridge auth (missing/wrong token), scope (other workspace),
and conflict → 409; feedback delivery states including no agent and queued-while-running; hooks
return the original request on internal failure.

## 12. Open points (owner: backend engineer, report back)

1. Does the provider expose `PASEO_AGENT_ID` to stdio MCP children? (D7)
2. Maximum practical RPC hold time for long-poll `doc.watch`. (D8)
3. `agents.ref().send()` behaviour while the agent is `running` (queue vs reject) — the
   dispatcher assumes it must queue itself.
4. Whether `mcpServers` injected at create survive `resume`/`import` for all three providers; if
   not, `agent.setup` RPC is the manual path.

---

## 13. v1.1 — Graph canvas (contract, in implementation)

**Why.** Agents currently produce one tall column of groups filled with prose notes ("un chorizo
largo", see `/tmp/lienzo-chorizo-current.png`). The user wants documents that read as a **spatial
graph**: compact node cards laid out in two dimensions and joined by connectors, with groups as
dashed regions around related nodes (reference: `/tmp/lienzo-graph-reference.png`). The in-block
`diagram` type stays, but the canvas itself becomes the diagram.

This promotes "persisted links" from §0's planned list into the product. Everything else in §0
still holds. `plugin/shared/model.ts` remains authoritative once it lands; this section is the
contract the backend and frontend implement against.

### 13.1 Model additions (all optional or defaulted — stored v1 documents must still parse)

```ts
linkSchema = { id: idSchema, from: idSchema, to: idSchema,          // endpoints: any block or group id
               label?: string (≤200),
               kind: "flow" | "depends" | "reference" (default "flow"),
               tone?: "neutro" | "acento" | "violeta" | "turquesa" | "aviso" | "peligro" }  // strict
documentContentSchema += links: linkSchema[] (max 2000, default [])
documentContentSchema += layout?: layoutSchema          // how root-level entities are arranged
layoutSchema.mode    += "graph"                         // free | stack | grid | flow | graph
layoutSchema         += direction?: "down" | "right"    // graph only; default "down"
templateSchema       += links: linkSchema[] (default [])
blockTypeSchema.renderer += "node"
```

New built-in block type **`node`** (renderer `node`): the compact card of the reference image.
Properties: `kind` (text, short eyebrow such as MODULE / SERVICE / STEP), `status` (text, short
chip such as ready / draft / blocked), `summary` (text, one or two lines), `details` (text, longer
body shown only when the node is selected/expanded). All optional except the block `title`.

Operations (added to `operationSchema`):

```ts
{ type: "link.create", link }            { type: "link.update", id, patch }       { type: "link.delete", id }
{ type: "document.update", …, layout? }   // existing op gains the optional layout field
```

Invariants (reducer): link ids unique; both endpoints exist; `from !== to`; no duplicate
`(from, to, kind)` triple. Deleting a block or group (including a subtree) removes every link that
touches a removed entity, in the same transaction. `entity.duplicate` and `template.insert` remap
link ids and endpoints with the same `idPrefix`, keeping only links whose two endpoints are inside
the copied set. `canvas.group.export` includes the links internal to the exported subtree. Packs
round-trip links. Undo/redo restores them. History `changed`/`removed` may contain link ids.

### 13.2 Layout semantics (client-side, nothing persisted)

- A container (the document root or a group) in mode `graph` — or with **no explicit mode but at
  least one link between its direct children** — is laid out as a layered graph: longest-path
  layering along `direction`, ordering inside a layer to reduce crossings, siblings without links
  packed in rows after the graph (never one endless column). Root default when there are no links
  and no positions: wrap into rows by available width instead of a single column.
- An entity with an explicit `position` keeps it (existing free-position rule), and the existing
  overlap resolution still applies afterwards.
- A link whose endpoints live in different groups is drawn between the visible ancestors; a link
  to something inside a collapsed group attaches to that group's frame.

### 13.3 Interaction and rendering (visual decisions belong to the Opus designer)

Curved connectors with arrowheads, colour by `kind`/`tone`; hovering or selecting a node highlights
its links and neighbours and dims the rest; parallel links between the same pair are bundled with a
count; link label on the path. React Native has no SVG in the host: on web the connector layer may
be a DOM `<svg>` created only inside `plugin/client/web.ts`; native falls back to elbow segments
built from `View`s. The person can create a link by dragging from a node handle to another node,
select a link, relabel it and delete it; all through `canvas.mutate`.

### 13.4 Agent guidance

`integrationInstructions` and the tool descriptions must steer agents away from the tall column:
model systems, flows and explanations as `node` blocks joined by links, grouped by area with
`layout.mode: "graph"`; keep text in `summary`/`details` or a single short note; never stack more
than a few prose notes; reserve the in-block `diagram` for small self-contained figures. Ship one
example document in a built-in pack that demonstrates this style (labelled example).
