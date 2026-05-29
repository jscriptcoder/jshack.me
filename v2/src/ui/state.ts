/**
 * Terminal UI state — module-level Solid signals (per decisions.md D2:
 * module-level signals over Context). The terminal is an app singleton, so
 * the scrollback + input + cwd + patch journal live here, not in a provider.
 *
 * `runInput` is the seam between the DOM and `core/`: it echoes the typed
 * line into the scrollback, materializes the current FS view by replaying the
 * fetched patch journal over the seed base FS, builds a CommandEnv, runs the
 * line through `runCommandLine`, and mirrors the resulting lines back.
 *
 * Write path (server-authoritative): the injected `PatchApi` POSTs signed
 * envelopes to `/api/patches`. After a successful mutation we re-fetch the
 * journal so the next command's materialized view reflects server truth — the
 * await means a `mkdir` is durable and visible before the user's next line
 * runs. The journal is also hydrated once on boot, so a write survives reload.
 */

import { createSignal } from 'solid-js';
import type { AbsPath } from '../core/types';
import type { PatchApi, TerminalLine } from '../core/commands/types';
import type { Patch } from '../core/filesystem/applyPatches';
import { applyPatches } from '../core/filesystem/applyPatches';
import { commandRegistry } from '../core/commands/registry';
import { runCommandLine } from '../core/shell/runLine';
import { commandEchoLine } from '../core/shell/prompt';
import { buildCommandEnv } from './env';
import { getPlayerIdentity } from './identity';
import { createPatchApi, fetchOwnPatches, type PatchClientDeps } from '../adapters/patchApi';
import { createSyncChannel } from '../adapters/crossTabSync';
import { SEED_HOME, SEED_HOST, seedFs, seedSession } from './seed';

const identity = getPlayerIdentity();
const session = seedSession(identity);

/** Shared config for both the write API and the journal read. */
const patchClientDeps: PatchClientDeps = {
  identity,
  machineId: session.machineId,
  owner: session.username,
  tier: session.userType,
};

const [scrollback, setScrollback] = createSignal<readonly TerminalLine[]>([]);
const [input, setInput] = createSignal('');
const [cwd, setCwd] = createSignal<AbsPath>(SEED_HOME);
const [patches, setPatches] = createSignal<readonly Patch[]>([]);

export { cwd, input, scrollback, setInput };

/** Re-pull the own-workstation journal and replace the local view. */
const refetchPatches = async (): Promise<void> => {
  setPatches(await fetchOwnPatches(patchClientDeps));
};

// Hydrate the journal on boot so reload-durable writes show up immediately.
void refetchPatches();

// Cross-tab sync: a write in another tab of this browser (same identity, same
// workstation) hints us to re-pull the journal, so our next command reflects it
// without a reload. The BroadcastChannel spec never echoes our own writes back
// to us, so this can't self-trigger. (Cross-browser via Realtime is a later plan.)
const syncChannel = createSyncChannel();
syncChannel.onMessage((message) => {
  if (message.type === 'patches-changed' && message.machineId === session.machineId) {
    void refetchPatches();
  }
});

/** The real PatchApi, wrapped so a successful mutation reconciles the local
 *  journal with server truth before the call resolves. The command awaits the
 *  mutation, so the refetched patches are in place before the next line runs. */
const wrapWithRefetch = (inner: PatchApi): PatchApi => {
  const afterWrite =
    <Args extends readonly unknown[]>(method: (...args: Args) => ReturnType<PatchApi['mkdir']>) =>
    async (...args: Args) => {
      const result = await method(...args);
      if (result.ok) {
        await refetchPatches();
        // Tell other tabs to re-pull — only after our own journal reflects the
        // server-persisted write, so a receiver's refetch sees the new truth.
        syncChannel.broadcast({ type: 'patches-changed', machineId: session.machineId });
      }
      return result;
    };
  return {
    write: afterWrite(inner.write),
    remove: afterWrite(inner.remove),
    mkdir: afterWrite(inner.mkdir),
  };
};

const patchApi = wrapWithRefetch(createPatchApi(patchClientDeps));

/** Clear the terminal. Doubles as the backing for a future `clear` command. */
export const resetTerminal = (): void => {
  setScrollback([]);
  setInput('');
  setCwd(SEED_HOME);
};

export const runInput = async (): Promise<void> => {
  const line = input();
  setInput('');

  setScrollback((previous) => [
    ...previous,
    commandEchoLine({ username: session.username, host: SEED_HOST, cwd: cwd() }, line),
  ]);

  const env = buildCommandEnv({
    identity,
    session,
    root: applyPatches(seedFs(), patches()),
    cwd,
    onCwdChange: setCwd,
    patches: patchApi,
  });

  const result = await runCommandLine(env, line, commandRegistry);
  if (result.kind === 'sync') {
    setScrollback((previous) => [...previous, ...result.lines]);
  }
};
