# Panel integration

`plugin/client/Panel.tsx` exports `LienzoPanel` for Paseo 0.10.3
`PluginWorkspacePanelProps`. The existing client entry mounts it as workspace
panel `canvas`. It uses the host theme, layout and connection through
`UIProvider`, `useAgent` and `useCanvas`. The contextual actions are split into `SelectionActions`, `SelectionOverlay`,
`DocumentActions`, `NumberPropertyField` and the pure `panel-actions` helpers.
Canvas keeps the `selectionToolbar: ReactNode` contract and adds
`CanvasApi.editLinkLabel()`. Its three drawing anchor lookups pass the catalog
so custom renderer aliases work without capturing ordinary card data.

## Layout and navigation

The implementation follows `design/whiteboard-spec.md` sections 5 and 6 and
`docs/design.md` sections 20.4 through 20.6. On noncompact hosts, the Canvas
container is absolute with `inset: 0`. Its sibling overlay layer uses
`pointerEvents="box-none"`. Every empty positioning wrapper for the document island, tools, composer,
style, notices and compact Listo uses `box-none`; the island bodies retain
automatic hit testing. The former full-width contextual-toolbar wrapper has
been removed from Panel. Canvas receives the island body through
`selectionToolbar` and must use `box-none` on its positioning wrapper. This
addresses the coordinator's browser QA finding that the former full-width row
intercepted clicks beside the toolbar. The former docked top bar, catalog rail, inspector
rail and context tray no longer reserve canvas space.

The document island is top-left and contains the main menu, title, persisted
example marker, save warning indicator, undo and redo. The title opens the real
document picker. Renaming is available through the main menu and F2 with no
selection. The save indicator appears after 400 ms of a pending edit or after a
reported failure. Tools sit at the top centre and yield to the measured document
island. When both cannot fit on the same row, tools use the next floating row.
Below 560 px they use the frontend's reduced tool set; redo remains in the menu.

The assistant composer floats at the bottom centre. Below 560 px it aligns left
and leaves space for Canvas's zoom control. Its selection chips, queue actions,
errors and delivery receipt use the actual controller data. The style island is
168 px wide and vertically centred on wide panels. Below 880 px it becomes
horizontal, eight pixels above the measured composer. It appears for text,
shape or draw tools or a whiteboard selection. Shapes and library use the
frontend's real popover components. Canvas alone owns zoom.

Compact hosts retain a docked compact header, default to outline, and expose
Herramientas in a host Modal. Opening it switches to Canvas. Choosing a creation
tool closes the sheet; Listo returns to selection. The compact tool set uses
`ToolIsland grid`: four columns and two rows of
44 px buttons, with 8 px gaps, no dividers and no horizontal tool scroller. Its
200 px grid is centred in the sheet. Applicable style controls follow the tools,
then an explicit Biblioteca row opens the existing library picker. Noncompact
tool dialogs retain the normal horizontal island. The catalog uses a host Modal. Selection popovers become host sheets in compact mode. Document settings, history and activity have dedicated content in host dialogs. The local Modal wrapper carries the UI context through host
portals. Solo lienzo hides the Panel controls while retaining Canvas zoom and
save, conflict and connection notices.

The main menu and dialogs preserve document creation and copies, labelled
examples, history, communication instructions, agent connection, activity,
settings, guide, undo/redo, grouping, duplication, deletion and collections.
Catalog tabs retain every learning block, template and pack. Its quick actions
add notes, nodes and empty groups, accept media URLs, or import SVG. Existing
group template save and collection import/export use the actual RPCs. No UI
claims that an assistant answered or a write succeeded before a response.

## Tools, style and creation

Panel controls `CanvasTool`, `ToolStyle` and `toolLocked` as view state. Defaults
come from `DEFAULT_TOOL_STYLE`. The tool island forwards selection, hand, text,
shape, drawing and eraser choices. Double-click locking is forwarded through
`onLockChange`. Offline transitions cancel the current gesture and return to
selection. Selecting a whiteboard catalog type opens its placement tool instead
of persisting empty text or invalid drawing data.

Style changes update the preference for subsequent elements and capture the
selected whiteboard IDs. After `controller.settle()`, the panel reads current
blocks for the same document and sends one `block.update` per applicable entity
in one `controller.edit` transaction. Ordinary blocks are excluded. Text accepts
color, scale, font and alignment; shapes accept color, shape, fill, stroke and
`weight` from the scale control. Heads are written only for lines. Changing a
line to another shape removes `from` and `heads`. SVG accepts only color. Drawing
updates color/weight on its strokes without adding those keys at the root.
Unrelated data is preserved. More than 200 targets produces an error instead of
truncating the transaction.

