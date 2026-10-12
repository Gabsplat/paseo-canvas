// Pure copilot presentation logic: no React, no host. Tested headlessly.
import type { CopilotCadence } from '../../shared/model';

export type PillStatus = 'off' | 'on' | 'drawing';
export type PillEntry = { enabled: boolean; drawing: boolean; hasTools: boolean };
export type CopilotLatest = { documentId: string; transactionId: string; at: string; label: string; ids: string[]; removed: string[]; titles: string[] };
export type DocumentSummary = { id: string; title: string; updatedAt: string; example?: boolean };

export const PILL_LABEL = 'Lienzo';
export const PILL_TITLE = 'Lienzo copilot — the agent draws what it explains on a canvas (Lienzo is Spanish for canvas)';
export const POPOVER_SIZE = { width: 320, maxHeight: 360 } as const;

export function pillStatus(entry: PillEntry | undefined): PillStatus {
  if (!entry?.enabled) return 'off';
  return entry.drawing ? 'drawing' : 'on';
}
export const statusText: Record<PillStatus, string> = { off: 'Off', on: 'On', drawing: 'Drawing now' };

export const CADENCE_OPTIONS: readonly { value: CopilotCadence; label: string; hint: string }[] = [
  { value: 'thinking', label: 'Thinking', hint: 'Draws after reasoning or each tool use.' },
  { value: 'step', label: 'Step', hint: 'Draws after each step worth showing.' },
  { value: 'task', label: 'Task', hint: 'Draws once, at the end of a task.' },
  { value: 'custom', label: 'Custom', hint: 'Draws when your rule says so.' },
];
export const cadenceHint = (cadence: CopilotCadence) => CADENCE_OPTIONS.find(option => option.value === cadence)!.hint;
/** Reminders exist only for step and task: thinking draws all the time, custom follows the person's rule. */
export const remindApplies = (cadence: CopilotCadence) => cadence === 'step' || cadence === 'task';

export function relativeTime(at: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** One line for "Go to latest": what the agent touched last, and when. */
export function latestPreview(latest: CopilotLatest | null, now: number): { title: string; detail: string } | null {
  if (!latest) return null;
  const count = latest.ids.length, when = relativeTime(latest.at, now);
  const what = count ? `${count} ${count === 1 ? 'thing' : 'things'}` : latest.removed.length ? `removed ${latest.removed.length}` : 'an edit';
  const names = latest.titles.length ? latest.titles.map(title => `“${title}”`).join(', ') + (count > latest.titles.length ? ` and ${count - latest.titles.length} more` : '') : latest.label;
  return { title: `${what} · ${when}`, detail: names };
}

/** Recent Lienzos to attach: real documents first by recency, the attached one excluded, examples last. */
export function recentLienzos(documents: readonly DocumentSummary[], attachedId: string | null, limit = 3): DocumentSummary[] {
  return [...documents].filter(document => document.id !== attachedId)
    .sort((a, b) => Number(!!a.example) - Number(!!b.example) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

/** Model string for "New agent with Lienzo": same provider and model as the agent it replaces. */
export function providerModel(agent: { provider: string; model?: string | null }): string {
  return agent.model && !agent.provider.includes('/') ? `${agent.provider}/${agent.model}` : agent.provider;
}

/** How often the pill status is polled: only while some agent with the copilot on is running, plus a short tail. */
export const POLL_MS = 1500;
