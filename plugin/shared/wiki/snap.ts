/**
 * "Snap (example)": the example of presentation (docs/extensions.md, "Presentation" and "Overlay effects"). An overlay
 * that hides the selected cards, turns them to dust where they were, then asks whether to delete them for good or
 * bring them back. It is example code, not installed by itself: Help → Make your own → "7. How it appears" shows it,
 * and the catalog repository ships it as extensions/snap (tests/wiki.test.ts keeps the two equal).
 *
 * It uses: presentation { mode: "overlay" }, lienzo.view.get().rects (where cards are on screen), lienzo.view.snapshot
 * (their pixels, in the desktop app; elsewhere it draws a stand-in card), lienzo.hide / lienzo.show,
 * lienzo.ui.capturePointer while it asks, lienzo.keys, lienzo.input from canvas_extension_open, and lienzo.edit.
 */
export const SNAP_HTML = `<style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
.pill,.ask{position:fixed;display:none;border:1px solid;box-shadow:0 10px 30px rgba(0,0,0,.18)}
.pill{left:50%;bottom:92px;transform:translateX(-50%);padding:7px 14px;border-radius:999px;white-space:nowrap}
.ask{width:264px;padding:14px 16px 12px;border-radius:12px}
.ask b{display:block;font-size:14px;margin-bottom:2px}.ask p{margin:0 0 12px;opacity:.75}
.row{display:flex;gap:8px;justify-content:flex-end}
button{font:inherit;font-weight:600;padding:6px 12px;border-radius:8px;border:1px solid;cursor:pointer}
kbd{font:inherit;font-weight:600}
</style>
<canvas id="dust"></canvas>
<div class="pill" id="hint"></div>
<div class="ask" id="ask" role="dialog" aria-label="Snap"><b id="title"></b><p id="text"></p>
<div class="row"><button id="back">Bring back</button><button id="del">Delete</button></div></div>
<script>
var cv = document.getElementById('dust'), g = cv.getContext('2d'), hint = document.getElementById('hint'), ask = document.getElementById('ask');
var back = document.getElementById('back'), del = document.getElementById('del');
var ctx = null, k = null, dust = [], pictures = [], snapped = [], phase = 'idle', t0 = 0, W = 0, H = 0, dpr = 1, at = { x: 0, y: 0 }, pending = null, job = {};
function size() { dpr = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; }
addEventListener('resize', size); size();

// Colours from the theme, so it reads in light and dark.
function paint() {
  hint.style.background = ask.style.background = k.surface; hint.style.color = ask.style.color = k.foreground;
  hint.style.borderColor = ask.style.borderColor = k.border;
  back.style.background = 'transparent'; back.style.color = k.foreground; back.style.borderColor = k.border;
  del.style.background = k.accent; del.style.color = k.background; del.style.borderColor = k.accent;
}
function cards(ids) {
  var by = {}; ctx.document.blocks.forEach(function (b) { by[b.id] = b; });
  return ids.filter(function (id) { return by[id]; }).map(function (id) { return by[id]; });
}
function idle() {
  phase = 'idle'; ask.style.display = 'none'; lienzo.ui.capturePointer(false);
  var n = cards(ctx.selection).length;
  hint.innerHTML = n ? 'Press <kbd>Enter</kbd> to snap ' + n + (n === 1 ? ' card' : ' cards') + ' · <kbd>Esc</kbd> closes' : 'Select cards, then press <kbd>Enter</kbd> · <kbd>Esc</kbd> closes';
  hint.style.display = 'block';
}
lienzo.onContext(function (c) {
  ctx = c; k = c.theme.colors; glow = rgb(k.needs); paint();
  if (pending) { var w = pending; pending = null; snap(w); } else if (phase === 'idle') idle();
});
// An agent can open it on given cards: canvas_extension_open { extension: "snap", input: { ids, delete? } }.
lienzo.onInput(function (input) { if (input && input.ids) { if (ctx) snap(input); else pending = input; } });
lienzo.keys.bind('Enter', function () { if (phase === 'idle') snap({}); });

function load(url) { return new Promise(function (ok) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { ok(null); }; i.src = url; }); }
// A card as Lienzo draws it, when no snapshot can be taken (in a browser): its surface, border, title and summary.
function standIn(o, w, h, b) {
  var fit = function (t, max) { t = String(t || ''); while (t && o.measureText(t).width > max) t = t.slice(0, -2) + '…'; return t; };
  o.beginPath(); o.roundRect(0.5, 0.5, w - 1, h - 1, 8); o.fillStyle = k.surface; o.fill(); o.strokeStyle = k.border; o.lineWidth = 1; o.stroke();
  o.textBaseline = 'top'; o.fillStyle = k.foreground; o.font = '600 14px system-ui,-apple-system,"Segoe UI",sans-serif'; o.fillText(fit(b.title, w - 24), 12, 12);
  var text = b.data && (b.data.summary || b.data.text); if (text && h > 44) { o.fillStyle = k.muted; o.font = '12px system-ui,-apple-system,"Segoe UI",sans-serif'; o.fillText(fit(text, w - 24), 12, 35); }
}
// Every few pixels of a card become one grain: it waits its turn (left to right, a little at random), then drifts off.
function grains(r, img, shot, b) {
  var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)), off = document.createElement('canvas'), o = off.getContext('2d');
  off.width = Math.round(w * dpr); off.height = Math.round(h * dpr); o.scale(dpr, dpr);
  if (img && shot) { var sx = img.naturalWidth / shot.width, sy = img.naturalHeight / shot.height; o.drawImage(img, (r.x - shot.x) * sx, (r.y - shot.y) * sy, r.width * sx, r.height * sy, 0, 0, w, h); }
  else standIn(o, w, h, b);
  // The card stays a crisp picture; each grain is cut out of it as it leaves.
  var card = { off: off, o: o, x: r.x, y: r.y, w: w, h: h }; pictures.push(card);
  var px = o.getImageData(0, 0, off.width, off.height).data, s = Math.max(2, Math.round(Math.sqrt(w * h / 3000)));
  for (var y = 0; y < h; y += s) for (var x = 0; x < w; x += s) {
    var i = (Math.min(off.height - 1, Math.round((y + s / 2) * dpr)) * off.width + Math.min(off.width - 1, Math.round((x + s / 2) * dpr))) * 4; if (px[i + 3] < 12) continue;
    // Once it flies, one grain in four glows a little in the canvas' violet, so the dust reads on any card and theme.
    var c = [px[i], px[i + 1], px[i + 2]], f = Math.random() < .25 ? mix(c, glow, .6) : c;
    dust.push({ card: card, lx: x, ly: y, x: r.x + x, y: r.y + y, s: s, out: false, c: 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',', f: 'rgba(' + f[0] + ',' + f[1] + ',' + f[2] + ',', wait: (x / w * .7 + (1 - y / h) * .15 + Math.random() * .3) * 1300,
      vx: 40 + Math.random() * 110, vy: -30 - Math.random() * 80, life: 1 + Math.random() * .9, seed: Math.random() * 6.3 });
  }
}
function rgb(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); var n = m ? parseInt(m[1], 16) : 0x8a6cf0; return [n >> 16, n >> 8 & 255, n & 255]; }
function mix(a, b, t) { return [0, 1, 2].map(function (j) { return Math.round(a[j] + (b[j] - a[j]) * t); }); }
var glow = [138, 108, 240];
function frame(now) {
  var t = now - t0, alive = 0; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  for (var i = 0; i < dust.length; i++) { var p = dust[i]; if (!p.out && t >= p.wait) { p.out = true; p.card.o.clearRect(p.lx - .5, p.ly - .5, p.s + 1, p.s + 1); } }
  pictures.forEach(function (c) { g.drawImage(c.off, c.x, c.y, c.w, c.h); });
  for (var j = 0; j < dust.length; j++) {
    var q = dust[j], e = (t - q.wait) / 1000; if (e < 0) { alive++; continue; }
    var a = 1 - e / q.life; if (a <= 0) continue; alive++;
    g.fillStyle = (e < .12 ? q.c : q.f) + a.toFixed(3) + ')';
    g.fillRect(q.x + q.vx * e + Math.sin(q.seed + e * 4) * 10 * e, q.y + q.vy * e - 24 * e * e, q.s * (0.6 + a * .4), q.s * (0.6 + a * .4));
  }
  if (alive) requestAnimationFrame(frame); else done();
}
function snap(input) {
  if (phase !== 'idle') return;
  var list = cards(input.ids && input.ids.length ? input.ids : ctx.selection);
  if (!list.length) return idle();
  if (!lienzo.view || ctx.extension.permissions.indexOf('view') < 0) { hint.textContent = 'Allow Snap to see the view first (the chip above has Allow).'; return; }
  phase = 'dust'; hint.style.display = 'none'; job = input;
  lienzo.view.get().then(function (view) {
    list = list.filter(function (b) { return view.rects[b.id]; });
    if (!list.length) return idle();
    var ids = list.map(function (b) { return b.id; });
    var shot = lienzo.view.canSnapshot ? lienzo.view.snapshot(ids).catch(function () { return null; }) : Promise.resolve(null);
    return shot.then(function (s) { return (s ? load(s.url) : Promise.resolve(null)).then(function (img) {
      dust = []; pictures = []; list.forEach(function (b) { grains(view.rects[b.id], img, s && s.rect, b); });
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      ids.forEach(function (id) { var r = view.rects[id]; x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height); });
      at = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; snapped = ids;
      // Hidden only on this screen, never saved; back by themselves after a minute, or when Snap closes.
      return lienzo.hide(ids, { ms: 60000 }).then(function () { t0 = performance.now(); requestAnimationFrame(frame); });
    }); });
  }).catch(function (err) { phase = 'idle'; hint.textContent = err.message; hint.style.display = 'block'; });
}
function done() {
  pictures = []; dust = []; g.clearRect(0, 0, W, H); var input = job; job = {};
  if (input.delete === true) return remove();
  if (input.delete === false) return restore();
  phase = 'ask'; var n = snapped.length;
  document.getElementById('title').textContent = n === 1 ? 'One card turned to dust' : n + ' cards turned to dust';
  var can = ctx.extension.permissions.indexOf('edit') >= 0;
  document.getElementById('text').textContent = can ? 'Delete them for good (Undo still works), or bring them back.' : 'Snap may not change the canvas, so they can only come back.';
  del.style.display = can ? '' : 'none';
  ask.style.left = Math.max(12, Math.min(W - 276, at.x - 132)) + 'px'; ask.style.top = Math.max(12, Math.min(H - 140, at.y - 50)) + 'px'; ask.style.display = 'block';
  // The overlay lets clicks through to the canvas; while it asks, it takes them.
  lienzo.ui.capturePointer(true); del.focus();
}
function restore() { lienzo.show(snapped).then(idle); }
function remove() {
  var n = snapped.length;
  lienzo.edit(snapped.map(function (id) { return { type: 'block.delete', id: id }; }), n === 1 ? 'Snap a card' : 'Snap ' + n + ' cards')
    .then(function () { return lienzo.show(snapped); }, function (err) { document.getElementById('text').textContent = err.message; return lienzo.show(snapped); })
    .then(idle);
}
back.onclick = restore; del.onclick = remove;
</script>`;
export const SNAP_DOCS = `An example of an extension that draws over the canvas. Snap turns the selected cards to dust where they are, then asks whether to delete them or bring them back.

## Use it

1. Select some cards.
2. Open **Snap (example)** from the + catalog (Extensions). A small chip at the top says it draws over the canvas.
3. Press **Enter**. The cards crumble away.
4. Press **Delete** to remove them in one step you can undo, or **Bring back**.

> Esc closes it at any moment, and anything it hid comes back. It asks to move the view of the canvas (to see where the cards are) and to change the canvas (to delete them).`;
/** The whole extension, as save_extension takes it. Example code: nothing installs it by itself. */
export const SNAP_EXTENSION = { id: "snap", kind: "tool", api: 1, name: "Snap (example)", description: "Example: turns the selected cards to dust over the canvas, then deletes them or brings them back.", icon: "Sparkles",
  permissions: ["view", "edit"], presentation: { mode: "overlay", accent: "violet" }, html: SNAP_HTML, docs: SNAP_DOCS } as const;
/** The same extension as a file: what the catalog repository holds (marketplace/extensions/snap/extension.json). */
export const SNAP_FILE = { format: "paseo-canvas-pack", version: 1, id: "snap", name: "Snap (example)", description: SNAP_EXTENSION.description, blockTypes: [], templates: [], documents: [], extensions: [{ ...SNAP_EXTENSION, id: "snap.snap" }] } as const;
