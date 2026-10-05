/* Lienzo · explicador de arquitectura. Sin dependencias: SVG propio con paneo y zoom. */
(function () {
  "use strict";

  const A = window.ARCH;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const nodeById = new Map(A.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(A.edges.map((e) => [e.id, e]));
  const zoneById = new Map(A.zones.map((z) => [z.id, z]));
  const reducedMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ICONS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
    cursor: '<path d="M5 3l14 8-6 2-2 6z"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5M12 8v4l3 2"/>',
    database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    package: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
    send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
    hook: '<circle cx="14" cy="4.5" r="1.5"/><path d="M14 6v7a4 4 0 0 1-8 0v-3M3.5 12.5L6 10l2.5 2.5"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V5M9 13v2M15 13v2"/><circle cx="12" cy="4" r="1"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.5 2.4 3.5 5.2"/>',
    merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 9c0 3 4 3 10 3"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M15 10h3M15 14h3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    note: '<path d="M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 13h4"/>',
    group: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    box: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="2.6"/>',
    prev: '<path d="M15 6l-6 6 6 6"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
  };

  const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function el(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(node);
    return node;
  }

  /* ───────── Estado ───────── */

  const state = {
    mode: "explorar",
    selected: null,
    flow: A.flows[0].id,
    step: 0,
    playing: false,
    follow: true,
    multi: "hoy",
  };
  const view = { x: 0, y: 0, k: 1 };
  const K_MIN = 0.25;
  const K_MAX = 2.4;

  const svg = $("canvas");
  const world = $("world");
  const side = $("side");
  const zoneEls = new Map();
  const nodeEls = new Map();
  const edgeEls = new Map();
  const edgePaths = new Map();

  /* ───────── Dibujo ───────── */

  const SIDE_DIR = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] };

  function anchor(n, s) {
    if (s === "t") return [n.x + n.w / 2, n.y];
    if (s === "b") return [n.x + n.w / 2, n.y + n.h];
    if (s === "l") return [n.x, n.y + n.h / 2];
    return [n.x + n.w, n.y + n.h / 2];
  }

  function autoSides(a, b) {
    if (a.x + a.w <= b.x) return ["r", "l"];
    if (b.x + b.w <= a.x) return ["l", "r"];
    return a.y < b.y ? ["b", "t"] : ["t", "b"];
  }

  function edgeGeometry(e) {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    const sides = e.sides || autoSides(a, b);
    const gapA = e.both ? 4 : 1;
    const gapB = 4;
    const da = SIDE_DIR[sides[0]];
    const db = SIDE_DIR[sides[1]];
    let [x1, y1] = anchor(a, sides[0]);
    let [x2, y2] = anchor(b, sides[1]);
    x1 += da[0] * gapA; y1 += da[1] * gapA;
    x2 += db[0] * gapB; y2 += db[1] * gapB;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const d = Math.max(22, Math.min(150, dist * 0.42));
    return `M${x1} ${y1} C${x1 + da[0] * d} ${y1 + da[1] * d} ${x2 + db[0] * d} ${y2 + db[1] * d} ${x2} ${y2}`;
  }

  function build() {
    const zonesG = $("zones");
    A.zones.forEach((z) => {
      const g = el("g", { class: `zone z-${z.id}` }, zonesG);
      el("rect", { x: z.x, y: z.y, width: z.w, height: z.h, rx: 14 }, g);
      const tab = el("rect", { class: "zone-tab", x: z.x + 14, y: z.y - 9, width: 10, height: 18, rx: 4 }, g);
      const label = el("text", { x: z.x + 22, y: z.y + 4 }, g);
      label.textContent = z.title;
      zoneEls.set(z.id, { g, tab, label });
    });

    const edgesG = $("edges");
    A.edges.forEach((e) => {
      const g = el("g", { class: "edge" + (e.both ? " is-both" : "") }, edgesG);
      const path = el("path", { d: edgeGeometry(e) }, g);
      edgeEls.set(e.id, g);
      edgePaths.set(e.id, path);
      if (e.label) {
        const text = el("text", {}, g);
        text.textContent = e.label;
        e._text = text;
      }
    });

    const nodesG = $("nodes");
    A.nodes.forEach((n) => {
      const g = el("g", {
        class: `node z-${n.zone}` + (n.status === "futuro" ? " is-future" : ""),
        transform: `translate(${n.x} ${n.y})`,
        tabindex: 0,
        role: "button",
        "aria-label": `${n.title}. ${n.sub}. ${zoneById.get(n.zone).title}`,
        "data-node": n.id,
      }, nodesG);
      el("rect", { class: "node-halo", x: -3, y: -3, width: n.w + 6, height: n.h + 6, rx: 13 }, g);
      el("rect", { class: "node-bg", width: n.w, height: n.h, rx: 10 }, g);
      el("rect", { class: "node-spine", x: 0, y: 12, width: 3, height: n.h - 24, rx: 1.5 }, g);
      el("rect", { class: "node-chip", x: 13, y: 12, width: 36, height: 36, rx: 8 }, g);
      const ic = el("g", { class: "node-icon", transform: "translate(21 20) scale(0.8333)" }, g);
      ic.innerHTML = ICONS[n.icon] || "";
      el("text", { class: "node-title", x: 60, y: 27 }, g).textContent = n.title;
      el("text", { class: "node-sub", x: 60, y: 44 }, g).textContent = n.sub;
      nodeEls.set(n.id, g);
    });

    /* Medidas que dependen del texto ya renderizado. */
    requestAnimationFrame(layoutText);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutText);
  }

  function layoutText() {
    zoneEls.forEach(({ tab, label }) => {
      let w = 0;
      try { w = label.getComputedTextLength(); } catch (e) { w = 0; }
      if (!w) w = label.textContent.length * 7.1;
      tab.setAttribute("width", Math.ceil(w + 16));
    });
    A.edges.forEach((e) => {
      if (!e._text) return;
      const path = edgePaths.get(e.id);
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      e._text.setAttribute("x", p.x);
      e._text.setAttribute("y", p.y + 3.5);
    });
  }

  /* ───────── Vista: paneo y zoom ───────── */

  function applyView() {
    world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
    $("zoom-level").textContent = Math.round(view.k * 100) + "%";
    svg.classList.toggle("lod-low", view.k < 0.55);
  }

  let tween = 0;
  function animateTo(target, ms) {
    cancelAnimationFrame(tween);
    if (reducedMotion || !ms) {
      Object.assign(view, target);
      applyView();
      return;
    }
    const from = { x: view.x, y: view.y, k: view.k };
    const start = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    (function frame(now) {
      const t = Math.min(1, (now - start) / ms);
      const q = ease(t);
      view.x = from.x + (target.x - from.x) * q;
      view.y = from.y + (target.y - from.y) * q;
      view.k = from.k + (target.k - from.k) * q;
      applyView();
      if (t < 1) tween = requestAnimationFrame(frame);
    })(start);
  }

  function boundsOf(ids) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    ids.forEach((id) => {
      const n = nodeById.get(id);
      if (!n) return;
      x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h);
    });
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function worldBounds() {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    A.zones.forEach((z) => {
      x1 = Math.min(x1, z.x); y1 = Math.min(y1, z.y - 12);
      x2 = Math.max(x2, z.x + z.w); y2 = Math.max(y2, z.y + z.h);
    });
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function fit(b, opts) {
    opts = opts || {};
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pad = opts.pad == null ? 36 : opts.pad;
    const bottom = (state.mode === "flujos" ? 96 : 52) + (opts.extraBottom || 0);
    const availW = Math.max(60, r.width - pad * 2);
    const availH = Math.max(60, r.height - pad - bottom);
    let k = Math.min(availW / b.w, availH / b.h);
    k = Math.max(K_MIN, Math.min(opts.maxK || 1.25, k));
    const target = {
      k,
      x: pad + (availW - b.w * k) / 2 - b.x * k,
      y: pad + (availH - b.h * k) / 2 - b.y * k,
    };
    animateTo(target, opts.instant ? 0 : 480);
  }

  const fitAll = (instant) => fit(worldBounds(), { instant, pad: 28, maxK: 1.1 });

  function zoomAt(cx, cy, factor) {
    const k = Math.max(K_MIN, Math.min(K_MAX, view.k * factor));
    const f = k / view.k;
    view.x = cx - (cx - view.x) * f;
    view.y = cy - (cy - view.y) * f;
    view.k = k;
    applyView();
  }

  function zoomCenter(factor) {
    const r = svg.getBoundingClientRect();
    cancelAnimationFrame(tween);
    zoomAt(r.width / 2, r.height / 2, factor);
  }

  const pointers = new Map();
  let drag = null;
  let pinch = null;

  function hideHint() { $("hint").classList.add("is-gone"); }

  svg.addEventListener("pointerdown", (ev) => {
    /* Botón central (ruedita): pan libre en X e Y; se evita el autoscroll del navegador. */
    const middle = ev.button === 1;
    if (ev.button > 1) return;
    if (middle) ev.preventDefault();
    cancelAnimationFrame(tween);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
    if (pointers.size === 1) {
      const target = !middle && ev.target.closest ? ev.target.closest("[data-node]") : null;
      drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: middle, node: target ? target.dataset.node : null };
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
      if (drag) drag.moved = true;
    }
  });

  svg.addEventListener("pointermove", (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    const prev = pointers.get(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2 && pinch) {
      const pts = [...pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const r = svg.getBoundingClientRect();
      const cx = (pts[0].x + pts[1].x) / 2 - r.left;
      const cy = (pts[0].y + pts[1].y) / 2 - r.top;
      if (pinch.d > 0) zoomAt(cx, cy, d / pinch.d);
      pinch.d = d;
      view.x += (ev.clientX - prev.x) / 2;
      view.y += (ev.clientY - prev.y) / 2;
      applyView();
      hideHint();
      return;
    }
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    svg.classList.add("is-panning");
    view.x = drag.vx + dx;
    view.y = drag.vy + dy;
    applyView();
    hideHint();
  });

  function endPointer(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      drag = { x: p.x, y: p.y, vx: view.x, vy: view.y, moved: true, node: null };
      return;
    }
    svg.classList.remove("is-panning");
    const d = drag;
    drag = null;
    if (!d || d.moved || ev.type === "pointercancel") return;
    if (d.node) selectNode(d.node);
    else if (state.mode === "explorar" && state.selected) selectNode(null);
  }
  svg.addEventListener("mousedown", (ev) => { if (ev.button === 1) ev.preventDefault(); });
  svg.addEventListener("auxclick", (ev) => { if (ev.button === 1) ev.preventDefault(); });
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    cancelAnimationFrame(tween);
    const r = svg.getBoundingClientRect();
    const isMouseWheel = ev.deltaMode !== 0 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 50 && Number.isInteger(ev.deltaY));
    if (ev.ctrlKey || ev.metaKey || isMouseWheel) {
      const unit = ev.deltaMode === 1 ? 0.05 : ev.ctrlKey ? 0.01 : 0.0015;
      zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * unit));
    } else {
      view.x -= ev.deltaX;
      view.y -= ev.deltaY;
      applyView();
    }
    hideHint();
  }, { passive: false });

  svg.addEventListener("keydown", (ev) => {
    const nodeTarget = ev.target.closest ? ev.target.closest("[data-node]") : null;
    if (nodeTarget && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      ev.stopPropagation();
      selectNode(nodeTarget.dataset.node);
      return;
    }
    const step = ev.shiftKey ? 160 : 60;
    const pan = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[ev.key];
    if (!pan) return;
    /* En Flujos, ← y → cambian de paso; con Mayús mueven la vista. */
    if (state.mode === "flujos" && (ev.key === "ArrowLeft" || ev.key === "ArrowRight") && !ev.shiftKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    cancelAnimationFrame(tween);
    view.x += pan[0];
    view.y += pan[1];
    applyView();
  });

  $("zoom-in").addEventListener("click", () => zoomCenter(1.25));
  $("zoom-out").addEventListener("click", () => zoomCenter(0.8));
  $("zoom-fit").addEventListener("click", () => fitAll(false));

  /* ───────── Enfoque ───────── */

  function setFocus(nodes, edges) {
    const has = !!(nodes && nodes.size);
    svg.classList.toggle("has-focus", has);
    const zonesOn = new Set();
    nodeEls.forEach((g, id) => {
      const on = has && nodes.has(id);
      g.classList.toggle("is-on", on);
      if (on) zonesOn.add(nodeById.get(id).zone);
    });
    edgeEls.forEach((g, id) => g.classList.toggle("is-on", has && !!edges && edges.has(id)));
    zoneEls.forEach(({ g }, id) => g.classList.toggle("is-on", zonesOn.has(id)));
    nodeEls.forEach((g, id) => g.classList.toggle("is-selected", state.mode === "explorar" && id === state.selected));
  }

  function neighbours(id) {
    const nodes = new Set([id]);
    const edges = new Set();
    A.edges.forEach((e) => {
      if (e.from === id || e.to === id) {
        edges.add(e.id);
        nodes.add(e.from);
        nodes.add(e.to);
      }
    });
    return { nodes, edges };
  }

  /* ───────── Paquetes animados ───────── */

  const packetsG = $("packets");
  let packetRaf = 0;

  function stopPackets() {
    cancelAnimationFrame(packetRaf);
    packetsG.textContent = "";
    edgeEls.forEach((g) => g.classList.remove("is-hot"));
  }

  function runPackets(pathSpec) {
    stopPackets();
    if (reducedMotion || !pathSpec.length) return;
    const segs = pathSpec.map((spec) => {
      const rev = spec.endsWith("<");
      const id = rev ? spec.slice(0, -1) : spec;
      const path = edgePaths.get(id);
      return { id, rev, path, len: path.getTotalLength() };
    });
    const ring = el("circle", { class: "packet-ring", r: 11 }, packetsG);
    const dot = el("circle", { class: "packet", r: 5 }, packetsG);
    const SPEED = 0.42; /* unidades de lienzo por ms */
    const durs = segs.map((s) => Math.max(380, s.len / SPEED));
    const total = durs.reduce((a, b) => a + b, 0);
    const PAUSE = 650;
    const start = performance.now();
    let hot = null;
    (function frame(now) {
      let t = (now - start) % (total + PAUSE);
      let i = 0;
      while (i < segs.length && t > durs[i]) { t -= durs[i]; i++; }
      if (i >= segs.length) {
        dot.setAttribute("opacity", 0);
        ring.setAttribute("opacity", 0);
        if (hot) { edgeEls.get(hot).classList.remove("is-hot"); hot = null; }
      } else {
        const s = segs[i];
        const q = t / durs[i];
        const p = s.path.getPointAtLength((s.rev ? 1 - q : q) * s.len);
        dot.setAttribute("opacity", 1);
        ring.setAttribute("opacity", 1);
        dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y);
        ring.setAttribute("cx", p.x); ring.setAttribute("cy", p.y);
        if (hot !== s.id) {
          if (hot) edgeEls.get(hot).classList.remove("is-hot");
          edgeEls.get(s.id).classList.add("is-hot");
          hot = s.id;
        }
      }
      packetRaf = requestAnimationFrame(frame);
    })(start);
  }

  /* ───────── Panel lateral ───────── */

  const zoneVar = (zone) => `style="--zc: var(--z-${zone})"`;

  function renderIntro() {
    const quick = ["service", "m-group", "feedback", "bridge", "catalog", "m-instr"];
    return `
      <div>
        <p class="eyebrow">Visión general</p>
        <h1>Un lienzo que el agente construye y la persona responde</h1>
      </div>
      <p class="lead">Lienzo es un panel de Paseo junto a la conversación. El agente crea bloques y grupos con herramientas MCP; la persona los lee, selecciona y actúa; esas acciones vuelven al agente como contexto estructurado.</p>
      <section>
        <h2>Cinco ideas</h2>
        <dl class="defs">${A.principles.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join("")}</dl>
      </section>
      <section>
        <h2>Empieza por</h2>
        <div class="quick">${quick.map((id) => `<button type="button" data-go-node="${id}">${esc(nodeById.get(id).title)}</button>`).join("")}</div>
      </section>
      <section>
        <h2>Cómo leer el mapa</h2>
        <div class="legend">
          ${A.zones.filter((z) => z.id !== "futuro").map((z) => `<span ${zoneVar(z.id)}><i></i>${esc(z.title.split(" · ")[0])}</span>`).join("")}
          <span><i class="dash"></i>Planeado, no construido</span>
          <span><i class="pk"></i>Dato en movimiento</span>
        </div>
      </section>
      <section>
        <h2>Planeado, fuera de la v1</h2>
        <ul class="list muted">${A.planned.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      </section>
      <p class="note">Los nombres de RPC, operaciones y campos de este mapa son los de <code>plugin/shared/model.ts</code> y <code>rpc.ts</code>. Los datos de los ejemplos son ilustrativos.</p>`;
  }

  function renderNode(n) {
    const zone = zoneById.get(n.zone);
    const out = A.edges.filter((e) => e.from === n.id);
    const inc = A.edges.filter((e) => e.to === n.id);
    const linkRow = (e, otherId, dir) => {
      const o = nodeById.get(otherId);
      return `<button type="button" class="link" data-go-node="${o.id}" ${zoneVar(o.zone)}>
        <span class="dir" aria-hidden="true">${dir}</span><span class="sw"></span>
        <span class="name">${esc(o.title)}</span><span class="via">${esc(e.label || "")}</span></button>`;
    };
    const inFlows = [];
    A.flows.forEach((f) => {
      const i = f.steps.findIndex((s) => s.nodes.includes(n.id));
      if (i >= 0) inFlows.push({ f, i });
    });
    return `
      <button type="button" class="back" data-go-node="">${icon("back")}Visión general</button>
      <div ${zoneVar(n.zone)}>
        <p class="eyebrow tone">${esc(zone.title)}</p>
        <h1>${esc(n.title)}</h1>
        <div class="head-row" style="margin-top:8px">
          ${n.status === "futuro" ? '<span class="chip future">Planeado · no construido</span>' : '<span class="chip real">En la v1</span>'}
          <span class="muted">${esc(n.sub)}</span>
        </div>
      </div>
      <p class="lead">${esc(n.what)}</p>
      ${n.duties.length ? `<section><h2>${n.status === "futuro" ? "Qué haría falta" : "Responsabilidades"}</h2><ul class="list">${n.duties.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></section>` : ""}
      ${n.contract ? `<section><h2>Contrato</h2><pre class="code">${esc(n.contract)}</pre></section>` : ""}
      ${n.apis.length ? `<section><h2>Se apoya en</h2><div class="apis">${n.apis.map((a) => `<code>${esc(a)}</code>`).join("")}</div></section>` : ""}
      ${out.length + inc.length ? `<section><h2>Conecta con</h2><div class="links">
        ${out.map((e) => linkRow(e, e.to, "→")).join("")}${inc.map((e) => linkRow(e, e.from, "←")).join("")}</div></section>` : ""}
      ${inFlows.length ? `<section><h2>Aparece en</h2><div class="links">${inFlows.map(({ f, i }) =>
        `<button type="button" class="link" data-go-flow="${f.id}" data-go-step="${i}"><span class="dir">${icon(f.icon)}</span><span class="name">${esc(f.title)}</span><span class="via">paso ${i + 1}</span></button>`).join("")}</div></section>` : ""}
      <section><h2>Dónde vive</h2><p class="owner">${esc(n.owner)}</p></section>`;
  }

  function renderFlows() {
    const flow = currentFlow();
    return `
      <div>
        <p class="eyebrow">Flujos paso a paso</p>
        <h1>${esc(flow.title)}</h1>
      </div>
      <p class="lead">${esc(flow.summary)}</p>
      <div class="now-card">
        <p class="eyebrow">Paso ${state.step + 1} de ${flow.steps.length}</p>
        <b>${esc(flow.steps[state.step].title)}</b>
        <p>${esc(flow.steps[state.step].text)}</p>
        ${flow.steps[state.step].code ? `<pre class="code">${esc(flow.steps[state.step].code)}</pre>` : ""}
      </div>
      <div class="flow-tabs">${A.flows.map((f) => `
        <button type="button" class="flow-tab" data-go-flow="${f.id}" aria-pressed="${f.id === flow.id}">
          ${icon(f.icon)}<b>${esc(f.title)}</b><span class="n">${f.steps.length} pasos</span></button>`).join("")}</div>
      <section>
        <h2>Pasos</h2>
        <ol class="steps">${flow.steps.map((s, i) => `
          <li class="${i === state.step ? "is-now" : i < state.step ? "is-done" : ""}">
            <button type="button" class="step-head" data-go-step="${i}" aria-current="${i === state.step ? "step" : "false"}">${esc(s.title)}</button>
            ${i === state.step ? `<div class="step-body"><p>${esc(s.text)}</p>${s.code ? `<pre class="code">${esc(s.code)}</pre>` : ""}</div>` : ""}
          </li>`).join("")}</ol>
      </section>
      <p class="note">Los valores de los ejemplos (ids, revisiones, textos) son ilustrativos. No es salida en vivo de un agente.</p>`;
  }

  function renderMulti() {
    const m = A.multiplayer[state.multi];
    return `
      <div>
        <p class="eyebrow">Multijugador</p>
        <h1>${esc(m.title)}</h1>
      </div>
      <div class="seg" role="group" aria-label="Estado">
        <button type="button" data-go-multi="hoy" aria-pressed="${state.multi === "hoy"}">Hoy · real</button>
        <button type="button" data-go-multi="futuro" aria-pressed="${state.multi === "futuro"}">Futuro · planeado</button>
      </div>
      <p class="lead">${esc(m.lead)}</p>
      <dl class="defs">${m.points.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join("")}</dl>
      ${m.ready ? `<section><h2>Lo que ya queda preparado</h2><ul class="list">${m.ready.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></section>` : ""}
      <section>
        <h2>Lado a lado</h2>
        <table class="cmp">
          <thead><tr><th></th><th>Hoy</th><th>Futuro</th></tr></thead>
          <tbody>${A.compare.map(([k, a, b]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(a)}</td><td class="fut">${esc(b)}</td></tr>`).join("")}</tbody>
        </table>
      </section>`;
  }

  side.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.goFlow) {
      setFlow(t.dataset.goFlow, t.dataset.goStep ? +t.dataset.goStep : 0);
    } else if (t.dataset.goStep != null && t.dataset.goStep !== "") {
      pause();
      setStep(+t.dataset.goStep);
    } else if (t.dataset.goNode != null) {
      selectNode(t.dataset.goNode || null, true);
    } else if (t.dataset.goMulti) {
      state.multi = t.dataset.goMulti;
      render(true);
    }
  });

  /* ───────── Flujos ───────── */

  const currentFlow = () => A.flows.find((f) => f.id === state.flow) || A.flows[0];
  let playTimer = 0;

  function setFlow(id, step) {
    pause();
    state.mode = "flujos";
    state.flow = id;
    state.step = Math.max(0, Math.min(currentFlow().steps.length - 1, step || 0));
    render(true);
  }

  function setStep(i) {
    const n = currentFlow().steps.length;
    state.step = Math.max(0, Math.min(n - 1, i));
    render(true);
  }

  function schedule() {
    clearTimeout(playTimer);
    if (!state.playing) return;
    const flow = currentFlow();
    const s = flow.steps[state.step];
    const ms = 3600 + s.path.length * 700;
    playTimer = setTimeout(() => {
      if (state.step >= flow.steps.length - 1) { pause(); return; }
      state.step += 1;
      render(true);
      schedule();
    }, ms);
  }

  function play() {
    const flow = currentFlow();
    if (state.step >= flow.steps.length - 1) state.step = 0;
    state.playing = true;
    render(true);
    schedule();
  }

  function pause() {
    state.playing = false;
    clearTimeout(playTimer);
    updatePlayer();
  }

  function updatePlayer() {
    const player = $("player");
    player.hidden = state.mode !== "flujos";
    if (player.hidden) return;
    const flow = currentFlow();
    $("player-count").textContent = `${flow.title} · paso ${state.step + 1} de ${flow.steps.length}`;
    $("player-title").textContent = flow.steps[state.step].title;
    $("step-prev").disabled = state.step === 0;
    $("step-next").disabled = state.step === flow.steps.length - 1;
    const playBtn = $("step-play");
    playBtn.innerHTML = icon(state.playing ? "pause" : "play");
    playBtn.setAttribute("aria-label", state.playing ? "Pausar" : "Reproducir");
    $("player-dots").innerHTML = flow.steps.map((s, i) =>
      `<button type="button" data-dot="${i}" class="${i === state.step ? "is-now" : i < state.step ? "is-done" : ""}" aria-label="Ir al paso ${i + 1}: ${esc(s.title)}"></button>`).join("");
  }

  $("step-prev").innerHTML = icon("prev");
  $("step-next").innerHTML = icon("next");
  $("step-prev").addEventListener("click", () => { pause(); setStep(state.step - 1); });
  $("step-next").addEventListener("click", () => { pause(); setStep(state.step + 1); });
  $("step-play").addEventListener("click", () => (state.playing ? pause() : play()));
  $("player-dots").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-dot]");
    if (b) { pause(); setStep(+b.dataset.dot); }
  });
  $("follow").addEventListener("change", (ev) => {
    state.follow = ev.target.checked;
    if (state.follow) render(true);
  });

  /* ───────── Orquestación ───────── */

  function selectNode(id, moveCamera) {
    pause();
    state.mode = "explorar";
    state.selected = id && nodeById.has(id) ? id : null;
    render(false);
    if (state.selected && moveCamera) {
      const { nodes } = neighbours(state.selected);
      fit(boundsOf(nodes), { pad: 70, maxK: 1.05 });
    }
    side.scrollTop = 0;
  }

  function setMode(mode) {
    pause();
    state.mode = mode;
    render(true);
    side.scrollTop = 0;
  }

  function render(moveCamera) {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === state.mode)));
    stopPackets();

    if (state.mode === "explorar") {
      if (state.selected) {
        const f = neighbours(state.selected);
        setFocus(f.nodes, f.edges);
        side.innerHTML = renderNode(nodeById.get(state.selected));
      } else {
        setFocus(null, null);
        side.innerHTML = renderIntro();
        if (moveCamera) fitAll(false);
      }
    } else if (state.mode === "flujos") {
      const s = currentFlow().steps[state.step];
      const edges = new Set(s.path.map((p) => p.replace("<", "")));
      const lit = new Set(s.nodes);
      edges.forEach((id) => { const e = edgeById.get(id); lit.add(e.from); lit.add(e.to); });
      setFocus(lit, edges);
      const keep = side.scrollTop;
      side.innerHTML = renderFlows();
      side.scrollTop = keep;
      const now = side.querySelector(".steps li.is-now");
      if (now && now.scrollIntoView && window.innerWidth > 900) now.scrollIntoView({ block: "nearest" });
      runPackets(s.path);
      if (moveCamera && state.follow) fit(boundsOf(s.nodes), { pad: 80, maxK: 1.0 });
    } else {
      const m = A.multiplayer[state.multi];
      setFocus(new Set(m.nodes), new Set(m.edges));
      side.innerHTML = renderMulti();
      if (moveCamera) fit(boundsOf(m.nodes), { pad: 70, maxK: 1.0 });
    }
    updatePlayer();
    writeHash();
  }

  function writeHash() {
    let h = "";
    if (state.mode === "explorar") h = state.selected ? `#nodo/${state.selected}` : "";
    else if (state.mode === "flujos") h = `#flujo/${state.flow}/${state.step + 1}`;
    else h = `#multijugador/${state.multi}`;
    try { history.replaceState(null, "", h || location.pathname + location.search); } catch (e) {}
  }

  function readHash() {
    const parts = decodeURIComponent(location.hash.replace(/^#/, "")).split("/");
    if (parts[0] === "nodo" && nodeById.has(parts[1])) {
      state.mode = "explorar";
      state.selected = parts[1];
    } else if (parts[0] === "flujo" && A.flows.some((f) => f.id === parts[1])) {
      state.mode = "flujos";
      state.flow = parts[1];
      state.step = Math.max(0, Math.min(currentFlow().steps.length - 1, (parseInt(parts[2], 10) || 1) - 1));
    } else if (parts[0] === "multijugador") {
      state.mode = "multijugador";
      state.multi = parts[1] === "futuro" ? "futuro" : "hoy";
    }
  }

  document.querySelector(".tabs").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-mode]");
    if (b) setMode(b.dataset.mode);
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (ev.key === "Escape" && state.mode === "explorar" && state.selected) { selectNode(null); return; }
    if (ev.key === "0") { fitAll(false); return; }
    if (ev.key === "+" || ev.key === "=") { zoomCenter(1.25); return; }
    if (ev.key === "-") { zoomCenter(0.8); return; }
    if (state.mode !== "flujos") return;
    if (ev.key === "ArrowRight" && !ev.shiftKey) { ev.preventDefault(); pause(); setStep(state.step + 1); }
    else if (ev.key === "ArrowLeft" && !ev.shiftKey) { ev.preventDefault(); pause(); setStep(state.step - 1); }
    else if (ev.key === " " && tag !== "BUTTON" && !(ev.target.closest && ev.target.closest("[data-node]"))) { ev.preventDefault(); state.playing ? pause() : play(); }
  });

  /* Tema */
  const themeBtn = $("theme-btn");
  function paintTheme() {
    themeBtn.innerHTML = icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon");
  }
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("paseo-canvas-arch-theme", next); } catch (e) {}
    paintTheme();
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.mode === "explorar" && !state.selected) fitAll(true);
    }, 150);
  });
  window.addEventListener("hashchange", () => { pause(); readHash(); render(true); });

  /* Arranque */
  build();
  paintTheme();
  readHash();
  fitAll(true);
  render(false);
  if (state.mode !== "explorar" || state.selected) {
    requestAnimationFrame(() => {
      if (state.mode === "explorar") fit(boundsOf(neighbours(state.selected).nodes), { pad: 70, maxK: 1.05, instant: true });
      else render(true);
    });
  }
  setTimeout(hideHint, 9000);
})();
