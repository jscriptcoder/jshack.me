import { describe, expect, it, vi } from 'vitest';
import { handleHydraCrack, type HydraCrackDeps } from './hydraCrack';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { hostServices } from '../generation/remoteHostFs';
import { ALL_GENERATED_PASSWORDS, UNCRACKABLE_PASSWORDS } from '../generation/passwordPools';
import { machineIdForLanHost, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { DEFAULT_WORDLIST, WORDLIST_PATH, formatWordlist } from '../wordlist/defaultWordlist';
import { accountsIn } from './passwdAccount';
import { sweepAccounts } from '../wordlist/passwordSweep';
import { parseMysqlDatabase, type MysqlDatabase } from '../mysql/types';
import { md5 } from '../generation/md5';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
} from '../logging/authLog';
import { VSFTPD_LOG_PATH, formatVsftpdLoginLine } from '../logging/vsftpdLog';
import {
  MYSQL_LOG_OWNER,
  MYSQL_LOG_PATH,
  MYSQL_LOG_PERMISSIONS,
  formatMysqlAttemptLine,
} from '../logging/mysqlLog';
import { derivePid } from '../logging/syslog';
import { asAbsPath, asGameTime } from '../types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { Directory } from '../filesystem/types';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type {
  ListPathPatchesResult,
  PathPatchRow,
  PatchRow,
} from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleHydraCrack` decides what a player can crack, and it decides it
 * SERVER-side — the same place `ssh` validates a password, from the same
 * `/etc/passwd`, so the two can never disagree. A hydra that reports a credential
 * `ssh` then rejects would read to the player as a broken game.
 *
 * The gate is the wordlist on the machine the caller is standing on, read from
 * that machine's journal rather than taken from the request: a password absent
 * from the file is uncrackable however weak it looks, and one present in it falls
 * however strong it looks. The list is never a client claim.
 *
 * That read is machine-scoped, so the file is whatever the LAST writer left there
 * — a box is one box, and a list another player left on it is the list the tools
 * use. Reading only the caller's own row would let a player `cat` a wordlist the
 * tool then denied existed.
 *
 * The target must be reachable on the caller's own LAN, bootable, and actually
 * running the service asked for — the same three refusals `ssh` makes, checked in
 * the same order, so a dead box stays dark to every tool.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
const WORKSTATION = 'skylab';
// 2026-08-09 11:04:07 UTC — the server clock every trace line in these tests is
// stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);
const ATTACKER_IP = '192.168.1.50';

/** A LAN host that actually runs ssh — the sweep needs a service to attack. */
const sshHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.ssh),
  );
  if (host === undefined) throw new Error('no ssh-running host on LAN');
  return host;
};

/** A LAN host that runs ftp — the second door, whose sweep must land in the ftp
 *  daemon's own log rather than sshd's. */
const ftpHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.ftp),
  );
  if (host === undefined) throw new Error('no ftp-running host on LAN');
  return host;
};

/** A LAN host that runs mysqld — the database door, and the only one in the catalog
 *  whose accounts are not the box's own. */
const mysqlHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.mysql),
  );
  if (host === undefined) throw new Error('no mysql-running host on LAN');
  return host;
};

/** A LAN host running NO ssh — the "nothing listening there" refusal. */
const sshlessHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      !hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.ssh),
  );
  if (host === undefined) throw new Error('every host on LAN runs ssh');
  return host;
};

/** A LAN host running ssh but NO database — the box that separates a refusal about
 *  the DOOR from a refusal about the machine. Its shell opens to the same wordlist
 *  that its database door must turn away. */
const databaselessHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find((candidate) => {
    if (candidate.kind !== 'machine') return false;
    const services = hostServices(essid, candidate).map(({ spec }) => spec);
    return services.includes(SERVICE_CATALOG.ssh) && !services.includes(SERVICE_CATALOG.mysql);
  });
  if (host === undefined) throw new Error('every ssh host on LAN runs a database');
  return host;
};

/** A LAN host other than `host` — the box a player STANDS on while attacking
 *  something else on the same network. */
const lanHostOtherThan = (host: LanHost): LanHost => {
  const other = generateHomeLan(ESSID).hosts.find(
    (candidate) => candidate.kind === 'machine' && candidate.ip !== host.ip,
  );
  if (other === undefined) throw new Error('no second machine on LAN');
  return other;
};

/** Every account on a generated host draws from this pool, so matching against it
 *  recovers the real plaintexts a test needs to build wordlists from. */
const KNOWN_POOL = ALL_GENERATED_PASSWORDS;

/** Every account on a host paired with its real plaintext, recovered by matching
 *  the stored md5 against a candidate list — exactly what the handler must do. */
const accountsWithPasswords = (
  host: LanHost,
  candidates: readonly string[],
): readonly { readonly username: string; readonly password: string }[] => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  return accountsIn(baseFs).flatMap((account) => {
    const password = candidates.find((candidate) => md5(candidate) === account.hash);
    return password === undefined ? [] : [{ username: account.username, password }];
  });
};

/** One file's content on a regenerated host, or undefined when nothing there is a
 *  file. The datadir is read the same way the daemon reads its own. */
const fileOn = (host: LanHost, segments: readonly string[]): string | undefined => {
  const parent = segments.slice(0, -1).reduce<Directory | undefined>((node, segment) => {
    const next = node?.entries.get(segment);
    return next !== undefined && next.kind === 'directory' ? next : undefined;
  }, resolveLanHostIdentity(host, ESSID).baseFs);
  const leaf = parent?.entries.get(segments.at(-1) ?? '');
  return leaf !== undefined && leaf.kind === 'file' ? leaf.content : undefined;
};

/** The database a mysql box keeps. */
const databaseOn = (host: LanHost): MysqlDatabase => {
  const raw = fileOn(host, ['var', 'lib', 'mysql', 'data.json']);
  const database = raw === null || raw === undefined ? null : parseMysqlDatabase(raw);
  if (database === null) throw new Error(`no database on ${host.hostname}`);
  return database;
};

/** Every DATABASE account on a host paired with its real plaintext — the mysql half
 *  of `accountsWithPasswords`, drawn on a stream the box's own accounts never share. */
const databaseAccountsWithPasswords = (
  host: LanHost,
  candidates: readonly string[],
): readonly { readonly username: string; readonly password: string }[] =>
  databaseOn(host).credentials.flatMap((credential) => {
    const password = candidates.find((candidate) => md5(candidate) === credential.passwordHash);
    return password === undefined ? [] : [{ username: credential.username, password }];
  });

/** One writer's row at the wordlist path — the shape `apt install hydra` leaves
 *  behind. `updated_at` and `writer_key` are what a reader decides the winner on
 *  when several writers have written the same file on one machine. */
const wordlistRow = (
  words: readonly string[],
  over: Partial<PathPatchRow> = {},
): PathPatchRow => ({
  content: formatWordlist(words),
  updated_at: '2026-08-09T11:00:00.000Z',
  writer_key: 'the-caller',
  ...over,
});

/** A patch row at the datadir path — `null` content is the file being deleted, which
 *  is what root removing it leaves behind. */
const datadirRow = (content: string | null): OwnerPatchRow =>
  ({
    path: asAbsPath('/var/lib/mysql/data.json'),
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-08-09T11:00:00.000Z',
    writer_key: 'b'.repeat(64),
  }) as OwnerPatchRow;

type DepOverrides = Partial<HydraCrackDeps> & {
  readonly wordlist?: readonly string[] | null;
  /** The machine's rows at the wordlist path, when a test needs more than one
   *  writer or a deletion. Defaults to the single row `wordlist` describes. */
  readonly wordlistRows?: readonly PathPatchRow[];
};

const makeDeps = (over: DepOverrides = {}) => {
  const findPatches = vi.fn<
    (query: {
      machine_id: string;
    }) => Promise<{ data: readonly OwnerPatchRow[] | null; error: unknown }>
  >(async () => ({ data: [], error: null }));
  const listPathPatches = vi.fn<
    (query: { machine_id: string; path: string }) => Promise<ListPathPatchesResult>
  >(async () => ({
    data: over.wordlistRows ?? (over.wordlist === null ? [] : [wordlistRow(over.wordlist ?? [])]),
    error: null,
  }));
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readAuthLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const findActiveSession = vi.fn<HydraCrackDeps['findActiveSession']>(async () => ({
    data: null,
    error: null,
  }));
  const deps: HydraCrackDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findActiveSession,
    findPatches,
    listPathPatches,
    readAuthLog,
    upsertPatch,
    ...over,
  };
  return { deps, findActiveSession, findPatches, listPathPatches, readAuthLog, upsertPatch };
};

type CrackRequest = {
  readonly essid?: string;
  readonly target_ip: string;
  readonly service?: string;
  readonly username?: string;
  readonly caller_machine_id?: string;
  readonly source_ip?: string | null;
};

const signedCrack = (identity: ReturnType<typeof generateIdentity>, request: CrackRequest) =>
  signRequest(identity, 'hydraCrack', {
    essid: request.essid ?? ESSID,
    target_ip: request.target_ip,
    service: request.service ?? 'ssh',
    ...(request.username === undefined ? {} : { username: request.username }),
    caller_machine_id:
      request.caller_machine_id ?? computeWorkstationId(WORKSTATION, identity.publicKeyHex),
    source_ip: request.source_ip === undefined ? ATTACKER_IP : request.source_ip,
  });

/** One line the sweep is expected to leave on the target's auth.log. */
const traceLine = (
  outcome: 'success' | 'failure',
  user: string,
  host: LanHost,
  fromIp = ATTACKER_IP,
): string =>
  formatSshdAuthLine({
    outcome,
    user,
    fromIp,
    hostname: host.hostname,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

/** One line the sweep is expected to leave on the target's mysql.log. An accepted
 *  attempt names the database it opened; a refused one has none to name. */
const mysqlTraceLine = (
  outcome: 'success' | 'failure',
  user: string,
  database?: string,
): string =>
  formatMysqlAttemptLine({
    outcome,
    user,
    fromIp: ATTACKER_IP,
    hostname: '',
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
    ...(database === undefined ? {} : { database }),
  });

/** Every DATABASE account on a host, in datadir order — the order a sweep attacks
 *  them in, and so the order their trace lines must appear in. */
const databaseAccountNamesOn = (host: LanHost): readonly string[] =>
  databaseOn(host).credentials.map((credential) => credential.username);

/** The lines a sweep actually wrote, in order — the content of the single patch
 *  the handler upserts, minus the trailing newline the appender adds. */
const writtenLines = (upsertPatch: { readonly mock: { readonly calls: readonly PatchRow[][] } }) => {
  const row = upsertPatch.mock.calls[0]?.[0];
  return (row?.content ?? '').split('\n').filter((line) => line.length > 0);
};

/** Every account on a host, in `/etc/passwd` order — the order a sweep attacks
 *  them in, and so the order their trace lines must appear in. */
const accountNamesOn = (host: LanHost): readonly string[] =>
  accountsIn(resolveLanHostIdentity(host, ESSID).baseFs).map((account) => account.username);

/** An account whose password no OTHER account on the box shares, so a wordlist
 *  holding it cracks exactly one account and the expected trace stays exact. */
const soleHolderOf = (
  accounts: readonly { readonly username: string; readonly password: string }[],
): { readonly username: string; readonly password: string } => {
  const sole = accounts.find(
    (account) => accounts.filter((other) => other.password === account.password).length === 1,
  );
  if (sole === undefined) throw new Error('every password on this host is shared');
  return sole;
};

/** An ssh host on this LAN with an account the SHIPPED wordlist cannot open,
 *  paired with the password that would. Drawn from the uncrackable pool, which
 *  `DEFAULT_WORDLIST` covers not at all — so this is a door that genuinely holds
 *  against a default install, and only a harvested word opens it. */
const hostWithADoorThatHolds = (
  essid: string,
): {
  readonly host: LanHost;
  readonly held: { readonly username: string; readonly password: string };
} => {
  const doors = generateHomeLan(essid)
    .hosts.filter(
      (candidate) =>
        candidate.kind === 'machine' &&
        hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.ssh),
    )
    .flatMap((host) =>
      accountsWithPasswords(host, UNCRACKABLE_PASSWORDS).map((held) => ({ host, held })),
    );
  const first = doors[0];
  if (first === undefined) throw new Error('every account on every ssh host is crackable');
  return first;
};

describe('handleHydraCrack', () => {
  it('reports every account whose password is in the wordlist', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const everything = accountsWithPasswords(host, KNOWN_POOL);
    const { deps } = makeDeps({ wordlist: everything.map((account) => account.password) });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body.cracked).toEqual(everything);
  });

  it('never reports an account whose password is absent from the wordlist', async () => {
    // The whole mechanic: membership in YOUR list is the only gate. Drop one
    // account's password and that account must survive the sweep untouched.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const everything = accountsWithPasswords(host, KNOWN_POOL);
    const withheld = everything[0];
    const { deps } = makeDeps({
      wordlist: everything.slice(1).map((account) => account.password),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response.body.cracked).toEqual(everything.slice(1));
    expect(response.body.cracked).not.toContainEqual(withheld);
  });

  it('attacks only the named account when a username is given', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const everything = accountsWithPasswords(host, KNOWN_POOL);
    const target = everything[0];
    const { deps } = makeDeps({ wordlist: everything.map((account) => account.password) });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, username: target.username }),
      deps,
    );

    expect(response.body.cracked).toEqual([target]);
  });

  it('cracks nothing when the caller has no wordlist', async () => {
    // A deleted wordlist is a real state — it is an ordinary file on the player's
    // own box, and root can remove it.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({ wordlist: null });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cracked: [], wordlistFound: false });
  });

  it('cracks with the newest wordlist on the machine, whoever wrote it', async () => {
    // A box is one box: the wordlist holds whatever the last writer left there,
    // exactly as `cat` on that machine would show it. A list is not private to
    // the player who installed it — leaving one behind arms whoever stands here
    // next. The rows arrive newest-first, so nothing works by accident of order.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const stolen = soleHolderOf(accountsWithPasswords(host, KNOWN_POOL));
    const { deps } = makeDeps({
      wordlistRows: [
        wordlistRow([stolen.password], {
          writer_key: 'somebody-else',
          updated_at: '2026-08-09T12:00:00.000Z',
        }),
        wordlistRow(['nothing-matches-this'], { updated_at: '2026-08-09T09:00:00.000Z' }),
      ],
    });

    const response = await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(response.body).toMatchObject({
      cracked: [{ username: stolen.username, password: stolen.password }],
      wordlistFound: true,
    });
  });

  it('reports no wordlist when the newest row on the machine is a deletion', async () => {
    // Root can remove the file, and the removal is a row like any other. It has
    // to read as ABSENT rather than empty: an absent list is what `apt install
    // hydra` restores, and that recovery is what both tools tell the player.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const everything = accountsWithPasswords(host, KNOWN_POOL);
    const { deps } = makeDeps({
      wordlistRows: [
        wordlistRow(
          everything.map((account) => account.password),
          { writer_key: 'somebody-else', updated_at: '2026-08-09T09:00:00.000Z' },
        ),
        { content: null, updated_at: '2026-08-09T12:00:00.000Z', writer_key: 'the-caller' },
      ],
    });

    const response = await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(response.body).toMatchObject({ cracked: [], wordlistFound: false });
  });

  it('reports no wordlist when the lookup yields no rows at all', async () => {
    // A journal read can come back with nothing rather than an empty list. That
    // is still "the file is not on this box" — never a crash, and never a 500,
    // which would read as the sweep having failed rather than found nothing.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({ listPathPatches: async () => ({ data: null, error: null }) });

    const response = await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cracked: [], wordlistFound: false });
  });

  it('reads the wordlist from the CALLER-s own machine, not the target', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, listPathPatches } = makeDeps({ wordlist: [] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(listPathPatches).toHaveBeenCalledWith({
      machine_id: computeWorkstationId(WORKSTATION, identity.publicKeyHex),
      path: WORDLIST_PATH,
    });
  });

  it('refuses a caller_machine_id the caller holds no session on', async () => {
    // The wordlist is read from whatever machine the caller names, so an
    // unchecked id would let a player read a file off a box they never reached.
    const identity = generateIdentity();
    const stranger = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, listPathPatches } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack(
      signedCrack(identity, {
        target_ip: host.ip,
        caller_machine_id: computeWorkstationId('victim', stranger.publicKeyHex),
      }),
      deps,
    );

    expect(response).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(listPathPatches).not.toHaveBeenCalled();
  });

  it('sweeps from an NPC box the caller holds a session on', async () => {
    // Tools run where you stand: a player who rooted a box on their LAN and
    // installed hydra there attacks from it, and the box they are standing on is
    // the one whose wordlist the sweep reads.
    const identity = generateIdentity();
    const standing = lanHostOtherThan(sshHostOn(ESSID));
    const host = sshHostOn(ESSID);
    const stolen = soleHolderOf(accountsWithPasswords(host, KNOWN_POOL));
    const { deps } = makeDeps({
      wordlist: [stolen.password],
      findActiveSession: async () => ({ data: { username: 'root', userType: 'root', essid: ESSID }, error: null }),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, {
        target_ip: host.ip,
        caller_machine_id: machineIdForLanHost(standing, ESSID),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      cracked: [{ username: stolen.username, password: stolen.password }],
    });
  });

  it('reads the wordlist off the box the caller is standing on', async () => {
    const identity = generateIdentity();
    const standing = lanHostOtherThan(sshHostOn(ESSID));
    const host = sshHostOn(ESSID);
    const { deps, listPathPatches } = makeDeps({
      wordlist: [],
      findActiveSession: async () => ({ data: { username: 'root', userType: 'root', essid: ESSID }, error: null }),
    });

    await handleHydraCrack(
      signedCrack(identity, {
        target_ip: host.ip,
        caller_machine_id: machineIdForLanHost(standing, ESSID),
      }),
      deps,
    );

    expect(listPathPatches).toHaveBeenCalledWith({
      machine_id: machineIdForLanHost(standing, ESSID),
      path: WORDLIST_PATH,
    });
  });

  it('refuses a caller machine it cannot place on the LAN, even with a session', async () => {
    // The trace has to name where the sweep really came from. A box the server
    // cannot locate has no address to record, and guessing one would frame a
    // machine — so the sweep is refused rather than written up as somebody else.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps({
      wordlist: [],
      findActiveSession: async () => ({ data: { username: 'root', userType: 'root', essid: ESSID }, error: null }),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, caller_machine_id: 'deep-layer-box' }),
      deps,
    );

    expect(response).toEqual({ status: 403, body: { error: 'caller_not_on_lan' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('reports the port the service actually listens on', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const listening = hostServices(ESSID, host).find(({ spec }) => spec === SERVICE_CATALOG.ssh);
    const { deps } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response.body.port).toBe(listening?.port);
  });

  it('refuses a target that is not a host on the caller-s LAN', async () => {
    const identity = generateIdentity();
    const { deps } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: '10.99.99.99' }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it('refuses a host that is not running the service asked for', async () => {
    const identity = generateIdentity();
    const host = sshlessHostOn(ESSID);
    const { deps } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });

  it('refuses a bricked host, exactly as ssh does', async () => {
    // A box with its kernel removed is dark to every tool, not just to logins —
    // there is nothing running to attack.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps } = makeDeps({
      wordlist: [],
      findPatches: async () => ({
        data: [
          {
            path: asAbsPath('/boot/vmlinuz'),
            content: null,
            owner: 'root',
            permissions: null,
            node_type: 'file',
            updated_at: '2026-07-31T00:00:00Z',
            writer_key: 'a'.repeat(64),
          } as OwnerPatchRow,
        ],
        error: null,
      }),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(machineId).toBeTruthy();
  });

  it('refuses an envelope whose signature does not verify', async () => {
    // The signature is what makes the pubkey a claim about WHO is asking, and
    // everything downstream — whose wordlist, whose machine — hangs off it.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const envelope = signedCrack(identity, { target_ip: host.ip });
    const { deps, listPathPatches, findPatches } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack({ ...envelope, signature: 'f'.repeat(128) }, deps);

    // Named, not just refused: `hydra` reports the server's reason to the player,
    // and a nameless refusal reaches them as a generic network error.
    expect(response).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(listPathPatches).not.toHaveBeenCalled();
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('refuses a payload that names no target', async () => {
    // The payload is a trust boundary: an absent target must be rejected as a
    // malformed request, not resolved into "no such host" further down.
    const identity = generateIdentity();
    const { deps, findPatches } = makeDeps({ wordlist: [] });
    const envelope = signRequest(identity, 'hydraCrack', {
      essid: ESSID,
      service: 'ssh',
      caller_machine_id: computeWorkstationId(WORKSTATION, identity.publicKeyHex),
    });

    const response = await handleHydraCrack(envelope, deps);

    expect(response).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('refuses a payload that supplies its own player_key', async () => {
    // The acting player is the verified signer, never a field in the body — a
    // client-supplied key would be an identity claim the signature does not cover.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({ wordlist: [] });
    const envelope = signRequest(identity, 'hydraCrack', {
      essid: ESSID,
      target_ip: host.ip,
      service: 'ssh',
      caller_machine_id: computeWorkstationId(WORKSTATION, identity.publicKeyHex),
      player_key: identity.publicKeyHex,
    });

    const response = await handleHydraCrack(envelope, deps);

    expect(response.status).toBe(400);
  });

  it("reads the TARGET host's journal, keyed by the machine it resolved", async () => {
    // Reading the wrong machine's journal would sweep a passwd belonging to some
    // other box — and report credentials `ssh` would refuse on this one.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps, findPatches } = makeDeps({ wordlist: [] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(findPatches).toHaveBeenCalledWith({ machine_id: machineId });
  });

  it('reports that the wordlist was found when a sweep actually ran', async () => {
    // The counterpart to the no-wordlist case: "nothing matched" and "nothing was
    // tried" must stay distinguishable in both directions.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({ wordlist: ['nothing-matches-this'] });

    const response = await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(response.body).toMatchObject({ cracked: [], wordlistFound: true });
  });

  it('fails closed when the wordlist cannot be read', async () => {
    // A read error must not collapse into "you have no wordlist" — that reads to
    // the player as an empty list rather than a broken lookup, and they would
    // curate a file that was never consulted.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({
      listPathPatches: async () => ({ data: null, error: new Error('db down') }),
    });

    const response = await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(response).toEqual({ status: 500, body: { error: 'wordlist_lookup_failed' } });
  });

  it('fails closed when the target journal cannot be read', async () => {
    // Never a false crack, and never a false "nothing here" either.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({
      wordlist: [],
      findPatches: async () => ({ data: null, error: new Error('db down') }),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });
});

/**
 * Growing the wordlist IS the progression, and this is the whole of it: harvest a
 * password, append it, and a door that held opens. The gate is membership in the
 * file, so the mechanic only exists if a word added to the file on the caller's
 * machine reaches the sweep — which is why the append below is a journal row and
 * never a request field. A list the client could supply would be a claim, not a
 * possession.
 *
 * The base list is the real `DEFAULT_WORDLIST`, so this is a claim about the
 * SHIPPED game rather than about a list a test invented: what `apt install hydra`
 * hands a player genuinely cannot open this door until they widen it themselves.
 */
describe('growing the wordlist', () => {
  it('opens a door the shipped list cannot, once the harvested password is a line in the file', async () => {
    const identity = generateIdentity();
    const { host, held } = hostWithADoorThatHolds(ESSID);

    const before = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      makeDeps({ wordlist: DEFAULT_WORDLIST }).deps,
    );
    const after = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      // Appended, exactly as `nano` would leave it: the harvested word is the LAST
      // line, the position an off-by-one over the list would silently skip.
      makeDeps({ wordlist: [...DEFAULT_WORDLIST, held.password] }).deps,
    );

    // The shipped list DID open other doors on this box — `guest` always falls — so
    // the sweep genuinely ran and this one account held on its own merit, rather
    // than the run having quietly done nothing.
    expect(before.body.cracked).not.toHaveLength(0);
    // Absent under ANY password before, not merely under the right one — a sweep
    // that reported the account with something else would be a worse bug.
    expect(before.body.cracked).not.toContainEqual(
      expect.objectContaining({ username: held.username }),
    );
    expect(after.body.cracked).toContainEqual(held);
  });
});

