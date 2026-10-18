# Adding an extension

## The short way: Publish… in Lienzo

1. Make the extension (ask your agent: "make me a Lienzo extension that…"). Give it a clear name, a one-line
   description and a short Help page (`docs`).
2. In Lienzo open **Extensions**, find its card and press **Publish…**. Lienzo checks it, saves `extension.json`, and
   shows where it goes: `extensions/<id>/extension.json`.
3. Press **Open GitHub**. Sign in if asked. For a short file GitHub opens with the file already filled in; for a long
   one it opens the folder's upload page, where you drop the saved `extension.json`.
4. Commit, then **Propose changes** and **Create pull request**. GitHub makes your own copy (a fork) of the catalog
   for you. Lienzo never asks for a GitHub token.

## By hand

1. Fork this repository.
2. Export the extension from Lienzo (**Extensions → Export**) and save it as `extensions/<id>/extension.json`, where
   `<id>` is the file's `id`.
3. Optionally add `README.md` and `screenshot.png` (up to 512 KB) next to it.
4. Run `node scripts/build-index.mjs --check` and fix anything it reports.
5. Open a pull request. Do not edit `index.json`: CI rebuilds it after the merge.

## The rules

- One folder per file, named after the file's `id` (letters, digits, `.`, `_`, `-`).
- `extension.json` is a Lienzo extension file (`"format": "paseo-canvas-pack"`, `"version": 1`) with empty
  `blockTypes`, `templates` and `documents`, and 1 to 50 extensions, up to 1 MB in all.
- Each extension: `kind: "tool"`, `api: 1`, a name (up to 80 characters), a one-line description, an optional Lucide
  `icon`, its `html` page (up to 300 000 characters), `permissions` from `edit` and `network`, and an optional `docs`.
- Every extension id starts with the file's id and a dot (`title-case.title-case`), and no id appears twice in the
  catalog.
- `docs` is Markdown (headings, paragraphs, lists, code, links, bold, italic), up to 20 000 characters, with no HTML;
  links go to http, https or mailto addresses. It becomes the extension's page in Lienzo's Help.
- Optional `actions` (up to 20): what the tool offers an agent. Each has a `name`, a plain-text `description`, an
  optional `input` object schema and `returns`, and is registered with `lienzo.action(name, fn)` in a
  `<script data-lienzo="actions">` of the page (see Lienzo's Help → Make your own → 6).
- Ask only for the permissions you use, and say in `docs` why a tool needs `network`.

An update is a pull request that changes the same folder. People who installed the old file see **Update…** in
Discover, for any change to the extensions, code included (the index carries a `contentHash` of them); a changed file asks for its permissions again.
