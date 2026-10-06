# Whiteboard Panel harness

This mounts the production `LienzoPanel`, `useCanvas`, Canvas, media, whiteboard
renderers and floating tools under React 19.1 and react-native-web 0.21.3. Its
in-memory transport validates production RPC contracts and applies the production
reducer and built-in catalog. Every document is explicitly marked as example data.
Writes simulate 45 ms latency. `__panelQA.failNext()` simulates a rejected write.
There is no live assistant, disk persistence or installed-plugin test here.

The Paseo icon, modal, toast, theme injection, settings and RPC transport are
stand-ins. Icons appear as `▫`. Responsive compact checks use the web renderer,
not a native device. The server persistence, pack, revision and undo boundaries
are separately exercised by the automated backend suite.

Read the omabox skill before running any browser. Build from the repository root:

```sh
PATH=/home/gabsplat/.local/share/pnpm/bin:$PATH bash design/whiteboard-harness/build.sh
omabox up --net isolated
omabox run -d -- python3 -m http.server 8765 --bind 127.0.0.1 --directory "$PWD/dist/panel-qa"
omabox run -d -- chromium --no-first-run --disable-gpu --remote-debugging-port=9222 --user-data-dir=/tmp/lienzo-whiteboard-chromium --app='http://127.0.0.1:8765/?theme=papel'
```

The build uses temporary browser-only dependencies in `$LIENZO_RN`, default
`/tmp/lienzo-rn-harness`, installing them there with pnpm if needed. It adds no
plugin runtime dependencies. Wait for the browser debug port, then run each
scenario sequentially inside the box:

```sh
omabox run -- node "$PWD/dist/panel-qa/basic.cjs"
omabox run -- node "$PWD/dist/panel-qa/features.cjs"
omabox run -- node "$PWD/dist/panel-qa/imports.cjs"
omabox run -- node "$PWD/dist/panel-qa/frames.cjs"
omabox run -- node "$PWD/dist/panel-qa/library.cjs"
omabox run -- node "$PWD/dist/panel-qa/compact.cjs"
omabox run -- node "$PWD/dist/panel-qa/many.cjs"
```

The scripts drive the browser through its private debugging port, assert document
state and capture screenshots/results in `/tmp/lienzo-wb-*` **inside the box**.
They never access the real desktop. The SVG file scenario intercepts the file
chooser and supplies the bundled synthetic fixture. All URLs stay local to the
isolated box; no external site is required. The web fixture has a real form and
scroll area inside the production iframe sandbox.

Copy wanted results before `omabox down`. Evidence for the October 6 verification
is in `design/qa-whiteboard-2026-10-06/`.
