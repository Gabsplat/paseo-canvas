// Headless stand-ins for @getpaseo/plugin/client/react-native: element types only, no host.
export const Icon = 'Icon';
export const ScrollView = 'ScrollView';
export const TextInput = 'TextInput';
export const Modal = Object.assign(() => null, { Content: 'ModalContent' });
export function useToast() { return { show() {}, error() {} }; }
export async function copyText() {}
