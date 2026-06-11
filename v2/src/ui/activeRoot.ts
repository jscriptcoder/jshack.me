/**
 * resolveActiveRoot — pick the filesystem tree the active session operates on.
 *
 * Your own (patched) workstation tree when the active session is on your box (the
 * base login + any `su` hop); the deterministically-generated tree of a remote
 * host when you've ssh'd in. The remote host is recovered from its coordinate
 * `machine_id` by regenerating the current LAN and matching ids (`hostForMachineId`)
 * — so a session carrying only a `machine_id` resolves to the right tree both on
 * the live ssh path and on a refresh rebuild.
 *
 * It falls back to the own tree when a remote can't be resolved (offline, or the
 * host isn't on the current LAN) — a defensive edge, not a normal path: after an
 * ssh you are still on the LAN you connected from.
 */

import { buildRemoteHostFs } from '../core/generation/remoteHostFs';
import { hostForMachineId } from '../core/generation/remoteHostId';
import type { Directory } from '../core/filesystem/types';
import type { Session } from '../core/commands/types';

export const resolveActiveRoot = (args: {
  readonly session: Session;
  readonly ownWorkstationId: string;
  readonly publicKeyHex: string;
  readonly essid: string | null;
  readonly ownRoot: Directory;
}): Directory => {
  if (args.session.machineId === args.ownWorkstationId) return args.ownRoot;
  if (args.essid === null) return args.ownRoot;
  const host = hostForMachineId(args.publicKeyHex, args.essid, args.session.machineId);
  return host === null ? args.ownRoot : buildRemoteHostFs(args.publicKeyHex, args.essid, host);
};
