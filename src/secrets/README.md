# Secrets

Anti-cheat encoding system. Sensitive content is XOR+Base64 encoded at build time to prevent finding flag strings or passwords in the JS bundle.

## Content Encoding

- `npm run encode` generates `__encoded.ts` (gitignored)
- `predev`/`prebuild`/`pretest`/`pretest:run`/`pretest:coverage` hooks auto-run encode
- `wifiNetworks.ts` imports from `__encoded.ts`, not the plaintext `secrets.ts`
- `generateWifi.ts` imports WiFi passwords from `__encoded.ts`
- `pools/` modules import mission passwords from `__encoded.ts` (not hardcoded in source)
- Unit tests import source files directly (unaffected by encoding)
- Verify: `grep -r "FLAG{" dist/` and `grep -r "cr4ck3d_w1f1" dist/` after build should return zero matches (mission flags are generated at runtime, not embedded in the bundle)

## Secrets Registry

`secrets.ts` defines sensitive non-filesystem strings (e.g., WiFi password, mission passwords) as key-value pairs. The `encode` script encodes them into `__encoded.ts`. App code imports from `__encoded`, tests import from the source file directly.

Current secrets:

| Key                  | Description                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `WIFI_PASSWORD`      | Legacy static WiFi password                                                                  |
| `WIFI_PASSWORDS`     | JSON-stringified array of 40 passwords for seeded WiFi generation                            |
| `MISSION_PASSWORDS`  | JSON-stringified array of 120 passwords — never in hydra's wordlist, never brute-forceable   |
| `GUEST_PASSWORDS`    | JSON-stringified array of 20 guest passwords — always in hydra's wordlist                    |
| `WORDLIST_PASSWORDS` | JSON-stringified array of 60 common passwords for hydra's wordlist — disjoint from MISSION   |
| `SNMP_COMMUNITIES`   | JSON-stringified array of 24 SNMP read-write community strings for mission generator & hydra |

To add a new secret: add the key-value pair to `secrets.ts`, then run `npm run encode`.
