/**
 * resolveActiveRoot — materialize the filesystem the active session operates on:
 * pick the BASE tree, then replay the active machine's patch journal over it so a
 * write (own OR remote) is visible.
 *
 * Base: your own workstation seed when the active session is on your box (the
 * base login + any `su` hop); the deterministically-generated tree of a remote
 * host when you've ssh'd in. The remote host is recovered from its coordinate
 * `machine_id` by regenerating the current LAN and matching ids
 * (`hostForMachineId`) — so a session carrying only a `machine_id` resolves on
 * the live ssh path and on a refresh rebuild alike.
 *
 * It falls back to the own base when a remote can't be resolved (offline, or the
 * host isn't on the current LAN) — a defensive edge, not a normal path: after an
 * ssh you are still on the LAN you connected from.
 *
 * `patches` is the journal for whichever machine is active (the caller swaps it
 * when the active session hops machines), so replaying it over the chosen base
 * is correct for both the own and remote cases. Empty patches return the base
 * unchanged (by reference).
 */

import { buildRemoteHostFs } from '../core/generation/remoteHostFs';
import { hostForMachineId } from '../core/generation/remoteHostId';
import { isCrossPlayerWorkstation } from '../core/network/crossPlayerHop';
import { applyPatches, type Patch } from '../core/filesystem/applyPatches';
import type { Directory } from '../core/filesystem/types';
import type { Session } from '../core/commands/types';

const baseFsFor = (args: {
  readonly session: Session;
  readonly ownWorkstationId: string;
  readonly publicKeyHex: string;
  readonly essid: string | null;
  readonly ownBaseFs: Directory;
}): Directory => {
  if (args.session.machineId === args.ownWorkstationId) return args.ownBaseFs;
  if (args.essid === null) return args.ownBaseFs;
  const host = hostForMachineId(args.publicKeyHex, args.essid, args.session.machineId);
  return host === null ? args.ownBaseFs : buildRemoteHostFs(args.publicKeyHex, args.essid, host);
};

export const resolveActiveRoot = (args: {
  readonly session: Session;
  readonly ownWorkstationId: string;
  readonly publicKeyHex: string;
  readonly essid: string | null;
  readonly ownBaseFs: Directory;
  readonly patches: readonly Patch[];
}): Directory => applyPatches(baseFsFor(args), args.patches);

/**
 * Whether the active session is a CROSS-PLAYER hop (Story 2): an interactive shell
 * session on a machine that is neither your own workstation nor a host on your
 * current LAN. The only way to hold such a session is a public-IP login into
 * another identity's box — so this is the signal to fetch that box's SERVER-served
 * tree (decision D1) instead of letting `resolveActiveRoot` wrongly fall back to
 * your OWN base. The machine-level test is the shared `isCrossPlayerWorkstation`;
 * the shell-kind requirement is this dispatch's own.
 *
 * Both `ssh` (the original hop) and `su` (an elevation ON that same foreign box)
 * count: a su keeps you standing on the box you ssh'd into — its tree, now served
 * at the elevated tier — so `reboot`/`ls`/`cat` as root read A, not your own box
 * (Story 4). Service sessions (nc/mysql/…) have no served tree and are excluded.
 */
export const isCrossPlayerHop = (
  session: Session,
  essid: string | null,
  publicKeyHex: string,
): boolean =>
  (session.kind === 'ssh' || session.kind === 'su') &&
  isCrossPlayerWorkstation({ machineId: session.machineId, publicKeyHex, essid });
