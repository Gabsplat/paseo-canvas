import { useEffect, useState } from 'react';
import type { CanvasController } from './useCanvas';
import type { Change } from './lenses';
/** The stored changes of the open document, re-read when its revision moves. Null while loading or on failure. */
export function useHistory(c: CanvasController, enabled: boolean): { changes: Change[] | null; failed: boolean } {
  const id = c.view?.document.id, revision = c.view?.document.revision, [state, setState] = useState<{ key: string; changes: Change[] | null; failed: boolean }>({ key: '', changes: null, failed: false });
  const key = `${id}:${revision}`;
  useEffect(() => {
    if (!enabled || !id) return; let live = true;
    void c.api.history({ workspaceId: c.workspaceId, documentId: id }).then(result => { if (live) setState({ key, changes: result.transactions as Change[], failed: false }); }).catch(() => { if (live) setState(previous => ({ key, changes: previous.changes, failed: true })); });
    return () => { live = false; };
  }, [enabled, key]);
  return enabled ? { changes: state.changes, failed: state.failed } : { changes: null, failed: false };
}
