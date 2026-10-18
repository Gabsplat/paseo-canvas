import { capabilities, type SettingsState } from './host';
import type { canvasPreferences } from '../shared/preferences';

// Save before opening: two clients with the same revision cannot both show the guide.
export async function claimFirstGuide(settings: SettingsState<typeof canvasPreferences.schema>): Promise<boolean> {
  if (settings.status !== 'ready' || settings.values.guideSeen || settings.saving || settings.saveError) return false;
  return settings.save({ ...settings.values, guideSeen: true }, settings.revision);
}

/** The four scenes of the Lienzo guide (docs/redesign-2026-10.md, "Onboarding"), in order. */
export type GuideScene = { id: 'draws' | 'hojas' | 'point' | 'tools'; kicker: string; title: string; body: string };
export const guideScenes = (): readonly GuideScene[] => [
  { id: 'draws', kicker: 'While it works', title: 'The agent draws while it works.', body: capabilities.runsAgents
    ? 'Turn on the Lienzo chip in a conversation and your agent sketches what it explains, card by card, as it answers. You watch the idea take shape next to the chat.'
    : 'Connect your agent once (Settings → Agents) and ask it to draw what it explains. It sketches card by card, as it answers in its own app.' },
  { id: 'hojas', kicker: 'Sheets', title: 'One Sheet per explanation.', body: 'A Sheet is a chapter. Each new explanation gets its own, side by side. The pill on top says where you are, and the magnet follows the agent while it draws. Move the camera yourself and it lets go.' },
  { id: 'point', kicker: 'Your chat', title: 'Point, then ask in your own chat.', body: 'Select something and say “mirá esto” in your conversation: the agent reads what you selected and what you did with it. The canvas never talks to the agent. Your chat does.' },
  { id: 'tools', kicker: 'Extensions', title: 'Make your own tools.', body: 'Extensions are small pages you or your agent write. Ask for one, like “a timer for this Frame”, and it joins the toolbar. They work in Paseo and in the desktop app.' },
];
