import { z } from 'zod';

// Per-row indexable metadata for findit.io's search engine. Rows with
// a non-null search_metadata appear in `/etc/findit/index.json` on
// findit.io's filesystem. Rows with null are not indexed (e.g.,
// playground, debug surfaces). See
// supabase/migrations/20260502120000_world_networks_search_metadata.sql.
export const SearchMetadataSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  keywords: z.array(z.string()),
});

export type SearchMetadata = z.infer<typeof SearchMetadataSchema>;

// Public shape of a world_networks row returned by listWorldNetworks.
// Mirrors the table columns we project in the SELECT.
//
// description, public_domain, and search_metadata are nullable in the
// DB; the others are NOT NULL per the migration. theme is a free-form
// tag (`'playground'`, `'office'`, `'police'`, `'university'`, `'cafe'`,
// `'search-engine'`, ...) — string rather than a TS enum to keep
// adding new themes a content change (new migration row), not a code
// change. public_domain is the FQDN themed networks expose (e.g.,
// 'findit.io'); rows without a public-facing domain leave it null.
//
// Wire shape uses snake_case to match the DB; consumers keep it as-is.
export const WorldNetworkSchema = z.object({
  public_ip: z.string().min(1),
  seed: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  theme: z.string().min(1),
  public_domain: z.string().nullable(),
  search_metadata: SearchMetadataSchema.nullable(),
});

export type WorldNetwork = z.infer<typeof WorldNetworkSchema>;
