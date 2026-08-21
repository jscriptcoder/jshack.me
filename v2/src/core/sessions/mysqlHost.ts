/**
 * Reaching a box that serves a database, before anything is asked of it.
 *
 * Both database doors — the login and every statement behind it — have to establish
 * the same four things first: that the address names a real host on the caller's own
 * LAN, that the box boots, that mysqld is actually listening, and what the box's
 * filesystem currently IS. Only then is there something to authenticate against.
 *
 * They share it rather than each doing it because the answers have to agree. A login
 * that consulted the pidfiles and a statement that did not would leave a prompt
 * answering queries against a daemon the player has already stopped — and it is the
 * per-statement repeat of exactly this check that lets a stopped daemon drop a
 * session, since no session row exists to be invalidated instead.
 *
 * The filesystem is the box's REAL one: journal replayed over the seeded base, the
 * same tree `cat` shows. A door reading a locally regenerated baseline would refuse
 * an account the player can see sitting in the datadir, or serve a table they
 * already dropped.
 */

import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { canBoot } from '../boot/bootFiles';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { Directory } from '../filesystem/types';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

/** The journal lookup both doors need. Named as its own contract so a caller cannot
 *  hand this function a way to WRITE: reaching a host reads, and nothing else. */
export type MysqlHostLookup = {
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

export type ReachedMysqlHost = {
  readonly host: LanHost;
  readonly machineId: string;
  /** The box's current filesystem — what the datadir and the pidfiles were read from,
   *  and what an accepted connection will be logged against. */
  readonly hostFs: Directory;
};

export type MysqlHostReach =
  | { readonly ok: true; readonly reached: ReachedMysqlHost }
  | { readonly ok: false; readonly refusal: HandlerResponse };

const UNREACHABLE: HandlerResponse = { status: 404, body: { error: 'host_unreachable' } };

export const reachMysqlHost = async (
  deps: MysqlHostLookup,
  target: { readonly essid: string; readonly targetIp: string },
): Promise<MysqlHostReach> => {
  // Resolved on the caller's OWN regenerated LAN, which proves the address names a
  // reachable host rather than an arbitrary number, and yields what is needed to
  // rebuild its filesystem.
  const host = generateHomeLan(target.essid).hosts.find(
    (candidate) => candidate.ip === target.targetIp,
  );
  if (host === undefined) return { ok: false, refusal: UNREACHABLE };

  const { machineId, baseFs } = resolveLanHostIdentity(host, target.essid);

  const patches = await deps.findPatches({ machine_id: machineId });
  if (patches.error) {
    return { ok: false, refusal: { status: 500, body: { error: 'patches_lookup_failed' } } };
  }
  const hostFs = materializeMachineFs(baseFs, patches.data);

  // A bricked box is dark before anything is asked of it, so a dead machine cannot
  // be probed for which database accounts it used to have.
  if (!canBoot(hostFs).ok) return { ok: false, refusal: UNREACHABLE };

  // The pidfiles are the truth about what is listening — the same source `nmap`
  // reads. A stopped daemon has nothing to authenticate against.
  const listening = readOpenPorts(hostFs).some(
    (open) => open.service === SERVICE_CATALOG.mysql.service,
  );
  if (!listening) {
    return { ok: false, refusal: { status: 404, body: { error: 'service_not_running' } } };
  }

  return { ok: true, reached: { host, machineId, hostFs } };
};
