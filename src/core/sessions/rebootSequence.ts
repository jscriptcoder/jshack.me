/**
 * rebootSequence — what happens to a box once something with the authority to take it
 * down has done so. Shared by the two acts that reboot a machine: `reboot` itself
 * (`handleRebootMachine`, after its own authority check) and a router's firmware flash
 * (`handleUpsertPatch`, after the write gates), because a flash that ended sessions one
 * way and a reboot that ended them another would be two different reboots.
 *
 * The sequence ends EVERY active row on the machine — every player, every kind — keeps
 * one `kern.log` line naming the address it was ordered from, mints the boot id a
 * terminal already standing on the box reads, and ends the chains standing on what
 * closed. The authority is the caller's question; this module never asks it.
 *
 * The line names the address the caller's login on the box came from, as that login's
 * own `auth.log` line already names it, so a visitor who came through a hop is traced to
 * the hop — with no carve-out for rebooting your own box, because an exception is one
 * more rule to remember and it would tell an attacker exactly which act is invisible.
 */

import type { StandingSession } from '../patches/authorizeMachineAccess.js';
import { appendMachineLog, type AppendLog } from '../patches/appendMachineLog.js';
import type { FindOccupantWorkstationByMachineId } from '../patches/remoteWritePermission.js';
import {
  formatRebootLine,
  KERN_LOG_OWNER,
  KERN_LOG_PATH,
  KERN_LOG_PERMISSIONS,
} from '../logging/kernLog.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import {
  resolveCrossPlayerSourceIp,
  type FindHomeNetworkByOwnerKey,
} from '../logging/crossPlayerSourceIp.js';
import { parseWorkstationId } from '../identity/workstation.js';
import { hostnameForMachineId } from '../generation/lanTopology.js';
import { asGameTime } from '../types.js';
import type { EndReason } from './endSession.js';
import { endChainsAbove, type EndedSession, type EndSessionsAbove } from './upstreamLost.js';

/** No `player_key`: the update is scoped to the MACHINE and nothing else, which is
 *  what lets one reboot reach a row the caller has never seen. */
export type EndMachineSessionsParams = {
  readonly machine_id: string;
  readonly reason: EndReason;
};

export type WriteBootIdParams = {
  readonly machine_id: string;
  readonly player_key: string;
  readonly boot_id: string;
};

export type RebootSequenceDeps = {
  /** Answers with the rows it closed, which are where the chains above them start. */
  readonly endMachineSessions: (
    params: EndMachineSessionsParams,
  ) => Promise<{ readonly data: readonly EndedSession[] | null; readonly error: unknown }>;
  readonly endSessionsAbove: EndSessionsAbove;
  /** Land the new boot id on the machine's own tree. Separate from the row close
   *  because they answer different readers: the rows are what the server enforces,
   *  the marker is what a terminal already standing on the box can see. */
  readonly writeBootId: (params: WriteBootIdParams) => Promise<{ readonly error: unknown }>;
  /** The server's wall clock, epoch-ms (UTC), for the log line's stamp. Injected
   *  so the sequence stays pure and the rendered line is testable. */
  readonly now: () => number;
  /** Whose box this is — `null` for a generated host or an access point nobody
   *  owns. It decides the row the kernel log accretes under, which is the only
   *  thing standing between two attackers' lines and one erasing the other. */
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
  /** The address the actor OWNS, from their verified key — never a value they
   *  send. Asked only when the owner reboots their own box, which no login reached. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
  readonly appendLog: AppendLog;
  /** A fresh, unguessable id for this boot. Injected so tests can name it — and
   *  unguessable in production because a caller able to predict the next id could
   *  keep a session alive across the reboot that was meant to end it. */
  readonly newBootId: () => string;
};

/** The box going down, and who took it down: the caller's verified key, and their live
 *  row on the box — `null` for an owner on their own box, whose base login is no row. */
export type RebootTarget = {
  readonly machineId: string;
  readonly actorKey: string;
  readonly standing: StandingSession | null;
};

/** Where a line about this box is filed, and the address it names. */
export type BoxTraceProvenance = {
  /** `null` means file nothing: the box's owner could not be read. */
  readonly writerKey: string | null;
  readonly sourceIp: string;
};

/**
 * Whose journal row a log on this box accretes under. `null` means file nothing:
 * an unreadable answer would put a stranger's evidence in the wrong row, and a log
 * line is never worth guessing for.
 *
 * A box its owner is occupying answers with the owner's key, which is what lets
 * several attackers' lines pile up in one file instead of each replacing the last —
 * patches key on `(machine_id, path, writer_key)` and a log patch carries the WHOLE
 * file, so two writers on one path means the newer row wins outright.
 *
 * Nobody owns an access point or a generated host, so those fall back to the
 * network's own stable key, which does not move as players join and leave. The
 * caller's key is the last resort, and it is the right answer in the one case that
 * reaches it honestly: your own box, rebooted after `nmcli disconnect` took your
 * occupancy row away with it. There your key IS the owner's.
 */
