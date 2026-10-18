import type { WikiArtId } from "./art";

/** The sections of Help, in the order the rail lists them. */
export type WikiSectionId = "start" | "drawing" | "shapes" | "text" | "frames" | "sheets" | "windows" | "interactive" | "mini-apps" | "lenses" | "shortcuts" | "agents" | "extensions" | "make";
export type WikiSection = { id: WikiSectionId; title: string; icon: string };

/**
 * One Help page. The same data is the in-app page, the generated docs (docs/help.md) and what the agent reads with
 * canvas_catalog help, so each fact is written once.
 */
export type WikiPage = {
  id: string; section: WikiSectionId; title: string; icon: string;
  /** One line: what it is. Shown under the title and in search results. */
  summary: string;
  /** What it is for, in a short paragraph. */
  purpose: string;
  /** How to use it by hand, one step per entry. */
  byHand?: readonly string[];
  /** Things to say to an agent to get it, word for word. */
  askAgent?: readonly string[];
  tips?: readonly string[];
  /** A shortcut id from the registry (client/shortcuts.ts); the page shows the keys the person has now. */
  shortcut?: string;
  /** Block types this page explains: every built-in type has exactly one page (tests/wiki.test.ts). */
  blockTypes?: readonly string[];
  art: WikiArtId;
  /** Longer Markdown (shared/markdown.ts), after the structured parts. */
  body?: string;
  /** Other pages, by id. */
  related?: readonly string[];
  /** Extra words that should find this page. */
  keywords?: string;
};
