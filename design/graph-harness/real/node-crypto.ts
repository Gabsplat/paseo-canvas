export const randomUUID = () => (globalThis as any).crypto.randomUUID() as string;
