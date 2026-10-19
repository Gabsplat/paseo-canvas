import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { CanvasError } from "../shared/errors";
import { MEDIA_LIMITS, mediaRef, parseMediaRef, prepareImage } from "../shared/media";
import { atomicWrite } from "./store";

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Image files beside the Lienzo data (`<canvas directory>/media/<sha256>.<ext>`), in both hosts: the desktop app's
 * userData/canvas/media and the Paseo plugin's ~/.paseo/canvas/media. Content-addressed, so the same bytes are kept
 * once and a reference never changes meaning. Files are written whole (temporary file, then rename) and never edited.
 */
export class MediaStore {
  readonly directory: string;
  constructor(canvasDirectory: string) { this.directory = join(canvasDirectory, "media"); }

  async put(base64: string): Promise<{ url: string; mime: string; bytes: number; existed: boolean }> {
    if (base64.length > Math.ceil(MEDIA_LIMITS.bytes * 4 / 3) + 4) throw new CanvasError("TOO_LARGE", `Images can be up to ${MEDIA_LIMITS.bytes / 1024 / 1024} MB.`);
    if (base64.length % 4 || !BASE64.test(base64)) throw new CanvasError("VALIDATION", "The image data is not base64.");
    let image;
    try { image = prepareImage(new Uint8Array(Buffer.from(base64, "base64"))); }
    catch (error) { throw new CanvasError((error as { code?: string }).code === "TOO_LARGE" ? "TOO_LARGE" : "VALIDATION", (error as Error).message); }
    const hash = createHash("sha256").update(image.bytes).digest("hex"), url = mediaRef(hash, image.extension), file = join(this.directory, `${hash}.${image.extension}`);
    const existed = await stat(file).then(s => s.isFile() && s.size === image.bytes.length, () => false);
    if (!existed) { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await atomicWrite(file, image.bytes); }
    return { url, mime: image.mime, bytes: image.bytes.length, existed };
  }

  async read(url: string): Promise<{ mime: string; data: string; bytes: number }> {
    const ref = parseMediaRef(url);
    if (!ref) throw new CanvasError("VALIDATION", "Not a Lienzo image reference.");
    let bytes: Buffer;
    try { bytes = await readFile(join(this.directory, `${ref.hash}.${ref.extension}`)); }
    catch { throw new CanvasError("NOT_FOUND", "That image is not stored on this computer."); }
    // The name is the content: a file that no longer matches it is not served.
    if (createHash("sha256").update(bytes).digest("hex") !== ref.hash) throw new CanvasError("NOT_FOUND", "That image file is damaged.");
    return { mime: ref.mime, data: bytes.toString("base64"), bytes: bytes.length };
  }
}
