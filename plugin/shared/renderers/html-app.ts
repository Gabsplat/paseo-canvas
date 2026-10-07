import { z } from "zod";
import type { RendererSpec } from "./spec";
export const HTML_APP_LIMITS = { html: 200_000, minHeight: 80, maxHeight: 1600, defaultHeight: 360, payload: 4000 } as const;
export const htmlAppDataSchema = z.object({
  /** A complete page: any HTML, CSS and JavaScript. It runs sandboxed in its own window on the canvas. */
  html: z.string().min(1).max(HTML_APP_LIMITS.html),
  /** Height of the window in canvas units when the block has no stored size. The page may ask for another with lienzo.resize. */
  height: z.number().finite().min(HTML_APP_LIMITS.minHeight).max(HTML_APP_LIMITS.maxHeight).optional(),
}).strict();
export type HtmlAppData = z.infer<typeof htmlAppDataSchema>;
/** What a page may send back to the agent: bounded, plain JSON. Anything else is dropped. */
export function htmlAppEvent(kind: unknown, payload: unknown): { kind: string; payload: unknown } | null {
  if (typeof kind !== "string" || !/^[a-zA-Z][a-zA-Z0-9._:-]{0,63}$/.test(kind)) return null;
  let text: string; try { text = JSON.stringify(payload ?? null); } catch { return null; }
  return text === undefined || text.length > HTML_APP_LIMITS.payload ? null : { kind, payload: JSON.parse(text) };
}
export const htmlAppSpec = {
  id: "html", dataSchema: htmlAppDataSchema, interactive: false, 
  guidance: "html is a mini app: when something is better understood by using it than by reading about it (an algorithm, a layout, a state machine, a formula, a UI idea, a data shape), build it. data.html is one complete self-contained page with any HTML, CSS and JavaScript you want; there are no preset components and no style to follow. It runs sandboxed in a window on the canvas, with scripts and network allowed and no access to the canvas page. A global lienzo object connects it to the canvas: lienzo.send(kind, payload) reports what the person did to you as a canvas event (payload is JSON up to 4000 characters; send meaningful moments, not every mouse move); lienzo.onContext(fn) gives { theme: { dark, colors }, block: { id, title }, selection: [{ id, title }], document: { id, title } } now and on every change, so the page can match the theme and react to what is selected; lienzo.select(id) selects a card on the canvas; lienzo.resize(height) asks for a taller or shorter window. Keep the page under 200000 characters, make it work without a build step, and update it with block.update data.html as the conversation moves. For a project with several files or a server, run it and show it with a preview block (data.url) instead.",
  blockType: { id: "html", name: "Mini app", description: "Una página HTML, CSS y JavaScript libre, viva dentro del lienzo.", renderer: "html",
    properties: [{ key: "html", label: "HTML", kind: "text", required: true }, { key: "height", label: "Alto", kind: "number", required: false }],
    defaults: { html: "<!doctype html><meta charset=\"utf-8\"><body style=\"margin:0;display:grid;place-items:center;height:100vh;font:16px system-ui\"><button onclick=\"lienzo.send('click',{at:Date.now()})\">Pulsa</button></body>" } },
} satisfies RendererSpec;
