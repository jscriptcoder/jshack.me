/**
 * Committed plaintext spoiler secrets. NEVER imported by the app directly —
 * `scripts/encode.ts` reads this file at build time and emits the gitignored
 * `__encoded.ts`, which is what the game consumes. That indirection keeps these
 * strings out of a grep of the deployed bundle (see `contentCodec.ts`:
 * obfuscation, not secrecy).
 *
 * Each value is a single string so the codec can encode it as one blob; arrays
 * are JSON-stringified and the consumer `JSON.parse`s after decoding.
 *
 * Scope: `WIFI_PASSWORDS` (the crackable-AP pool `generateWifi` draws from) and
 * `UNCRACKABLE_PASSWORDS` (every password the shipped wordlist does NOT cover —
 * accounts and gateway admins alike). Other legacy pools port in when their
 * feature lands.
 */
export const secrets = {
  /**
   * Account passwords that are NOT in the wordlist `apt install hydra` ships, so
   * an account that draws one holds against a default install. They live here
   * rather than in a plain module for one reason: printed in the bundle they
   * would be a lookup table for the whole game, and a player who grepped for
   * them would skip the progression entirely.
   *
   * Long on purpose. Wordlist growth is the progression — harvest a plaintext,
   * append it, widen your coverage across every machine that drew the same word
   * — and that is only a progression while the pool is big enough for each find
   * to be a real but partial gain.
   *
   * Deliberately idiosyncratic rather than merely long: these read like
   * passwords somebody chose, which is exactly why a generic wordlist misses
   * them. The crackable pool is the opposite by design — obvious and guessable.
   */
  UNCRACKABLE_PASSWORDS: JSON.stringify([
    'brightw4ter',
    'copperfield7',
    'zulu-tango-9',
    'marmalade22',
    'nightjar!7',
    'oxide_flux',
    'penumbra31',
    'quartzite8',
    'ravenglass5',
    'saltmarsh4',
    'tessellate9',
    'umbra_9x',
    'vantablack1',
    'wolfram74',
    'xenolith3',
    'yardarm55',
    'zephyrus12',
    'alabaster6',
    'basalt_rim',
    'cinderfall2',
    'driftwood81',
    'elderflower',
    'fathomless2',
    'gallowglass',
    'hinterland7',
    'ironmonger4',
    'juniper_ash',
    'kestrelwing',
    'lodestone19',
    'millrace33',
    'nimbostrat8',
    'obsidian_k',
    'palisade46',
    'quillfeather',
    'rimefrost8',
    'stormglass5',
    'thornfield2',
    'undertow_11',
    'verdigris7',
    'wanderlust9',
    'xylophage6',
    'yellowhammr',
    'zircon_88',
    'ambergris4',
    'bellwether6',
    'chandlery3',
    'dovetail_7',
    'errantry15',
  ]),
  WIFI_PASSWORDS: JSON.stringify([
    'sunshine2024',
    'football99',
    'iloveyou!',
    'princess01',
    'trustno1',
    'letmein123',
    'welcome1',
    'shadow2024',
    'master2024',
    'dragon123',
    'qwerty2024',
    'monkey123',
    'passw0rd!',
    'batman2024',
    'access2024',
    'summer2025',
    'winter2024',
    'charlie99',
    'starwars1',
    'compaq123',
    'mustang01',
    'harley2024',
    'jordan2023',
    'hunter2024',
    'ranger2024',
    'buster2024',
    'thomas2024',
    'robert123',
    'soccer2024',
    'george2024',
    'killer2024',
    'andrew2024',
    'jessica01',
    'pepper2024',
    'ginger2024',
    'diamond99',
    'thunder24',
    'tigger2024',
    'coffee2024',
    'phoenix01',
  ]),
} as const;
