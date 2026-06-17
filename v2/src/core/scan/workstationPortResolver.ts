/**
 * `buildWorkstationPortResolver` — the server-side `resolveTargetPorts` that the
 * single `scanResult` total function injects (Story 5.1.3b). For a NAT forward's
 * `internalIp`, it answers "what ports is the host behind that forward serving?".
 *
 * In the cross-player HOME NAT (Story 5.1) there is exactly ONE host behind a
 * player's router: their workstation, at the deterministic LAN IP
 * `assignHomeNetwork(owner_key, essid).localIp`. So the resolver matches that one
 * address — a forward to anything else is dead (empty) — and reads the
 * workstation's open ports off its materialized tree (base + journal). It is the
 * LIVENESS GATE a forward passes only while its target is up: a fresh workstation
 * has an empty `/var/run`, so it advertises nothing until A starts `sshd` (the
 * pidfile lands on the journal).
 *
 * Pure (`assignHomeNetwork`/`materializeWorkstationFs`/`readOpenPorts` are all
 * pure): the server prefetches the workstation journal and builds this synchronous
 * closure, keeping `core/` free of any async materialization wiring.
 */

import { assignHomeNetwork } from '../network/homeNetwork';
import { materializeWorkstationFs, type OwnerPatchRow } from '../network/materializeWorkstationFs';
import { readOpenPorts, type OpenPort } from '../services/pidfile';

/** The registry identity needed to locate + reconstruct the one workstation behind
 *  a player's router: the LAN IP is derived from `owner_key`+`essid`, and the tree
 *  from the owner's identity (the same base every cross-player path replays over). */
export type WorkstationTarget = {
  readonly owner_key: string;
  readonly essid: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

export const buildWorkstationPortResolver = (args: {
  readonly registry: WorkstationTarget;
  readonly workstationPatches: readonly OwnerPatchRow[] | null;
}): ((internalIp: string) => readonly OpenPort[]) => {
  const lanIp = assignHomeNetwork(args.registry.owner_key, args.registry.essid).localIp;
  const openPorts = readOpenPorts(
    materializeWorkstationFs(args.registry, args.workstationPatches),
  );
  return (internalIp) => (internalIp === lanIp ? openPorts : []);
};
