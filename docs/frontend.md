# Lienzo frontend

The native Paseo plugin entry is `plugin/index.client.tsx`. It registers the workspace
and Explorer panel as **canvas**, titled **Lienzo**. The Command Center action and
`/lienzo` open that same panel. Both opening paths call
`openPanel("canvas")`. The contributed Papel and Tinta themes are optional and are
not activated by the plugin.

All client imports use Paseo 0.10.3 host modules. Dialogs import the `Modal` wrapper
from `client/ui.tsx`: it retains the SDK props and static `Content` component, and
inserts an explicit UI provider inside the content children for compact sheet
portals. The controller is passed through; opening a sheet creates no extra
`useCanvas` instance or RPC subscription. Shared RPC identifiers are imported
from `shared/rpc.ts`. No endpoint strings are duplicated in client code, and no
client RPC sends anything to an agent.
The token transcription in `client/tokens.ts` comes from the Opus v7 design and whiteboard contract. No client
runtime import crosses into `design/`, `architecture/`, or `server/`.

## Working with a document

The UI is in English with five Spanish brand words (Lienzo, Marco, Hoja, Lente, Ventana), each explained where it
appears; `docs/design.md` §19 and §33 have the copy. The title opens Lienzos, a list of your documents and labelled
examples. New Lienzo creates and opens an empty document titled "Untitled Lienzo" with empty communication; there
is no creation form. Rename in the menu (or F2) edits the title in place, saving after idle or blur. Duplicate as
my own and Export this Lienzo are in the menu; duplicating clears the example flag. An empty canvas shows the
mate, "Add something" (the + catalog) and "Use a template".

The guide uses the SDK's host-scoped `onboarding` settings document, registered by
the server and read with `useSettings`. It waits for ready settings and a loaded
catalog, then saves `guideSeen: true` before opening. A failed save does not open the
modal; it offers retry. Concurrent clients cannot both claim the same settings
revision. Paseo persists and broadcasts this preference across workspaces, web and
native clients, and restarts. Lienzo guide in the menu always opens it manually. The legacy
exports in `web.ts` remain only for the isolated design harness's session memory.

The last successfully opened document is remembered for this process session,
scoped to the Paseo host ID and workspace. A compact-navigation remount restores
that ID only when it is present in the freshly fetched document list; removed or
unavailable IDs are forgotten. A full client reload can reset this session memory.

The free canvas supports background drag to pan, zoom controls, fit, and browser
wheel pan or Ctrl/Command wheel zoom. First open centres content horizontally at
80–100% scale with its top at 76 px on desktop and 48 px in compact mode; Fit all (Shift+1) still fits all content.
Cards use their measured content heights.
In the browser, left dragging beyond 4 px moves a block or group from any passive content or control. Short clicks still activate controls. Range sliders, learning surfaces, editing inputs, resize and connection handles retain their own drag. Children in stack, grid, or flow Marcos also offer Move earlier / Move later. Dragging moves elements between Marcos.
Compact clients show Lista, switch to the canvas while a drawing tool or the hand is in use, and do not drag cards. Group movement
uses parent-relative persisted positions; collapse hides descendants and preserves
their membership. Card and whiteboard resize gestures persist block size through transactions. Group frames expand around their children.

Click or tap passive block content or a title to select. Shift/Command clicking, or long pressing followed
by tapping, selects several entities. Selection calls `setSelection`, with its
separate selection version, and never sends an agent message. Grouping and deletion
operate on the highest selected ancestors so selecting a group and its child does
not delete the same subtree twice.

The right panel (Properties) appears with a selected block, Marco or link, with the options of the tool in hand,
or with an open extension tool; the pin or ⌘\ keeps it open on the Lienzo itself. Multiple selection shows shared
actions without an item list. History opens in a modal from the menu. There is no composer: the toolbar sits on the
bottom edge, and the selection bar floats above selected bounds.

Properties edits typed properties and one "Instructions for the agent" field.
Editing that field preserves existing `intent` and `audience`; those keys remain
available to MCP and JSON but have no UI editor. Fields commit after 600 ms idle or
on blur, preserve rejected drafts, and offer retry. IDs, type IDs, numeric dimensions,
pin coordinates, parent-group radios and link endpoint controls are absent.
Manual block sizes retain Tamaño automático; resize handles remain on the canvas.
Release position remains available for pinned ordinary entities. Whiteboard entities always retain a position and are excluded from automatic release. In compact/list mode, where
there are no resize or drag handles, numeric resizing and moving into an existing
group no longer have a direct UI path. MCP can still perform those operations.

