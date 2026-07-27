/**
 * `buildWorkstationPortResolver` — the server-side `resolveTargetPorts` that the
 * single `scanResult` total function injects (Story 5.1.3b). For a NAT forward's
 * `internalIp`, it answers "what ports is the host behind that forward serving?".
 *
 * In the cross-player HOME NAT (Story 5.1) there is exactly ONE host behind a
 * player's router: their workstation, at the LAN address that player holds a LEASE
 * on. So the resolver matches that one address — a forward to anything else is dead
 * (empty) — and reads the workstation's open ports off its materialized tree (base +
 * journal). It is the LIVENESS GATE a forward passes only while its target is up: a
 * fresh workstation has an empty `/var/run`, so it advertises nothing until A starts
 * `sshd` (the pidfile lands on the journal).
 *
 * The address is passed IN rather than derived here, so the public path and the
 * same-LAN path resolve one player's box to one address: the lease is read by the
 * handler alongside the journal, and this stays pure
 * (`materializeWorkstationFs`/`readOpenPorts` are both pure) — the server prefetches
 * and builds this synchronous closure, keeping `core/` free of async wiring.
 */

import type { Directory } from '../filesystem/types';
import { materializeWorkstationFs, type OwnerPatchRow } from '../network/materializeWorkstationFs';
import { readOpenPorts, type OpenPort } from '../services/pidfile';
import { canBoot } from '../boot/bootFiles';

/** The persisted identity needed to reconstruct the one workstation behind an AP's
 *  router: the tree comes from the owner's identity (the same base every cross-player
 *  path replays over). Where that box ANSWERS is its lease, supplied separately. */
export type WorkstationTarget = {
  readonly owner_key: string;
  readonly essid: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

/**
 * Resolve a NAT forward's `internalIp` to the ONE workstation behind a player's
 * router: returns that workstation's materialized tree (base + journal) when
 * `internalIp` is the address that workstation holds its LEASE on, else null (the
 * forward reaches no host — including when the owner holds no lease at all, which is
 * what `lanIp: null` means).
 *
 * The SHARED internalIp→workstation lookup the public SCAN (its open ports —
 * `buildWorkstationPortResolver` below) and the public SSH gate (its passwd +
 * service liveness — `authCreateSessionPublic`) both read, so the two can never
 * disagree on what A's box looks like behind the forward. Materializes once and
 * closes over the tree, so a multi-forward scan doesn't rebuild it per call.
 */
export const buildWorkstationResolver = (args: {
  readonly target: WorkstationTarget;
  readonly workstationPatches: readonly OwnerPatchRow[] | null;
  readonly lanIp: string | null;
}): ((internalIp: string) => Directory | null) => {
  const { lanIp } = args;
  const workstationFs = materializeWorkstationFs(args.target, args.workstationPatches);
  // The role-based dark-gate behind the NAT: a bricked workstation (a /boot tombstone)
  // can't come up, so the forward reaches a dead host — it answers nothing even if a
  // stale sshd pidfile lingers. The tree is materialized once, so check boot once.
  const bootable = canBoot(workstationFs).ok;
  // A null `lanIp` (no lease) needs no separate guard: an internal IP is a string, so
  // it never equals null and every forward falls through to "reaches no host".
  return (internalIp) => (internalIp === lanIp && bootable ? workstationFs : null);
};

export const buildWorkstationPortResolver = (args: {
  readonly target: WorkstationTarget;
  readonly workstationPatches: readonly OwnerPatchRow[] | null;
  readonly lanIp: string | null;
}): ((internalIp: string) => readonly OpenPort[]) => {
  const resolveWorkstationFs = buildWorkstationResolver(args);
  return (internalIp) => {
    const workstationFs = resolveWorkstationFs(internalIp);
    return workstationFs === null ? [] : readOpenPorts(workstationFs);
  };
};
