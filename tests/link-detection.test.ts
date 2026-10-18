import test from 'node:test';
import assert from 'node:assert/strict';
import { describeLink, fetchLinkPreview, linkBlock, normaliseLink, FRAME_REFUSING_HOSTS } from '../plugin/client/media';

const ok = (raw: string, intent: Parameters<typeof describeLink>[1]) => {
  const link = describeLink(raw, intent); assert.equal(link.status, 'ok', raw); return link as Extract<typeof link, { status: 'ok' }>;
};

test('a link typed without a scheme is read as https; other schemes are refused in words', () => {
  assert.equal(normaliseLink('example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(normaliseLink('  https://example.com '), 'https://example.com/');
  assert.equal(normaliseLink('not a link'), null);
  assert.deepEqual(describeLink('', 'page'), { status: 'empty' });
  const file = describeLink('file:///home/me/cat.png', 'image'); assert.equal(file.status, 'invalid');
  assert.match((file as { message: string }).message, /Files on this computer/);
  assert.match((describeLink('javascript:alert(1)', 'page') as { message: string }).message, /web links/);
  assert.match((describeLink('hello there', 'video') as { message: string }).message, /not a web link/);
});

test('YouTube and Vimeo are detected as you paste, with a thumbnail and an oEmbed title source', () => {
  for (const intent of ['page', 'image', 'video', 'audio'] as const) {
    const yt = ok('https://youtu.be/dQw4w9WgXcQ?t=42', intent);
    assert.equal(yt.kind, 'video'); assert.equal(yt.provider, 'YouTube');
    assert.equal(yt.thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.match(yt.oembed!, /^https:\/\/www\.youtube\.com\/oembed\?format=json&url=/);
    assert.equal(!!yt.warning, false);
    if (intent !== 'video') assert.match(yt.note!, /becomes a video player/);
  }
  const vimeo = ok('vimeo.com/76979871', 'video');
  assert.equal(vimeo.provider, 'Vimeo'); assert.equal(vimeo.thumbnail, undefined); assert.match(vimeo.oembed!, /^https:\/\/vimeo\.com\/api\/oembed\.json\?url=/);
  const playlist = ok('https://www.youtube.com/playlist?list=PL123', 'video');
  assert.equal(playlist.kind, 'reference'); assert.match(playlist.warning!, /not a single video/);
});

test('files are typed by their extension, whatever sheet they were pasted in', () => {
  assert.equal(ok('https://cdn.example.com/a/cat.webp', 'image').kind, 'image');
  const image = ok('https://cdn.example.com/a/cat.webp', 'image'); assert.equal(image.name, 'cat.webp'); assert.equal(image.warning, undefined);
  const sound = ok('https://example.com/ep%201.mp3', 'video'); assert.equal(sound.kind, 'audio'); assert.equal(sound.name, 'ep 1.mp3'); assert.match(sound.note!, /a sound file, so it is added as a sound/);
  const clip = ok('https://example.com/clip.mp4', 'page'); assert.equal(clip.kind, 'video'); assert.match(clip.note!, /becomes a player/);
  assert.equal(ok('https://example.com/clip.mp4', 'video').note, 'It never starts on its own.');
});

test('a page link in an image, video or audio sheet warns that it may not play', () => {
  const image = ok('https://example.com/gallery', 'image');
  assert.equal(image.kind, 'image'); assert.match(image.warning!, /does not end in \.png/);
  assert.match(ok('https://example.com/watch', 'video').warning!, /\.mp4 or \.webm/);
  assert.match(ok('https://example.com/listen', 'audio').warning!, /\.mp3/);
});

test('a Window warns about sites that refuse to be framed, and about plain http', () => {
  const page = ok('https://lienzo.example.org/docs', 'page');
  assert.equal(page.kind, 'page'); assert.equal(page.warning, undefined); assert.match(page.note!, /sandbox/);
  for (const host of ['github.com', 'www.github.com', 'gist.github.com', 'x.com', 'docs.google.com']) assert.match(ok(`https://${host}/a`, 'page').warning!, /does not let other apps show its pages/, host);
  assert.ok(FRAME_REFUSING_HOSTS.includes('github.com'));
  assert.match(ok('http://intranet.example/a', 'page').warning!, /not secure/);
});

test('the block a link becomes: a Window titled by its caption, or Media with kind, caption and the video title', () => {
  assert.deepEqual(linkBlock(ok('example.org', 'page'), '  Docs  '), { renderer: 'preview-frame', title: 'Docs', data: { url: 'https://example.org/', description: 'Docs' } });
  assert.deepEqual(linkBlock(ok('example.org', 'page'), ''), { renderer: 'preview-frame', title: '', data: { url: 'https://example.org/', description: 'https://example.org/' } });
  assert.deepEqual(linkBlock(ok('https://youtu.be/dQw4w9WgXcQ', 'video'), 'Watch this', 'Never Gonna Give You Up'), { renderer: 'image-ref', title: 'Never Gonna Give You Up', data: { url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Watch this', mediaKind: 'video' } });
  assert.deepEqual(linkBlock(ok('https://example.com/a.png', 'image'), ''), { renderer: 'image-ref', title: '', data: { url: 'https://example.com/a.png', caption: '', mediaKind: 'image' } });
});

test('the oEmbed title and thumbnail are best effort: a failure, a bad answer or no network read as nothing', async () => {
  const calls: unknown[] = [], none = { title: null, thumbnail: null };
  assert.deepEqual(await fetchLinkPreview('https://o.example/x', async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ title: ' A talk ', thumbnail_url: 'https://i.vimeocdn.com/video/1.jpg' }) }; }), { title: 'A talk', thumbnail: 'https://i.vimeocdn.com/video/1.jpg' });
  assert.deepEqual(calls, [['https://o.example/x', { credentials: 'omit' }]]);
  assert.deepEqual(await fetchLinkPreview('u', async () => ({ ok: true, json: async () => ({ title: 'T', thumbnail_url: 'javascript:alert(1)' }) })), { title: 'T', thumbnail: null });
  assert.deepEqual(await fetchLinkPreview('u', async () => ({ ok: false, json: async () => ({ title: 'x' }) })), none);
  assert.deepEqual(await fetchLinkPreview('u', async () => ({ ok: true, json: async () => ({ title: 3 }) })), none);
  assert.deepEqual(await fetchLinkPreview('u', async () => { throw new Error('offline'); }), none);
  assert.deepEqual(await fetchLinkPreview('u', undefined), none);
});
