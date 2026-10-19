# Lienzo desktop

`apps/desktop` runs Lienzo as an Electron app, outside Paseo. It is the same code as the plugin: the same server core,
store, MCP tools, panel and state file format. What Paseo used to provide comes from a desktop host instead.

## Run and build

```sh
export PATH="$HOME/.local/share/pnpm/bin:$PATH"
pnpm install
pnpm --dir apps/desktop dev        # bundle, then open the app
pnpm --dir apps/desktop build      # unsigned Linux AppImage in apps/desktop/release/
pnpm --dir apps/desktop build:mac  # unsigned mac dmg and zip; run it on a Mac
pnpm --dir apps/desktop preview    # the same app in a browser at http://127.0.0.1:7422/, no Electron
pnpm --dir apps/desktop typecheck
```

Electron 44 downloads its binary the first time it is used, into `~/.cache/electron`.

`scripts/bundle.mjs` bundles four things with esbuild into `dist/`:

| Output | Entry | What it is |
|---|---|---|
| `main.cjs` | `src/main/main.ts` | Electron main process: window, menu, IPC, the core and the MCP server |
| `preload.cjs` | `src/main/preload.ts` | Exposes `window.lienzo.invoke(name, input)`, plus `trafficLights` and `onFullScreen` for the window chrome |
| `renderer/` | `src/renderer/main.tsx` | The plugin's `LienzoPanel` under react-native-web |
| `preview.cjs` | `src/main/preview.ts` | The core plus a local HTTP server for checking the UI in a plain browser |

The renderer build resolves `react`, `react-dom` and `react-native` (as `react-native-web`) from `apps/desktop`, and
replaces `plugin/client/host/index.ts` (the Paseo host) with `src/renderer/host.tsx`. Everything ships bundled, so the
packaged app carries no `node_modules`; `electron-builder.yml` packs `dist/` only. That includes the QuickJS
interpreter that runs extension actions for agents (`plugin/server/sandbox.ts`): its WebAssembly is embedded in the
JavaScript of `@jitl/quickjs-singlefile-browser-release-sync`, so it is bundled into `main.cjs` and `preview.cjs` like
any module, with no `.wasm` file to copy or unpack from the asar (about 0.9 MB of the bundle). Builds are unsigned unless the
release workflow finds signing secrets (see Releases). The app updates itself (see Updates).

