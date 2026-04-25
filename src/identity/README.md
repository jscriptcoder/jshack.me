# Identity

Ed25519 keypair primitives + localStorage persistence. The player's identity is a 32-byte public key derived from a 32-byte secret key generated on first launch and persisted across sessions.

The identity is the long-lived "this is who I am" credential — separate from the in-game wallet key (which lives in the virtual filesystem and can be lost on permadeath or stolen by other players). See `project_multiplayer_identity_wallet_keys` memory for the full split, and `docs/technology-choices.md` ("Identity & authenticated requests") for the rationale behind picking Ed25519.

## Files

| File          | Description                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `identity.ts` | Ed25519 primitives: `generateIdentity`, `sign`, `verify`. Wraps `@noble/ed25519` v3 (sync API).    |
| `storage.ts`  | localStorage adapter: hex-serializes the keypair under `jshack.identity`. Defensive on corruption. |
| `index.ts`    | Public surface + lazy singleton `getIdentity()` (reads or generates on first call).                |
| `hex.ts`      | Shared `bytesToHex` / `hexToBytes` helpers used by identity, storage, and signedRequest modules.   |
| `*.test.ts`   | Unit tests for each of the above.                                                                  |

## Identity shape

```ts
type Identity = {
  readonly privateKey: Uint8Array; // 32 bytes — never leaves the device
  readonly publicKey: Uint8Array; // 32 bytes — the player's identifier on the network
  readonly publicKeyHex: string; // 64-char lowercase hex, for display + storage
};
```

## How Ed25519 works (in this codebase)

- **Keypair generation** (`generateIdentity`): `ed.utils.randomSecretKey()` produces 32 bytes of crypto entropy as the private key. The public key is derived by scalar multiplication of the curve generator point — irreversible, so seeing a public key never leaks the private key.
- **Signing** (`sign(privateKey, message)`): produces a 64-byte signature that proves the holder of the private key "saw" the message bytes. Deterministic: signing the same `(key, message)` pair twice produces identical signatures (Ed25519 spec — no nonce randomness at sign time).
- **Verification** (`verify(publicKey, signature, message)`): pure function that returns true only if the signature was produced by the matching private key over the exact message bytes. No false positives — flipping any bit in any input fails verification.

`@noble/ed25519` v3 ships sync primitives but requires the caller to wire a SHA-512 implementation explicitly (kept out of the core package to minimize bundle size). `identity.ts` does this once at module load via `ed.hashes.sha512 = sha512` from `@noble/hashes`.

## Storage model

The identity is hex-encoded and persisted in `localStorage` under `jshack.identity`:

```json
{
  "privateKey": "<64 hex chars>",
  "publicKey": "<64 hex chars>"
}
```

`getOrCreateIdentity(storage)` is the typical entry point — returns the stored identity if one exists, otherwise generates + persists a fresh one. Callers don't usually need to know which path was taken.

`loadIdentity` is defensive: any malformed storage state (missing fields, bad hex, wrong length) returns `null` instead of throwing, so `getOrCreateIdentity` can fall back to `generateIdentity` rather than crashing on boot. The downside — silent identity reset on corruption — is intentional and documented in the identity-vs-wallet-keys memory.

## Singleton entry point

`getIdentity()` (from `index.ts`) is a lazy singleton — reads or generates the identity on first call, caches the result for the lifetime of the page. `localStorage` is available synchronously in the browser so this stays sync.

`resetIdentityCache()` is exposed for tests to clear the in-memory cache between scenarios; it does not touch `localStorage` itself.

## Identity reset

There is no in-game UI for "new identity." A player who wants a fresh identity must clear `localStorage` manually via browser devtools (or use a fresh browser profile). This is deliberate: identity reset = abandoning your reputation, your darknet listings, your messages — it is a destructive action and should require explicit intent. See `project_multiplayer_identity_wallet_keys` memory.

## CLI surface

`identity` (in `src/commands/identity.ts`) prints the player's public key:

```
Identity:    ed25519:<64 hex chars>
Fingerprint: <first 16 hex chars>
```

The fingerprint is a UI convenience for sharing — players can recognize their friends by the short prefix without copying the whole 64-character key.
