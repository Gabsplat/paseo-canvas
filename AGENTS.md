# Paseo Canvas

Use pnpm for all JavaScript/TypeScript dependency installation and scripts.

This is a new Paseo plugin plus a visual architecture explainer. Read the global /home/gabsplat/AGENTS.md. Do not alter unrelated projects or restart the Paseo daemon. Only the coordinator installs the plugin, changes Tailscale mappings, or launches shared preview services.

User-specified roles: architecture and every visual design decision use Claude Opus 5.5 with Medium thinking. Engineering implementers use GPT 6.1 Sol with High thinking. Do not delegate further without coordinator instruction.

Concurrent ownership: architecture agent owns docs/architecture.md and architecture/; visual designer owns design/ and docs/design.md; backend engineer owns plugin/server/, plugin/shared/, plugin/index.server.ts, plugin package/config/manifests, backend tests, and docs/mcp.md. Frontend engineer owns plugin/client/, plugin/index.client.tsx, frontend tests and docs/frontend.md, following Opus design artifacts, except plugin/client/Panel.tsx. The panel integrator owns only plugin/client/Panel.tsx and docs/frontend-integration.md. Coordinate public component props with the frontend engineer. Do not overwrite another role's files. Publish shared contracts early.

Required product: persistent canvas documents; understandable blocks and first-class groups; selection context; communication instructions; a local catalog of block types, group templates, and JSON packs with import/export; transactional MCP create/read/update/group/catalog tools; undo and revision conflicts; actual UI interactions sent to the connected agent; frontend and progressive-learning example documents. No fake completion or fake live agent output. Clearly label example data.

Quality: strong typography and spacing, useful empty/loading/error states, readable light/dark themes, keyboard and compact layouts where supported. Visual decisions come from Opus. Validate meaningful persistence, group, pack, conflict, and MCP behaviors. Respect installed Paseo 0.10.3 APIs; current docs at /tmp/paseo-canvas-plugin-reference.md and /tmp/paseo-canvas-plugins.md. Installed SDK package manifests/types live under /home/gabsplat/Servicios/paseo/node_modules/.pnpm/@getpaseo+plugin@0.10.3*/node_modules/@getpaseo/plugin/. The root node_modules/@getpaseo contains only cli; do not assume a top-level plugin SDK. Development should install matching @getpaseo/plugin@0.10.3 using pnpm. Existing reference implementation /home/gabsplat/Programming/theme-creator is read-only.

GUI apps and browser screenshots must run in omabox after reading /home/gabsplat/.codex/skills/omabox/SKILL.md. Headless logic tests are fine outside it. No real desktop automation. Do not print credentials or private configuration. No public exposure, no Funnel changes. Architecture explainer must work without needing a commercial tldraw production license; a custom interactive canvas is acceptable.
