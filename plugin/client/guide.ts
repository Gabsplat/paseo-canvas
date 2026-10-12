import type { SettingsState } from '@getpaseo/plugin/client';
import { DEFAULT_SHORTCUTS, formatCombo } from './shortcuts';
import type { canvasPreferences } from '../shared/preferences';

// Save before opening: two clients with the same revision cannot both show the tour.
export async function claimFirstGuide(settings: SettingsState<typeof canvasPreferences.schema>): Promise<boolean> {
  if (settings.status !== 'ready' || settings.values.guideSeen || settings.saving || settings.saveError) return false;
  return settings.save({ ...settings.values, guideSeen: true }, settings.revision);
}

export type GuideAction = 'documents' | 'catalog' | 'templates' | 'packs' | 'inspector' | 'agents' | 'communication' | 'history' | 'activity';
export type GuideFeature = { title: string; detail: string; keywords?: string; action?: GuideAction; button?: string };
export const guideSections: readonly { id: string; title: string; icon: string; intro: string; features: readonly GuideFeature[] }[] = [
  { id: 'start', title: 'Start a Lienzo', icon: 'Frame', intro: 'Lienzo (Spanish for canvas) is one canvas where you and your agent draw what is being explained.', features: [
    { title: 'Lienzos', detail: 'The title at the top left opens your Lienzos. New Lienzo makes an empty one with no questions; rename it in place with F2.', action: 'documents', button: 'Open Lienzos' },
    { title: 'Examples and templates', detail: 'Try the frontend, learning and architecture examples. They are marked as examples. Templates add a reusable structure.', action: 'templates', button: 'See templates' },
    { title: 'The + catalog', keywords: 'catalog add blocks pin', detail: 'The + at the end of the toolbar lists shapes, embeds, blocks and extensions, with a search on top. Pin the ones you use: they join the toolbar and get keys 1–9.', action: 'catalog', button: 'Open the catalog' },
  ] },
  { id: 'arrange', title: 'Arrange it your way', icon: 'SquareDashed', intro: 'Drag from anywhere on a block. A short click still works its controls; sliders and charts keep their own drag.', features: [
    { title: 'Drag and resize', keywords: 'resize size', detail: 'Move blocks and Marcos, also from one Marco into another. Drag the bottom-right corner of a selected block to resize it; Shift keeps the proportions.' },
    { title: 'Move or use content', detail: 'Double-click, Enter or Interact lets you select text, use a web page or play media. While interacting, move the card by its title. Esc or the Interacting chip leaves.' },
    { title: 'Select and wrap in a Marco', keywords: 'group frame', detail: 'Shift-click adds to the selection. A Marco (Spanish for frame) holds things together: ⌘G wraps the selection in one, M adds an empty one. Marcos nest, collapse and have their own instructions.' },
    { title: 'Automatic layouts', detail: 'Select a Marco: Properties has its layout (graph, stack, grid, flow or free). Dragging pins a position; Release position hands it back to the automatic order.', action: 'inspector', button: 'Open Properties' },
    { title: 'Move around', detail: 'Drag the background or use the middle mouse button. Hold Space for the hand. The wheel scrolls; Ctrl/⌘ + wheel zooms. Shift+1 fits everything, Shift+2 the selection. ⌘. hides all the interface.' },
  ] },
  { id: 'whiteboard', title: 'Write and draw freely', icon: 'PenTool', intro: 'The toolbar at the bottom: Select, Hand | Pencil, Shape, Text, Arrow, Eraser | Marco, Ventana | your pinned tools | +.', features: [
    { title: 'Text and shapes', keywords: 'labels arrow circle rectangle diamond', detail: 'Text makes a label without a card. Double-click or Enter edits text and shape labels; Ctrl/⌘ + Enter confirms and Esc cancels. Press Shape again for rectangle, ellipse, diamond, triangle or line. Drag to size; Shift keeps proportions or 15° angles.' },
    { title: 'Pencil and eraser', keywords: 'strokes learner agent', detail: 'Each finished stroke is one change. Start on a card and the drawing follows it. Your strokes are solid; the agent’s are dashed and labelled. The eraser removes whole strokes and Undo brings them back. Clear my strokes keeps the agent’s and the author’s.' },
    { title: 'Ventana', keywords: 'embed iframe video web', detail: 'A Ventana (Spanish for window) shows a web page, a video, a sound or a mini app inside the Lienzo. W asks for its address.' },
    { title: 'Style', detail: 'Colour, size, fill, stroke and font live in Properties on the right while a drawing tool is in hand or a drawing is selected.' },
    { title: 'Tools that stay', detail: 'Text and Shape go back to Select after one use. Double-click the tool in hand to keep it; Pencil and Eraser stay until Esc or V.' },
  ] },
  { id: 'connect', title: 'Connect the ideas', icon: 'Spline', intro: 'Arrows join blocks and Marcos. They follow when things move or change size.', features: [
    { title: 'Join with the +', keywords: 'magnet arrows ports', detail: 'Select or approach a block and drag its + onto another. Near a port the tip is drawn in and a short signal confirms it. Let go to make the link.' },
    { title: 'Edit a link', detail: 'Press the arrow: Properties edits its label, kind (flow, needs, mentions) and colour; the bar over it reverses or deletes it.' },
    { title: 'From the keyboard', detail: 'Select two things and run “Connect the two” from ⌘K, or use Connect in Properties to search for a target.' },
  ] },
  { id: 'material', title: 'Bring your material', icon: 'Image', intro: 'Paste HTTP or HTTPS links into a Ventana, an image, a video or a sound.', features: [
    { title: 'Images', detail: 'Press the image to enlarge it. Use + and − to zoom and drag to explore. Open reference goes to the original.' },
    { title: 'Video and audio', detail: 'Direct links and YouTube or Vimeo videos are recognised. Double-click or Interact enables the controls. Nothing plays on its own.' },
    { title: 'Web pages', detail: 'A Ventana shows the page. Double-click or Interact uses it; otherwise you can move the block and pan over it. If the site refuses to be embedded, open it in the browser.' },
    { title: 'Editable content', detail: 'Properties on the right holds every field of the selected block. Lists can be ticked; questions and forms send your answers to the agent. Code can be copied.' },
    { title: 'Animated flow', keywords: 'timeline links nodes', detail: 'Follow events over the real nodes and links of the Lienzo. They move with the blocks and stop when out of sight.' },
    { title: 'GLSL shader', keywords: 'WebGL uniforms', detail: 'Explore an image computed from shared variables. Compile errors show in the block; without WebGL there is a static stand-in.' },
    { title: 'On a phone', detail: 'Lista (the list) makes reading and selecting easy. Videos and web pages open in the browser; learning blocks show a static description.' },
  ] },
  { id: 'agent', title: 'Work with your agent', icon: 'Bot', intro: 'You choose what context to share and when to send.', features: [
    { title: 'Connect an agent', detail: 'Choose the workspace agent from the composer. Its status says whether it is working, idle or unavailable.', action: 'agents', button: 'See agents' },
    { title: 'Give instructions', detail: 'Select a block or Marco and open Instructions for the agent in Properties. Those of the whole Lienzo are in the menu. The agent gets them together, most specific first.', action: 'communication', button: 'Instructions for the agent' },
    { title: 'Ask about the selection', detail: 'Select, write in the composer and send, or type in ⌘K and choose Ask the agent. Answers and forms send real feedback; selecting alone sends nothing.' },
    { title: 'Follow the delivery', detail: 'Activity tells queued, sent, received and failed apart. A failed delivery can be retried. Sent means delivered, not done.', action: 'activity', button: 'See activity' },
  ] },
  { id: 'keep', title: 'Keep and share', icon: 'Package', intro: 'Every confirmed change is a revision. You can go back and reuse the content.', features: [
    { title: 'History, undo and redo', detail: 'See the revisions and use Undo or Redo for content, positions, sizes and links.', action: 'history', button: 'See history' },
    { title: 'Templates and collections', detail: 'Select a Marco and choose Save as template… in Properties. Export the selection or the Lienzo as a JSON collection, and import collections of types, templates and documents.', action: 'packs', button: 'Open collections' },
    { title: 'Changes at the same time', detail: 'If the Lienzo changed while you edited, the notice lets you apply your change again or discard it.' },
    { title: 'Your keys', keywords: 'shortcuts keyboard', detail: 'Press ? for every shortcut. Settings → Shortcuts reassigns them; your choices are kept for this Paseo host.' },
  ] },
];
/** The cheat sheet in the guide, from the shortcut registry so it never disagrees with the keys. */
export const guideShortcuts: readonly (readonly [string, string])[] = [
  ...DEFAULT_SHORTCUTS.filter(s => !s.id.startsWith('pinned.') || s.id === 'pinned.1').map(s => [s.id === 'pinned.1' ? '1–9' : s.keys.map(k => formatCombo(k, false)).join(' / '), s.id === 'pinned.1' ? 'Pinned tools' : s.label] as const),
  ['Shift + click', 'Add to or remove from the selection'], ['Arrows / Shift + arrows', 'Move 8 / 32 px'], ['Enter / F2', 'Edit text or interact with content'], ['Tab / Shift + Tab', 'Go through things'], ['Ctrl/⌘ + Enter', 'Send to the agent'], ['0 / + / −', '100% / zoom in / zoom out'],
];
