export const Platform = { OS: 'web' };
export const View = 'View';
export const Txt = 'Txt';
export const Button = 'Button';
export function useUI() { return { compact: false, layout: { platform: Platform.OS }, c: { accent: '#246', statusDanger: '#933' } }; }
