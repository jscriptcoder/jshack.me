# Game

Game state management — the bootstrap layer that owns the player's identity and the seed everything else hangs off.

## Game State

`GameState = { seed, workstationName, username, rootPassword }` persisted in IndexedDB (`types.ts`).

- Game seed drives WiFi network generation and home network generation (deterministic)
- Player username is configurable; appears in prompt, home directory, and `/etc/passwd`
- Root password is player-chosen; guest password is seed-derived from the guest passwords pool
- Player's own user has no password (empty hash in `/etc/passwd`)
- Localhost is generated at runtime via `generateLocalhost(gameState, hostname)` in `src/generation/generateLocalhost.ts`

## App Screen Flow

`IntroScreen → BootScreen (new game only) → Terminal`

- **IntroScreen** (`src/components/IntroScreen.tsx`) — Single-screen 3-field form (workstation name, username, root password) for "New Game" or "Continue" (loads existing game). Prompt preview mirrors the in-game prompt (suffix-stripped via `displayPromptHostname`).
- **BootScreen** (`src/components/BootScreen.tsx`) — Linux boot sequence animation shown only for new games
- **Terminal** — Main game interface; prompt shows the suffix-stripped hostname

## Related modules

- **`src/homeNetworks/`** — cracked-WiFi LANs as shared persistent networks, including the `HomeNetworksContext` provider/hook. (Used to live here; moved out so all home-network code lives together.)
- **`src/generation/`** — pure topology generators (mission networks, home networks, localhost). Consume `gameSeed` for determinism.
- **`src/identity/`** — Ed25519 keypair lifecycle (lazy-create, localStorage-backed). Surface that derives the workstation_id suffix.

## Files

| File          | Description                    |
| ------------- | ------------------------------ |
| `types.ts`    | `GameState` type definition    |
| `gameSeed.ts` | Seed generation and validation |
