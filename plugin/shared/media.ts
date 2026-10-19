import { sanitizeSvg, SVG_LIMITS } from "./svg";

/**
 * Images a person brings from their computer (a dropped or pasted file, "Choose file…"). The host keeps the bytes
 * beside the Lienzo data, named by their SHA-256, and a block refers to them as `lienzo-media:<sha256>.<ext>`: the
 * same picture added twice is stored once, and the reference survives restarts and copies of the document on the
 * same host. A host that cannot store files gets a small inline data URL instead (MEDIA_LIMITS.inlineBytes).
 */
export const MEDIA_LIMITS = { bytes: 10 * 1024 * 1024, inlineBytes: 256 * 1024, files: 12, svgBytes: SVG_LIMITS.bytes } as const;
export const MEDIA_TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" } as const;
export type MediaExtension = keyof typeof MEDIA_TYPES;
/** What the file picker and a drop accept, by name. The bytes decide in the end (sniffImage). */
export const MEDIA_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
export const MEDIA_SCHEME = "lienzo-media:";
const REF = /^lienzo-media:([a-f0-9]{64})\.(png|jpg|webp|gif|svg)$/;
const INLINE = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;

export type MediaRef = { hash: string; extension: MediaExtension; mime: string };
export const mediaRef = (hash: string, extension: MediaExtension) => `${MEDIA_SCHEME}${hash}.${extension}`;
export function parseMediaRef(value: unknown): MediaRef | null {
  const match = typeof value === "string" ? REF.exec(value) : null;
  return match ? { hash: match[1], extension: match[2] as MediaExtension, mime: MEDIA_TYPES[match[2] as MediaExtension] } : null;
}
/** A stored image or a small inline one: what an image block may hold besides an http(s) link. */
export function isLocalImage(value: unknown): boolean { return !!parseMediaRef(value) || inlineImage(value) !== null; }
/** An inline `data:image/…;base64,` URL within the inline cap, with bytes that really are that kind of image. */
export function inlineImage(value: unknown): { mime: string; bytes: Uint8Array } | null {
  if (typeof value !== "string" || value.length > Math.ceil(MEDIA_LIMITS.inlineBytes * 4 / 3) + 64) return null;
  const match = INLINE.exec(value); if (!match) return null;
  const bytes = fromBase64(match[2]), extension = bytes && sniffImage(bytes);
  if (!bytes || !extension || MEDIA_TYPES[extension] !== match[1] || bytes.length > MEDIA_LIMITS.inlineBytes) return null;
  if (extension === "svg") { try { sanitizeSvg(utf8(bytes)); } catch { return null; } }
  return { mime: match[1], bytes };
}

/** The kind of image the bytes are, from their first bytes; never from the file's name or claimed type. */
export function sniffImage(bytes: Uint8Array): MediaExtension | null {
  const at = (offset: number, ...values: number[]) => values.every((value, i) => bytes[offset + i] === value);
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (bytes.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return "gif";
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  // SVG is text: an optional BOM, XML declaration, comments or doctype, then <svg.
  const head = utf8(bytes.subarray(0, 2048)).replace(/^﻿/, "").replace(/<\?xml[\s\S]*?\?>/, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/i, "").trimStart();
  return /^<svg[\s>]/i.test(head) ? "svg" : null;
}

/** The bytes to keep for an upload: sniffed, capped, and an SVG rewritten through the static SVG sanitizer. */
export function prepareImage(bytes: Uint8Array): { extension: MediaExtension; mime: string; bytes: Uint8Array } {
  if (!bytes.length) throw Object.assign(new Error("The file is empty."), { code: "VALIDATION" });
  if (bytes.length > MEDIA_LIMITS.bytes) throw Object.assign(new Error(`Images can be up to ${MEDIA_LIMITS.bytes / 1024 / 1024} MB.`), { code: "TOO_LARGE" });
  const extension = sniffImage(bytes);
  if (!extension) throw Object.assign(new Error("That file is not a PNG, JPEG, WebP, GIF or SVG image."), { code: "VALIDATION" });
  if (extension !== "svg") return { extension, mime: MEDIA_TYPES[extension], bytes };
  if (bytes.length > MEDIA_LIMITS.svgBytes) throw Object.assign(new Error("SVG images can be up to 64 KB."), { code: "TOO_LARGE" });
  let clean: string;
  try { clean = sanitizeSvg(utf8(bytes)).svg; } catch { throw Object.assign(new Error("This SVG has scripts, links, embedded images or animation, which Lienzo does not keep."), { code: "VALIDATION" }); }
  return { extension, mime: MEDIA_TYPES.svg, bytes: new TextEncoder().encode(clean) };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 without Buffer or atob, so the same code runs in both hosts, the browser and tests. */
export function toBase64(bytes: Uint8Array): string {
  let out = "", i = 0;
  for (; i + 2 < bytes.length; i += 3) { const n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2]; out += B64[n >> 18] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63]; }
  if (i < bytes.length) { const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8; out += B64[n >> 18] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : "=") + "="; }
  return out;
}
/** Strict: null for anything that is not canonical base64. */
export function fromBase64(text: string): Uint8Array | null {
  if (text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0, out = new Uint8Array(text.length / 4 * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = B64.indexOf(text[i]) << 18 | B64.indexOf(text[i + 1]) << 12 | (text[i + 2] === "=" ? 0 : B64.indexOf(text[i + 2])) << 6 | (text[i + 3] === "=" ? 0 : B64.indexOf(text[i + 3]));
    out[o++] = n >> 16 & 255; if (o < out.length) out[o++] = n >> 8 & 255; if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
// TextDecoder is missing on some native runtimes; a plain UTF-8 decode is enough for sniffing and the SVG sanitizer.
function utf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++], extra = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : 0;
    let code = extra ? b & (0x3f >> extra) : b;
    for (let k = 0; k < extra && i < bytes.length; k++) code = code << 6 | bytes[i++] & 0x3f;
    out += String.fromCodePoint(code > 0x10ffff ? 0xfffd : code);
  }
  return out;
}
