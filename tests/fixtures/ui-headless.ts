// Headless stand-in for plugin/client/ui.tsx in shallow component tests: primitives are element types only.
export const Txt = 'Txt', Button = 'Button', Input = 'Input', MenuRow = 'MenuRow', Segments = 'Segments', CheckRow = 'CheckRow', UIProvider = 'UIProvider';
export function friendlyError(error: unknown) { return error instanceof Error ? error.message : String(error); }
