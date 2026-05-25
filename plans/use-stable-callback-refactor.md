# Plan: useStableCallback Refactor

**Branch**: feat/use-stable-callback-refactor
**Status**: Active

## Goal

Kill the closure-capture bug class permanently by giving every consumer-facing context method (in `useNetwork`, `useFileSystem`) a **stable identity** while always invoking the LATEST implementation. Drop the load-bearing `useRef`/`.current` wrappers + the giant `useMemo` in `useNetworkCommands` — the architectural workaround becomes unnecessary because the underlying context methods are now safe to capture.

## Background

The bug class (see memory `project_react_closure_capture_pattern`) recurred 4+ times during PR #161's cross-LAN smoke. Each occurrence: a command's `AsyncOutput.start()` closure captures `resolveNat` (or peer) at command-creation time; when state updates and `useCallback` returns a new function, the closure still holds the OLD one. Symptom: "works on second call but not first," "works after nmap but not alone," cross-LAN 404 / invalid_credentials / Not a directory.

The current mitigation in `useNetworkCommands` wraps each at-risk method in a `useRef` updated during render, exposes a wrapper `(args) => ref.current(args)` to consumers. This works but:

- 5 explicit refs in `useNetworkCommands` (resolveNat, readFileFromMachine, getNodeFromMachine, resolveTargetMachineId, createFileOnMachine)
- A 38-entry `useMemo` deps array plus an eslint-disable
- The pattern must be repeated **per consumer** when a new at-risk method emerges. Anyone adding a new cross-LAN command must remember the recipe.

