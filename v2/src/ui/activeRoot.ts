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

import { generatedBaseFsForMachineId } from '../core/generation/lanHostIdentity';
import { isCrossPlayerWorkstation } from '../core/network/crossPlayerHop';
import { applyPatches, type Patch } from '../core/filesystem/applyPatches';
import type { Directory } from '../core/filesystem/types';
import type { Session, SessionKind } from '../core/commands/types';

const baseFsFor = (args: {
  readonly session: Session;
  readonly ownWorkstationId: string;
  readonly publicKeyHex: string;
  readonly essid: string | null;
  readonly ownBaseFs: Directory;
}): Directory => {
  if (args.session.machineId === args.ownWorkstationId) return args.ownBaseFs;
  if (args.essid === null) return args.ownBaseFs;
  // Any machine the NETWORK generates — a journal-backed edge router or inner
  // gateway/switch (a `ssh root@<gateway>` hop), a deep chain door reached through a
  // forward, a deep NPC behind one, or an NPC sibling — rebuilds its seeded base from the
  // ESSID via the shared resolver, the same tree the server materializes, so a locally
  // replayed journal (a `nano rules.v4` edit, a deep reach/scan trace) lands on it — and
  // on the same tree every other occupant replays. Falls back to the own base when nothing
  // matches (a defensive edge — another player's box is fetched server-side, not here).
  const generatedFs = generatedBaseFsForMachineId(args.essid, args.session.machineId);
  return generatedFs ?? args.ownBaseFs;
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
 * Every session kind that lands you in a SHELL counts, because the question is
 * which box the shell is reading, not which door was used to reach it. `ssh` is
 * the original hop; `su` is an elevation ON that same foreign box, and keeps you
 * standing where you were — its tree, now served at the elevated tier — so
 * `reboot`/`ls`/`cat` as root read the target, not your own box. `nc` joins them
 * because a backdoor opens a shell too: while it was excluded, an intruder stood
 * on another network's box reading their OWN filesystem, with writes from that
 * shell landing on the target's journal.
 *
 * A kind that never asks this question stays out. `ftp` addresses its target
 * through `ftpRoot`, held apart on purpose because the shell and the ftp session
 * are two machines at once — so widening this to every kind would claim a served
 * tree for a session that reads none.
 */
const SHELL_KINDS: readonly SessionKind[] = [
  'ssh',
  'su',
  'nc',
  // Both exploit grants stand you in a shell ON the target. The weaker one is
  // limited in what it can RUN, never in whose filesystem it is looking at —
  // leaving it out would reprise the backdoor's own defect exactly.
  'exploit',
  'exploit_limited',
];

export const isCrossPlayerHop = (
  session: Session,
  essid: string | null,
  publicKeyHex: string,
): boolean =>
  SHELL_KINDS.includes(session.kind) &&
  isCrossPlayerWorkstation({ machineId: session.machineId, publicKeyHex, essid });

/**
 * Whether the box this session stands on has to be re-read before the next line
 * runs. A separate question from WHERE that tree comes from, which is
 * `isCrossPlayerHop`'s: this one only asks whether the copy in hand is allowed to
 * be the one the player walked in with.
 *
 * It began as one case — a backdoor, the only door that could be taken away while
 * it was being held. A reboot makes that true of every session on a box that is
 * not the player's own: the rows close server-side in one stroke, and the marker
 * on the box's own tree is the only thing that can tell a shell already standing
 * there. Answering from a tree fetched at the hop would describe the box the
 * player walked into rather than the one they are typing at.
 *
 * Your own workstation is the exception, and deliberately so. It is the one
 * machine whose tree is already local, and the one session nobody can close
 * without you — the base login is not a row, so no reboot can end it. That keeps
 * the priced claim this narrowing has always been about: a command on your own box
 * issues no requests at all.
 *
 * A backdoor stays in by name, because it is the one door that can be taken away
 * on your own box too: a visitor holding a session there can `kill` the listener
 * that admitted them.
 */
export const needsFreshTree = (session: Session, ownWorkstationId: string): boolean =>
  session.kind === 'nc' || session.machineId !== ownWorkstationId;