Ordinary catalog insertion retains the selected group destination. With one
selected block it uses that block's parent and places the new block to its right.
Otherwise it uses the reported visible canvas centre. Template insertion retains
its existing transactional placement logic and operation limit. SVG insertion
uses `CanvasApi.insertSvg` and explicitly forwards a selected group destination.
The frontend `SvgImportDialog` handles pasted SVG, SVG files and URL fetching
with its guarded browser helpers. Successful insertion returns to selection;
errors remain in the library or import dialog. Media URLs create the actual
`media` catalog type with its defaults, caption and inferred media kind. Raster,
video and audio file upload is not implemented by Panel; no upload helper was
published for those formats.

## Context and interaction

The composer can send selected targets, or a nonempty note without selection. A
send captures one event ID, document ID, target IDs and note, waits for pending
writes, and verifies the document is still current before calling `send`.
Retries retain the same ID and payload. Persisted event retries use the existing
flush RPC. Queue, sent, failed and acknowledged labels come from returned or
polled events. Selection remains shared through the controller selection RPC.
Drawing and style edits do not independently send an assistant prompt.

Panel composes `selectionToolbar` and passes it to Canvas only outside compact
mode. Canvas positions its separate overlay above the current selection or a
connection label point, measures its width, clamps it to the viewport and flips
it away from the last selection pointer. It unmounts during drag, resize, pan,
zoom, connection gestures, drawing, editing and interaction. It returns after
120 ms with the approved 100 ms fade and 4 px movement, respecting reduced motion.
In compact mode Panel docks the same actions in a 48 px bar above the composer.
The compact header exposes Deshacer and Añadir.

The toolbar offers type-specific data edits, communication instructions,
grouping, connections and group operations directly. Más includes scoped text
editing, data, variables, collapse, templates, selection export, leaving a group,
releasing positions, automatic sizing and ordering where applicable. These
operations use the current controller and existing RPCs. Numeric fields validate
before saving, JSON validates on blur, failed edits retain their draft, and
missing collections show the unknown-type message. Instruction edits preserve
intent and audience; Vaciar clears all three local fields. Ancestor instruction
rows reopen this same form at the group or document level. Hidden results and
the blocks that hide them retain their presentation restrictions.

Layout changes to Libre freeze drawn child positions in the same transaction.
Leaving a group preserves world positions. Connection controls edit labels,
kind, tone and direction; inline Escape cancels without a transaction. All
writes use `c.edit` and retain revision conflicts and undo. Deletion and clearing
instructions also show a temporary Deshacer receipt. The pinned SDK toast API
has no action callback, so the receipt carries the working undo button.

On web, Reiniciar calls `activateRendererReset(panelRoot, blockId, guard)` after
pending writes settle. The adapter searches only within the mounted Panel root,
checks the current document, workspace, single selection and enabled button,
then activates the renderer's existing handler. It does not add a generic reset
transaction or event. This preserves renderer-local cleanup, pending edits,
audio shutdown and its own event payload. Missing, disabled or stale targets
produce a visible failure. Native supports an explicit runtime fallback for
controls; other learning resets remain disabled there.

Enter/F2 opens scoped ordinary text fields or delegates whiteboard editing to
Canvas. Interactuar remains reachable through Más where content interaction is
needed. The separate `LinkLabelEditor` uses the existing controller transaction;
Canvas still owns free drag, middle-button pan, resizing and interaction shields.

Existing undo/redo, group, delete, connect, send, selection traversal, arrow
nudges, zoom, catalog and immersive shortcuts remain reachable. Panel also
routes V/H/T/R/D/E and Shift+L. Escape closes tool popovers, leaves interaction,
cancels a creation tool, or clears selection as appropriate. Focused inputs
remain protected by the frontend keyboard helper. The guide still claims and
persists `guideSeen` once and can be reopened from the main menu.

## Validation and handoff

Run at the workspace root:

```sh
PATH=/home/gabsplat/.local/share/pnpm/bin:$PATH pnpm typecheck
```

The Panel closure passes 104 directed tests and `pnpm typecheck`. The tests use
production schemas, reducer, persistence service and learning runtime for
instruction inheritance, layouts, leaving groups, ordering, links, undo/redo,
revision conflicts, scope preservation and reset adapter boundaries. The only
change to `tests/whiteboard-frontend.test.ts` is its authorized mock entry for
the new separate SelectionOverlay module; existing assertions are unchanged.

The isolated omabox browser QA passes 18 cases with the real Panel, useCanvas,
registered renderers, scheduler, RPC schemas and reducer. Its host transport,
icons, Modal and instrumented AudioHost are stand-ins. The audio regression
checks context shutdown, cancelled pending edits, one settled reset event and a
rejected save with visible error and zero live contexts. It does not certify
physical audio or an installed Paseo/native-device build. No plugin installation,
reload or shared service change was performed.

New evidence and reproduction commands are in
[`design/qa-panel-close-2026-10-06/report.md`](../design/qa-panel-close-2026-10-06/report.md).
Earlier whiteboard evidence remains in its original directory. The coordinator
runs the full combined suite after integration and retains the independent core
and onboarding commits.
