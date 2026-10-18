import type { WikiPage } from "./types";

/**
 * "Make your own": the walkthrough for writing an extension, and the complete example it builds. The example is the
 * one source for the agent's extension guide (shared/extensions.ts), docs/extensions-tutorial.md and the example in
 * the catalog repository (marketplace/extensions/title-case/extension.json); tests/wiki.test.ts keeps them equal.
 */
export const EXAMPLE_HTML = `<style>body{margin:0;padding:12px;font:13px system-ui,sans-serif}button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid;cursor:pointer}button:disabled{opacity:.5;cursor:default}</style>
<p id="info">Select some cards.</p>
<button id="go" disabled>Title Case the titles</button>
<script data-lienzo="actions">
// The work, once: the button below runs it, and so can an agent (canvas_extension_run), headless, without this page.
function titleCase(t) { return t.replace(/\\b\\w/g, function (c) { return c.toUpperCase(); }); }
lienzo.action('titleCase', function (input, c) {
  var ids = input.ids || c.selection;
  var ops = c.document.blocks.filter(function (b) { return ids.indexOf(b.id) >= 0 && titleCase(b.title) !== b.title; })
    .slice(0, 200).map(function (b) { return { type: 'block.update', id: b.id, patch: { title: titleCase(b.title) } }; });
  if (!ops.length) return { changed: 0 };
  return lienzo.edit(ops, 'Title Case').then(function () { return { changed: ops.length }; });
});
</script>
<script>
var info = document.getElementById('info'), go = document.getElementById('go');
lienzo.onContext(function (c) {
  var k = c.theme.colors, n = c.document.blocks.filter(function (b) { return c.selection.indexOf(b.id) >= 0; }).length;
  document.body.style.background = k.surface; document.body.style.color = k.foreground;
  go.style.background = k.accent; go.style.color = k.background; go.style.borderColor = k.accent;
  info.textContent = n ? n + ' selected' : 'Select some cards.';
  go.disabled = !n;
});
go.onclick = function () {
  lienzo.run('titleCase', {}).then(function (r) { info.textContent = r.changed ? 'Done. Undo brings the old titles back.' : 'They are in Title Case already.'; }, function (e) { info.textContent = e.message; });
};
</script>`;
export const EXAMPLE_DOCS = `Title Case gives every selected card a title in Title Case, in one step you can undo.

## Use it

1. Select the cards to tidy.
2. Open **Title Case** from the + catalog (Extensions).
3. Press **Title Case the titles**.

> It needs the "Changes the canvas" permission. Undo (⌘Z) brings the old titles back.`;
/** What the example offers an agent: one action, the same code the button runs. */
export const EXAMPLE_ACTIONS = [{ name: "titleCase", description: "Rewrites card titles in Title Case, in one undoable edit. Without ids it works on the cards the person selected.",
  input: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, maxItems: 200, description: "The cards to change. Default: the person's selection." } } },
  returns: { type: "object", properties: { changed: { type: "integer", description: "How many titles changed." } } } }] as const;
/** The whole extension, as save_extension takes it and as the catalog example ships it. */
export const EXAMPLE_EXTENSION = { id: "title-case", kind: "tool", api: 1, name: "Title Case", description: "Gives the selected cards titles in Title Case.", icon: "CaseSensitive", permissions: ["edit"], html: EXAMPLE_HTML, docs: EXAMPLE_DOCS, actions: EXAMPLE_ACTIONS } as const;
/** The same extension as a single-extension file: what Export writes and what the catalog holds. */
export const EXAMPLE_FILE = { format: "paseo-canvas-pack", version: 1, id: "title-case", name: "Title Case", description: EXAMPLE_EXTENSION.description, blockTypes: [], templates: [], documents: [], extensions: [{ ...EXAMPLE_EXTENSION, id: "title-case.title-case" }] } as const;

