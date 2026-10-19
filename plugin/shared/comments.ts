import { z } from "zod";
import { idSchema, positionSchema, revisionSchema } from "./model";

/**
 * Comments: the person's notes pinned on the canvas, and the agent's short answers in them. They are stored with the
 * document but are not drawing content: no document revision, no undo history, no expectedRevision. They have their
 * own small counter (commentsVersion) so a client knows when to read them again.
 */
export const COMMENT_LIMITS = { text: 2000, messages: 50, threads: 200, label: 80, bytes: 1024 * 1024 } as const;
export const commentStatusSchema = z.enum(["open", "resolved"]);
export const commentAuthorSchema = z.discriminatedUnion("kind", [
  // `via`: the extension that wrote it for the person (lienzo.comments), shown beside the name.
  z.object({ kind: z.literal("person"), via: z.string().min(1).max(COMMENT_LIMITS.label).optional() }).strict(),
  z.object({ kind: z.literal("agent"), agentId: z.string().min(1).max(200), label: z.string().min(1).max(COMMENT_LIMITS.label) }).strict(),
]);
export const commentTextSchema = z.string().trim().min(1, "Write something first.").max(COMMENT_LIMITS.text, `A comment holds at most ${COMMENT_LIMITS.text} characters.`);
export const commentMessageSchema = z.object({ id: idSchema, author: commentAuthorSchema, text: commentTextSchema, createdAt: z.iso.datetime() }).strict();
/**
 * Where a thread is pinned. On a block or a group, `dx`/`dy` move the pin from the entity's top-right corner (world
 * units) so it follows the entity; `at` is the last world point the pin was seen at, where it stays if the entity is
 * deleted (the thread becomes a free `point`). A free point is in world coordinates.
 */
export const commentAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("point"), x: z.number().finite(), y: z.number().finite() }).strict(),
  z.object({ kind: z.literal("block"), id: idSchema, dx: z.number().finite().default(0), dy: z.number().finite().default(0), at: positionSchema.optional() }).strict(),
  z.object({ kind: z.literal("group"), id: idSchema, dx: z.number().finite().default(0), dy: z.number().finite().default(0), at: positionSchema.optional() }).strict(),
]);
export const commentThreadSchema = z.object({
  id: idSchema, anchor: commentAnchorSchema, status: commentStatusSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), resolvedAt: z.iso.datetime().optional(),
  // Set when the entity the thread was pinned to was deleted: its title, so the list can still say what it was about.
  orphanedFrom: z.object({ kind: z.enum(["block", "group"]), id: idSchema, title: z.string().max(300) }).strict().optional(),
  // Came in a .lienzo file (shared/lienzo-file.ts): its authors are the other computer's, kept as they were.
  imported: z.literal(true).optional(),
  messages: z.array(commentMessageSchema).min(1).max(COMMENT_LIMITS.messages),
}).strict();
export const commentsRecordSchema = z.object({ version: revisionSchema, threads: z.array(commentThreadSchema).max(COMMENT_LIMITS.threads) }).strict();
export type CommentAuthor = z.infer<typeof commentAuthorSchema>;
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;
export type CommentThread = z.infer<typeof commentThreadSchema>;
export type CommentMessage = z.infer<typeof commentMessageSchema>;
export type CommentsRecord = z.infer<typeof commentsRecordSchema>;

/** What every comments RPC answers: the whole set for the document (small by the limits above) and its counter. */
export const commentsViewSchema = z.object({ documentId: idSchema, commentsVersion: revisionSchema, threads: z.array(commentThreadSchema), threadId: idSchema.optional() });
export type CommentsView = z.infer<typeof commentsViewSchema>;

/** The name an agent signs with: its conversation title, else its provider, else a client name, else "Agent". */
export function agentLabel(agentId: string, title?: string | null, provider?: string | null): string {
  const clean = (text?: string | null) => text?.replace(/\s+/g, " ").trim().slice(0, COMMENT_LIMITS.label);
  const named = clean(title) || (provider ? clean(provider[0].toUpperCase() + provider.slice(1)) : undefined);
  if (named) return named;
  return agentId.startsWith("mcp:") && agentId.length > 4 ? agentId.slice(4, 4 + COMMENT_LIMITS.label) : "Agent";
}
export const isAgentAuthor = (author: CommentAuthor): author is Extract<CommentAuthor, { kind: "agent" }> => author.kind === "agent";
/** The world point of a pin, given where its entity is (absolute world rectangle), or null when the entity is not there. */
export function pinPoint(anchor: CommentAnchor, rectOf: (id: string) => { x: number; y: number; width: number; height: number } | undefined): { x: number; y: number } | null {
  if (anchor.kind === "point") return { x: anchor.x, y: anchor.y };
  const r = rectOf(anchor.id);
  return r ? { x: r.x + r.width + anchor.dx, y: r.y + anchor.dy } : anchor.at ? { ...anchor.at } : null;
}
