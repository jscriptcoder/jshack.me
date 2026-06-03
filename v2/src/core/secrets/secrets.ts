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
 * Scope (WiFi connectivity arc): `WIFI_PASSWORDS` only — the crackable-AP pool
 * `generateWifi` draws from. Other legacy pools port in when their feature lands.
 */
export const secrets = {
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
