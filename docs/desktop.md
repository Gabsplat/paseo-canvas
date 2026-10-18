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
| `preload.cjs` | `src/main/preload.ts` | Exposes one function, `window.lienzo.invoke(name, input)` |
| `renderer/` | `src/renderer/main.tsx` | The plugin's `LienzoPanel` under react-native-web |
| `preview.cjs` | `src/main/preview.ts` | The core plus a local HTTP server for checking the UI in a plain browser |

The renderer build resolves `react`, `react-dom` and `react-native` (as `react-native-web`) from `apps/desktop`, and
replaces `plugin/client/host/index.ts` (the Paseo host) with `src/renderer/host.tsx`. Everything ships bundled, so the
packaged app carries no `node_modules`; `electron-builder.yml` packs `dist/` only. There is no code signing,
notarization or auto-update. The AppImage uses the default Electron icon.

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
host that runs agents (`runsAgents: true`, Paseo) also gets agent verification, feedback delivery that wakes the
agent, copilot reminders and lifecycle hooks. Tool injection at agent creation, session binding, the stdio MCP bridge
and setup snippets stay in `server/paseo.ts`.

## What differs from the plugin

- **One workspace.** Every desktop document lives in the workspace `desktop`.
- **Agents connect over MCP; the app runs none.** The Paseo agent dialog becomes a **Connect an agent** sheet with the
  command for Claude Code, Codex and Cursor, the agents that have called in, and a plain statement that the app cannot
  wake an agent. The agent chip shows the MCP client's name, with no working status.
- **Actions are pulled, never pushed.** What the person sends from the canvas is stored as a pending event. The agent
  reads it with `canvas_events` and acknowledges it, and the panel then shows "Received by the agent". Nothing starts a
  turn. The queued toast says so.
- **No copilot chip.** The composer pill, copilot reminders and `canvas.agent.setup` are Paseo-only. The copilot
  setting exists in the state, but the desktop UI cannot turn it on. Agents see `copilot.enabled: false` and use the
  tools when the person asks.
- **Settings** (guide seen, pinned tools, shortcuts) are kept in `settings.json` in the app's data folder, with
  Paseo's revision and conflict rules.
- **Theme** is Lienzo's Papel (light) or Tinta (dark), following the operating system and switching with it.
- **Menu**: File (copy the Claude Code MCP command, close or quit), Edit, View (reload, developer tools, zoom, full
  screen) and Window. Undo and redo show their keys but leave them to the page, which undoes text or the canvas.

## State

The app keeps its state in Electron's `userData` folder, which is `~/.config/Lienzo` on Linux and
`~/Library/Application Support/Lienzo` on macOS:

- `canvas/state.json` holds the canvas state, in the plugin's format `paseo-canvas-state/1`. `canvas/writer.lock`
  stops a second writer.
- `settings.json` holds the host settings.
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
`canvas_sheet`, `canvas_catalog`, `canvas_events`, `canvas_selection`, `canvas_history`, `canvas_undo`,
`canvas_redo`, `canvas_example`, `canvas_runtime`), with the same schemas and results (see `docs/mcp.md`). Every
session is identified by the client's declared name: `mcp:claude-code`, for example. That identity owns its undo
history, and it becomes a canvas's recipient when it uses that canvas.

**An agent can** list, create, read and edit documents transactionally with revisions, use groups, Hojas, templates,
packs and extensions, undo and redo its own edits, read the selection and its instructions, and read and acknowledge
the person's actions.

**An agent cannot** be woken, receive a message from the canvas, or be reminded to draw. It sees the person's actions
only when it calls `canvas_events`. The server only answers requests.

## Known limits

- Requests are refused when they carry a foreign `Host` header or a browser `Origin`, so web pages cannot drive the
  server. It has no token, so any program on this computer can call it.
- Sessions live in memory. After the app restarts, a client holding an old session gets "Session not found" (404),
  and per the MCP spec it should start a new session. If one does not, reconnect it (`/mcp` in Claude Code).
- All clients with the same declared name share one identity, so two Claude Code sessions undo each other's edits
  as one agent.
- Only the Linux AppImage has been built and smoke-tested. The mac configuration is unbuilt and unsigned, and the
  macOS menu key handling for undo and redo is unverified.
- The AppImage needs FUSE, or `APPIMAGE_EXTRACT_AND_RUN=1`.
- Web pages that forbid framing do not load in a Ventana, as in Paseo's web client.
