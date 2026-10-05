// Process-session state survives host navigation remounts on every platform.
// Only IDs are retained; fresh RPC reads remain authoritative for document data.
const lastOpenedDocuments = new Map<string, string>();
const key = (hostId: string | undefined, workspaceId: string) => hostId ? JSON.stringify([hostId, workspaceId]) : null;

export function rememberOpenDocument(hostId: string | undefined, workspaceId: string, documentId: string) {
  const scope = key(hostId, workspaceId);
  if (scope) lastOpenedDocuments.set(scope, documentId);
}

export function initialDocumentId(hostId: string | undefined, workspaceId: string, documents: readonly { id: string }[]): string | null {
  const scope = key(hostId, workspaceId), remembered = scope ? lastOpenedDocuments.get(scope) : undefined;
  if (remembered && documents.some(document => document.id === remembered)) return remembered;
  if (scope) lastOpenedDocuments.delete(scope);
  return documents[0]?.id ?? null;
}
