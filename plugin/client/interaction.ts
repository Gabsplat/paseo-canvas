import React, { createContext, useContext } from 'react';
const ContentInteraction = createContext<boolean | null>(null);
export const ContentInteractionProvider = ContentInteraction.Provider;
export const useContentInteraction = () => useContext(ContentInteraction) === true;
/** Outside cards, keep each text control's selection behavior. Passive cards suppress native text drag. */
export const useContentSelectionAllowed = () => useContext(ContentInteraction) !== false;
/** Cards with text ranges, scrolling or embedded media benefit from explicit interaction mode. */
export function needsContentInteraction(renderer?: string): boolean {
  return ['text','note','code','callout','step','preview-frame','image-ref','annotated-content'].includes(renderer ?? '');
}
