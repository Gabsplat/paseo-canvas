# Lienzo frontend

The native Paseo plugin entry is `plugin/index.client.tsx`. It registers the workspace
and Explorer panel as **canvas**, titled **Lienzo**. The Command Center action is
"Abrir Lienzo", and `/lienzo` opens that same panel. Both opening paths call
`openPanel("canvas")`. The contributed Papel and Tinta themes are optional and are
not activated by the plugin.

All client imports use Paseo 0.10.3 host modules. Dialogs import the `Modal` wrapper
from `client/ui.tsx`: it retains the SDK props and static `Content` component, and
inserts an explicit UI provider inside the content children for compact sheet
portals. The controller is passed through; opening a sheet creates no extra
`useCanvas` instance or RPC subscription. Shared RPC identifiers are imported
from `shared/rpc.ts`, including the corrected `agentAction`, `readAgentEvents`, and
`flushAgentEvents` contracts. No endpoint strings are duplicated in client code.
The token transcription in `client/tokens.ts` comes from the Opus v2 design. No client
runtime import crosses into `design/`, `architecture/`, or `server/`.

## Working with a document

Create or open a document from the title switcher. The two shipped packs can create
the frontend review and progressive learning examples. Example documents retain
their EJEMPLO labels; duplicating as your own document clears the example flag on
the new copy. An empty canvas offers the local block and template catalog.
The last successfully opened document is remembered for this process session,
scoped to the Paseo host ID and workspace. A compact-navigation remount restores
that ID only when it is present in the freshly fetched document list; removed or
unavailable IDs are forgotten. A full client reload can reset this session memory.

The free canvas supports background drag to pan, zoom controls, fit, and browser
wheel pan or Ctrl/Command wheel zoom. First open centres content horizontally at
80–100% scale with its top at 48 px; Ajustar al lienzo still fits all content.
Cards use their measured content heights.
Root items and children of free groups drag by their headers. Children in stack,
grid, or flow groups use Subir/Bajar or the inspector's parent chooser. Compact
clients default to Esquema and support pan/zoom but do not drag cards. Group movement
uses parent-relative persisted positions; collapse hides descendants and preserves
their membership. Frame resizing is not part of the shared model.

Click or tap a header to select. Shift/Command clicking, or long pressing followed
by tapping, selects several entities. Selection calls `setSelection`, with its
separate selection version, and never sends an agent message. Grouping and deletion
operate on the highest selected ancestors so selecting a group and its child does
not delete the same subtree twice.

The inspector edits real typed properties and the communication keys `intent`,
`audience`, and `instructions`. Fields commit after 600 ms idle or on blur, show
pending and failed feedback, preserve rejected drafts, and offer retry. Block and
group instructions display two-line inherited previews from nearest ancestor to document;
pressing a row selects that level. Vaciar instrucción clears all three keys in one
undoable edit. The shared update contracts cannot remove the communication object;
all-empty fields are treated as absent by the editor, markers, and inherited list.

Document edits are transactions with the current revision. A rejected revision
reloads the latest document before showing the retained failure. Reapplying submits
the same operations against the fresh revision. Undo and redo use the backend's real
availability and history, including its conflict checks. An unrelated successful
edit does not dismiss another edit's conflict. A failed watch disables writes and
retains the readable document. `watchDocument` and agent events poll every 1.5 seconds
without overlapping poll requests. Scope guards discard late results after opening
another document or changing workspace.

## Actual actions and agents

Use the agent dialog to choose an existing agent in the workspace. It shows the
current agent title, provider, selectable ID, and a selected option row. Lifecycle
statuses have Spanish labels. Connecting
selects the recipient of UI feedback. Workspace tool authorization is separate;
injection enables tools for new agents in that workspace. Existing-agent setup
returns a provider configuration snippet and instructions. Copy uses the raw
configuration text. The plugin never edits provider configuration or reloads agents.

Explicit sends use a generated event ID retained for retry:

| Control | Action | Delivery |
| --- | --- | --- |
| Enviar al agente | `selection.send`, selection IDs and note | Immediate |
| Enviar respuesta | `block.answer`, answer and block ID | Immediate |
| Form Enviar | `block.submit`, committed typed values and block ID | Immediate |
| Preguntar por este paso | `diagram.step`, node ID, label, block ID | Immediate |
| Ver pista | `block.hint`, block ID | Batched |

Checklist toggles, text edits, dragging, collapse, and selection only persist data.
Form submission waits for previous edits, commits all current typed field values,
then sends the values returned by that committed view. Boolean fields use native
checkbox controls. Pending, sent, acknowledged, and failed labels come from returned
or polled `AgentEvent.status`. A request in flight says Enviando. The UI does not
invent a reply, teaching result, or agent activity. Failed persisted deliveries use
the backend flush path instead of generating a duplicate event.

