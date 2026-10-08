import { useSyncExternalStore } from 'react';
import type { CanvasCatalog, CanvasDocument } from '../shared/model';
import type { RuntimeState } from '../shared/learning';
import type { CanvasController } from './useCanvas';
import { canvasPresentation, type CanvasPresentation } from './presentation';

// A runtime frame is shared by sibling cards: compute visibility once per snapshot.
const cache = new WeakMap<CanvasDocument, WeakMap<RuntimeState, WeakMap<CanvasCatalog, CanvasPresentation>>>();
const projections = new WeakMap<CanvasDocument, { signature: string; document: CanvasDocument }>();
export function usePresentation(controller: CanvasController): CanvasPresentation | undefined {
  const runtime = useSyncExternalStore(controller.learning.subscribe, controller.learning.getSnapshot, controller.learning.getSnapshot);
  const document = controller.view?.document, catalog = controller.catalog;
  if (!document || !catalog) return undefined;
  let snapshots = cache.get(document);
  if (!snapshots) cache.set(document, snapshots = new WeakMap());
  let catalogs = snapshots.get(runtime);
  if (!catalogs) snapshots.set(runtime, catalogs = new WeakMap());
  let result = catalogs.get(catalog);
  if (!result) {
    result = canvasPresentation(document, catalog, runtime);
    // Scope sliders publish every frame. Unchanged visibility must not invalidate graph layout.
    const signature = JSON.stringify([...result.hiddenBy.keys()].sort()), previous = projections.get(document);
    if (previous?.signature === signature) result.document = previous.document;
    else projections.set(document, { signature, document: result.document });
    catalogs.set(catalog, result);
  }
  return result;
}
