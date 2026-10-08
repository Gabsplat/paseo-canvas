// Headless lifecycle probe. No browser, window, native bridge or GUI is loaded.
export type Element = { type: unknown; props: Record<string, any> };
export const effects: (() => void | (() => void))[] = [], updates: unknown[] = [];
export function reset() { effects.length = 0; updates.length = 0; }
export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element {
  return { type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } };
}
export function useRef<T>(current: T) { return { current }; }
export function useState<T>(initial: T) { return [initial, (value: unknown) => updates.push(value)] as const; }
export function useEffect(effect: () => void | (() => void)) { effects.push(effect); }
export function useMemo<T>(get: () => T) { return get(); }
export function useSyncExternalStore(_subscribe: unknown, snapshot: () => unknown) { return snapshot(); }
export const Fragment = 'fragment';
export const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
export const jsxs = jsx;
export default { createElement };
export function createContext<T>(value: T) { return { value, Provider: 'context-provider' }; }
export function useContext<T>(context: { value: T }) { return context.value; }
