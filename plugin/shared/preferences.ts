import { defineSettings } from './contract';
import { z } from 'zod';

// Paseo stores this document on the host and broadcasts saves to connected clients.
export const canvasPreferences = defineSettings({
  id: 'onboarding',
  scope: 'host',
  version: 1,
  schema: z.object({ guideSeen: z.boolean().default(false) }),
});

// The person's arrangement of the interface on this host: pinned tools in pin order, shortcut overrides by id, and recent icons
// (an empty string clears a shortcut). Missing keys fall back to the defaults in client/shortcuts.ts.
export const interfacePreferences = defineSettings({
  id: 'interface',
  scope: 'host',
  version: 1,
  schema: z.object({
    pinned: z.array(z.string().max(200)).max(32).default([]),
    shortcuts: z.record(z.string().max(200), z.string().max(64)).default({}),
    // The icon library's recent icons, newest first. Offline ones by id; online ones keep their small static SVG.
    recentIcons: z.array(z.object({ id: z.string().max(200), label: z.string().max(200), svg: z.string().max(4096).optional(), source: z.string().max(200).optional(), license: z.string().max(200).optional() })).max(16).default([]),
  }),
});
