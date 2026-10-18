// Downloads for the Mac updater, with Node's own http(s), so files carry no quarantine flag. Every hop of a
// redirect is checked against the feed's hosts, and a file is hashed as it arrives and checked before it is used.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { allowedUrl, type Feed } from './feed';

const MAX_REDIRECTS = 8;
const TIMEOUT_MS = 30_000;
/** No latest*.yml is anywhere near this; a mac zip is ~120 MB. */
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

/** Opens a GET and follows redirects, refusing any URL outside the feed's hosts. */
export async function open(url: string, feed: Pick<Feed, 'hosts' | 'allowHttp'>, signal?: AbortSignal): Promise<IncomingMessage> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowedUrl(current, feed)) throw new Error(`Refused to download from ${safeHost(current)}.`);
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = (current.startsWith('https:') ? httpsGet : httpGet)(current, { headers: { 'user-agent': 'Lienzo-updater', accept: '*/*' }, signal, timeout: TIMEOUT_MS }, resolve);
      request.on('timeout', () => request.destroy(new Error('The update server did not answer in time.')));
      request.on('error', reject);
    });
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      current = new URL(response.headers.location, current).toString();
      continue;
    }
    if (status !== 200) { response.resume(); throw new Error(status === 404 ? 'No release was found on the update server.' : `The update server answered ${status}.`); }
    return response;
  }
  throw new Error('The update server redirected too many times.');
}
const safeHost = (url: string) => { try { return new URL(url).host || 'an unknown place'; } catch { return 'an invalid address'; } };

export async function fetchText(url: string, feed: Pick<Feed, 'hosts' | 'allowHttp'>, signal?: AbortSignal): Promise<string> {
  const response = await open(url, feed, signal), chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    size += (chunk as Buffer).length;
    if (size > MAX_TEXT_BYTES) { response.destroy(); throw new Error('The update feed is too large.'); }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Downloads to `destination` and checks its sha512 (base64, as in latest*.yml) and size. A file that does not match
 * is deleted and the download fails: nothing unverified is left behind to be used.
 */
export async function downloadVerified(url: string, destination: string, expected: { sha512: string; size?: number }, feed: Pick<Feed, 'hosts' | 'allowHttp'>, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  const response = await open(url, feed, signal);
  const total = expected.size ?? (Number(response.headers['content-length']) || 0);
  const hash = createHash('sha512');
  let received = 0, reported = -1;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      if (received > MAX_FILE_BYTES || (expected.size && received > expected.size)) { done(new Error('The download is larger than the release says.')); return; }
      hash.update(chunk);
      if (total && onProgress) { const fraction = Math.min(1, received / total); if (Math.floor(fraction * 100) !== reported) { reported = Math.floor(fraction * 100); onProgress(fraction); } }
      done(null, chunk);
    },
  });
  try {
    await pipeline(response, meter, createWriteStream(destination, { mode: 0o600 }), { signal });
    if (expected.size && received !== expected.size) throw new Error('The download is incomplete.');
    if (hash.digest('base64') !== expected.sha512) throw new Error('The download does not match the release checksum.');
  } catch (error) { await rm(destination, { force: true }); throw error; }
}

/** The sha512 of a file on disk, base64. */
export async function sha512File(path: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('base64');
}
/** True only when the file's sha512 equals the expected base64 value. */
export async function verifySha512(path: string, expected: string): Promise<boolean> {
  return (await sha512File(path)) === expected;
}
