// .lienzo files through the desktop shell (plugin/shared/lienzo-file.ts): saving with the system's dialog and the files
// the system opens with the app. Kept free of imports so the preload stays small.

/** Renderer → main: show the Save dialog and write the file. Resolves false when the person cancels. */
export const SAVE_FILE_CHANNEL = 'lienzo:save-file';
/** Renderer → main: the .lienzo files opened with the app that the page has not taken yet. */
export const TAKE_FILES_CHANNEL = 'lienzo:take-files';
/** Main → renderer: more files were opened; take them. */
export const FILES_WAITING_CHANNEL = 'lienzo:files-waiting';
/** LIENZO_FILE.maxBytes: a larger file is not read (tests/lienzo-file.test.ts keeps the two equal). */
export const LIENZO_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const isLienzoPath = (path: string) => /\.lienzo$/i.test(path) && !path.startsWith('-');
export type OpenedFile = { name: string; text: string; error?: string };