The React Compiler experiment (PR #162 history) confirmed the compiler cannot fix this — the closure escape happens outside the render tree (event-driven `AsyncOutput.start()` dispatch). The architectural answer is to wrap the methods at the **boundary** (their source hook), once, so callers can capture them safely.

The pattern is well-known: it's the same mechanism behind React's `useEffectEvent` (shipped stable in 19.2). We can't use `useEffectEvent` directly because its lint enforces "call only from effects," but the underlying primitive — `useRef` + `useCallback`-stabilized — is a 5-line helper.

## Acceptance Criteria

- [ ] Adding a new cross-LAN command requires zero per-consumer ref ceremony — the context methods are safe to destructure and use directly.
- [ ] `useNetworkCommands` no longer contains `useRef` for context methods; the `useMemo` may stay (perf) but without an eslint-disable.
- [ ] Cross-LAN smoke matrix (PR #161's 8 commands: nmap, ssh, scp, ftp, nc, curl, gobuster, lynx) **plus hydra + msfconsole** (deferred in #161) passes on a fresh page, first call, no warmup.
- [ ] The 4724 unit tests + 1 e2e mission playthrough pass.
- [ ] No new performance regression: render counts stay roughly equivalent (the helper itself is `useRef + useCallback`, identical to existing patterns).
- [ ] The fix is documented so the `project_react_closure_capture_pattern` memory can be updated to "obsolete — see `project_use_stable_callback`."

## Out of Scope

- React Compiler (separate experiment, falsified)
- Refactoring command bodies (curl/scp/nc/gobuster/lynx) to defer NAT resolution to a context handoff (the alternative architectural fix). This plan keeps command bodies as-is and fixes the boundary instead.
- Wrapping context state reads (e.g. `activeNetwork`, `lanOccupants`) — these are values not callables; closure capture of values is a separate concern with its own correctness model.
- Other hooks (`useHomeNetworks`, `useForeignNetworks`, `useSession`) — only `useNetwork` + `useFileSystem` are touched by the at-risk methods. Other hooks can be migrated opportunistically later if they sprout the same pattern.

## Dependency

Compatible with both React 18 and React 19 — `useStableCallback` uses only `useRef` + `useCallback`. **Ideally lands after PR #162 (React 19 upgrade)** so we're not stacking unrelated changes, but the refactor itself doesn't require R19.

## PR Breakdown

Three PRs after the plan PR:

- **Plan PR** — this document only.
- **PR 2** — `useStableCallback` helper + tests. Standalone, mergeable.
- **PR 3** — Wrap at-risk methods in `useNetwork` (`NetworkContext.tsx`) and `useFileSystem` (`useFileSystemReaders.ts`, `useFileSystemMutations.ts`, `useFileSystemSync.ts`). Behavior unchanged; all existing tests must pass. Mergeable without touching commands.
- **PR 4** — Drop the 5 `useRef`s + the eslint-disable in `useNetworkCommands.ts`, **stable-wrap `resolveTargetMachineId`** (it's built inline in this file, not in a context hook), and run the cross-LAN smoke matrix **including hydra + msfconsole** (which PR #161 deferred). Mergeable.

Each PR ends in a known-good state. PR 3 lands ref-stable methods without removing the redundant refs in `useNetworkCommands`. PR 4 removes the redundancy once we've confirmed PR 3 works.

## Steps

Every step follows RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR. No production code without a failing test.

### Step 1 — `useStableCallback` helper + unit tests (PR 2)

**RED**: Write tests in `src/hooks/useStableCallback.test.ts` that verify:

1. The returned callback has stable identity across renders (`renderHook` + `result.current`-then-rerender comparison).
2. The returned callback invokes the LATEST implementation passed to the hook (rerender with a different `fn`, call result.current, observe the new fn ran).
3. The returned callback can be safely captured (closure) before a rerender and still invoke the latest impl when called after.

**GREEN**: Implement in `src/hooks/useStableCallback.ts`:

```ts
import { useCallback, useRef } from 'react';

export const useStableCallback = <T extends (...args: never[]) => unknown>(fn: T): T => {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args) => ref.current(...args)) as T, []);
};
```

**MUTATE**: Manually mutate the implementation (no Stryker) — e.g. drop the ref update on each render → test 2 should fail. Drop `useCallback` deps `[]` → test 1 should fail.
**KILL MUTANTS**: Address any uncaught mutations.
**REFACTOR**: Assess. Likely none — the helper is minimal.
**Done when**: 3 tests green, helper is 5 lines, mutation suite catches the 2 obvious breakages.

### Step 2 — Wrap at-risk methods in `useNetwork` (PR 3, part A)

**Targets in `src/network/NetworkContext.tsx`**: methods that close over state and whose closure capture has caused or could cause cross-LAN bugs:

- `resolveNat` (NetworkContext.tsx:1037) — closes over `allIptablesRules`
- `findMachineByIp` (NetworkContext.tsx:901) — closes over machine maps
- `findMachineByIpAsync` (NetworkContext.tsx:980) — same
- `findMachineUsers` (NetworkContext.tsx:830) — closes over machine maps
- `getMachine`, `getMachines` (780, 787) — close over machine maps
- `getInterfaces`, `getInterface` (769, 776) — close over interface state
- `getLocalIP`, `getPublicIP`, `getGateway` (798, 807, 791) — close over network state
- `resolveDomain` (812) — closes over DNS state
- `getHandler` (1055) — closes over world handlers

**RED**: For each method, write a render-stability test in `NetworkContext.test.tsx`:

```ts
it('exposes a resolveNat with stable identity across state changes', () => {
  // render the provider with initial state
  // capture resolveNat reference
  // trigger a state change (e.g. push a new iptables rule)
  // re-render
  // assert the EXTERNAL resolveNat reference is === the captured one
  // assert calling the captured reference returns the NEW NAT mapping
});
```

This test will fail on `main` because `useCallback`-derived references change on dep change.

**GREEN**: Wrap each method with `useStableCallback`:

```ts
const resolveNatImpl = useCallback(
  (ip, port) => {
    /* existing body */
  },
  [allIptablesRules],
);
const resolveNat = useStableCallback(resolveNatImpl);
```

Note: keep the inner `useCallback` (still useful — the impl identity matters internally for any other React-tracked dep). Wrap with `useStableCallback` at the exposed-API boundary.

**MUTATE**: Drop the wrap on resolveNat → render-stability test fails. Drop the inner state dep on `useCallback` (e.g. `[]` instead of `[allIptablesRules]`) → behavior test fails because stale impl is captured by the ref permanently.
**KILL MUTANTS**: Fix gaps.
**REFACTOR**: Consider extracting a small helper if 10+ methods get the same pattern.
**Done when**: Render-stability tests pass for all listed methods. Existing NetworkContext tests still pass.

### Step 3 — Wrap at-risk methods in `useFileSystem` (PR 3, part B)

**Targets**:

- `useFileSystemReaders.ts`: `getNodeFromMachine`, `readFileFromMachine`, `listDirectoryFromMachine`, `getNode`, `resolvePath`, `canReadFromMachine`, `canWriteFromMachine`, `canTraverseOnMachine` (all close over `fileSystems`)
- `useFileSystemMutations.ts`: `createFileOnMachine`, `writeFileToMachine`, `upsertFileOnMachine`, `createDirectoryOnMachine`, `deleteNodeFromMachine`, `flushPendingPatches` (all close over `fileSystems` / `pendingPatchesRef`)
- `useFileSystemSync.ts`: `awaitCrossPlayerBaseFs`, `fetchCrossPlayerBaseFsIfNeeded` (close over `crossPlayerBaseFsRef` and `patchesRef`)

**RED**: Same render-stability test pattern, per method.
**GREEN**: Wrap each at the exposed-API boundary.
**MUTATE / KILL MUTANTS / REFACTOR**: Same approach as Step 2.
**Done when**: Render-stability tests pass; existing `useFileSystem*` tests pass.

### Step 4 — Drop refs in `useNetworkCommands` (PR 4)

**RED**: Write an integration test using `renderHook` for `useNetworkCommands` that simulates the closure-capture scenario:

1. Render the hook with mocks where `resolveNat` initially has empty iptables.
2. Capture the curl command from `result.current.commands`.
3. Rerender with mocks where `resolveNat` now has a NAT rule for `203.0.113.42:8080 → 192.168.1.10:80`.
4. Invoke the CAPTURED curl command (the OLD closure).
5. Assert it calls the LATEST `resolveNat` (returns the NAT-mapped backend).

This test will fail before the refactor: the captured closure calls the OLD `resolveNat`. It will pass after PR 3 makes the methods stable.

**GREEN**: Remove `useRef`s + `.current` wrappers + the `useMemo` deps `eslint-disable`. The `useMemo` itself can stay (it's still useful — but its deps array shrinks dramatically since stable-identity methods don't need to be listed).

**Stable-wrap `resolveTargetMachineId`**: it's built inline in `useNetworkCommands` (from `buildResolveTargetMachineId(activeNetwork, lanOccupants, hostname, foreignNetworks, foreignLanOccupants)`) and returns a new function every render, so it has the same closure-capture risk as context methods. Wrap with `useStableCallback` at the point of construction:

```ts
const resolveTargetMachineId = useStableCallback(
  buildResolveTargetMachineId(
    activeNetwork,
    lanOccupants,
    hostname,
    foreignNetworks,
    foreignLanOccupants,
  ),
);
```

This is what unblocks the **hydra + msfconsole** cross-LAN paths — they currently use `resolveTargetMachineId` directly (no refs in main), so the refs in `useNetworkCommands` didn't cover them. PR #161's smoke matrix deferred hydra and msfconsole; this refactor brings them into scope.

**MUTATE**: Stryker-style: restore one of the refs (e.g. `resolveNatRef`) → integration test still passes because the underlying context method is stable now. This is the GOOD outcome — the test proves correctness independent of the consumer-side refs. Mutating further: drop the `useStableCallback` wrap on resolveNat in NetworkContext (a regression in PR 3's territory) → integration test should fail.
**KILL MUTANTS**: Should be a no-op if PR 3 is solid.
**REFACTOR**: Assess `useMemo` value. If it's not measurably faster, drop it entirely and let the compiler (or future compiler) handle it.
**Done when**: Integration test passes, `useNetworkCommands.ts` is ~100 lines lighter, no eslint-disable, all existing tests pass, cross-LAN smoke matrix passes.

### Step 5 — Cross-LAN smoke matrix (PR 4 verification)

Manual two-browser smoke replicating PR #161's matrix. Fresh page each time, no warmup commands.

| Action                                            | Expected                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `nmap <B-public-ip>`                              | shows forwarded ports                                                  |
| `ssh root@<B-public-ip> -p 2222`                  | foothold on B                                                          |
| `scp local <B-user>@<B-public-ip>:/tmp/file 2222` | file lands on B                                                        |
| `ftp <B-public-ip> 2121` (if forwarded)           | FTP prompt                                                             |
| `nc <B-public-ip> <forwarded-nc-port>`            | shell on B                                                             |
| `curl http://<B-public-ip>:8080/`                 | renders B's index.html                                                 |
| `gobuster -u http://<B-public-ip>:8080`           | finds B's paths                                                        |
| `lynx http://<B-public-ip>:8080`                  | renders B's site                                                       |
| `hydra ssh://<B-public-ip>:2222 -l user -P wl`    | bruteforce against B's `/etc/passwd` via cross-player crackCredentials |
| `msfconsole <B-public-ip> <forwarded-cve-port>`   | CVE-effect (file_read/file_write/etc.) lands on B's workstation_id     |

Plus the original failing cases that motivated the refs:

- First-call curl on fresh page (no nmap warmup) → must NOT 404.
- First-call scp on fresh page → must NOT return invalid_credentials.
- Second-call scp after a first that succeeded → must NOT return Connection refused.

If any case regresses: file findings, revert PR 4 (keep PR 3 — it's correct on its own), iterate.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — manual (no Stryker). Each step's MUTATE phase produces a report.
2. Refactoring assessment — assess after green.
3. Typecheck + lint pass (`npm run build`, `npm run lint`).
4. Format check (`npm run format:check`).
5. Full test suite (`npm run test:run`).

## Risks

- **Wrapping a method whose identity NEEDS to change for downstream `useEffect` deps**. If something does `useEffect(() => {...}, [resolveNat])` to re-run when the NAT rules change, stable-wrapping `resolveNat` breaks that effect (it'll never re-run). Audit: grep for `resolveNat`, `readFileFromMachine`, etc. in effect deps before wrapping. **Mitigation**: keep the INNER `useCallback` with proper deps; the stable wrap is a separate identity that delegates. If a consumer needs the dep-driven identity, they can read the inner version (we'd expose both or none — probably none, since the dep-driven case is rare and the consumer can use the underlying state directly).
- **Lint / typecheck friction** from the `useCallback(((...args) => ref.current(...args)) as T, [])` cast. Test it on the helper first. Possibly we end up with an unavoidable single `as T` cast inside the helper, which is acceptable (one cast at a sealed boundary).
- **Test flakiness from React 19's stricter effect-double-invoke**. Already on R19 via PR #162; should be a non-issue since tests already pass on the experiment branch.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
