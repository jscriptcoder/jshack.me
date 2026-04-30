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
export type WorldNetwork = {
  readonly public_ip: string;
  readonly seed: string;
  readonly name: string;
  readonly description: string | null;
  readonly theme: string;
};
