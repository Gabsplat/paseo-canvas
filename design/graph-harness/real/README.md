# Real-component interaction harness

This mounts Lienzo's actual `Canvas.tsx`, `Blocks.tsx`, `Links.tsx`, `motion.tsx`,
`logic.ts`, `ui.tsx`, `web.ts`, `Onboarding.tsx`, `ImageViewer.tsx`, `MagnetCue.tsx`,
`media.ts`, `guide.ts` and tokens under react-native-web. All data is labelled
as example data. The stand-in controller parses writes with `mutateInputSchema` and
applies the real reducer, simulating 60 ms latency and an optional rejected write.
It serializes writes and reuses unchanged entity references as `useCanvas` does.
Host context wraps the stateful app as it does in `LienzoPanel`.

Paseo icons, host modal, toast, theme injection, RPC transport, selection persistence,
polling and panel chrome are stand-ins. Toolbar release buttons call the pure
release logic; they do not exercise Panel's batching, dialogs or shortcuts. There
is no live agent and no installed-plugin test here. The other harness one directory
up uses DOM stand-in cards; its results should be distinguished from these results.

## Build and run

Read the omabox skill before launching Chromium. Run from the repository root:

```bash
export PATH="$HOME/.local/share/pnpm/bin:$PATH"
design/graph-harness/real/build.sh
omabox up --net isolated
omabox run -d -- python3 -m http.server 8765 --bind 127.0.0.1 --directory /home/gabsplat/Labs/paseo-canvas/dist/rn-harness
omabox run -d -- python3 -m http.server 8766 --bind 127.0.0.1 --directory /home/gabsplat/Labs/paseo-canvas/dist/rn-harness
omabox run -d --wait -- chromium --no-first-run --disable-gpu --remote-debugging-port=9222 --user-data-dir=/tmp/lienzo-chromium --app='http://127.0.0.1:8765/?theme=papel'
omabox run -- node /home/gabsplat/Labs/paseo-canvas/design/graph-harness/real/smoke.cjs interaction
omabox run -- node /home/gabsplat/Labs/paseo-canvas/design/graph-harness/real/smoke.cjs features
omabox run -- node /home/gabsplat/Labs/paseo-canvas/design/graph-harness/real/smoke.cjs guide
omabox run -- node /home/gabsplat/Labs/paseo-canvas/design/graph-harness/real/smoke.cjs media
omabox run -- node /home/gabsplat/Labs/paseo-canvas/design/graph-harness/real/smoke.cjs many
omabox run -- node /home/gabsplat/Labs/paseo-canvas/design/graph-harness/real/smoke.cjs compact
omabox down
```

Both servers and the debug port stay inside the isolated box. Port 8766 exercises a
separate origin for iframe storage and forms. Use your own box; never
stop another session's box. Build on the host: the checkout is read-only in a
running box. Temporary output is written to the box's `/tmp`, not the checkout.

`build.sh` installs only temporary harness dependencies via pnpm if needed:
React/react-dom 19.1.0 and react-native-web 0.21.3, in `/tmp/lienzo-rn-harness`
(`LIENZO_RN` overrides that path). It uses the workspace's esbuild. No plugin
dependency, SDK version or lockfile is changed. Output goes to ignored
`dist/rn-harness`. The default bundle is development; build production with:

```bash
LIENZO_BUILD_MODE=production design/graph-harness/real/build.sh
```

Build also copies the explicitly labelled image/web fixtures and creates small synthetic
MP4/WAV clips with ffmpeg in ignored output. No user's media or network download is involved.
The mock modal is a real RN-web modal/scroll view, not Paseo's modal implementation.

The smoke runner uses Node 22+'s built-in WebSocket and Chromium's local CDP, with
no browser automation package. It navigates with cache disabled and drives actual
mouse down/move/up events through React Native's responders. `inspect.cjs` accepts
a JavaScript expression for read-only inspection through the same debug port.

Query options: `?theme=papel` (light), `?theme=tinta` (dark/default), `?doc=many`
(150 nodes in six groups with 149 links), `?perf=1` (frame meter), `?compact`
(outline), `?latency=500` (simulated write latency), `?doc=interactive` (image, video,
web, YouTube, Vimeo and audio examples), `?guide` (open the guide), `?first-visit`
(exercise the local dismissal preference). Combinations use `&`.
`many --profile` additionally writes a CPU profile to the box's
`/tmp/lienzo-many-profile.json` and prints the top sampled functions.

## Verification, 2026-10-05

Tested on the local changes above `f3568c3`, without installing/reloading the
plugin, restarting Paseo, committing or pushing. Chromium ran in an isolated
omabox on a 1920 × 1080 / 60 Hz desktop, with a 1896 × 1030 content viewport and
GPU disabled. Results are browser-harness evidence, not a device or host benchmark.