/**
 * The defender's half. A sweep is the noisiest thing a player can do to a box, and
 * until now it was the only thing that left no mark — `ssh` logged every attempt
 * while hydra tried a whole wordlist against every account in silence.
 *
 * The trace is per PASSWORD TRIED, not per account, because the volume IS the
 * behaviour: a sweep must read as a sweep in the log, and that visible cost is what
 * an offline cracker later buys its way out of. An attempt that stopped early —
 * the word matched — records only the words that came before it.
 *
 * Nothing is written for a sweep that never touched the box. An unreachable, dead
 * or serviceless host must not be probeable through its own log.
 */
describe('the trace a hydra sweep leaves on its target', () => {
  it('records every password tried against an account that held', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const words = ['no-such-word', 'nor-this-one'];
    const { deps, upsertPatch } = makeDeps({ wordlist: words });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(writtenLines(upsertPatch)).toEqual(
      accountNamesOn(host).flatMap((name) => words.map(() => traceLine('failure', name, host))),
    );
    // One sweep is one append: a line-by-line write would re-read and re-upsert the
    // whole log for every password tried.
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('records the account that fell as Accepted, after only the words tried before it', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const target = soleHolderOf(accountsWithPasswords(host, KNOWN_POOL));
    // The match sits in the MIDDLE of the list: a sweep that carried on past it
    // would record the trailing word too, and the defender would read attempts the
    // attacker never made.
    const { deps, upsertPatch } = makeDeps({
      wordlist: ['no-such-word', target.password, 'never-reached'],
    });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(writtenLines(upsertPatch)).toEqual(
      accountNamesOn(host).flatMap((name) =>
        name === target.username
          ? [traceLine('failure', name, host), traceLine('success', name, host)]
          : [
              traceLine('failure', name, host),
              traceLine('failure', name, host),
              traceLine('failure', name, host),
            ],
      ),
    );
  });

  it('traces only the named account when a username is given', async () => {
    // A sweep that never attacked an account must not fabricate attempts against
    // it — the log is the defender's evidence of what actually happened.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const target = soleHolderOf(accountsWithPasswords(host, KNOWN_POOL));
    const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

    await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, username: target.username }),
      deps,
    );

    expect(writtenLines(upsertPatch)).toEqual([traceLine('failure', target.username, host)]);
  });

  it("records the address the attacker's machine connected from", async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const elsewhere = '192.168.1.77';
    const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

    await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, source_ip: elsewhere }),
      deps,
    );

    expect(writtenLines(upsertPatch)).toEqual(
      accountNamesOn(host).map((name) => traceLine('failure', name, host, elsewhere)),
    );
  });

  it('records the box the sweep was launched FROM, not the address the client claimed', async () => {
    // Standing on a pivot is the whole point: the target sees the machine the
    // packets came from. The server derives that from the box the caller is on
    // rather than trusting the request, so a player cannot dress their sweep up
    // as coming from somebody else.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const standing = lanHostOtherThan(host);
    const { deps, upsertPatch } = makeDeps({
      wordlist: ['no-such-word'],
      findActiveSession: async () => ({ data: { username: 'root', userType: 'root', essid: ESSID }, error: null }),
    });

    await handleHydraCrack(
      signedCrack(identity, {
        target_ip: host.ip,
        caller_machine_id: machineIdForLanHost(standing, ESSID),
        source_ip: '192.168.1.77',
      }),
      deps,
    );

    expect(writtenLines(upsertPatch)).toEqual(
      accountNamesOn(host).map((name) => traceLine('failure', name, host, standing.ip)),
    );
  });

  it('records an unknown source when the attempt carried no address', async () => {
    // A missing address is not a reason to drop the trace: the defender still
    // learns their box was swept, exactly as `ssh` reports an unknown origin.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip, source_ip: null }), deps);

    expect(writtenLines(upsertPatch)).toEqual(
      accountNamesOn(host).map((name) => traceLine('failure', name, host, 'unknown')),
    );
  });

  it("lands on the TARGET's auth.log, root-owned and readable by every tier", async () => {
    // World-readable is the whole point: a guest-tier occupant must be able to
    // `cat` the attack. Root-write keeps it a system write, not a player one.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: identity.publicKeyHex,
        machine_id: machineId,
        path: AUTH_LOG_PATH,
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
        node_type: 'file',
      }),
    );
  });

  it('appends to what the log already holds', async () => {
    // A sweep after an ssh login must not erase the login — and a second sweep
    // must not erase the first.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const earlier = 'Aug  9 10:00:00 box sshd[100]: Accepted password for guest from 192.168.1.9\n';
    const { deps, upsertPatch } = makeDeps({
      wordlist: ['no-such-word'],
      readAuthLog: async () => ({ data: { content: earlier }, error: null }),
    });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch.mock.calls[0]?.[0].content).toBe(
      `${earlier}${accountNamesOn(host)
        .map((name) => traceLine('failure', name, host))
        .join('\n')}\n`,
    );
  });

  it('writes nothing when the sweep never reached the box', async () => {
    // Unreachable, serviceless and bricked all refuse before anything is attacked.
    // A log line would tell an attacker the box exists, and tell its owner they
    // were attacked when they were not.
    const identity = generateIdentity();
    const unreachable = makeDeps({ wordlist: ['no-such-word'] });
    const serviceless = makeDeps({ wordlist: ['no-such-word'] });
    const bricked = makeDeps({
      wordlist: ['no-such-word'],
      findPatches: async () => ({
        data: [
          {
            path: asAbsPath('/boot/vmlinuz'),
            content: null,
            owner: 'root',
            permissions: null,
            node_type: 'file',
            updated_at: '2026-08-09T00:00:00Z',
            writer_key: 'a'.repeat(64),
          } as OwnerPatchRow,
        ],
        error: null,
      }),
    });

    await handleHydraCrack(signedCrack(identity, { target_ip: '10.99.99.99' }), unreachable.deps);
    await handleHydraCrack(
      signedCrack(identity, { target_ip: sshlessHostOn(ESSID).ip }),
      serviceless.deps,
    );
    await handleHydraCrack(signedCrack(identity, { target_ip: sshHostOn(ESSID).ip }), bricked.deps);

    expect(unreachable.upsertPatch).not.toHaveBeenCalled();
    expect(serviceless.upsertPatch).not.toHaveBeenCalled();
    expect(bricked.upsertPatch).not.toHaveBeenCalled();
  });

  it('writes nothing when the caller has no wordlist to try', async () => {
    // No list, no attempt — a trace here would report a sweep that never ran.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps({ wordlist: null });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('writes nothing when the wordlist is empty', async () => {
    // The file exists but holds no words: the sweep found the list and tried
    // nothing, which is still nothing to record.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps({ wordlist: [] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('still reports the cracked credentials when the log write fails', async () => {
    // Logging is best-effort: a broken journal must never swallow the result of an
    // attack that really happened.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const everything = accountsWithPasswords(host, KNOWN_POOL);
    const { deps } = makeDeps({
      wordlist: everything.map((account) => account.password),
      upsertPatch: async () => {
        throw new Error('journal down');
      },
    });

    const response = await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(response.status).toBe(200);
    expect(response.body.cracked).toEqual(everything);
  });
  describe('the trace lands in the attacked service own log', () => {
    it('writes an ftp sweep to vsftpd.log, in the ftp daemon own shape', async () => {
      // The wall of failures and the break-in that followed have to be in ONE file.
      // Filed under sshd, an ftp sweep tells the defender a door was knocked on that
      // nobody touched, while the door that actually opened shows nothing at all.
      const identity = generateIdentity();
      const host = ftpHostOn(ESSID);
      const everything = accountsWithPasswords(host, KNOWN_POOL);
      // A miss FIRST, so line 0 is a genuine failure: a list whose opening word
      // already opens account 0 would assert the success shape by accident.
      const { deps, upsertPatch } = makeDeps({
        wordlist: ['no-such-word', ...everything.map((account) => account.password)],
      });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'ftp' }),
        deps,
      );

      const row = upsertPatch.mock.calls[0]?.[0];
      expect(row?.path).toBe(VSFTPD_LOG_PATH);
      expect(writtenLines(upsertPatch)[0]).toBe(
        formatVsftpdLoginLine({
          outcome: 'failure',
          user: accountNamesOn(host)[0] ?? '',
          fromIp: ATTACKER_IP,
          hostname: host.hostname,
          time: asGameTime(FIXED_NOW),
          pid: derivePid(FIXED_NOW),
        }),
      );
    });

    it('leaves auth.log untouched when the door swept was ftp', async () => {
      // The other half of the same claim: routing that only ADDS a destination would
      // pass the assertion above while still writing the sshd-tagged wall.
      const identity = generateIdentity();
      const host = ftpHostOn(ESSID);
      const everything = accountsWithPasswords(host, KNOWN_POOL);
      // A miss FIRST, so line 0 is a genuine failure: a list whose opening word
      // already opens account 0 would assert the success shape by accident.
      const { deps, upsertPatch } = makeDeps({
        wordlist: ['no-such-word', ...everything.map((account) => account.password)],
      });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'ftp' }),
        deps,
      );

      const paths = upsertPatch.mock.calls.map(([row]) => row.path);
      expect(paths).not.toContain(AUTH_LOG_PATH);
    });

    it('still writes an ssh sweep to auth.log, in sshd shape', async () => {
      // The control. Routing by service must move the ftp door WITHOUT moving the one
      // every shipped trace already depends on.
      const identity = generateIdentity();
      const host = sshHostOn(ESSID);
      const everything = accountsWithPasswords(host, KNOWN_POOL);
      // A miss FIRST, so line 0 is a genuine failure: a list whose opening word
      // already opens account 0 would assert the success shape by accident.
      const { deps, upsertPatch } = makeDeps({
        wordlist: ['no-such-word', ...everything.map((account) => account.password)],
      });

      await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

      const row = upsertPatch.mock.calls[0]?.[0];
      expect(row?.path).toBe(AUTH_LOG_PATH);
      expect(writtenLines(upsertPatch)[0]).toBe(
        traceLine('failure', accountNamesOn(host)[0] ?? '', host),
      );
    });

    it('writes a mysql sweep to mysql.log, in the database daemon own shape', async () => {
      const identity = generateIdentity();
      const host = mysqlHostOn(ESSID);
      const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
        deps,
      );

      const row = upsertPatch.mock.calls[0]?.[0];
      expect(row?.path).toBe(MYSQL_LOG_PATH);
      expect(writtenLines(upsertPatch)[0]).toBe(
        mysqlTraceLine('failure', databaseAccountNamesOn(host)[0] ?? ''),
      );
    });

    it('denies in mysql own words, not another daemon-s', async () => {
      // Asserting the line EQUALS what the formatter produces cannot catch a change
      // inside the formatter — both sides move together, the same blind spot a name
      // pool compared against itself has. The shape is what closes it: a defender
      // reading this file sees mysql's ISO-with-microseconds stamp and its own
      // refusal wording, and would see neither if the sshd formatter were wired here.
      const identity = generateIdentity();
      const host = mysqlHostOn(ESSID);
      const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
        deps,
      );

      expect(writtenLines(upsertPatch)[0]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000000Z\t\d+ Connect\tAccess denied for user '[^']+'@'[^']+' \(using password: YES\)$/,
      );
    });

    it('leaves auth.log untouched when the door swept was mysql', async () => {
      const identity = generateIdentity();
      const host = mysqlHostOn(ESSID);
      const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
        deps,
      );

      const paths = upsertPatch.mock.calls.map(([row]) => row.path);
      expect(paths).not.toContain(AUTH_LOG_PATH);
    });

    it("lands on the TARGET's mysql.log, root-owned and readable by every tier", async () => {
      // Same rule auth.log follows: a guest-tier occupant must be able to `cat` the
      // attack, and only the daemon may write it.
      const identity = generateIdentity();
      const host = mysqlHostOn(ESSID);
      const { machineId } = resolveLanHostIdentity(host, ESSID);
      const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
        deps,
      );

      expect(upsertPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          writer_key: identity.publicKeyHex,
          machine_id: machineId,
          path: MYSQL_LOG_PATH,
          owner: MYSQL_LOG_OWNER,
          permissions: MYSQL_LOG_PERMISSIONS,
          node_type: 'file',
        }),
      );
    });

    it('records one line per password tried against the database, not one per account', async () => {
      // The volume IS the behaviour: a sweep is the noisiest thing a player can do to
      // a box, and a defender reading the file back has to see that. One line per
      // account would price the attack at a fraction of what it cost.
      const identity = generateIdentity();
      const host = mysqlHostOn(ESSID);
      const words = ['no-such-word', 'nor-this-one', 'nor-that'];
      const { deps, upsertPatch } = makeDeps({ wordlist: words });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
        deps,
      );

      expect(writtenLines(upsertPatch)).toHaveLength(
        words.length * databaseAccountNamesOn(host).length,
      );
    });

    it('records the database account that fell, after only the words tried before it', async () => {
      // The words after the match were never sent, so they cannot appear. This is the
      // line that tells a defender the sweep LANDED rather than merely happened.
      const identity = generateIdentity();
      const host = mysqlHostOn(ESSID);
      const database = databaseAccountsWithPasswords(host, KNOWN_POOL);
      const fell = database[0];
      const { deps, upsertPatch } = makeDeps({
        wordlist: ['no-such-word', fell?.password ?? ''],
      });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'mysql', username: fell?.username }),
        deps,
      );

      expect(writtenLines(upsertPatch)).toEqual([
        mysqlTraceLine('failure', fell?.username ?? ''),
        mysqlTraceLine('success', fell?.username ?? '', databaseOn(host).name),
      ]);
    });

    it('names the database on the line that opened it', async () => {
      // The defender's most useful signal: a wall of denials that names nothing,
      // then one Connect that names a database, is a sweep that LANDED. A refusal
      // cannot carry the name — a client that never authenticated was never told
      // which database it would have reached — so the name appearing at all is what
      // separates the attempt that worked from the hundreds that did not.
      //
      // Asserted as a shape rather than against the formatter, because a test that
      // compares the line to the function that wrote it moves whenever that function
      // does and can never catch it changing.
      const identity = generateIdentity();
      const host = mysqlHostOn(ESSID);
      const fell = databaseAccountsWithPasswords(host, KNOWN_POOL)[0];
      const { deps, upsertPatch } = makeDeps({ wordlist: [fell?.password ?? ''] });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'mysql', username: fell?.username }),
        deps,
      );

      expect(writtenLines(upsertPatch)[0]).toMatch(
        new RegExp(
          `^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.000000Z\\t\\d+ Connect\\t` +
            `${fell?.username ?? ''}@${ATTACKER_IP} on ${databaseOn(host).name} using TCP/IP$`,
        ),
      );
    });

    it('appends a mysql sweep to what the log already holds', async () => {
      // A sweep must not erase the connection history the box already recorded.
      const identity = generateIdentity();
      const host = mysqlHostOn(ESSID);
      const earlier =
        '2026-08-09T10:00:00.000000Z\t99 Connect\treadonly@10.0.0.9 on shop using TCP/IP\n';
      const { deps, upsertPatch } = makeDeps({
        wordlist: ['no-such-word'],
        readAuthLog: async () => ({ data: { content: earlier }, error: null }),
      });

      await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
        deps,
      );

      expect(upsertPatch.mock.calls[0]?.[0].content).toBe(
        `${earlier}${databaseAccountNamesOn(host)
          .map((name) => mysqlTraceLine('failure', name))
          .join('\n')}\n`,
      );
    });

    it('refuses a box that runs no database, and writes nothing, however weak the box is', async () => {
      // The refusal has to be about the DOOR, not about the machine or the wordlist.
      // So this box is one whose every unix account is in the list being swept: its
      // shell falls in the very same breath its database door is turned away, which
      // is the control that gives the refusal its meaning. A handler that reached for
      // `/etc/passwd` when it found no datadir would answer 200 here and hand back
      // three accounts — the loudest possible version of the bug this door exists to
      // avoid.
      //
      // And nothing is written either way: the refusal comes before anything is
      // attacked, so a box with no mysqld cannot be probed through its own log for
      // whether it ever had one.
      const identity = generateIdentity();
      const host = databaselessHostOn(ESSID);
      const box = accountsWithPasswords(host, KNOWN_POOL);
      const wordlist = box.map((account) => account.password);
      const database = makeDeps({ wordlist });
      const shell = makeDeps({ wordlist });

      const refused = await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
        database.deps,
      );
      const opened = await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'ssh' }),
        shell.deps,
      );

      expect(box.length).toBeGreaterThan(0);
      expect(refused).toEqual({ status: 404, body: { error: 'service_not_running' } });
      expect(database.upsertPatch).not.toHaveBeenCalled();
      expect(opened.body.cracked).toEqual(box);
    });

    it('refuses a service the world has no row for, and writes nothing', async () => {
      // `hydra <host> telnet` names a door the game does not model. It is answered
      // exactly like a service that is not running — the caller learns nothing about
      // the box either way — and nothing is recorded on it.
      const identity = generateIdentity();
      const host = sshHostOn(ESSID);
      const { deps, upsertPatch } = makeDeps({ wordlist: ['whatever'] });

      const response = await handleHydraCrack(
        signedCrack(identity, { target_ip: host.ip, service: 'telnet' }),
        deps,
      );

      expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });
  });
});

