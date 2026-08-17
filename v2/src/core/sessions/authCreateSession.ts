/**
 * handleAuthCreateSession — the server-side gate for an ssh session on a FOREIGN
 * host (ssh epic, PR 3b). Ported from legacy `authCreateSession`, adapted to v2's
 * pure generation: instead of reading a stored `machine_filesystems` projection,
 * the server REGENERATES the target's filesystem from the VERIFIED pubkey + the
 * payload's essid + ip, reads its real `/etc/passwd`, server-derives the userType
 * (never a client claim), and validates `md5(password)` against the stored hash
 * before persisting the row.
 *
 * Auth model: the own-workstation gate does NOT apply — an ssh target is foreign
 * by design, so the passwd check IS the authorization boundary. Resolving the
 * target on the caller's own regenerated LAN also proves `target_ip` is a real
 * reachable host (not an arbitrary address). Unknown-user and wrong-password
 * collapse to ONE 401 so the response never reveals which accounts exist (real
 * ssh / legacy parity).
 *
 * Stored: `essid` (the regeneration key the later L1/L2 write path needs to
 * rebuild this host's FS). NOT stored: `target_ip` — it is recoverable from
 * `(essid, machine_id)` via `hostForMachineId`, so it stays out of the row.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { canBoot } from '../boot/bootFiles';
import { md5 } from '../generation/md5';
import { SERVICE_CATALOG, type ServiceSpec, type SweepLog } from '../services/serviceCatalog';
import {
  readOpenPorts,
  readRunningProcesses,
  type Listener,
  type RunningProcess,
} from '../services/pidfile';
import type { Directory } from '../filesystem/types';
import { derivePid } from '../logging/syslog';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import { accountIn } from './passwdAccount';
import { asGameTime, type UserType } from '../types';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The doors this endpoint opens. Three of them authenticate the same way —
 *  against the box's real `/etc/passwd` — and differ only in which log records the
 *  attempt and what the client does with the row: `ssh` is a hop the shell walks
 *  onto, `ftp` a parallel session the terminal holds alongside where it already
 *  stands, and `scp` a transient row that exists for one transfer and is ended
 *  behind it.
 *
 *  `nc` is the fourth and asks for nothing. There is no daemon behind it and no
 *  account to name: the pidfile somebody left in `/var/run` IS the door, and it
 *  already says who planted it and at what tier. */
export const DOOR_KINDS = ['ssh', 'ftp', 'scp', 'nc'] as const;
export type DoorKind = (typeof DOOR_KINDS)[number];

/** The doors that ask for a password — everything except a backdoor. */
type PasswdDoorKind = Exclude<DoorKind, 'nc'>;

/** Which SERVICE a password door knocks on — the daemon that has to be listening,
 *  and whose log records the attempt. Not the same question as which kind the row
 *  stores: `scp` rides sshd, so it is answered by the ssh daemon and written up as
 *  an ordinary ssh login, while the row still remembers a transfer opened it.
 *  Keeping the two apart is what lets the defender's evidence stay truthful without
 *  the session table forgetting what it was for.
 *
 *  `nc` is absent by TYPE rather than by an `unknown` row: it knocks on no daemon,
 *  so it has no service to name and no log to be routed to — and a `sweepLog` for a
 *  door with no credential to sweep would be a fabrication the defender would then
 *  be reading as evidence. */
export const SERVICE_BY_DOOR = { ssh: 'ssh', ftp: 'ftp', scp: 'ssh' } as const satisfies Record<
  PasswdDoorKind,
  keyof typeof SERVICE_CATALOG
>;

export type AuthSessionRow = {
  readonly session_id: string;
  readonly player_key: string;
  readonly machine_id: string;
  readonly credentials: { readonly username: string; readonly userType: UserType };
  readonly parent_session_id: string | null;
  readonly source_ip: string | null;
  readonly kind: DoorKind;
  readonly essid: string;
};

export type AuthCreateSessionDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the auth.log line. */
  readonly now: () => number;
  readonly insertSession: (row: AuthSessionRow) => Promise<{ readonly error: unknown }>;
  /** The resolved host's FULL patch journal (scoped to `machine_id`, server order),
   *  replayed over its seeded base so the gate sees the box's REAL state: a `/boot`
   *  tombstone makes it unbootable, and any journal write to `/etc/passwd` is the
   *  credential actually in force. Without this the handler could only ever see the
   *  pristine regenerated tree. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** Read the current content of a log file on the host's shared journal, keyed
   *  `(machine_id, path, writer_key)` — the read half of the system-written
   *  auth.log line. */
  readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended auth.log line on the remote host). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through; the
