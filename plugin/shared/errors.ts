export type ErrorCode = "REVISION_CONFLICT" | "NOT_FOUND" | "VALIDATION" | "INVARIANT" | "UNKNOWN_TYPE" | "UNDO_BLOCKED" | "FORBIDDEN" | "TOO_LARGE" | "UNAVAILABLE";
export class CanvasError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    // Paseo RPC transports serialize Error.message; retain the code for client conflict UI.
    super(`${code}: ${message}`);
    this.name = "CanvasError";
  }
}
