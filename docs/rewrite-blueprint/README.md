# JSHACK.ME Rewrite Blueprint

A complete snapshot of every feature, system, and design decision in the current React/TypeScript codebase, prepared for a from-scratch rewrite in Solid.js.

The goal: a Solid engineer (or future Claude session) can re-implement the whole game from this folder without reading the original source, while keeping every gameplay-meaningful behavior intact. Mission content is deferred — multiplayer + CVEs + cross-player are the priority.

## How to read this

- **Start with Section 4 (Multiplayer Foundation)** if you're scoping the rewrite — it's the load-bearing system and the longest section. Identity → signed envelope → L1 → L2 (reads + writes + auth) → deferred L3 are all enumerated, with the threat-model summary table at §4.18.
- **Section 3 (CVE & Exploit System)** is the second-most-protected design — the 8 effect kinds, day-0 vs procedural timing, library CVE chain, defense treadmill, msfconsole variants. Worth reading before touching network/exploit code.
- **Section 5 (Shared World)** documents the seed-regen cross-LAN approach, foreign LAN occupants, and the React closure-capture pattern (which will need a different shape under Solid's signal model).
- **Sections 1, 2, 6** describe terminal UX, network/daemon model, and filesystem/generation — read once each to scope work.
- **Section 7 (Game Shell)** covers intro/boot/lifecycle/persistence and ends with a deliberately-skimmed mission overview.

## Security layer index

Captured across multiple sections (Section 4 is the hub):

| Layer | Where documented | What it protects |
| ---- | ---------------- | ---------------- |
| L0 — transport / envelope | §4.3 signed envelope + §4.3 replay protection | Forgery, replay, signature malleability |
| L1 — session presence    | §4.8 + ambient-log allowlist                  | "Caller has no session on this machine"  |
| L2 — write permission    | §4.9 walker + machine_filesystems projection  | Guest writing to root-owned paths        |
| L2 — read privacy        | §4.10 three-tier read filter                  | No-session callers reading secrets       |
| L2 — auth + userType     | §4.6 createSession + authCreateSession        | Forging "I am root" via envelope         |
| L3 — game-logic (deferred) | §4.17 + §4.18 boundary table                  | Forge bypasses on exploitRead/password_reset |
| RLS (Supabase)           | §4.4 per-table posture                        | Direct anon SELECT on sensitive tables   |
| Anti-cheat (client)      | §6.11 build-time secrets encoding             | Flag/password search through JS bundle   |

## Sections

1. [Terminal & Commands](sections/01-terminal-and-commands.md)
2. [Network & Infrastructure](sections/02-network-and-infrastructure.md)
3. [CVE & Exploit System](sections/03-cve-and-exploits.md)
4. [Multiplayer Foundation](sections/04-multiplayer-foundation.md) ← **start here for the rewrite scope**
5. [Shared World & Cross-Player](sections/05-shared-world-and-cross-player.md)
6. [Filesystem, Users, Generation](sections/06-filesystem-and-generation.md)
7. [Game Shell & Lifecycle](sections/07-game-shell-and-lifecycle.md)

## Out of scope for this blueprint

- **Mission content** — Player explicitly deferred. Section 7.14 sketches the lifecycle and points at `docs/mission-variations.md`. Multiplayer + CVEs come first; missions get redesigned on top.
- **UI styling specifics** — The CRT amber-on-black aesthetic and theme catalog are noted (§7.9) but exact CSS values aren't reproduced; the rewrite can re-derive from `src/theme/themes.ts`.
- **Test coverage strategy** — TDD principles in `docs/development-guidelines.md` carry over; the smoke-test catalog (§4.19) is what matters for multiplayer.

## Cross-cutting concerns the rewrite should design for from day one

1. **Server-authoritative gameTime** — Currently `Date.now() - startedAt` client-side. Memory `project_multiplayer_design_notes` flags this as anti-cheat work. Bake server-stamped gameTime into the API surface from the start (§7.5).
2. **Solid's signal model vs React closure-capture pattern** — The whole `useNetworkCommands` ref-wrap + `flushSync` pattern documented in §5.9 is a React-specific bug shape. Solid signals don't capture stale values the same way; this should simply not exist in the rewrite. Don't port the workaround.
3. **Shared permission walker as a pure module** — §4.9 + §6.2. The walker is byte-identical client + server; keep that property in the rewrite (single `permissionWalker.ts`, imported by both sides).
4. **Patch-stream + Realtime hint-only broadcasts** — §4.14. Don't ship full payloads through Realtime. The hint architecture (`{ machine_id, originator_key }` → refetch via signed endpoint) is the load-bearing design.
5. **/etc/passwd as the canonical credential source** — §6.3 + §4.6. No `passwordHash` field on RemoteUser, no `/etc/shadow`. Sabotage-via-garble is a real attack vector by design.
6. **Identity vs wallet keypair split** — §4.1 + §4.2 + §7.8. Two keypairs, different storage, different threat models. Don't merge them.
7. **`'ed25519:'` prefix in computeWorkstationId** — §4.1. Load-bearing invariant; calling derive with raw playerKey produces a divergent suffix and silently breaks auth.

## Glossary (quick reference)

- **L1 / L2 / L3** — server-side patch-validation layers; see Security Layer Index above.
- **machine_id** — canonical identifier for a machine on the wire. For a player's own workstation, this is `${workstation_name}-${first-8-hex(sha256('ed25519:' + playerKeyHex))}`.
- **gameTime** — whole days elapsed since the player's `startedAt` anchor. Drives CVE publication timing.
- **publishedAt** — game days from `startedAt` after which a CVE is exploitable. Hand-authored CVEs have `publishedAt=0` (day-0); procedural CVEs are time-gated.
- **effect kind** — one of 8 outcomes a CVE can produce: shell_full (tiered), shell_limited, file_read, dir_list, file_write, password_reset, backdoor_port_open, script_exec.
- **userType** — `'guest' | 'user' | 'root'`. The tier the session walks at.
- **Layer 0** — the player's local LAN interface (vs deeper subnet layers behind a router).
- **occupant** — a player who has joined a shared home network.
- **seed-regen** — the cross-LAN resolution strategy: any foreign-IP access regenerates the entire foreign HomeNetwork client-side from its seed and slots it into the local network view.