Client files changed: `Blocks.tsx`, `Canvas.tsx`, `Inspector.tsx`, `Links.tsx`,
`Panel.tsx`, `logic.ts`, `motion.tsx`, `tokens.ts`, `ui.tsx`, `useCanvas.ts` and
`web.ts`, plus `ImageViewer.tsx`, `MagnetCue.tsx`, `Onboarding.tsx`, `guide.ts`
and `media.ts`. Other changes: `tests/frontend.test.ts`, `design/tokens.json`,
`docs/design.md` and the files in this harness directory. The user specifically
authorized `plugin/shared/model.ts`'s optional nullable block size schema. Existing
reducer/RPC operations already support it. Plugin dependencies and entry points are unchanged.

The `interaction` scenario checks:

- Shift multi-selection, one shared drag delta, and connectors updating before
  the transaction; the post-drag click preserves selection.
- Releasing positions returns nodes to their graph placement.
- Middle mouse pans over cards; dragging a group body pans without writing or
  clearing selection.
- A stack child pins without changing its container mode; it can enter another
  group and repeatedly drag back to root.
- Moving a group preserves its child's local coordinates.
- A simulated rejected edit leaves revision unchanged and springs back visually.
- The `+` handle still creates a real reducer-validated link.
- A live `prefers-reduced-motion` change reaches `AccessibilityInfo` and the
  shared motion setting; fitting still works.

The `features` scenario checks:

- Live corner resizing and connectors before saving, one `block.update` on release,
  no pin added, and Shift preserving the starting aspect ratio.
- Restoring automatic size; rejected resize rolls back without advancing the revision.
- Magnetic acquisition 24 screen pixels outside the target card, the spring endpoint
  arriving at its side port, and reducer-validated link creation only on release.

The `guide` scenario checks six tour steps, searchable options, personal dismissal
surviving reload, reopening, and action callbacks closing the guide and routing to
the stand-in panel. It mounts the real guide but not Panel's first-visit activation.

The `media` scenario checks native browser video play/pause with no canvas edits,
actual input/form submission/storage and wheel scrolling in the cross-origin iframe,
no parent panning, and image-viewer zoom/pan/reset. It checks that YouTube/Vimeo stay
unmounted until requested and that their canonical URLs omit autoplay. External
provider playback is not tested in the isolated network. The MP4/WAV are synthetic.

The `compact` scenario checks the actual outline at 390 × 844, card width, tap
selection and the example label, all six guide steps with scrollable navigation,
and a dark searchable guide. It captures `/tmp/lienzo-compact.png` and
`/tmp/lienzo-guide-compact-dark.png` inside the box; it is not an iOS/Android run.
The stand-in toolbar is for desktop testing and is not the product's compact top bar.
The guide is opened by a harness query on compact; the product uses Más acciones.

The `many` probe includes pick-up, 90 pointer steps, 120 ms held at the endpoint,
the simulated save and 700 ms of settling, followed by a middle-button pan and a
90-step resize. It asserts that the sampled node is visible, gets pinned, previews
resize without document writes, and stores its final size. The meter records
`requestAnimationFrame` intervals, not pointer-to-pixel latency.

| Final v5 production bundle / gesture | Frames | Median ms | p95 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: |
| Drag | 222 | 16.6 | 21.5 | 66.6 |
| Pan | 223 | 16.6 | 17.5 | 21.7 |
| Resize | 224 | 16.6 | 16.8 | 65.4 |

Restricting selection invalidation to selected cards and sharing unchanged RPC entities
avoids redrawing every card. The host context stays outside the stateful panel.
Median movement is near 60 Hz, with occasional long frames during drag/resize in
this software-rendered environment. These measurements do not establish a constant
60 fps guarantee on the installed Paseo client or measure external player GPU cost.

The repository's `pnpm test` passes **82 tests**, including pure pin/unpin,
drop target, guides, snapping, order, reference reuse, media URLs, size geometry and
magnet hysteresis/exclusion checks. Real service/store tests verify persisted sizes,
size reset, duplicate, packs, reopen, atomic pin release, undo/redo and stale revisions;
RPC/MCP regression tests pass as well. `pnpm typecheck` checks plugin/client and
tests against the installed 0.10.3 SDK.

Still unverified in the live host: native-driver performance, physical trackpad
pinch/flick, iOS/Android touches and compact chrome, Panel shortcuts and release
batching through the RPC transport, host modal portals, onboarding first-visit activation,
inspector editing, immersive mode, auto-follow and connected-agent delivery. Their
existing code paths are retained; this harness cannot substantiate live-host behaviour.
The implementation and exact motion parameters are specified in
[docs/design.md](../../../docs/design.md#17-guide-interactive-media-block-sizes-and-link-magnetism--tokens-v5).

To try the local source in Paseo, the coordinator runs `paseo plugin reload canvas`
and refreshes the client panel. The shared size schema must be loaded too. No
document reset, daemon restart or new installation is needed for this local change.