**macOS window chrome.** There is no title bar (`titleBarStyle: 'hidden'`): the traffic lights float over the panel's
top-left corner, centred on the row of the top islands (`trafficLightPosition` in `src/shared/chrome.ts`). The preload
says so (`trafficLights`), and the shell passes `layout.inset` (`{ left: 78, top: 52 }`) to the panel: the document
island, its menu and the compact top bar start after `left`, and a screen sheet that would reach into the corner
starts below `top`. The window moves by a 12 px strip along the top edge and by the lights' corner (`-webkit-app-region:
drag`, in `src/renderer/main.tsx`); a double-click there zooms. In full screen macOS hides the lights, so the main
process reports `enter-full-screen`/`leave-full-screen` (and the state after every load) and the inset and drag areas
go away. Windows and Linux keep the system title bar; Paseo passes no inset.

The window has contextIsolation on, nodeIntegration off and the sandbox on. The main process answers IPC only from
its own window. Links open in the system browser; the page never navigates away.

## The host boundary

Everything Lienzo takes from its host sits behind two small interfaces, each with a Paseo and a desktop implementation.

| | Contract | Paseo | Desktop |
|---|---|---|---|
| Panel | `plugin/client/host/contract.ts` | `plugin/client/host/index.ts` (plugin SDK) | `apps/desktop/src/renderer/host.tsx` |
| Server | `plugin/server/host.ts` (`ServerHost`) | `plugin/server/paseo.ts` | `apps/desktop/src/main/host.ts` |

Panel files import only from `./host`: RPC (`useRpc`), `Icon`, `ScrollView`, `TextInput`, `Modal`, `useToast`,
`copyText`, `openExternalUrl`, `useSettings`, `useAgent`, `usePaseo`, the theme and panel props, `capabilities` and an
optional `AgentSheet`. `shared/contract.ts` defines `defineRpc` and `defineSettings` with the same shape as the SDK's,
so neither the shared contracts nor the server need the SDK.

`plugin/server/core.ts` builds the store, service, tool router, copilot and every panel RPC on any `ServerHost`. A
host that runs agents (`runsAgents: true`, Paseo) also gets agent verification, the optional copilot reminder and
lifecycle hooks. No RPC on any host sends anything to an agent. Tool injection at agent creation, session binding, the
stdio MCP bridge and setup snippets stay in `server/paseo.ts`.

## What differs from the plugin

- **One workspace.** Every desktop document lives in the workspace `desktop`.
- **Agents connect over MCP; the app runs none.** The Paseo agent dialog becomes a **Connect an agent** sheet with the
  command for Claude Code, Codex and Cursor, the agents that have called in, and a line saying to talk to the agent in
  its own app. The same content is Settings → **Agents** (the host's `AgentSettings` slot, `ConnectAgentBody`); the
  desktop shows Agents where Paseo shows Copilot. The agent chip shows the MCP client's name, with no working status.
- **One-way, like the plugin.** The canvas never messages the agent. The person selects something and says "look at
  what I selected" in the terminal; the agent reads it with `canvas_selection`, including the state that blocks and
  mini apps left.
- **No copilot chip.** The composer pill, copilot reminders and `canvas.agent.setup` are Paseo-only. The copilot
  setting exists in the state, but the desktop UI cannot turn it on. Agents see `copilot.enabled: false` and use the
  tools when the person asks.
- **Settings** (guide seen, pinned tools, shortcuts) are kept in `settings.json` in the app's data folder, with
  Paseo's revision and conflict rules. Settings → About shows the app's version, its update state and the path of
  `canvas/state.json`.
- **Extensions** work the same as in Paseo: the same files, the same review before install, the same sandbox.
- **Theme** is Lienzo's Papel (light) or Tinta (dark), following the operating system and switching with it.
- **Menu**: File (copy the Claude Code MCP command, close or quit), Edit, View (reload, developer tools, zoom, full
  screen) and Window. Undo and redo show their keys but leave them to the page, which undoes text or the canvas.

## State

The app keeps its state in Electron's `userData` folder, which is `~/.config/Lienzo` on Linux and
`~/Library/Application Support/Lienzo` on macOS:

- `canvas/state.json` holds the canvas state, in the plugin's format `paseo-canvas-state/1`. `canvas/writer.lock`
  stops a second writer.
- `canvas/media/` holds the images people drop, paste or choose, one file per picture named by its SHA-256.
- `settings.json` holds the host settings, including "Automatically check for updates" (`desktop-updates`) and the
  interface choices (`interface`: pinned tools, shortcuts, Appearance). The window opens in the saved Appearance:
  the main process sets `nativeTheme.themeSource` from it before the window exists, and again whenever it changes
  (`desktop.appearance`), so the title area and the background behind the page match the panel.
- `updates/` (macOS only) holds a downloaded update until it is installed.
- `desktop.json` is optional: `{ "mcpPort": 7421 }`.

To bring documents over from Paseo, quit the app and copy `~/.paseo/canvas/state.json` to
`<userData>/canvas/state.json`. On the next start, every document moves into the `desktop` workspace, history
included. Connections to Paseo agents are dropped, because those agents do not exist here. Copy the file back to
Paseo only after checking it: the moved workspace IDs do not match Paseo's workspaces.

## Connecting agents

The MCP server listens on `http://127.0.0.1:7421/mcp` using streamable HTTP and the official MCP TypeScript SDK. To
change the port, set `LIENZO_MCP_PORT` or `mcpPort` in `desktop.json`. If the port is taken, the app still opens and
the sheet says why agents cannot connect.

```sh
claude mcp add lienzo --transport http http://127.0.0.1:7421/mcp
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.lienzo]
url = "http://127.0.0.1:7421/mcp"
```

Cursor, in `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "lienzo": { "url": "http://127.0.0.1:7421/mcp" } } }
```

The tools are the plugin's (`canvas_list`, `canvas_create`, `canvas_read`, `canvas_apply`, `canvas_group`,
`canvas_sheet`, `canvas_catalog`, `canvas_selection`, `canvas_history`, `canvas_undo`,
`canvas_redo`, `canvas_runtime`), with the same schemas and results (see `docs/mcp.md`). Every
session is identified by the client's declared name: `mcp:claude-code`, for example. That identity owns its undo
history, and it becomes the canvas's connected agent when it uses that canvas.

