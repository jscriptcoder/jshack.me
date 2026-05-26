# Rewrite Decisions Log

Locked-in answers to the architectural questions raised in `core-contracts.md`. Once a decision is in this file, it's settled unless explicitly revisited and overwritten.

## D1. Code location

**The rewrite lives at `/v2`** in this repo, with its own `package.json`, `vite.config.ts`, `tsconfig.json`.

- Same git history. Blueprint docs (`docs/rewrite-blueprint/`) are import-distance from the new code.
- Legacy React build stays at root, frozen, currently running the rework-notice screen in prod.
- No second Vercel project — local-only development for now. Multiplayer tested across two browsers locally.

## D2. UI framework

**Solid.js, used minimally.** Treat Solid as a state library + reactivity primitive, not a full app framework.

- Use: `createSignal`, `createEffect`, `createStore`, `onMount`, `onCleanup`, `Show`, `For`, JSX.
- Avoid: Solid Router, `createResource`, `<Suspense>`, Context API, ecosystem packages, custom directives.
- Module-level signals over Context API. Components are dumb renderers (props in, JSX out, no logic).
- Test before reaching for a Solid feature: "If we swap Solid for plain DOM tomorrow, how much code changes?" If the answer is "the whole architecture," don't use it.

## D3. Command execution model

**All commands are `async`** — uniformly. Future-proof for any command that might need a network call; eliminates the sync/async distinction at the call site.

- `Command.execute` returns `Promise<CommandResult>`.
- `CommandResult` discriminated union still applies (`sync` lines array, `async` AsyncIterable, `mode_change`).
- Even "instant" commands like `pwd` resolve immediately — the `await` is free.

## D4. Streaming output

**Stream as produced, no artificial batching or buffering.**

- Commands `yield` lines at whatever pace makes sense for them (real-time progress for `aircrack`, instant burst for `nmap`).
- The UI appends to a Solid store as lines arrive; fine-grained reactivity handles DOM updates efficiently.
- No artificial delays. Realism comes from the command's natural pacing, not from UI throttling.
- If a perf problem ever surfaces (e.g. a command yielding thousands of lines instantly), add micro-batching at the **adapter** layer in one place — not a day-1 concern.

## D5. Error encoding

**Per-endpoint discriminated unions.** Each method on `RemoteApi` declares its own error type.

```ts
// Example
type CreateSessionError =
  | { kind: 'no_session' }
  | { kind: 'permission_denied' }
  | { kind: 'usertype_mismatch' }
  | { kind: 'rate_limited' };

createSession(req): Promise<Session | CreateSessionError>;
```

- Forces exhaustive switching at call sites.
- No shared `RemoteError` union; that would be the lowest common denominator and lose specificity.
- Network-layer errors (transport failures, JSON parse errors) wrap as `{ kind: 'network_error' }` in every endpoint's union.

## D6. gameTime model

**Server-stamped + client-cached, with client-computed fallback.**

- Every signed API response carries a `serverGameTime` field, populated by `verifySignedRequest`'s handler wrapper.
- Client adapter updates a module-level `lastKnownGameTime` whenever a response arrives.
- `env.gameTime()` returns the cached value synchronously (CVE eligibility checks need sync access).
- Fallback to client-computed `Date.now() - startedAt` when no server response has been seen (cold start, offline, single-player).
- This is **day-1 anti-cheat**: CVE eligibility checks always run against server time once a session has touched any API.

## D7. Pools file layout

**One file per category**, barrel-exported.

```
core/cve/pools/
  index.ts          re-exports all
  ssh.ts
  web.ts
  database.ts
  ftp.ts
  redis.ts
  mysql.ts
  firmware.ts
  libraries.ts
  ...
```

- Categories follow service families, not severity or effect kind.
- Each pool file exports a `readonly CveTemplate[]` — no logic, just data.
- New CVE = add to the relevant file.

## D8. Testing harness

**`test/factories/commandEnv.ts` exports `mockCommandEnv(overrides?)`.**

```ts
export const mockCommandEnv = (overrides?: Partial<CommandEnv>): CommandEnv => ({
  identity: mockIdentity(),
  session: mockSession(),
  hopChain: [],
  gameTime: () => 0 as GameTime,
  now: () => 0 as EpochMs,
  fs: mockFsView(),
  network: mockNetworkView(),
  output: mockOutputSink(),
  patches: mockPatchApi(),
  remote: mockRemoteApi(),
  log: mockLogApi(),
  signal: new AbortController().signal,
  ...overrides,
});
```

- Sensible defaults for every field; override only what the test cares about.
- Sub-factories (`mockFsView`, `mockSession`, etc.) live alongside in `test/factories/`.
- TDD-friendly: a new command starts with `const env = mockCommandEnv({ fs: ... })`.

## D9. Build tooling

- **Vite** + **Vitest** + **TypeScript strict** + **ESLint** + **Prettier** — same toolchain as legacy. Lower risk, familiar.
- Prettier config inherited from root `.prettierrc` (nothing to duplicate in `v2/`).
- Vite plugin: `vite-plugin-solid`.
- Test environment: `jsdom` (consistent with legacy).

## D10. Repo conventions

- TDD for `core/`. UI does not get unit tests for declarative rendering; smoke-test through the browser.
- No PR over ~400 lines. Force chunking.
- One smoke run through the UI before any chunk is "done" (per memory `feedback_e2e_test_new_primitives`).
- No tests for static metadata (per memory `Testing Guidelines`).
- Plan files in `plans/`; delete on completion (per memory `feedback_no_plan_memory_refs_in_code`).
- Memory updates after every significant chunk.

## D11. Deployment

- **Local-only** for now. No second Vercel project, no preview URL.
- Multiplayer tested across two browsers on the same machine against local Supabase + local Vercel dev.
- Cut-over plan deferred — decided when v2/ reaches feature parity with what's needed for launch.

---

## Pending decisions (not yet locked)

These need answers as the rewrite progresses, but are not blocking day-1 setup:

- Supabase project: reuse existing `jshack-dev` for v2 testing, or spin up a fresh one?
- When (if ever) to drop the legacy React build from the repo. Probably at cutover.
- Whether `v2/` ends up as a long-term name or gets renamed at cutover.
