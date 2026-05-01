import { z } from 'zod';

// Public shape of a world_networks row returned by listWorldNetworks.
// Mirrors the table columns we project in the SELECT.
//
// description is nullable in the DB; the others are NOT NULL per the
// migration. theme is a free-form tag (`'playground'`,
// `'office'`, `'police'`, `'university'`, `'cafe'`, ...) — string
// rather than a TS enum to keep adding new themes a content change
// (new migration row), not a code change.
//
// Wire shape uses snake_case to match the DB; consumers keep it as-is.
export const WorldNetworkSchema = z.object({
  public_ip: z.string().min(1),
  seed: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  theme: z.string().min(1),
});

export type WorldNetwork = z.infer<typeof WorldNetworkSchema>;