const resolveLogWriterKey = async (
  deps: RebootSequenceDeps,
  target: RebootTarget,
): Promise<string | null> => {
  const owner = await deps.findOccupantWorkstationByMachineId(target.machineId);
  if (owner.error) return null;
  if (owner.data !== null) return owner.data.owner_key;
  if (target.standing === null) return target.actorKey;
  return apGatewayLogWriterKey(target.standing.essid);
};

/** Where the act was ordered from. A caller standing on the box by a session came in
 *  through that session's login, so its address is the one to name; `unknown` rather
 *  than a guess when the row carries none. The owner's base login is no row and came
 *  from nowhere but their own network. */
const resolveSourceIp = (deps: RebootSequenceDeps, target: RebootTarget): Promise<string> =>
  target.standing === null
    ? resolveCrossPlayerSourceIp(deps.findHomeNetworkByOwnerKey, target.actorKey)
    : Promise.resolve(target.standing.sourceIp ?? 'unknown');

/** Whose row a line about this box lands in and which address it names — the one
 *  answer the reboot's own line and any line written alongside it share, so a defender
 *  reading both sees one visitor. */
export const boxTraceProvenance = async (
  deps: RebootSequenceDeps,
  target: RebootTarget,
): Promise<BoxTraceProvenance> => ({
  writerKey: await resolveLogWriterKey(deps, target),
  sourceIp: await resolveSourceIp(deps, target),
});

/** The box's own name, as `hostname` on it and a scan of it both show. A box the
 *  caller's network generates is named from that network; otherwise the id's leading
 *  half is the name — a player's workstation — and an id with no name in it is the
 *  only name anyone has for the box. */
const rebootHostname = (machineId: string, standing: StandingSession | null): string =>
  (standing === null ? null : hostnameForMachineId(standing.essid, machineId)) ??
  parseWorkstationId(machineId)?.name ??
  machineId;

/** Take the box down. `ok: false` is loud on purpose: a reboot that failed to end the
 *  rows, or ended them with nobody told, is the outcome the act exists to prevent. */
export const rebootBox = async (
  deps: RebootSequenceDeps,
  target: RebootTarget,
): Promise<{ readonly ok: boolean }> => {
  const { data: endedOnBox, error } = await deps.endMachineSessions({
    machine_id: target.machineId,
    reason: 'rebooted',
  });
  // Loud, unlike every other session write. A swallowed failure elsewhere costs a
  // log line; swallowed here it hands the player a convincing reboot and leaves
  // whoever was on the box still on it.
  if (error) return { ok: false };

  // At the shutdown beat, with the rows already closed: the eviction is what this
  // line records, so it is written once that has actually happened. Best-effort
  // from here on — the reboot is the act and the line is the note taken of it,
  // and failing over a log would tell the player their reboot did not take when
  // every row on the box has already gone.
  const provenance = await boxTraceProvenance(deps, target);
  if (provenance.writerKey !== null) {
    await appendMachineLog(
      { appendLog: deps.appendLog },
      {
        writerKey: provenance.writerKey,
        machineId: target.machineId,
        path: KERN_LOG_PATH,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
      },
      formatRebootLine({
        time: asGameTime(deps.now()),
        hostname: rebootHostname(target.machineId, target.standing),
        sourceIp: provenance.sourceIp,
      }),
    );
  }

  // Only now, and only if they closed. The rows are the authority and the marker is
  // how a terminal finds out — so a marker landing over rows that stayed open would
  // throw players off a box that is still holding their write grant, which is the
  // one arrangement worse than telling nobody.
  const marker = await deps.writeBootId({
    machine_id: target.machineId,
    player_key: target.actorKey,
    boot_id: deps.newBootId(),
  });
  // Equally loud, because rows closed with nobody told is exactly the outcome the
  // act exists to prevent: a defender walks away believing they are clear while an
  // intruder keeps typing into a shell that no longer has a row behind it.
  if (marker.error) return { ok: false };

  // After the marker, so the players standing on the box are told before anything
  // further up can fail. A chain left half-broken here is mended by the next
  // listing of it, which ends a session whose parent has ended.
  const chains = await endChainsAbove(deps.endSessionsAbove, endedOnBox ?? []);
  return { ok: chains.ok };
};