describe('the database door answers for its own accounts', () => {
  it("reports the datadir's credentials rather than the box's /etc/passwd", async () => {
    // A mysql account lives in `/var/lib/mysql/data.json`; a unix account lives in
    // `/etc/passwd`. The two are drawn on separate streams, so cracking a box buys
    // nothing toward its database and the reverse. The wordlist here holds BOTH
    // sets on purpose: a sweep reading the wrong file still reports something, which
    // is what makes this an assertion about the SOURCE and not about the sweep.
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const database = databaseAccountsWithPasswords(host, KNOWN_POOL);
    const box = accountsWithPasswords(host, KNOWN_POOL);
    const { deps } = makeDeps({
      wordlist: [...database, ...box].map((account) => account.password),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body.cracked).toEqual(database);
  });

  it('never opens one of the box own accounts through the database door', async () => {
    // The sharper half of the same claim. This box holds a `root` in BOTH files
    // under different passwords, so a sweep that read `/etc/passwd` hands back the
    // right name against the wrong secret — the one failure that would read to a
    // player as success, right up until the credential is used.
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const database = databaseAccountsWithPasswords(host, KNOWN_POOL);
    const box = accountsWithPasswords(host, KNOWN_POOL);
    const { deps } = makeDeps({
      wordlist: [...database, ...box].map((account) => account.password),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
      deps,
    );

    for (const account of box) {
      expect(response.body.cracked).not.toContainEqual(account);
    }
  });

  it('exposes no accounts when the datadir has been deleted', async () => {
    // The daemon is still listening — the pidfile says so — but there is nothing
    // behind it to authenticate against. Nothing to attack is the honest answer, and
    // falling back to the box's own accounts here is exactly the failure this door
    // exists to avoid: root can delete this file, and a tamperer must not be able to
    // turn the database door into a second shell door.
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const box = accountsWithPasswords(host, KNOWN_POOL);
    const { deps, upsertPatch } = makeDeps({
      wordlist: box.map((account) => account.password),
      findPatches: async () => ({ data: [datadirRow(null)], error: null }),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cracked: [], wordlistFound: true });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('exposes no accounts when the datadir holds something that is not a database', async () => {
    // A hand-edited datadir reads back as no database at all, the same as a missing
    // one. The tamperer learns nothing about how their edit failed, and the sweep
    // records nothing — an attempt that was never made must not appear in the log.
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const box = accountsWithPasswords(host, KNOWN_POOL);
    const { deps, upsertPatch } = makeDeps({
      wordlist: box.map((account) => account.password),
      findPatches: async () => ({
        data: [datadirRow(JSON.stringify({ name: 'shop_prod', tables: {} }))],
        error: null,
      }),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cracked: [], wordlistFound: true });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('still sweeps /etc/passwd when the door asked for is ssh', async () => {
    // The control, on the SAME box: teaching the database door to read its datadir
    // must not move the door every shipped trace already depends on.
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const box = accountsWithPasswords(host, KNOWN_POOL);
    const { deps } = makeDeps({ wordlist: box.map((account) => account.password) });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, service: 'ssh' }),
      deps,
    );

    expect(response.body.cracked).toEqual(box);
  });

  it('keeps a box-s shell and its database behind two different keys', async () => {
    // The two locks are drawn on separate streams, so neither is a step toward the
    // other: a player who has rooted the box still has to sweep the database, and a
    // player holding the database still has to get onto the box. Both directions are
    // checked, because a shared stream would leak either way round.
    //
    // Each sweep is given the OTHER door's entire set of passwords — not a wordlist
    // that merely fails, but the one that would open the box next door. The disjoint
    // check is what keeps that meaningful: if the two ever drew the same password for
    // the same box, these sweeps would be handed their own key and the claim would
    // quietly stop being tested.
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const shellPasswords = accountsWithPasswords(host, KNOWN_POOL).map(
      (account) => account.password,
    );
    const databasePasswords = databaseAccountsWithPasswords(host, KNOWN_POOL).map(
      (account) => account.password,
    );
    const shell = makeDeps({ wordlist: databasePasswords });
    const database = makeDeps({ wordlist: shellPasswords });

    const throughTheShell = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, service: 'ssh' }),
      shell.deps,
    );
    const throughTheDatabase = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, service: 'mysql' }),
      database.deps,
    );

    expect(shellPasswords.filter((password) => databasePasswords.includes(password))).toEqual([]);
    expect(shellPasswords.length).toBeGreaterThan(0);
    expect(databasePasswords.length).toBeGreaterThan(0);
    expect(throughTheShell.body.cracked).toEqual([]);
    expect(throughTheDatabase.body.cracked).toEqual([]);
  });
});