// refine rejects a client-supplied player_key (the server stamps it). There is no
// `userType` field — the server derives it from the regenerated passwd.
const authCreateSessionSchema = z
  .looseObject({
    action: z.literal('authCreateSession'),
    session_id: z.string().min(1),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    // Optional because a backdoor genuinely has neither to send — the pidfile
    // names its own user. A password door still requires both; missing collapses
    // into the same 401 as wrong, the way unknown-user already does.
    username: z.string().min(1).optional(),
    password: z.string().optional(),
    parent_session_id: z.string().min(1).nullable().optional(),
    source_ip: z.string().min(1).nullable().optional(),
    // Absent means ssh, so every shipped caller keeps working untouched.
    kind: z.enum(DOOR_KINDS).default('ssh'),
    // Only a backdoor needs one: a password door is answered by its daemon
    // wherever that daemon happens to be listening, but a listener is addressed
    // by the port it holds and nothing else knows which one is being knocked on.
    port: z.number().int().positive().optional(),
  })
  .refine((payload) => !('player_key' in payload));

type LoginAttempt = {
  readonly publicKey: string;
  readonly machineId: string;
  readonly host: LanHost;
  readonly username: string;
  readonly fromIp: string;
  readonly outcome: 'success' | 'failure';
  /** How the door being knocked on records an attempt — the same catalog column
   *  hydra's sweep writes through, so a login and a sweep against one service can
   *  never disagree about which file the defender should be reading. */
  readonly sweepLog: SweepLog;
};

/** Stamp the attempt onto the REMOTE host's log for the service it was made
 *  against. Best-effort: a logging failure must never break (or fabricate) the auth. */
const logLoginAttempt = async (
  deps: AuthCreateSessionDeps,
  attempt: LoginAttempt,
): Promise<void> => {
  const stamp = deps.now();
  const record = {
    outcome: attempt.outcome,
    user: attempt.username,
    fromIp: attempt.fromIp,
    hostname: attempt.host.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  };
  // A daemon that records arrivals separately writes both in one append: they are
  // one event to the box, and two appends would be two read-modify-writes racing
  // over the same file.
  const line = [attempt.sweepLog.formatArrival?.(record), attempt.sweepLog.formatAttempt(record)]
    .filter((entry) => entry !== undefined)
    .join('\n');
  try {
    await appendMachineLog(
      { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: attempt.publicKey,
        machineId: attempt.machineId,
        path: attempt.sweepLog.path,
        owner: attempt.sweepLog.owner,
        permissions: attempt.sweepLog.permissions,
      },
      line,
    );
  } catch {
    // best-effort: the auth result stands regardless of a logging failure.
  }
};

/** The door a knock actually reaches on the box, or null when nothing of that
 *  shape answers there.
 *
 *  For a password door the question is whether its daemon is up. For a backdoor it
 *  is whether a listener holds the asked port — and that single question IS the
 *  whole door, because the pidfile already carries who left it and at what tier.
 *  Which is why a backdoor can never answer 401: there is no credential to get
 *  wrong, only a door that is there or is not. A pidfile naming a tier the world
 *  does not have is not a door either — `readRunningProcesses` refuses to parse it,
 *  so a rooted planter cannot write themselves a rank nobody granted. */
export type ReachedDoor =
  | { readonly kind: 'passwd'; readonly spec: ServiceSpec }
  | { readonly kind: 'listener'; readonly admits: Listener };

/** Shared by every gate, so a door cannot exist at one address and not another.
 *  `reachedPort` narrows the match to the port the request actually arrived on —
 *  which a routed forward always knows and an own-LAN knock only knows for a
 *  backdoor, since a daemon is answered wherever it happens to be listening. */
/** The listener holding `port` on this box, or null when none does — everything a
 *  backdoor knows about who is coming in. Exported for the gates whose reachability
 *  is decided elsewhere and which only need the door's identity. */
export const listenerOn = (fs: Directory, port: number | undefined): Listener | null =>
  readRunningProcesses(fs).find(
    (running): running is Extract<RunningProcess, { kind: 'listener' }> =>
      running.kind === 'listener' && running.port === port,
  ) ?? null;

export const reachDoor = (
  kind: DoorKind,
  fs: Directory,
  reachedPort: number | undefined,
): ReachedDoor | null => {
  if (kind === 'nc') {
    const admits = listenerOn(fs, reachedPort);
    return admits === null ? null : { kind: 'listener', admits };
  }
  const spec = SERVICE_CATALOG[SERVICE_BY_DOOR[kind]];
  const serving = readOpenPorts(fs).some(
    (open) => open.service === spec.service && (reachedPort === undefined || open.port === reachedPort),
  );
  return serving ? { kind: 'passwd', spec } : null;
};

