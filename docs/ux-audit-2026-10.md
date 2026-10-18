# Lienzo for people: block and tool audit (October 2026)

Lienzo worked well for agents and badly for a person tinkering by hand. This audit looks at every block type and tool
from the person's side: what the canvas shows, what Properties asks, what is required, what is raw JSON or free text,
what the defaults are, and whether someone can make it do something useful without reading the docs. Scores go from
1 (needs the docs or an agent) to 5 (obvious on first use). "Before" is master at 8e61bf3; "after" is this branch.
The Properties patterns that came out of it are in [design.md §36](design.md); the data and MCP side in
[mcp.md](mcp.md) under "Learning runtime" and "Block type hints".

## Ranking

| # | Block or tool | Before | After | Why, in one line |
|---|---|---|---|---|
| 1 | Select, Hand | 5 | 5 | Standard; nothing to learn. |
| 2 | Free text (T) | 4.5 | 4.5 | Click and type on the canvas; Style for the rest. |
| 3 | Shape, Arrow (R, O, A) | 4.5 | 4.5 | Drag to draw; colour, fill, stroke and label in Style. Arrow is a line shape with a head. |
| 4 | Pencil, Eraser (P, E) | 4.5 | 4.5 | Draw and erase; Style holds colour and weight. |
| 5 | Link between cards | 4.5 | 4.5 | Drag from a card's handle or Connect; label, kind and colour in Properties. |
| 6 | Note | 4 | 4 | One text field. |
| 7 | Node | 3 | 4.5 | Before: kind and status were free text, and "In progress" did not even colour its chip. After: status chips with colours, kind with suggestions, detail under More, double press renames in place. |
| 8 | Checklist | 1.5 | 4.5 | Before: items were a JSON array (ticking worked on the card). After: rows with tick, text, reorder and remove; type a new item on the card itself. |
| 9 | Window (W, web page) | 3 | 4 | Before: "Description *" was required and came first. After: the address leads, the description is optional. |
| 10 | Media | 3 | 4 | Before: "Kind of media" was free text expecting reference/image/video/audio. After: it is found from the link; an override waits under More as four chips. |
| 11 | Code | 3.5 | 4 | Before: the code field was not even monospaced; language was free text. After: monospaced, language with suggestions. |
| 12 | File tree | 1 | 4 | Before: entries were JSON paths with slash rules, closed folders another JSON list. After: an outline editor: file or folder, name, note, indent and outdent, move, highlight, mute, starts closed, the card it opens. |
| 13 | Frame (M) | 3.5 | 4.5 | Before: variables appeared only when an agent had declared some, as JSON. After: a Variables section on every Frame, as typed rows. |
| 14 | The Lienzo (Properties with nothing selected) | 3 | 4 | Before: document variables had no UI at all. After: a Variables section. |
| 15 | Controls | 1 | 4 | Before: "Variables *" was a JSON list of names that had to be declared elsewhere, as JSON, or nowhere for the Lienzo. After: pick variables of the Frame or the Lienzo, or make one inline (number, on/off, choice); sliders, switches and option buttons on the card; the question is optional. |
| 16 | Animated flow | 1 | 3.5 | Before: guiding question required, events as JSON with block IDs, durations in milliseconds. After: events as rows along a picked link, kind as segments, payload typed, durations in seconds with a slider; sign, delay and propagation under More. Still needs links between cards first, and says so. |
| 17 | GLSL shader | 1.5 | 3 | Before: uniforms and builtins were JSON that had to match declarations in the code. After: parameters as rows (label, range, start, unit, a shared variable), and adding, renaming or removing one rewrites the declarations; builtins are two checkboxes. The shader code itself is still GLSL. |
| 18 | SVG image | 3.5 | 3.5 | The library and the import dialog work; Properties has nothing to add. |
| 19 | Mini app | 2 | 2.5 | A whole HTML page in a text box. Now monospaced, height under More, and the help says to ask the agent. By nature it stays the agent's tool. |

Every type, built-in or made by an agent, also gets "Raw data (JSON)" at the bottom of Content: the whole data object,
checked against the type before Apply, so nothing an agent wrote is out of reach.

## What each block showed and asked (before)

- **Node.** Card: kind as an eyebrow, status chip, title, summary; detail beside it when selected. Properties: Title,
  Kind, Status, Summary, Details, all free text, plus four status buttons (Done, In progress, Blocked, New). Nothing
  required. Default: empty. Usable, but the vocabulary of status words that colour the chip was invisible.