**An agent can** list, create, read and edit documents transactionally with revisions, use groups, Sheets, block types
and extensions, undo and redo its own edits, and read the selection with its instructions and the state the
person's interaction left on each block.

**An agent cannot** be woken, receive a message from the canvas, or be reminded to draw. The server only answers
requests.

## Known limits

- Requests are refused when they carry a foreign `Host` header or a browser `Origin`, so web pages cannot drive the
  server. It has no token, so any program on this computer can call it.
- Sessions live in memory. After the app restarts, a client holding an old session gets "Session not found" (404),
  and per the MCP spec it should start a new session. If one does not, reconnect it (`/mcp` in Claude Code).
- All clients with the same declared name share one identity, so two Claude Code sessions undo each other's edits
  as one agent.
- Only the Linux AppImage has been built and smoke-tested locally, its update included. The mac and Windows builds
  come from the release workflow and are unsigned; the macOS menu key handling for undo and redo, the Mac updater's
  swap on a real Mac and the Windows update are unverified.
- The AppImage needs FUSE, or `APPIMAGE_EXTRACT_AND_RUN=1`.
- Web pages that forbid framing do not load in a Window, as in Paseo's web client.

## Releases

`.github/workflows/desktop-release.yml` builds the installers on three GitHub machines and attaches them, with the
update feed files, to a normal (not pre-release) GitHub Release: the app finds updates through GitHub's "latest
release" link, which skips drafts and pre-releases. Push a tag to release, or run the workflow by hand with a version
to get the files as artifacts only:

```
git tag desktop-v0.2.0 && git push origin desktop-v0.2.0
```

| Machine | Files |
|---|---|
| macOS | `Lienzo-<version>-mac-arm64.dmg`, `…-mac-x64.dmg` and `.zip` for each |
| Windows | `Lienzo-<version>-win-x64.exe`, `…-win-arm64.exe` (NSIS, per-user, installation folder can be changed) |
| Linux | `Lienzo-<version>-x86_64.AppImage`, `Lienzo-<version>-amd64.deb` |
| Update feed | `latest-mac.yml`, `latest.yml` (Windows), `latest-linux.yml`, and `.blockmap` files for the mac zips and dmgs and the Windows installers (an AppImage carries its block map inside) |

The same steps run locally with `pnpm --dir apps/desktop release` (installers for the machine it runs on). It fails
when the feed file is missing or names another version. On distributions without `libcrypt.so.1` (Arch), the .deb step
fails inside electron-builder's bundled fpm; `LIENZO_LINUX_TARGETS=AppImage pnpm --dir apps/desktop release` builds
the AppImage and `latest-linux.yml` only.

Signing is optional and switches on by itself when these repository secrets exist:

| Secret | For |
|---|---|
| `MAC_CERTIFICATE_P12_BASE64`, `MAC_CERTIFICATE_PASSWORD` | Signing with a Developer ID Application certificate (Apple Developer Program) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization, so macOS opens it without a warning |
| `WIN_CERTIFICATE_PFX_BASE64`, `WIN_CERTIFICATE_PASSWORD` | Signing the Windows installer, so SmartScreen does not warn |

Without them the builds are unsigned: on macOS open the app the first time with right-click → Open; on Windows,
SmartScreen asks for "More info → Run anyway". Linux needs no signing.

## Updates

The packaged app checks for a new version 10 s after it starts and then every 6 hours, while Settings → About →
"Automatically check for updates" is on (it is by default). "Check for updates" in the same place checks at once. An
update downloads in the background; when it is ready, a small "Update ready · Restart" pill appears in the bottom-left
corner (above the toolbar on narrow windows), and About says "Ready to restart" with a Restart button. Restart
installs it and opens the new version; otherwise it is installed when Lienzo quits. About shows the state in words:
Up to date, Checking…, Downloading 42 %, Ready to restart, or what went wrong. Errors never block the app.
Development builds (`pnpm dev`) and the browser preview never check. The Paseo plugin has none of this: the panel's
`AboutUpdates` host slot is empty there.

**The feed.** electron-builder's generic provider, pointed at
`https://github.com/Gabsplat/paseo-canvas/releases/latest/download`. GitHub redirects that to the newest normal
release, so the `desktop-v` tag names are never parsed. `electron-builder.yml` has the same URL under `publish`, which
makes it write `latest*.yml` and the block maps even with `--publish never`; the app sets the URL itself. Releases must
be normal releases (the workflow publishes them that way); a pre-release is never offered.

