# Game

Game state management and home network generation.

## Game State

`GameState = { seed, workstationName, username, rootPassword }` persisted in IndexedDB (`types.ts`).

- Game seed drives WiFi network generation and home network generation (deterministic)
- Player username is configurable; appears in prompt, home directory, and `/etc/passwd`
- Root password is player-chosen; guest password is seed-derived from the guest passwords pool
- Player's own user has no password (empty hash in `/etc/passwd`)
- Localhost is generated at runtime via `generateLocalhost(gameState)` in `src/generation/generateLocalhost.ts`

## App Screen Flow

`IntroScreen → BootScreen (new game only) → Terminal`

- **IntroScreen** (`src/components/IntroScreen.tsx`) — Single-screen 3-field form (workstation name, username, root password) for "New Game" or "Continue" (loads existing game)
- **BootScreen** (`src/components/BootScreen.tsx`) — Linux boot sequence animation shown only for new games
- **Terminal** — Main game interface; prompt shows hostname via `session.hostname ?? session.machine`

## Files

| File                 | Description                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `types.ts`           | `GameState` type definition                                                               |
| `gameSeed.ts`        | Seed generation and validation                                                            |
| `useHomeNetworks.ts` | Accumulates home networks per WiFi connection, guarantees unique public IPs via `usedIps` |