Known server error codes map to short English messages, with a generic fallback.
Raw server messages are not rendered by the panel, catalog, settings or agent modal.
The panel also translates write errors before passing them to canvas/block
components. The conflict banner describes the rejected change and offers reapply
or discard without revision numbers.

Document edits are transactions with the current revision. A rejected revision
reloads the latest document before showing the retained failure. Reapplying submits
the same operations against the fresh revision. Undo and redo use the backend's real
availability and history, including its conflict checks. An unrelated successful
edit does not dismiss another edit's conflict. A failed watch disables writes and
retains the readable document. `watchDocument` and the document list poll every 1.5 seconds
without overlapping poll requests. Scope guards discard late results after opening
another document or changing workspace.

## Agents: one-way

Use the agent dialog to choose an existing agent in the workspace. It shows the
current assistant title, provider and a selected option row; it hides the raw ID.
Connecting marks the agent working on this Lienzo; it routes nothing, because the
canvas never sends anything to an agent. Workspace tool authorization is separate;
injection enables tools for new agents in that workspace. Existing-agent setup
returns a provider configuration snippet and instructions. Copy uses the raw
configuration text. The plugin never edits provider configuration or reloads agents.

The person talks to the agent in their own chat and says "look at what I selected";
the agent reads `canvas_selection`. What the person does with a block is stored on it:

| Control | What is stored |
| --- | --- |
| Quiz Answer | `data.answer` (a document edit) |
| Quiz Show hint | runtime `lastInteraction` `quiz.hint` |
| Form Save | the typed fields in `data`, then `lastInteraction` `form.save` |
| Controls, animated flow, shader | their runtime state, plus `lastInteraction` with the last move or reset |
| Mini app `lienzo.setState` | runtime `{ state }` |
| Strokes | `wb-draw` blocks with `author: learner` |

Checklist toggles, text edits, dragging, collapse, and selection only persist data.
Form saving waits for previous edits and commits all current typed field values.
Boolean fields use native checkbox controls. The UI does not invent a reply,
teaching result, or agent activity.

## Catalog and portable packs

Catalog types and group templates are actual local records. Define a type using its
declarative JSON properties and defaults. Saving a group as a template first calls
`exportGroup`, then stores that returned template with `template.put`; the export
RPC itself does not save it. Inserting a template uses a fresh ID prefix.

Paste JSON on every platform. Browsers also offer Choose a file with a 1 MiB limit.
Check runs the real validator and a noncommitting dry run against a freshly read
catalog revision. The review lists added and replaced entries by their display
names; unchanged entries collapse to a count. Catalog rows hide type and pack IDs. Replacing an existing pack requires
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

## Previews and references

`preview` blocks with a valid URL embed that actual URL on the web with the
Opus-specified `allow-scripts allow-forms` sandbox. A transparent shield covers the frame until explicit interaction mode starts. Selection alone keeps the shield. Double click, Enter/F2 or Interact removes it; a visible Interacting · Esc chip exits the mode. The
external-open action always remains available. Slow or blocked embeds get the
eight-second explanatory hint. A browser can reject framing or mixed HTTP content;
use the actual external link in that case. Native clients show a labeled browser
fallback. No-URL blocks are dashed conceptual references, not live-app mockups.

