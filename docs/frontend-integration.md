# Panel integration

`plugin/client/Panel.tsx` exports `LienzoPanel` for Paseo 0.10.3
`PluginWorkspacePanelProps`. The existing client entry mounts it as workspace
panel `canvas`. It uses the host theme, layout and connection through
`UIProvider`, `useAgent` and `useCanvas`. Browser helpers and drawing remain
owned by the frontend engineer. This delivery changes only `Panel.tsx` and this
file.

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
tool dialogs retain the normal horizontal island. The catalog and inspector
are real host modals
on every width. The local Modal wrapper carries the UI context through host
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

Panel composes `selectionToolbar` and passes it to Canvas for placement above
the selection and camera tracking. A whiteboard selection has Duplicar,
Eliminar and Más. Ordinary selection also has Preguntar and, only when
`needsContentInteraction` applies, Interactuar. Enter/F2 delegates text editing
or content interaction to `CanvasApi.editSelection`. Interaction entry and exit
use `beginInteraction` and `endInteraction`, with state reported through
`onInteractionChange`. Canvas owns drag, middle-button pan, text editing,
interaction shields, creation, resizing and contextual toolbar positioning.

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

Panel and Canvas compile together with the implemented tool, SVG, interaction
and contextual toolbar contracts. The final integrated suite passes 257 tests;
`pnpm typecheck` and `git diff --check` pass. The coordinator exercised the real
Panel and useCanvas under RN-web in an isolated omabox, with a simulated host
transport applying production RPC schemas and the production reducer. The 24
browser cases cover creation, persistence transactions, rejection, media
interaction, compact layouts, the compact grid and the narrow zoom menu.

Evidence and precise limitations are in
`design/qa-whiteboard-2026-10-06/report.md`; the reproducible harness is
`design/whiteboard-harness/`. Icons, host Modal and transport are stand-ins,
so this is not an installed Paseo or native-device verification. All four approved
Opus adjustments are implemented, including the narrow zoom owned by Canvas.
No plugin installation or reload was performed.