- **Note.** Card: the text. Properties: Text (required). Default: empty text. Fine.
- **Code.** Card: code with a copy button. Properties: Code (required, proportional font), Language (free text,
  default "text"). Fine for people who code.
- **Checklist.** Card: ticks that work in place, done items struck through. Properties: Items (required) as a JSON
  array of strings or `{label, done}`. Default: `[]`, so a new checklist was an empty card with no way to add a row
  without typing JSON.
- **Window.** Made through W with an address dialog (good). Properties: Description (required) first, Address second.
- **Media.** Made through W. Properties: Address (required), Caption, "Kind of media" free text whose valid values
  were not shown.
- **File tree.** Card: a real tree that folds. Properties: Root, Entries (required, JSON of `{path, note, ref,
  highlight, muted}` with trailing slashes for folders), Closed folders (JSON). Default: three entries.
- **Controls.** Card: one slider per variable, or "Add names of variables declared in the Frame or the Lienzo." and
  Spanish errors for missing ones. Properties: "Question or goal" (prefilled with a generic question), Variables
  (required, JSON list of names). Declaring a variable meant group JSON that only showed when it already existed, and
  document variables could not be declared by hand at all. A person could not make it do anything.
- **Animated flow.** Card: a timeline, a scrubber, Play and Reset. Properties: Guiding question (required), Declared
  events (JSON `{t, from, to, linkId?, payload, kind}` with raw IDs), Duration in milliseconds, Travel time in
  milliseconds, Sign and delay per link (JSON keyed by link ID), Propagation limits (JSON).
- **GLSL shader.** Card: the picture, sliders, Play. Properties: Question (required), Fragment GLSL, Uniforms and
  ranges (JSON), Resolution and time (JSON), Resolution limit, Static reference. A new uniform failed validation
  unless the code declared it too.
- **Mini app.** Card: the live page in a Window. Properties: HTML (required), Height.
- **Free text, Shape, SVG image, Drawing.** Edited on the canvas and in Style; Properties shows no raw fields.
- **Frame.** Title, Purpose, Layout, and Variables as JSON only when some existed.
- **Lienzo.** Description, Instructions for the agent, Layout. No variables.

## Global concepts that were missing

1. **Variables a person can see and edit.** Variables already existed for agents (numbers with a range on the Lienzo or
   a Frame, current values in the runtime channel, resolved to the nearest scope). They now have a home in Properties
   on the Lienzo and on every Frame, as typed rows, and an optional `type`: number (default), on/off (stored 0/1) or
   choice (stored as the option index, with `options`). Values stay numbers everywhere, so the runtime, `canvas_runtime`
   and shader binding did not change. Controls pick existing variables or create one inline; renaming or deleting a
   variable updates the Controls that show it in the same transaction. A shader parameter named like a variable uses it,
   and its editor offers "Use a shared variable".
2. **Fields with a known shape get an editor.** Lists, outlines, links, durations and words with a vocabulary have
   editors; JSON is the fallback for custom types and the raw disclosure.
3. **Required means truly required.** Questions and descriptions became optional; what remains required is what the
   block cannot exist without (the text of a note, the code of a code block, the address of media, the events list).
4. **Progressive disclosure.** Types mark fields as advanced; they wait under "More options" until they hold something.
5. **Edit where the thing is.** Ticks and a new item on the checklist card; double press on a card renames it in place.
6. **Nothing is lost.** "Raw data (JSON)" shows and applies the whole object, so anything an agent wrote stays
   reachable, including fields no editor covers.

## What agents keep

Same data, same validation, same MCP tools. Every editor writes exactly the shapes the schemas accept and the agent
guidance describes (checked by `tests/ux-editors.test.ts`). The extensions are additive: optional variable `type` and
`options`, optional property `options`, `advanced` and `help` on block types (an agent's `type.put` can use them too),
optional `question` on controls and animated flows. Old documents, variables without a type and controls with a
question load and are written back unchanged.

## Not done, and why

- **Text variables.** Every consumer of a variable (runtime, `canvas_runtime`, Controls, shader uniforms) is numeric.
  A text variable would need a second runtime value type and a consumer that reads text; there is none yet.
- **GLSL question.** Still required: the shader block's chrome belongs to the UI pass running in parallel. Its default
  is prefilled, so a person never has to type it.
- **The shader code and the mini app page** stay code. Their editors help around them (declarations, height), and the
  help points to the agent.