const fence = (language: string, text: string) => "```" + language + "\n" + text + "\n```";
export const tutorialPages: readonly WikiPage[] = [
  { id: "make.overview", section: "make", title: "Make your own", icon: "Hammer", art: "tutorial",
    summary: "Ask your agent for a tool, try it, and share it. No build step.",
    purpose: "An extension is a small tool that joins Lienzo: one HTML page that reads the Lienzo, changes the selection and, with your permission, edits the canvas in one undoable step. You do not need to write it yourself: your agent writes it, saves it, and it appears in the + catalog. These pages walk through it from the first request to sharing it in the catalog.",
    byHand: ["Ask your agent for the tool (step 1).", "Read what it saved in Extensions (step 2).", "Open it from the + catalog and try it on a few cards (step 3).", "Check what it may do (step 4).", "Export it or publish it to the catalog (step 5).", "Let your agent use it too (step 6)."],
    askAgent: ["Make me a Lienzo extension that counts the cards in the selection.", "Write a Lienzo tool that turns the selected cards into a checklist."],
    related: ["make.ask", "make.example", "ext.about"], keywords: "tutorial create build write extension tool walkthrough" },
  { id: "make.ask", section: "make", title: "1. Ask your agent", icon: "MessageSquare", art: "agent",
    summary: "Say what the tool is for, what it acts on, and what it changes.",
    purpose: "Your agent saves extensions with the canvas_catalog tool, which asks for your approval the first time. A good request says three things: what the tool works on (the selection, a Frame, the whole Lienzo), what it shows, and what it changes when you press it.",
    byHand: ["Open the conversation where your agent works (in Paseo, the chat next to the Lienzo; on desktop, the agent's own app or terminal).", "Describe the tool in one or two sentences.", "Approve the catalog change when your agent asks."],
    askAgent: ["Make a Lienzo extension called Title Case: it shows how many cards are selected and has one button that rewrites their titles in Title Case.", "Write a Lienzo tool that shows the selected Frame's cards as a numbered list I can copy.", "Add a page of Help to your extension that explains how to use it."],
    tips: ["Ask for a Help page too: the agent adds a docs field and the tool gets its own page here, under Extensions.", "Name the permission it may need. A tool that only reads and selects needs none."],
    related: ["make.writes"] },
  { id: "make.writes", section: "make", title: "2. What it writes", icon: "FileCode", art: "extension",
    summary: "A manifest and one self-contained page that talks to window.lienzo.",
    purpose: "Your agent saves a manifest: an id, a name, a one-line description, an icon, the permissions it asks for, the page (html), and optionally its Help page (docs, short Markdown). The page runs sandboxed in its own frame, with no access to Paseo, your files or other sites. It reaches the canvas only through window.lienzo.",
    body: [
      "## The parts of the page",
      "- `lienzo.onContext(fn)` calls `fn` with the Lienzo (cards, Frames, links, where each one is), the selection and the theme's colours, now and on every change.",
      "- `lienzo.select(ids)` changes the selection; `lienzo.open(id)` goes to a card on the canvas.",
      "- `lienzo.edit(operations, label)` changes the canvas in one transaction you can undo. It needs the **edit** permission.",
      "- `lienzo.kit.stage(...)` draws things with the canvas' own selection, hover and drag behaviour.",
      "- `lienzo.action(name, fn)`, in a script marked `data-lienzo=\"actions\"`, offers a job your agent can run too (step 6).",
      "",
      "## The manifest",
      fence("json", JSON.stringify({ id: "title-case", kind: "tool", api: 1, name: "Title Case", description: "Gives the selected cards titles in Title Case.", icon: "CaseSensitive", permissions: ["edit"], html: "<p id=\"info\">…</p><script>…</script>", docs: "Title Case gives every selected card…" }, null, 2)),
      "",
      "The whole contract is in [docs/extensions.md](https://github.com/Gabsplat/paseo-canvas/blob/master/docs/extensions.md).",
    ].join("\n"),
    related: ["make.example", "make.test"] },
  { id: "make.test", section: "make", title: "3. Test it", icon: "FlaskConical", art: "select",
    summary: "Open it from the + catalog and try it on a few cards.",
    purpose: "A saved extension appears at once in the + catalog under Extensions, in ⌘K, and as a card in the Extensions screen. It opens as a tab of the Properties panel and works on the shared selection, so what you select on the canvas is what it sees.",
    byHand: ["Press + in the toolbar and choose your tool under Extensions.", "Select a few cards: the tool should react at once.", "Press its button. If it changed the canvas, ⌘Z undoes the whole step.", "Ask your agent to fix anything that is off; saving the same id replaces the tool."],
    askAgent: ["The Title Case tool ignores Frames. Make it rename the selected Frames too.", "Your tool's text is hard to read in the light theme. Use the theme colours it is given."],
    tips: ["Extensions run in the web and desktop apps, not on the phone.", "If the tool says it has no permission, see step 4."],
    related: ["make.permissions"] },
  { id: "make.permissions", section: "make", title: "4. Permissions", icon: "ShieldCheck", art: "permissions",
    summary: "Reading and selecting are free; changing the canvas and the internet are asked for.",
    purpose: "An extension declares what it needs: edit (change the canvas) and network (load things from the internet). Without network it can load nothing from outside its own page. A tool made here by you or your agent holds what it declares. One that arrives in a file or from the catalog holds nothing until you allow it: until then it can only read and select.",
    byHand: ["Open Extensions (menu → Extensions).", "A card that waits shows a warning strip: read what it asks for, then press Allow.", "Replacing the file with different code asks again."],
    tips: ["There is no permission to talk to the agent: the canvas never sends anything to it. You talk to your agent in your own chat."],
    related: ["ext.permissions", "make.share"] },
  { id: "make.share", section: "make", title: "5. Share it", icon: "Share2", art: "publish",
    summary: "Export one file, or publish it to the catalog with a pull request.",
    purpose: "Every extension travels as an extension file (JSON). Export saves one tool as its own file: send it to someone and they add it with Add from file…, after a review of what it asks for. To share it with everyone, Publish… checks it, saves the file, and opens GitHub to propose it to the Lienzo extensions catalog. Once the pull request is merged it shows in Discover.",
    byHand: ["Open Extensions and find your tool's card.", "Press Export for a file, or Publish… for the catalog.", "Publish… checks the tool, saves the file and opens GitHub. Sign in there, add the file, and open the pull request.", "Add a README.md and a screenshot.png next to extension.json if you like."],
    tips: ["Lienzo never holds a GitHub token: everything on GitHub happens in your browser.", "Every id in a file starts with the file's id and a dot, like title-case.title-case."],
    related: ["ext.export", "ext.publish", "ext.discover"] },
  { id: "make.actions", section: "make", title: "6. Let your agent use it", icon: "Bot", art: "agent",
    summary: "Give the tool actions, and your agent can run it for you.",
    purpose: "An extension can offer actions: named jobs your agent runs itself, like \"Title Case these cards\". The work is written once, in a script of the page marked data-lienzo=\"actions\". The page's own buttons run it with lienzo.run, and your agent runs it with canvas_extension_run, without the page, in a sandbox on your computer. Each run the agent makes is one step in History, marked (agent), and undoes like any other.",
    byHand: ["Ask your agent to add an action to the tool (it declares it in the manifest and registers it in the actions script).", "Open the tool's Help page: \"For your agent\" lists its actions.", "Ask your agent to use it: \"Title Case the cards I selected\".", "Check History: the step reads \"Title Case (agent): Title Case\". Undo brings the old titles back."],
    askAgent: ["Add a titleCase action to my Title Case extension so you can run it yourself.", "Use the Title Case extension on the cards in the Ideas Frame."],
    tips: ["An action that changes the canvas needs the edit permission. One from a file or the catalog cannot edit until you allow it.", "The actions script must not use the page (no document, no buttons): it also runs without one.", "An action runs for at most 2 seconds and 64 MB, without timers or the internet; a failing one changes nothing."],
    body: [
      "## In the manifest",
      fence("json", JSON.stringify({ actions: EXAMPLE_ACTIONS }, null, 2)),
      "",
      "## In the page",
      fence("html", EXAMPLE_HTML.slice(EXAMPLE_HTML.indexOf('<script data-lienzo="actions">'), EXAMPLE_HTML.indexOf("</script>") + "</script>".length)),
      "",
      "Headless, the action sees `lienzo.context` (the document and the selection; no theme or layout), `lienzo.edit`, `lienzo.select`, `lienzo.action` and `lienzo.run`. All its edits in one run become one transaction.",
    ].join("\n"),
    related: ["make.example", "make.permissions"], keywords: "actions agent headless run canvas_extension_run automate" },
  { id: "make.example", section: "make", title: "A complete example", icon: "BookOpenCheck", art: "extension",
    summary: "Title Case: the whole extension, ready to save or import.",
    purpose: "This is a complete, small extension. It reads the selection, shows how many cards are selected, and rewrites their titles in one undoable step. It uses the theme's colours so it reads well in light and dark, and it brings its own Help page.",
    askAgent: ["Save the Title Case example from Lienzo Help as an extension."],
    body: [
      "## The page (html)",
      fence("html", EXAMPLE_HTML),
      "",
      "## The file to share",
      "Export writes the extension inside the file container. Its id is the file's id and a dot:",
      fence("json", JSON.stringify({ ...EXAMPLE_FILE, extensions: [{ ...EXAMPLE_FILE.extensions[0], html: "…the page above…", docs: "…its Help page…" }] }, null, 2)),
    ].join("\n"),
    related: ["make.writes", "make.share"], keywords: "sample manifest code json html" },
];
