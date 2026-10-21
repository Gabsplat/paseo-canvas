import { z } from "zod";

/**
 * How an extension appears (added to API 1, optional): the manifest's `presentation`, `lienzo.ui.set(patch)` at run
 * time and `canvas_extension_open { mode }` from an agent all go through `resolvePresentation`, so every size is
 * clamped and every value checked in one place. An extension without `presentation` opens as it always did: a panel
 * with a title bar on the right. docs/extensions.md, "Presentation".
 *
 * - panel: a floating card (width, height, chrome, position).
 * - overlay: a transparent layer over the whole canvas, under Lienzo's own controls. Pointer events go through to the
 *   canvas until the page calls lienzo.ui.capturePointer(true). dimCanvas lays a scrim under it.
 * - popover: a small bubble pointing at the selection (or at anchorId).
 * - fullscreen: covers the Lienzo area; Esc closes it.
 */
export const PRESENTATION_MODES = ["panel", "overlay", "popover", "fullscreen"] as const;
export const PRESENTATION_CHROME = ["full", "minimal", "none"] as const;
export const PRESENTATION_POSITIONS = ["right", "left", "bottom", "center"] as const;
/** The canvas' named tones an accent may use, else a #rrggbb colour. */
export const PRESENTATION_TONES = ["accent", "success", "warning", "violet"] as const;
export type PresentationMode = typeof PRESENTATION_MODES[number];
export type PresentationChrome = typeof PRESENTATION_CHROME[number];
export type PresentationPosition = typeof PRESENTATION_POSITIONS[number];
export const PRESENTATION_LIMITS = {
  width: { min: 200, max: 720 }, height: { min: 120, max: 900 }, dimCanvas: 0.6,
  /** lienzo.input from canvas_extension_open, in bytes of JSON. */
  input: 4096,
  /** lienzo.hide: things at once, and how long `ms` may keep them hidden. */
  hide: 400, hideMs: { min: 16, max: 120_000 },
} as const;
export const PRESENTATION_DEFAULTS = {
  panel: { width: 320, height: 440 }, popover: { width: 280, height: 160 },
} as const;
const clamp = (min: number, max: number) => (n: number) => Math.round(Math.max(min, Math.min(max, n)));
const accentSchema = z.union([z.enum(PRESENTATION_TONES), z.string().regex(/^#[0-9a-fA-F]{6}$/, "accent is a canvas tone (accent, success, warning, violet) or a #rrggbb colour.")]);
/** The manifest field. Sizes outside the limits are clamped, not refused; unknown keys are refused. */
export const presentationSchema = z.object({
  mode: z.enum(PRESENTATION_MODES).default("panel"),
  width: z.number().transform(clamp(PRESENTATION_LIMITS.width.min, PRESENTATION_LIMITS.width.max)).optional(),
  height: z.number().transform(clamp(PRESENTATION_LIMITS.height.min, PRESENTATION_LIMITS.height.max)).optional(),
  chrome: z.enum(PRESENTATION_CHROME).optional(),
  position: z.enum(PRESENTATION_POSITIONS).optional(),
  dimCanvas: z.number().transform(n => Math.round(Math.max(0, Math.min(PRESENTATION_LIMITS.dimCanvas, n)) * 100) / 100).optional(),
  accent: accentSchema.optional(),
}).strict();
export type ExtensionPresentation = z.output<typeof presentationSchema>;
/** Everything decided: what the host draws and what lienzo.ui.state says. */
export type ResolvedPresentation = { mode: PresentationMode; width: number; height: number; chrome: PresentationChrome; position: PresentationPosition; dimCanvas: number };
export type PresentationPatch = Partial<ResolvedPresentation>;

const pick = <T extends readonly string[]>(list: T, value: unknown): T[number] | undefined => typeof value === "string" && (list as readonly string[]).includes(value) ? value as T[number] : undefined;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
/**
 * The presentation now: the manifest's, then what the page or the agent asked for on top. A patch that is not an
 * object, or a key with the wrong type, is ignored key by key (lienzo.ui.set reports which in `ignored`). Changing
 * mode without a size takes that mode's default size unless the manifest gave one.
 */
export function resolvePresentation(manifest: Partial<ExtensionPresentation> | undefined, current?: ResolvedPresentation, patch?: unknown): ResolvedPresentation & { ignored: string[] } {
  const base = manifest ?? {}, mode = base.mode ?? "panel", sizes = mode === "popover" ? PRESENTATION_DEFAULTS.popover : PRESENTATION_DEFAULTS.panel;
  let next: ResolvedPresentation = current ? { ...current } : {
    mode, width: base.width ?? sizes.width, height: base.height ?? sizes.height, chrome: base.chrome ?? "full", position: base.position ?? "right", dimCanvas: base.dimCanvas ?? 0,
  };
  const ignored: string[] = [];
  if (patch !== undefined && patch !== null) {
    if (typeof patch !== "object" || Array.isArray(patch)) return { ...next, ignored: ["patch"] };
    const p = patch as Record<string, unknown>;
    for (const key of Object.keys(p)) if (!["mode", "width", "height", "chrome", "position", "dimCanvas"].includes(key)) ignored.push(key);
    const m = p.mode === undefined ? undefined : pick(PRESENTATION_MODES, p.mode); if (p.mode !== undefined && !m) ignored.push("mode");
    if (m && m !== next.mode) {
      const was = next.mode === "popover" ? PRESENTATION_DEFAULTS.popover : PRESENTATION_DEFAULTS.panel, now = m === "popover" ? PRESENTATION_DEFAULTS.popover : PRESENTATION_DEFAULTS.panel;
      next = { ...next, mode: m, width: next.width === was.width ? (base.width ?? now.width) : next.width, height: next.height === was.height ? (base.height ?? now.height) : next.height };
    }
    const w = num(p.width), h = num(p.height), d = num(p.dimCanvas), c = pick(PRESENTATION_CHROME, p.chrome), pos = pick(PRESENTATION_POSITIONS, p.position);
    if (p.width !== undefined) { if (w === undefined) ignored.push("width"); else next.width = clamp(PRESENTATION_LIMITS.width.min, PRESENTATION_LIMITS.width.max)(w); }
    if (p.height !== undefined) { if (h === undefined) ignored.push("height"); else next.height = clamp(PRESENTATION_LIMITS.height.min, PRESENTATION_LIMITS.height.max)(h); }
    if (p.dimCanvas !== undefined) { if (d === undefined) ignored.push("dimCanvas"); else next.dimCanvas = Math.round(Math.max(0, Math.min(PRESENTATION_LIMITS.dimCanvas, d)) * 100) / 100; }
    if (p.chrome !== undefined) { if (!c) ignored.push("chrome"); else next.chrome = c; }
    if (p.position !== undefined) { if (!pos) ignored.push("position"); else next.position = pos; }
  }
  return { ...next, ignored };
}
/**
 * What an agent may hand an extension it opens (canvas_extension_open input): any JSON up to 4 KB. Also checked on
 * the client before it reaches the page.
 */
export function presentationInputIssue(input: unknown): string | null {
  if (input === undefined) return null;
  let text: string;
  try { text = JSON.stringify(input); } catch { return "input must be JSON."; }
  if (text === undefined) return "input must be JSON.";
  return new TextEncoder().encode(text).length > PRESENTATION_LIMITS.input ? `input holds at most ${PRESENTATION_LIMITS.input / 1024} KB of JSON.` : null;
}
/** The ids lienzo.hide / lienzo.show may name, and how long: unknown ones are dropped, ms is clamped (or none). */
export function hideRequest(args: { ids?: unknown; ms?: unknown }, known: (id: string) => boolean): { ids: string[]; ms: number | null } {
  const ids = [...new Set((Array.isArray(args.ids) ? args.ids : []).filter((id): id is string => typeof id === "string" && known(id)))].slice(0, PRESENTATION_LIMITS.hide);
  const ms = num(args.ms);
  return { ids, ms: ms === undefined ? null : Math.round(Math.max(PRESENTATION_LIMITS.hideMs.min, Math.min(PRESENTATION_LIMITS.hideMs.max, ms))) };
}
