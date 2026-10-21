# Snap (example)

Example code for extension presentation: an **overlay** drawn right over the canvas. Select some cards and press
Enter: they crumble to dust where they are, then Snap asks whether to delete them (one step you can undo) or bring
them back. Esc closes it at any moment, and anything it hid comes back.

It shows `presentation: { mode: "overlay" }`, `lienzo.view.get().rects`, `lienzo.view.snapshot` (desktop app; in a
browser it draws a stand-in card), `lienzo.hide` / `lienzo.show`, `lienzo.ui.capturePointer`, `lienzo.keys` and
`lienzo.input`. An agent can open it on given cards:
`canvas_extension_open { extension: "snap.snap", input: { ids: ["…"], delete: false } }`.

It asks for two permissions: **move the view of the canvas** (to see where the cards are) and **change the canvas**
(to delete them).