`media` images use React Native Image with an error fallback. Direct video/audio URLs use real web controls after explicit interaction; supported YouTube/Vimeo links load an actual player on request. Native clients offer external links. Players never autoplay. `safeUrl` accepts only HTTP/HTTPS without
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
pnpm typecheck
pnpm test
```

The frontend checks cover
session restoration and host/workspace isolation, fan-out label separation,
readable initial camera framing, renderer widths,
stack/grid/flow and collapse geometry, group-drop layout preservation,
typed form conversions, safe URLs, subtree selection, empty communication inheritance,
portable pack forks, and real
RPC-parser/service transactions preserving nested groups during rename/collapse/layout
and undo. Native visual and interaction QA belongs to the coordinator's installed
plugin run through omabox. These headless checks do not claim that screenshots or
a live agent session have already been exercised. Headless component tests exercise
creation, title editing, visibility, instruction preservation and friendly errors.
Guide tests cover loading/error states, failed saves and concurrent client claims.
Labels use the UI sans face in sentence case. Free text supports sans, serif and mono from the whiteboard specification.

The panel integrator owns `client/Panel.tsx` and `docs/frontend-integration.md`.
`Catalog.initialTab` accepts `types`, `templates`, or `packs`.
`Inspector.initialSection` accepts `document`, `communication`, `history`, or
`activity`; a remount key can repeat a same-section navigation request. The parent-group chooser and its `reparent` prop were removed. `useCanvas.settle()` waits for edits and selection
to finish and rejects if the document scope changes.


## Whiteboard objects and tools

`design/whiteboard-spec.md` defines the persistence contract. The client uses the
registered `wb-text`, `wb-shape`, `wb-svg` and `wb-draw` types and their shared schemas.
They are normal CanvasBlocks, so selection, grouping, duplication, deletion, undo,
revision conflicts and pack export use the existing controller and reducer.

Free text has no card chrome. Click selects; double click, Enter/F2 or typing edits
in place. New text stays an unsaved draft until blur or Ctrl/Command + Enter. Enter
adds a line; Escape cancels. Confirming blank new text writes nothing; blank existing
text deletes its block. Shape labels use the same editor. Failed text saves retain
the draft and offer retry or cancellation.

Shapes include rectangle, rounded rectangle, ellipse, diamond, triangle, hexagon,
cylinder and line, with labels and arrowheads. Click creates a centered 160 × 104
shape; drag defines its bounds. Shift constrains a shape to 1:1 or a line to 15°.
Shape/SVG/draw selections expose eight resize handles, text exposes width handles,
and lines expose endpoint handles. SVG resize always preserves its aspect ratio.
Filled shapes use their box for hits; empty shapes and drawings only intercept their
contour or stroke with an eight-screen-pixel hit band, so their interior lets users
reach cards beneath them.

The layer order is group frames, shapes/SVG, links, cards, text, drawings, guides and
handles. Positioned whiteboard objects sit outside automatic placement and overlap
resolution in every layout. Inferred layouts ignore these annotations and their
links. Group frames still include their bounds; creating or moving inside a group
stores parent-relative coordinates.

The pencil samples at most 8192 points per gesture. Shared bounded simplification
and schemas enforce 512 points per stroke, 4000 per drawing and 32 strokes. Consecutive
strokes append to the same drawing while tool, document, parent and limits permit.
A separate preview store redraws only the preview on pointer movement. The whole
canvas layout runs after a committed document change. Each completed stroke creates
one transaction; the eraser removes whole crossed strokes in one transaction at
release, including crossings between sparse pointer events. Escape, document changes,
offline state and busy persistence abort pending creation gestures without a save.

The library contains twelve canonical Tabler SVGs, bundled locally with their pinned
source metadata and MIT license in `client/assets/`. Clicking inserts at the viewport
center or selected group center. Browser dragging shows an image ghost and inserts
at the released page point, converted by Canvas to world and group-relative
coordinates. Releasing outside Canvas or pressing Escape creates nothing. Imports
accept pasted code on every platform, plus browser files and HTTP/HTTPS URLs. Browser
fetches omit credentials, stop after ten seconds, bound streamed bytes to 64 KiB,
and require CORS access. Shared sanitization runs before insertion and on server
writes. Imported SVG paints as an image data URI, never as inline DOM.

The renderer and style code use the whiteboard role colors, font sizes and geometry
from Opus tokens. No dependency was added. On native, text and basic RN shape
geometry render directly; complex shapes, drawings and imported SVG show the
specified readable web fallback. Compact mode allows creation and drawing with
one finger and pans with two. Existing compact move/resize restrictions remain.

## Canvas and floating tools API

The additional Canvas props are optional, preserving existing callers:

```ts
tool?: CanvasTool;
onToolChange?: (tool: CanvasTool) => void;
toolStyle?: ToolStyle;
toolLocked?: boolean;
onInteractionChange?: (id: string | null) => void;
selectionToolbar?: React.ReactNode;
```

`CanvasTool` is select, hand, text, shape, draw, eraser or svg. `ToolStyle` contains
color, scale, fill, stroke, shape, heads, font and align. Both types and
`DEFAULT_TOOL_STYLE` are exported from `whiteboard-tools.ts`.

`CanvasApi` retains fit, zoomToSelection, zoomStep, zoomTo and instant, and adds:

```ts
setTool(tool: CanvasTool): void;
getTool(): CanvasTool;
cancelGesture(): void;
viewportCenter(): Point;
insertSvg(svg: string, options?: SvgInsertOptions): Promise<boolean>;
beginInteraction(id?: string): void;
endInteraction(): void;
editSelection(): void;
interactionId(): string | null;
```

`SvgInsertOptions` accepts caption, source, license, world position `at`, browser
page position `atPage`, and parentGroupId. Pointer insertion determines the group
under the released point. `editSelection` follows `beginInteraction`, opening the
whiteboard editor or an appropriate card's interaction mode. The selection toolbar
is supplied by Panel and anchored by Canvas with animated camera values, without
camera state updates in Panel. Interaction mode hides the contextual toolbar while its exit chip is visible. Below 880 px on desktop, zoom shows only the percent button; its anchored menu contains zoom, fit and reset actions.

The face (`docs/design.md` §3, §24, §31–33) is made of controlled components that hold no document controller;
Panel commits every change through `c.edit` or `c.send`:

- `Toolbar.tsx`: `Toolbar` takes active, shape, locked, disabled, onTool, onShape, onLock, pinned, onAdd, addOpen,
  keyLabel (registry id → formatted keys), scroll (compact) and addRef. Select and Hand stay available while
  writes are disabled. Only a double press on the tool in hand toggles its lock; Marco and Ventana never lock.
- `AddMenu.tsx`: `AddMenu` takes entries (`ToolEntry`: id, section, name, description, icon, tone, shortcut,
  keywords, run), pinned ids, onPin, onClose, onManage and maxHeight. The same entries feed pinned tools, keys 1–9
  and ⌘K.
- `RightPanel.tsx`: `RightPanel` takes tabs, active, onTab, pinned, onPin, onClose, top, maxHeight and focusSection;
  `PanelSection` is its collapsible section. `SelectionActions.tsx` exports `SelectionBar` and `SelectionProperties`.
- `CommandPalette.tsx` with the model in `palette.ts` (`fuzzyScore`, `itemScore`, `paletteSections`, `remember`).
- `shortcuts.ts`: `DEFAULT_SHORTCUTS`, `ShortcutRegistry` (and the `shortcutRegistry` instance extensions register
  into), `resolveShortcuts`, `eventCombo`, `normalizeCombo`, `formatCombo`. `ShortcutSheet.tsx` lists and reassigns.
  Pins and overrides are saved in the host-scoped `interface` settings (`shared/preferences.ts`).
- `ui.tsx`: `Tooltip`, `useTooltip`, `TooltipProvider` and `TooltipLayer`; `IconButton` takes `shortcut` and `detail`.
- `FloatingTools.tsx`: `StyleIsland` (with `bare` inside the right panel), `LibraryPopover` and `SvgImportDialog`.
- `Eggs.tsx`: `EmptyMate`, `Kettle` and `LoadingEgg`, all still or absent under reduced motion.

Canvas takes `reservedKey` (keys the registry owns, so typing on a selected label does not swallow them),
`lensShortcut` and `obscuredRight` (the right panel's width, kept clear by the selection beacon); `CanvasApi` adds
`cycleLens()`.

## Content interaction boundaries

Ordinary deep content starts in move mode. Explicit interaction enables selectable
text, annotations, internal scrolling, media and frames; its ring and exit chip are
transient client state. The title remains draggable during interaction. Browser
middle-button pan captures events over cards, controls, learning ranges and SVG;
passive media/iframe shields allow pan, wheel and zoom over their content. Focused
learning controls and interaction surfaces retain their own keyboard commands.
Space temporarily selects Hand when focus is outside those controls.

Events originating inside an active iframe belong to its separate document and
cannot be intercepted by the parent canvas. Escape there cannot exit interaction;
the visible exit chip provides that action. Middle mouse inside that active frame
also requires leaving interaction first. No cross-origin event interception is
claimed. All browser pointer, keyboard, SVG, import and media adapters remain in
`web.ts`; native loading touches no DOM.

Headless whiteboard tests exercise the actual creation hook with the real reducer,
bounded gestures, group-relative creation and movement, eraser sweeps, layout
isolation, resizing, export, unsafe imports, pointer adapters and the fast inactive
tool regression. They also verify delegation of learning keyboard commands and
wheel behavior over passive versus active content. The coordinator owns actual
Panel QA in omabox.
