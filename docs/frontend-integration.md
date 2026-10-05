# Native panel integration

`plugin/client/Panel.tsx` exports `LienzoPanel` with the installed Paseo 0.10.3
`PluginWorkspacePanelProps` contract. The existing client entry registers it as
workspace panel `canvas`, titled Lienzo. The panel borrows the host's theme,
layout and connection through `UIProvider`, `useAgent` and `useCanvas`. It imports
only host-provided React Native UI and local modules. Browser operations remain
in the frontend owner's guarded `web.ts` helpers.

## Layout and navigation

The root measures its width with `onLayout`. At 980 or more, when the host is not
compact, the catalog is a toggled 288 px rail and the inspector is a permanent
328 px rail. Below that width the rails become mutually exclusive overlays,
positioned below the measured top bar. Compact hosts start in Esquema and use
SDK modal sheets for the catalog and inspector. Selecting a block or group never
opens an inspector automatically or starts an agent turn.
The compact view toggle is 168 px wide so Esquema fits. The compact inspector
uses the SDK sheet's header and close control; only the medium overlay supplies
an Inspector `onClose` callback.

Installed-plugin QA found that the compact inspector modal could lose Lienzo's
local UI context and throw `Lienzo UI context unavailable`. Panel modals now
import `Modal` from `./ui` instead of importing the SDK modal directly. The
frontend-owned wrapper captures theme, layout and host before the portal, then
places an explicit `UIProvider` inside each direct SDK `Modal.Content` child's
body. It preserves the real SDK Content component, its props and layout. The
panel's modal content and behavior otherwise stay unchanged. Root owns reload
and GUI verification of this correction.

The document picker opens existing documents, creates documents with title and
communication instructions, instantiates the labelled frontend and learning
examples, and duplicates a document as a personal copy. Example markers follow
the persisted `example` flag. Pack documents remain labelled as examples when
instantiated. Document rows show their actual revision and relative update time.
No-document example entries pair the example chip and the stored title in one
left-aligned row. The title is a ghost press target and receives no added prefix.

Revision presses open document Historial. Queue-chip presses open Actividad.
Communication opens its own inspector section. Repeated requests remount the
inspector with `initialSection`, so its native scroll anchors run again. Empty
document actions use Catalog `initialTab` to open Bloques or Plantillas;
unknown-type actions open Packs. Compact Más acciones contains undo, redo,
document navigation, catalog, communication, agent connection, activity and
selection operations.

## Persistence and callbacks

Panel edits use `controller.edit` and the shared operation contracts. Grouping
uses one `group.create` transaction; the reducer attaches the selected blocks
and groups and synchronizes their parent links. The panel filters selected
descendants with `topSelection` before grouping, duplicating or deleting.
Reordering updates the parent's ordered `blockIds` or `groupIds`. Reparenting and
keyboard nudges use the frontend owner's `moveOperations`, preserving the
resolved stack intent of a group whose layout was absent.

Catalog insertion creates a block from the type's actual defaults. A single
selected group receives the block; otherwise insertion uses the reported canvas
center. Template insertion and placement use one edit transaction. Templates
with 200 or more root entities use their stored positions or the unplaced shelf
to stay within the backend's 200-operation transaction limit. Group duplication,
ungrouping, collapse, delete, property editing and communication editing also
remain available through the integrated Canvas and Inspector helpers.

Guardar como plantilla exports the real group subtree with `exportGroup`, then
saves it with `catalogMutate` and `template.put`. The catalog revision is read at
execution. Retry retains the template ID; successful persistence opens
Plantillas. Pack import and export use the frontend owner's PackImport and
PackExport modals and their shared RPCs. Document export builds a portable data
pack from the loaded document and catalog, then uses the same export modal.

## Feedback and connection

Presence reads the saved document connection and a real `useAgent` snapshot.
Missing snapshots show an unavailable agent with a neutral status dot. The
AgentModal owns connection changes, opt-in injection and the private setup helper.
Connecting never activates a theme. A reload notice appears only when the helper
reports `requiresReload`.

An explicit tray send captures the selected target IDs, note and one event ID.
It waits for `controller.settle()` before calling `agentAction`. A transport or
revision retry reuses that ID and payload. A persisted failed event uses
`flushAgentEvents`, which retries the backend's stored batches without creating
another event. That RPC can also deliver other queued events for this document.
The tray renders pending, sent, failed and acknowledged statuses from returned
or polled events. It clears the note only after a returned pending or sent
status. The no-agent tray offers Conectar; explicit block actions can persist in
the queue through the block helpers.

Selection is shared through the controller's selection RPC. Moving, editing,
collapsing, opening documents and checklist toggles do not send feedback prompts.
The event target limit is 100; the tray reports that limit before sending a
larger selection. Panel bulk duplicate and delete report the 200-operation
limit. Scope checks discard late UI effects after document changes.

## States and verification

The panel uses the Opus v2 tokens and design, including pass 3 corrections for
LoadingDocument, DocumentRow, EmptyState and Banner. Loading uses a skeleton
frame and three cards, honours reduced motion, and shows Sigue cargando after
four seconds. Failed document opens show the actual selectable error, retry and
copy-detail actions. Save failures and revision conflicts retain retry/discard
controls; the controller reloads the current view before displaying a conflict.
Offline reading remains available and mutating controls are disabled. At most
two banners appear in the canvas column; an additional notice opens Avisos.

Run `PATH=/home/gabsplat/.local/share/pnpm/bin:$PATH pnpm typecheck` at the workspace
root. It checks backend, native frontend under the ES2023-only client tsconfig,
and tests. Final panel integration passed that command. The coordinator owns
plugin installation, native/browser QA and the final Opus visual audit. No GUI
was launched, no plugin was installed or reloaded, and no daemon or host setting
was changed by the panel integrator. Rendered light/dark, compact, overlay,
delivery and conflict behavior still require that coordinator QA.
