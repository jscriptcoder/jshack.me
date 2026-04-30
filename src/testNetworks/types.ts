// Public shape of a test network row, returned by listTestNetworks.
// Mirrors the test_networks table columns we project in the SELECT.
//
// description is nullable in the DB; the others are NOT NULL per the
// migration. Wire shape uses snake_case to match the DB; consumers
// keep it as-is (no FileSystemPatch-style conversion needed since
// these fields are dev-only metadata, not gameplay data).
//
// REMOVED AT GAME RELEASE: drop this directory along with the
// supporting migration. See plans/test-networks-playground.md.
export type TestNetwork = {
  readonly public_ip: string;
  readonly seed: string;
  readonly name: string;
  readonly description: string | null;
};
