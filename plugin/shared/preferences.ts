import { defineSettings } from '@getpaseo/plugin';
import { z } from 'zod';

// Paseo stores this document on the host and broadcasts saves to connected clients.
export const canvasPreferences = defineSettings({
  id: 'onboarding',
  scope: 'host',
  version: 1,
  schema: z.object({ guideSeen: z.boolean().default(false) }),
});