export const handleAuthCreateSession = async (
  body: unknown,
  deps: AuthCreateSessionDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, authCreateSessionSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // Resolve the target on the caller's OWN regenerated LAN: gives the host needed
  // to rebuild its FS, and proves target_ip is a real reachable host.
  const host = generateHomeLan(payload.essid).hosts.find(
    (candidate) => candidate.ip === payload.target_ip,
  );
  if (host === undefined) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Validate the credential against the host's real /etc/passwd. Unknown user and
  // bad password are indistinguishable in the response. The shared resolver maps the
  // host to its machine id + seeded FS: the edge router (`.1`), an inner gateway, or
  // a coordinate-seeded sibling — the same mapping the client uses, so the session
  // lands on the box both agree on.
  const { machineId, baseFs } = resolveLanHostIdentity(host, payload.essid);

  // Replay the host's journal over its seeded base so the gate reads the box's REAL
  // state rather than the pristine regeneration. A read failure is a 500: never a
  // false login, and never a false dark either.
  const patches = await deps.findPatches({ machine_id: machineId });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const hostFs = materializeMachineFs(baseFs, patches.data);

  // A bricked box (a root `rm /boot/vmlinuz` tombstone) is dark on EVERY interface,
  // not just the WAN — refuse before the password is checked, so no credential
  // reaches a dead machine and nothing is logged on it. What survives a gateway
  // brick is the NETWORK, not the box: the ESSID keeps broadcasting and occupants
  // still reach each other over the LAN.
  if (!canBoot(hostFs).ok) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  /** One writer for the session row, whichever door produced the credentials —
   *  so a new door can decide WHO comes in without also deciding what a session
   *  looks like. */
  const insertRow = (credentials: AuthSessionRow['credentials']) =>
    deps.insertSession({
      session_id: payload.session_id,
      player_key: publicKey,
      machine_id: machineId,
      credentials,
      parent_session_id: payload.parent_session_id ?? null,
      source_ip: payload.source_ip ?? null,
      kind: payload.kind,
      essid: payload.essid,
    });

  // The door has to be OPEN. Only some boxes roll ftp — and ~60% of generated hosts
  // run no sshd at all — so a knock on a box that never started the daemon gets the
  // same 404 an unreachable host does, and the box records nothing: a log line would
  // confirm the machine exists.
  //
  // EVERY door obeys this, `ssh` included. It was exempt for a while, on the reasoning
  // that a router might generate without sshd and become unreachable — but no router
  // does (`ROUTER_SSH_PROBABILITY` is 1), so the exemption protected nothing and only
  // left a gap a crafted request could walk through. An honest client never noticed
  // either way: `ssh` compares the target's pidfile port before it prompts.
  const reached = reachDoor(payload.kind, hostFs, payload.port);
  if (reached === null) {
    return { status: 404, body: { error: 'service_not_running' } };
  }

  // A backdoor admits whoever its pidfile names and writes NOTHING anywhere: no
  // PAM, so no auth.log; no utmp, so nothing for `who` to show; and netcat has no
  // syslog of its own. The defender is left the two facts a real one is left —
  // live state they can see, and no line they can read.
  if (reached.kind === 'listener') {
    const { user, userType } = reached.admits;
    const { error } = await insertRow({ username: user, userType });
    if (error) {
      return { status: 500, body: { error: 'insert_failed' } };
    }
    // The username goes BACK, unlike a password door's: the caller typed that one
    // and already knows it, while here only the box knew who it was letting in.
    return { status: 200, body: { ok: true, username: user, userType } };
  }

  const spec = reached.spec;
  if (payload.username === undefined || payload.password === undefined) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const account = accountIn(hostFs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;

  // The host is resolved by now, so the attempt CAN be logged — every door records
  // both accepted and rejected logins. (A 404 above logs nothing — there is no
  // machine, or no daemon, to log on.)
  await logLoginAttempt(deps, {
    publicKey,
    machineId,
    host,
    username: payload.username,
    fromIp: payload.source_ip ?? 'unknown',
    outcome: passwordOk ? 'success' : 'failure',
    sweepLog: spec.sweepLog,
  });

  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error } = await insertRow({
    username: payload.username,
    userType: account.userType,
  });
  if (error) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return { status: 200, body: { ok: true, userType: account.userType } };
};
