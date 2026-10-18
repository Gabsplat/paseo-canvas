import { defineSettings } from './contract';
import { z } from 'zod';

// Paseo stores this document on the host and broadcasts saves to connected clients.
export const canvasPreferences = defineSettings({
  id: 'onboarding',
  scope: 'host',
  version: 1,
  schema: z.object({ guideSeen: z.boolean().default(false) }),
});

// The person's arrangement of the interface on this host: pinned tools in pin order, and shortcut overrides by id
// (an empty string clears a shortcut). Missing keys fall back to the defaults in client/shortcuts.ts.
export const interfacePreferences = defineSettings({
  id: 'interface',
  scope: 'host',
  version: 1,
  schema: z.object({
    pinned: z.array(z.string().max(200)).max(32).default([]),
    shortcuts: z.record(z.string().max(200), z.string().max(64)).default({}),
  }),
});
