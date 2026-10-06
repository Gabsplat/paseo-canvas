// Stand-in for `@getpaseo/plugin/client` so the real Lienzo components can be bundled outside Paseo. Harness only.
export const openExternalUrl = async (_url: string) => {};
export const useRpc = () => async () => { throw new Error('No hay RPC en el arnés'); };
export const useAgent = () => null;
export type PluginHostProps = any; export type PluginWorkspacePanelProps = any;
