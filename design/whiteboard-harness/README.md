# Whiteboard Panel harness

This mounts the production `LienzoPanel`, `useCanvas`, Canvas, media, whiteboard
renderers and floating tools under React 19.1 and react-native-web 0.21.3. Its
in-memory transport validates production RPC contracts and applies the production
reducer and built-in catalog. Every document is explicitly marked as example data.
Writes simulate 45 ms latency. `__panelQA.failNext()` simulates a rejected write.
There is no live assistant, disk persistence or installed-plugin test here. The canvas is one-way:
the QA host implements no RPC that sends to an agent, and `__panelQA.actions` stays empty; scenarios assert it.

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
omabox run -- node "$PWD/dist/panel-qa/face.cjs"          # the stage 1 face; add `papel` for light
omabox run -- node "$PWD/dist/panel-qa/extensions.cjs"
omabox run -- node "$PWD/dist/panel-qa/windows.cjs"       # mini app setState stored on its block
omabox run -- node "$PWD/dist/panel-qa/copilot.cjs"
omabox run -- node "$PWD/dist/panel-qa/screens.cjs" oscuro          # Lienzos, guide, Settings, Extensions, History
omabox run -- node "$PWD/dist/panel-qa/screens.cjs" papel compact   # any of oscuro|papel, with or without compact
omabox run -- node "$PWD/dist/panel-qa/guide.cjs"
omabox run -- node "$PWD/dist/panel-qa/wiki.cjs" papel compact   # Help, Discover (catalog served locally), Publish…
omabox run -- node "$PWD/dist/panel-qa/ui-fixes.cjs" oscuro sheets,icons,shader,screens   # §37; online steps need the network
```

The scenarios also run against a plain headless Chromium (no omabox), which is how the screens were verified:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory "$PWD/dist/panel-qa" &
chromium --headless=new --no-first-run --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir="$PWD/dist/chromium-profile" --window-size=1280,887 'http://127.0.0.1:8765/' &
LIENZO_SHOTS="$PWD/dist/shots" node dist/panel-qa/screens.cjs papel
```

`ux.cjs` edits every overhauled block by hand through Properties and the canvas (checklist, node, file tree, Controls
with new variables, animated flow, raw JSON, the Lienzo's Variables) and writes `ux-*-<theme>.png` to `$LIENZO_SHOTS`.
It needs a window at least 1600 wide so the right panel does not cover the cards: start Chromium with
`--window-size=1600,1000`, then `node dist/panel-qa/ux.cjs oscuro` and `node dist/panel-qa/ux.cjs papel`. When another harness already holds the
ports, serve and debug elsewhere and pass `LIENZO_HTTP` and `LIENZO_CDP` (for example 8791 and 9341).

`screens.cjs`, `guide.cjs`, `wiki.cjs`, `desktop-screens.cjs` and `desktop-wiki.cjs` write their captures to `$LIENZO_SHOTS`
(default `/tmp`). `wiki.cjs` and `desktop-wiki.cjs` take other ports from `$LIENZO_QA_PORT` and `$LIENZO_DEBUG_PORT`, and
answer requests to raw.githubusercontent.com with the files in `marketplace/`, so they need no network. Some
older scenarios assume the window size of the omabox they were written in: `chrome.cjs` needs a 1440-wide viewport,
and `features.cjs`, `frames.cjs` and `library.cjs` fail in a plain headless window both before and after the screens
work. `desktop-screens.cjs` checks the desktop preview with the real core and store:

```sh
LIENZO_DATA_DIR="$PWD/dist/desktop-data" LIENZO_MCP_PORT=7431 LIENZO_PREVIEW_PORT=7432 pnpm --dir apps/desktop preview &
node design/whiteboard-harness/desktop-screens.cjs http://127.0.0.1:7432/ dark   # or light
```

The scripts drive the browser through its private debugging port, assert document
state and capture screenshots/results in `/tmp/lienzo-wb-*` **inside the box**.
They never access the real desktop. The SVG file scenario intercepts the file
chooser and supplies the bundled synthetic fixture. All URLs stay local to the
isolated box; no external site is required. The web fixture has a real form and
scroll area inside the production iframe sandbox.

Copy wanted results before `omabox down`. Evidence for the October 6 verification
is in `design/qa-whiteboard-2026-10-06/`; the stage 1 face is in `design/qa-face-2026-10/`; the screens around the
canvas are in `design/qa-screens-2026-10/`. Scenarios that set a
viewport (`face.cjs`, `guide.cjs`, `compact.cjs`) clear it when they end, so the others run at the window's size.