## Catalog and portable packs

Catalog types and group templates are actual local records. Define a type using its
declarative JSON properties and defaults. Saving a group as a template first calls
`exportGroup`, then stores that returned template with `template.put`; the export
RPC itself does not save it. Inserting a template uses a fresh ID prefix.

Paste JSON on every platform. Browsers also offer Elegir archivo with a 1 MiB limit.
Revisar runs the real validator and a noncommitting dry run against a freshly read
catalog revision. The review lists every added and replaced ID in a scrollable
area; only unchanged IDs collapse to a count. Replacing an existing pack requires
the explicit checkbox and explains why the import button remains disabled;
commit uses the reviewed revision and shows a real conflict if the catalog changed.

Custom pack export retains its namespace and roundtrips through import. Shipped
packs `frontend` and `learn` have protected IDs. Their export dialog defaults to a
portable copy with a fresh pack namespace, remapped type/template definitions and
references, and unchanged example labels. The original JSON remains available as
a clearly labeled protected reference that cannot be imported directly. JSON
downloads run only in the browser. Native clients use Paseo `copyText` and selectable
text as the fallback, with no clipboard-read permission or simulated file download.

When dropping a positioned root into an absent-layout group whose existing children
have no positions, the client persists the group's existing stack intent in the
same transaction. This prevents retained root coordinates from changing the target
to an inferred free layout. Explicit stack/grid/flow layouts are preserved, and
dragging never silently converts an automatic layout to free.

## Diagrams, previews, and references

Diagram data is parsed with `diagramDataSchema`. A pure layout function derives
stable layers, fixed 136 × 44 node cards, orthogonal connectors, rail routes for
skipped/back edges, and arrowheads. Labeled diagrams use a 48 px row gap; next-row
labels sit below the horizontal run, centred on their target with a 136 px limit.
Unlabeled diagrams retain a 40 px gap. Explicit positions are normalized. Narrow
contexts or more than 30 nodes use a connected list. Node arrays and edge arrays
render from each real update. The last newly added node becomes current; tapping a
node or the stepper changes the client view. Todo shows all nodes; Paso a paso keeps
later nodes as unlabeled ghosts. The detail shows descriptions and outgoing edges.
Asking about a step is an explicit real action. Invalid data remains readable and
cannot crash the canvas.

`preview` blocks with a valid URL embed that actual URL on the web with the
Opus-specified `allow-scripts allow-forms` sandbox. A selection overlay covers the
frame until the card is selected; then the page can receive interaction. The
external-open action always remains available. Slow or blocked embeds get the
eight-second explanatory hint. A browser can reject framing or mixed HTTP content;
use the actual external link in that case. Native clients show a labeled browser
fallback. No-URL blocks are dashed conceptual references, not live-app mockups.

`media` images use React Native Image with an error fallback. Audio, video, and other
references are links and never autoplay. `safeUrl` accepts only HTTP/HTTPS without
embedded credentials. Executable URLs, inline HTML, and data URLs are rejected.
Radio and checkbox rings use the approved foreground-muted alpha for visibility
under foreign themes. Browser focus rings follow Tab/arrow keyboard input and clear
on pointer input, including an already focused control; native controls do not
show the keyboard focus ring. All browser DOM access is isolated in `client/web.ts`,
with narrow host interfaces
and no DOM library in the TypeScript configuration.

## Verification

Run with pnpm:

```sh
pnpm exec tsc --noEmit -p plugin/client/tsconfig.json
pnpm exec tsc --noEmit -p tests/tsconfig.json
pnpm exec tsx --test tests/frontend.test.ts
```

The frontend checks cover layered/progressive diagrams, cycles and unclipped rails,
session restoration and host/workspace isolation, fan-out label separation,
readable initial camera framing, renderer widths,
stack/grid/flow and collapse geometry, group-drop layout preservation,
typed form conversions, safe URLs, subtree selection, empty communication inheritance,
portable pack forks, and real
RPC-parser/service transactions preserving nested groups during rename/collapse/layout
and undo. Native visual and interaction QA belongs to the coordinator's installed
plugin run through omabox. These headless checks do not claim that screenshots or
live agent delivery have already been exercised.

The panel integrator owns `client/Panel.tsx` and `docs/frontend-integration.md`.
`Catalog.initialTab` accepts `types`, `templates`, or `packs`.
`Inspector.initialSection` accepts `document`, `communication`, `history`, or
`activity`; a remount key can repeat a same-section navigation request. Existing
component props remain compatible. `useCanvas.settle()` waits for edits and selection
to finish and rejects if the document scope changes.