**Windows and Linux** use electron-updater as it is: the NSIS updater (installs silently, per user, then starts the new
version), the AppImage updater (replaces the AppImage file, downloading only the changed blocks when the server allows
ranges), and the deb updater for the .deb (it asks for the password through pkexec). A Linux copy that is neither an
AppImage nor the .deb says "This copy cannot update itself". The two Windows installers come from two
electron-builder runs; `scripts/release.mjs` merges their `latest.yml`, and electron-updater picks the .exe whose name
has its architecture.

**macOS** cannot use electron-updater while the app is unsigned: its MacUpdater hands the zip to Squirrel.Mac, which
refuses an app without a Developer ID signature. `src/main/updater/mac.ts` (`MacZipUpdater`) implements the same
interface (`src/main/updater/engine.ts`) and:

1. Reads `latest-mac.yml` and compares versions (semver, a pre-release is older than its release).
2. Picks the zip for this machine (`…-mac-arm64.zip` on Apple silicon, the other on Intel).
3. Downloads it with Node's https into `<userData>/updates/<version>/`, so it gets no quarantine flag, hashing it as it
   arrives. A file whose sha512 or size does not match `latest-mac.yml` is deleted.
4. Only then unpacks it with `/usr/bin/ditto -x -k` and checks that it holds exactly one app whose
   `CFBundleIdentifier` is `dev.gabsplat.lienzo` and whose `CFBundleShortVersionString` is the expected version.
5. On Restart, while the app still runs: moves `Lienzo.app` aside to `Lienzo.app.old-<stamp>` in the same folder, moves
   the new one in, removes the old one. If moving the new one in fails, the old one goes back and About shows the error;
   the app keeps running. Then the app closes its documents and quits, and a small `/bin/sh` loop waits for its process
   to end and runs `/usr/bin/open` on the app. On quit without Restart, the same swap runs as the app exits, without
   reopening it. An old copy that could not be removed is removed at the next start.

The Mac updater refuses to download when the app cannot replace itself: run from a translocated path (a quarantined
app opened from Downloads runs from a random read-only `AppTranslocation` folder), from a mounted disk image
(`/Volumes/…`), or from a folder it cannot write (the folder or the bundle). About then says "Move Lienzo to
Applications to get updates." Homebrew (`Gabsplat/homebrew-tap`) installs the app without quarantine in
`/Applications`, where this works.

Limits of the Mac updater: it replaces the whole app (no block-map differential download); on a Mac where
`/Applications` is not writable by the user (a standard, non-admin account), it says to move the app; and it has been
tested on Linux with fake bundles (`tests/desktop-updater.test.ts`), not yet on a real Mac.

**When the app is signed.** Once releases are signed with a Developer ID and notarized (the secrets in Releases), set
`MAC_IS_SIGNED = true` in `apps/desktop/src/main/updater/index.ts`. The Mac then uses electron-updater's MacUpdater
(Squirrel.Mac) like the other platforms, from the same zip and `latest-mac.yml`. `mac.ts` and `mac-bundle.ts` can be
deleted afterwards.

**Security.** Every request, including each redirect, must be https to `github.com`, `objects.githubusercontent.com`
or `release-assets.githubusercontent.com` (GitHub now serves release assets from the last one). The Mac updater checks
this itself; for electron-updater the app cancels any other request in electron-updater's network session. Every
download is checked against the sha512 in `latest*.yml` before it is used (electron-updater does the same), nothing
downloaded runs before that, and the Mac refuses a bundle whose ID or version does not match.

**Testing an update locally.** `LIENZO_UPDATE_FEED` replaces the feed, for any build: https anywhere, or http on
`127.0.0.1`. Build version A, build version B (`npm pkg set version=…` in `apps/desktop`, then the release script), put
B's `latest-linux.yml` and AppImage in a folder, serve it with `python3 -m http.server 8765 --bind 127.0.0.1`, and run A
with `LIENZO_UPDATE_FEED=http://127.0.0.1:8765` (and `APPIMAGE_EXTRACT_AND_RUN=1` without FUSE). The browser preview
shows any state without a release: POST `desktop.updates.fake` with a state to `/rpc`;
`design/whiteboard-harness/desktop-updates.cjs` does that for the pill and every About state.
