import { z } from "zod";
import type { RendererSpec } from "./spec";
export const HTML_APP_LIMITS = { html: 200_000, minHeight: 80, maxHeight: 1600, defaultHeight: 360, state: 3000, payload: 1000 } as const;
export const htmlAppDataSchema = z.object({
  /** A complete page: any HTML, CSS and JavaScript. It runs sandboxed in its own window on the canvas. */
  html: z.string().min(1).max(HTML_APP_LIMITS.html),
  /** Height of the window in canvas units when the block has no stored size. The page may ask for another with lienzo.resize. */
  height: z.number().finite().min(HTML_APP_LIMITS.minHeight).max(HTML_APP_LIMITS.maxHeight).optional(),
}).strict();
export type HtmlAppData = z.infer<typeof htmlAppDataSchema>;
const plainJson = (value: unknown, limit: number): { value: unknown } | null => {
  let text: string | undefined; try { text = JSON.stringify(value ?? null); } catch { return null; }
  return text === undefined || text.length > limit ? null : { value: JSON.parse(text) };
};
/**
 * What a page may store on its block with lienzo.setState: plain JSON up to 3000 characters, or null to clear it.
 * Anything else is refused. The agent reads it as the block's state.state.
 */
export function htmlAppState(value: unknown): { value: unknown } | null { return plainJson(value, HTML_APP_LIMITS.state); }
/**
 * Pages written before setState called lienzo.send(kind, payload). That still works, and only records the last call on
 * the block (its lastInteraction); nothing is sent anywhere. A long payload is dropped and the kind kept.
 */
export function htmlAppInteraction(kind: unknown, payload: unknown): { kind: string; payload?: unknown } | null {
  if (typeof kind !== "string" || !/^[a-zA-Z][a-zA-Z0-9._:-]{0,63}$/.test(kind)) return null;
  const data = plainJson(payload, HTML_APP_LIMITS.payload);
  return data && data.value !== null ? { kind, payload: data.value } : { kind };
}
export const htmlAppSpec = {
  id: "html", dataSchema: htmlAppDataSchema, interactive: false, 
  guidance: "html is a mini app: when something is better understood by using it than by reading about it (an algorithm, a layout, a state machine, a formula, a UI idea, a data shape), build it. data.html is one complete self-contained page with any HTML, CSS and JavaScript you want; there are no preset components and no style to follow. It runs sandboxed in a window on the canvas, with scripts and network allowed and no access to the canvas page. A global lienzo object connects it to the canvas. The page cannot message you: the person talks to you in the conversation and you read what the page left. lienzo.setState(value) stores a small JSON value on this block (up to 3000 characters, replacing the previous one; null clears it) and resolves when it is saved; store the outcome that matters (an answer, a choice, a result, a step reached), not every mouse move. You read it with canvas_selection or canvas_read ids as the block's state.state. lienzo.state is the stored value (null when none), so the page can restore itself when it opens again. Never label a button as sending anything to the agent: tell the person to mention it in the conversation instead; lienzo.onContext(fn) gives { theme: { dark, colors }, block: { id, title }, state, selection: [{ id, title }], document: { id, title } } now and on every change, so the page can match the theme and react to what is selected; lienzo.select(id) selects a card on the canvas; lienzo.resize(height) asks for a taller or shorter window; lienzo.onFrame(fn) gives { x, y, width, height, others: [{ x, y, width, height }] } in screen pixels, where this window and the other mini apps are, now and whenever one moves, so a page can react to being dragged or to what is beside it. Keep the page under 200000 characters, make it work without a build step, and update it with block.update data.html as the conversation moves. For a project with several files or a server, run it and show it with a preview block (data.url) instead.",
  blockType: { id: "html", name: "Mini app", description: "A free HTML, CSS and JavaScript page, alive inside the Lienzo. Shown in a Window.", renderer: "html",
    properties: [{ key: "html", label: "HTML", kind: "text", required: true }, { key: "height", label: "Height", kind: "number", required: false }],
    defaults: { html: "<!doctype html><meta charset=\"utf-8\"><body style=\"margin:0;display:grid;place-items:center;height:100vh;font:16px system-ui\"><button id=\"b\">Pressed 0 times</button><script>var n=0,b=document.getElementById('b');function show(){b.textContent='Pressed '+n+(n===1?' time':' times')}lienzo.onContext(function(c){if(c.state&&typeof c.state.presses==='number'){n=c.state.presses;show()}});b.onclick=function(){n++;show();lienzo.setState({presses:n})}</script></body>" } },
} satisfies RendererSpec;
