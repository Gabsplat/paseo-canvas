import type { UpdateState } from './rpc';

/** How long ago, in the words the other screens use. */
export function agoWords(iso: string, now: number): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 60 * 24 ? `${Math.round(minutes / 60)} h ago` : new Date(iso).toLocaleDateString();
}

/** What Settings → About says about updates: a short state and, when there is one, a muted detail line. */
export function updateWords(state: UpdateState, now = Date.now()): { title: string; detail: string | null; tone: 'muted' | 'normal' | 'good' | 'warning' | 'danger' } {
  switch (state.kind) {
    case 'off': return { title: 'Off', detail: state.reason, tone: 'muted' };
    case 'blocked': return { title: 'Cannot update here', detail: state.reason, tone: 'warning' };
    case 'idle': return state.checkedAt ? { title: 'Up to date', detail: `Checked ${agoWords(state.checkedAt, now)}`, tone: 'good' } : { title: 'Not checked yet', detail: null, tone: 'normal' };
    case 'checking': return { title: 'Checking…', detail: null, tone: 'normal' };
    case 'downloading': return { title: `Downloading ${Math.floor(state.percent)} %`, detail: `Version ${state.version}, in the background`, tone: 'normal' };
    case 'ready': return { title: 'Ready to restart', detail: `Version ${state.version} is downloaded. Restart Lienzo to use it, or it goes in when you quit.`, tone: 'good' };
    case 'error': return { title: 'Update failed', detail: state.message, tone: 'danger' };
  }
}