/**
 * How often a database account falls is a property of the WORLD, not of a box. One
 * host proves nothing about a one-in-eight chance, and two sampled hosts prove less
 * than they look like they do — a curve read off a sample small enough to be lucky is
 * a curve that can be retuned to anything without a test noticing.
 *
 * So this block sweeps a population and reads the rates off it. The sweep is the real
 * one: the accounts come from the catalog row the mysql door actually consults, and
 * they are cracked by the same `sweepAccounts` the handler runs, against the wordlist
 * a player starts the game holding. What is left out is only the envelope — that the
 * handler hands back exactly this sweep is asserted per-host above, and signing eight
 * hundred networks' worth of requests to re-assert it would buy nothing.
 */
describe('the database difficulty curve (which database accounts a starting wordlist opens)', () => {
  /** What one box's database door yields to a player holding nothing but the wordlist
   *  the game ships with. The box itself is discarded — only its verdict is kept. */
  type DatabaseDoor = {
    readonly where: string;
    readonly usernames: readonly string[];
    readonly fell: readonly string[];
  };

  /** Eight hundred networks, swept ONCE for the whole block.
   *
   *  A LAN carries a handful of boxes and only some of them run a database, so a
   *  population wide enough to put a 0.12 rate on a real footing has to come from
   *  many networks rather than many addresses on one. This yields several hundred
   *  databases — enough that the retunings that matter (the knobs swapped, a roll
   *  flipped, every account crackable, none) land outside every band below.
   *
   *  Computed once for the reason the generation populations are: regenerating it per
   *  test is quick in an ordinary run but slow enough under mutation instrumentation
   *  to race Stryker's timeout, which scores a surviving mutant as killed and makes
   *  the number a measure of the machine rather than of the tests. Deterministic and
   *  read-only, so sharing it across tests couples nothing. */
  const DATABASE_DOORS: readonly DatabaseDoor[] = Array.from(
    { length: 800 },
    (_unused, index) => `POPULATION-NET-${index}`,
  ).flatMap((essid) =>
    generateHomeLan(essid)
      .hosts.filter(
        (host) =>
          host.kind === 'machine' &&
          hostServices(essid, host).some(({ spec }) => spec === SERVICE_CATALOG.mysql),
      )
      .map((host) => {
        const { baseFs } = resolveLanHostIdentity(host, essid);
        const accounts = SERVICE_CATALOG.mysql.accountsOn(baseFs);
        const { cracked } = sweepAccounts({
          accounts,
          username: undefined,
          wordlist: formatWordlist(DEFAULT_WORDLIST),
          hostname: host.hostname,
          fromIp: ATTACKER_IP,
          stamp: FIXED_NOW,
          formatAttempt: formatMysqlAttemptLine,
          database: SERVICE_CATALOG.mysql.databaseOn?.(baseFs),
        });
        return {
          where: `${essid} ${host.ip}`,
          usernames: accounts.map((account) => account.username),
          fell: cracked.map((credential) => credential.username),
        };
      }),
  );

  /** The application account is the rung with no fixed name: `root` and `readonly`
   *  are called what they are called on every box, and whatever else the ladder holds
   *  is the account the box's own software connects as. */
  const isAppAccount = (username: string): boolean =>
    username !== 'root' && username !== 'readonly';

  const doorsHolding = (username: string): readonly DatabaseDoor[] =>
    DATABASE_DOORS.filter((door) => door.usernames.includes(username));

  const doorsOpenedAt = (username: string): readonly DatabaseDoor[] =>
    DATABASE_DOORS.filter((door) => door.fell.includes(username));

  const appAccountsOpened = DATABASE_DOORS.filter((door) =>
    door.fell.some(isAppAccount),
  ).length;

  /** A complaint kept small however wrong the world turns out to be: a failure that
   *  renders several hundred generated databases takes longer to print than the suite
   *  takes to run, and under mutation instrumentation that reads as a timeout rather
   *  than a kill. A count and three examples fail just as loudly. */
  const noneOf = (
    offenders: readonly string[],
  ): { readonly count: number; readonly sample: readonly string[] } => ({
    count: offenders.length,
    sample: offenders.slice(0, 3),
  });

  const NONE = { count: 0, sample: [] };

  const share = (fraction: number): number => Math.round(DATABASE_DOORS.length * fraction);

  it('puts a real ladder behind every database door a box advertises', () => {
    // The guard the rates below stand on. A box whose scan reports 3306 but whose
    // datadir yields no accounts is a door that cannot be knocked on, and it would
    // also quietly shrink the denominator every rate here is measured against — so a
    // curve could be moved by boxes going missing rather than by passwords changing.
    //
    // The shape is asserted at the same time because the tiers below are read off it:
    // exactly one `root`, at most one `readonly`, and one further account that is
    // neither. Two accounts sharing a name, or an application account called `root`,
    // would put a credential in a tier it does not belong to and move the curve
    // without moving a single password.
    const misshapen = DATABASE_DOORS.filter(
      (door) =>
        door.usernames.filter((username) => username === 'root').length !== 1 ||
        door.usernames.filter((username) => username === 'readonly').length > 1 ||
        new Set(door.usernames).size !== door.usernames.length ||
        door.usernames.filter(isAppAccount).length !== 1,
    ).map((door) => door.where);

    expect(DATABASE_DOORS.length).toBeGreaterThan(400);
    expect(noneOf(misshapen)).toEqual(NONE);
  });

  it('opens every read-only account in the world, without exception', () => {
    // Not a probability — the always-open door. `readonly` exists on about half the
    // databases in the world, and every one that exists falls to the list a player
    // starts with. It is the rung that makes a database readable at all, so a single
    // survivor would be a box a player can find, scan, and never get into.
    //
    // The count guards the claim from passing by emptiness: "every one of none fell"
    // is true of a world with no read-only accounts in it.
    const held = doorsHolding('readonly');
    const shut = held.filter((door) => !door.fell.includes('readonly')).map((door) => door.where);

    expect(held.length).toBeGreaterThan(100);
    expect(noneOf(shut)).toEqual(NONE);
  });

  it('lets the application account fall on most databases — a swept LAN yields a writer', () => {
    // The rung that makes a database WRITABLE, and the one a player meets most often.
    // The band excludes every account crackable (every door), none (0), the roll
    // flipped (~0.30), and the root and application knobs wired to each other (~0.12).
    expect(appAccountsOpened).toBeGreaterThan(share(0.63));
    expect(appAccountsOpened).toBeLessThan(share(0.77));
  });

  it('keeps database root shut on most databases — rooting one is a find, not a routine', () => {
    // What makes the statements only database root may run rare rather than routine.
    // Same band the box's own root is held to, and it excludes the same retunings:
    // every root crackable (every door), none (0), the roll flipped (~0.88), and the
    // knobs swapped (~0.70).
    expect(doorsOpenedAt('root').length).toBeGreaterThan(share(0.09));
    expect(doorsOpenedAt('root').length).toBeLessThan(share(0.15));
  });

  it('makes database root the rarest of the three, and the application account the commonest', () => {
    // The ladder as a player actually experiences it, which is NOT the ladder the
    // per-account chances describe. A `readonly` that exists always falls and an
    // application account only usually does — but half the databases in the world
    // carry no `readonly` at all, so across the world the application account is the
    // credential a sweep hands back most often. Stating the order the other way round
    // is the mistake this test exists to prevent.
    expect(doorsOpenedAt('root').length).toBeLessThan(doorsOpenedAt('readonly').length);
    expect(doorsOpenedAt('readonly').length).toBeLessThan(appAccountsOpened);
  });
});
