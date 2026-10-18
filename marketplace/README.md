# Lienzo extensions

The public catalog of extensions for [Lienzo](https://github.com/Gabsplat/paseo-canvas), the canvas where your agent
draws what it explains. Every folder in `extensions/` is one extension file; Lienzo's **Extensions → Discover** lists
them and installs one after the usual review of what it asks for.

## How it works

```
extensions/
  title-case/
    extension.json     the file, exactly as Lienzo's Export or Publish… writes it
    README.md          optional: anything longer than the extension's own Help page
    screenshot.png     optional: up to 512 KB
index.json             built by CI from the folders; this is what the app reads
schema/                JSON Schemas for extension.json and index.json
scripts/build-index.mjs  the checks and the index builder (Node, no dependencies)
```

- A pull request adds or changes one folder. CI (`.github/workflows/catalog.yml`) runs
  `node scripts/build-index.mjs --check` on it: the file must be a valid single-extension file, its id must be the
  folder's name, every extension id must start with that id and a dot, its Help page (`docs`) must be Markdown
  without HTML, and nothing else may sit in the folder.
- When a pull request is merged, CI rebuilds `index.json` (name, description, permissions, SHA-256 and size of each
  file) and commits it. Lienzo downloads the index from
  `https://raw.githubusercontent.com/<owner>/<repo>/main/index.json`, keeps the last copy for offline use, and checks
  every file it installs against the SHA-256 in the index.
- Nothing in this repository runs in the app until a person presses Install and then Allow. Extensions run
  sandboxed, with no access to Paseo, the person's files or other sites (see
  [docs/extensions.md](https://github.com/Gabsplat/paseo-canvas/blob/master/docs/extensions.md), "Trust").

To add yours, see [CONTRIBUTING.md](CONTRIBUTING.md). Lienzo's **Publish…** button does most of it for you.

## For maintainers

Run the checks locally with `node scripts/build-index.mjs --check`, and rebuild the index with
`node scripts/build-index.mjs`. Review a pull request like code: read the page in `html`, check that its
permissions match what it does (`network` deserves a reason), and try it with **Add from file…** before merging.
