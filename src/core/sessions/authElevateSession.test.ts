import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthElevateSession,
  type AuthElevateSessionDeps,
  type SuSessionRow,
} from './authElevateSession.js';
import type { OccupantWorkstation } from './stoodOnBox.js';
import { workstationGuestHash } from '../generation/workstationFs.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { baseFsForLanHost, machineIdForLanHost } from '../generation/lanHostIdentity.js';
import { seedApGatewayAdminHash } from '../generation/routerFs.js';
import { npcUsername } from '../generation/remoteHostFs.js';
import { computeApGatewayId } from '../identity/router.js';
import { accountIn } from './passwdAccount.js';
import type { OwnerPatchRow } from '../network/materializeMachineFs.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { md5 } from '../generation/md5.js';
import { asAbsPath, asGameTime, type UserType } from '../types.js';
import { createFsView } from '../filesystem/fsView.js';
import type { Directory } from '../filesystem/types.js';
import { buildOccupantWorkstationFs } from '../patches/remoteWritePermission.js';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSuAuthLine,
} from '../logging/authLog.js';
import { derivePid } from '../logging/syslog.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { FindActiveSession, StandingSession } from '../patches/authorizeMachineAccess.js';
import { ALL_GENERATED_PASSWORDS, plaintextFor } from '../../test/passwords.js';

/**
 * `handleAuthElevateSession` answers `su` on a box that is not the caller's own. The
 * caller already holds a shell there; the handler finds the box from that shell's
 * session row (the network's own gateway, a machine it generates, or another player's
 * workstation), reads it as its journal leaves it, checks the typed password against its
 * `/etc/passwd`, and on success inserts a `kind:'su'` row at the account's tier.
 *
 * Why the server: a write is authorized at the ACTIVE session row's tier, so a switch
 * made only in the browser leaves the next write judged at the tier beneath it.
 * Unknown-user and wrong-password collapse to one 401.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const MACHINE = 'skylab-deadbeef';
// 2026-06-19 12:00:00 UTC — the server clock the su auth.log line is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 19, 12, 0, 0);
// A's identity → owner_key; the guest password is seeded from it, so the dev (and
// a future cracker) recovers it from `workstationGuestHash`.
const OWNER = generateIdentity();
const OCCUPANT: OccupantWorkstation = {
  owner_key: OWNER.publicKeyHex,
  workstation_machine_id: MACHINE,
  essid: 'BEAN-THERE-WIFI',
  workstation_username: 'neo',
  workstation_machine_name: 'nebuchadnezzar',
  workstation_root_hash: md5('matrix1999'),
};
const GUEST_PW = plaintextFor(workstationGuestHash(OWNER.publicKeyHex));
// Where the attacker's ssh login onto the box came from, as the server stamped it.
const SSH_LOGIN_IP = '198.51.100.23';
const ESSID = 'BEAN-THERE-WIFI';

/** The attacker's guest shell on the box, the one `su` is typed into. */
const sshedInAsGuest: FindActiveSession<StandingSession> = async () => ({
  data: { username: 'guest', userType: 'guest', essid: 'BEAN-THERE-WIFI', sourceIp: SSH_LOGIN_IP },
  error: null,
});

/** The caller's shell on the box as some other account, at that account's tier. */
const standingAs =
  (username: string, userType: UserType): FindActiveSession<StandingSession> =>
  async () => ({
    data: { username, userType, essid: ESSID, sourceIp: SSH_LOGIN_IP },
    error: null,
  });

type LookupResult = { data: OccupantWorkstation | null; error: unknown };
type JournalResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

/** A machine the network itself generates: nobody's workstation, so no occupancy row
 *  names it, and the only thing that says where it is is the session opened on it. */
const NPC_HOST = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'machine')!;
const NPC_MACHINE = machineIdForLanHost(NPC_HOST, ESSID);
const NPC_TREE = baseFsForLanHost(NPC_HOST, ESSID);

/** The password a generated account was given. The generator keeps only the hash, and
 *  every password it draws comes from one pool, so the pool is where to find it. */
const generatedPassword = (username: string): string => {
  const hash = accountIn(NPC_TREE, username)?.hash;
  const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === hash);
  if (password === undefined) throw new Error(`no generated password for ${username}`);
  return password;
};

/** The journal of a box whose `/etc/passwd` somebody rewrote: `username` now answers to
 *  `password`, and to nothing it was generated with. */
const passwdChangedTo = (
  tree: Directory,
  username: string,
  password: string,
): (() => Promise<JournalResult>) => {
  const passwd = createFsView(tree, { userType: 'root' }).read(asAbsPath('/etc/passwd'));
  const before = accountIn(tree, username)?.hash;
  if (!passwd.ok || before === undefined) throw new Error(`no ${username} row to change`);
  return async () => ({
    data: [
      {
        path: '/etc/passwd',
        content: passwd.content.replace(before, md5(password)),
        owner: 'root',
        permissions: null,
        node_type: 'file',
        updated_at: '2026-06-19T11:00:00.000Z',
        writer_key: 'whoever-changed-it',
      },
    ],
    error: null,
  });
};

const nobodysWorkstation = async (): Promise<LookupResult> => ({ data: null, error: null });

/** Overrides for the deps a test varies. Defaults: a guest shell on the box, an empty
 *  journal, the fixed server clock, an empty auth.log (a resolved attempt appends one
 *  line), and a successful write. */
type LogOverrides = {
  findActiveSession?: FindActiveSession<StandingSession>;
  findPatches?: () => Promise<JournalResult>;
  now?: () => number;
  readAuthLog?: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  upsertPatch?: (row: PatchRow) => Promise<{ error: unknown }>;
};

const makeDeps = (
  lookup: () => Promise<LookupResult> = async () => ({ data: OCCUPANT, error: null }),
  insert: () => Promise<{ error: unknown }> = async () => ({ error: null }),
  over: LogOverrides = {},
) => {
  const findOccupantWorkstationByMachineId =
    vi.fn<(machineId: string) => Promise<LookupResult>>(lookup);
  const insertSession = vi.fn<(row: SuSessionRow) => Promise<{ error: unknown }>>(insert);
  const readAuthLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    over.readAuthLog ?? (async () => ({ data: null, error: null })),
  );
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const findActiveSession = vi.fn<FindActiveSession<StandingSession>>(
    over.findActiveSession ?? sshedInAsGuest,
  );
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<JournalResult>>(
    over.findPatches ?? (async () => ({ data: [], error: null })),
  );
  const deps: AuthElevateSessionDeps = {
    nonceStore: freshStore,
    findOccupantWorkstationByMachineId,
    findActiveSession,
    findPatches,
    insertSession,
    now: over.now ?? (() => FIXED_NOW),
    readAuthLog,
    upsertPatch,
  };
  return {
    deps,
    findOccupantWorkstationByMachineId,
    insertSession,
    readAuthLog,
    upsertPatch,
  };
};

const envelope = (id: ReturnType<typeof generateIdentity>, fields: Record<string, unknown>) =>
  signRequest(id, 'suElevate', {
    session_id: 'su-root-1',
    machine_id: MACHINE,
    parent_session_id: 'ssh-guest-seed',
    source_ip: '192.168.1.5',
    ...fields,
  });

/** The su auth.log line the server is expected to stamp for a cross-player attempt
 *  at `FIXED_NOW`, given the workstation hostname + outcome + target/from users. */
const expectedSuLine = (
  outcome: 'success' | 'failure',
  targetUser: string,
  fromUser: string,
  hostname: string = OCCUPANT.workstation_machine_name,
): string =>
  formatSuAuthLine({
    outcome,
    targetUser,
    fromUser,
    hostname,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

describe('handleAuthElevateSession', () => {
  it('elevates on a machine the network generates, found from the session held on it', async () => {
    const visitor = generateIdentity();
    const { deps, insertSession } = makeDeps(nobodysWorkstation);

    const result = await handleAuthElevateSession(
      envelope(visitor, {
        machine_id: NPC_MACHINE,
        username: 'root',
        password: generatedPassword('root'),
      }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true, userType: 'root' } });
    expect(insertSession.mock.calls.map(([row]) => row)).toEqual([
      {
        session_id: 'su-root-1',
        player_key: visitor.publicKeyHex,
        machine_id: NPC_MACHINE,
        credentials: { username: 'root', userType: 'root' },
        parent_session_id: 'ssh-guest-seed',
        source_ip: SSH_LOGIN_IP,
        kind: 'su',
        essid: ESSID,
      },
    ]);
  });

  it("elevates on the access point's own gateway, which belongs to no occupant", async () => {
    const visitor = generateIdentity();
    const { deps, insertSession } = makeDeps(nobodysWorkstation);

    const result = await handleAuthElevateSession(
      envelope(visitor, {
        machine_id: computeApGatewayId(ESSID),
        username: 'root',
        password: plaintextFor(seedApGatewayAdminHash(ESSID)),
      }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true, userType: 'root' } });
    expect(insertSession.mock.calls.map(([row]) => row)).toMatchObject([
      { machine_id: computeApGatewayId(ESSID), essid: ESSID, kind: 'su' },
    ]);
  });

  describe('a box whose passwd the journal changed', () => {
    const BOXES = [
      {
        box: 'a generated machine',
        machineId: NPC_MACHINE,
        lookup: nobodysWorkstation,
        tree: NPC_TREE,
        generated: generatedPassword('root'),
      },
      {
        box: "another player's workstation",
        machineId: MACHINE,
        lookup: undefined,
        tree: buildOccupantWorkstationFs(OCCUPANT),
        generated: 'matrix1999',
      },
    ];

    it.each(BOXES)('answers to the new password on $box', async ({ machineId, lookup, tree }) => {
      const { deps, insertSession } = makeDeps(lookup, undefined, {
        findPatches: passwdChangedTo(tree, 'root', 'changed-since'),
      });

      const result = await handleAuthElevateSession(
        envelope(generateIdentity(), {
          machine_id: machineId,
          username: 'root',
          password: 'changed-since',
        }),
        deps,
      );

      expect(result).toEqual({ status: 200, body: { ok: true, userType: 'root' } });
      expect(insertSession).toHaveBeenCalledTimes(1);
      expect(deps.findPatches).toHaveBeenCalledWith({ machine_id: machineId });
    });

    it.each(BOXES)(
      'no longer answers to the password $box was generated with',
      async ({ machineId, lookup, tree, generated }) => {
        const { deps, insertSession } = makeDeps(lookup, undefined, {
          findPatches: passwdChangedTo(tree, 'root', 'changed-since'),
        });

        const result = await handleAuthElevateSession(
          envelope(generateIdentity(), {
            machine_id: machineId,
            username: 'root',
            password: generated,
          }),
          deps,
        );

        expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
        expect(insertSession).not.toHaveBeenCalled();
      },
    );

    it('reports a server error when the journal cannot be read, rather than judging without it', async () => {
      const { deps, insertSession, upsertPatch } = makeDeps(undefined, undefined, {
        findPatches: async () => ({ data: null, error: new Error('db down') }),
      });

      const result = await handleAuthElevateSession(
        envelope(generateIdentity(), { username: 'root', password: 'matrix1999' }),
        deps,
      );

      expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
      expect(insertSession).not.toHaveBeenCalled();
      expect(upsertPatch).not.toHaveBeenCalled();
    });
  });

  it("elevates to root against the reconstructed workstation and inserts a su session on the owner's real machine id", async () => {
    const attacker = generateIdentity();
    const { deps, findOccupantWorkstationByMachineId, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'root' });
    expect(findOccupantWorkstationByMachineId).toHaveBeenCalledWith(MACHINE);
    expect(insertSession).toHaveBeenCalledTimes(1);
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      session_id: 'su-root-1',
      player_key: attacker.publicKeyHex,
      machine_id: MACHINE,
      credentials: { username: 'root', userType: 'root' },
      parent_session_id: 'ssh-guest-seed',
      // su crosses no wire: the elevated shell came from wherever the ssh login under
      // it came from, so it carries that login's address on — never the client's — and
      // a reboot from the root shell names the same visitor the auth.log does.
      source_ip: SSH_LOGIN_IP,
      kind: 'su',
      essid: 'BEAN-THERE-WIFI',
    });
  });

  it("reads the address off the caller's own shell on that box, not anybody else's", async () => {
    const attacker = generateIdentity();
    const { deps } = makeDeps();

    await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(deps.findActiveSession).toHaveBeenCalledWith({
      player_key: attacker.publicKeyHex,
      machine_id: MACHINE,
    });
  });

  it('opens the elevated shell on the network the shell under it was opened on', async () => {
    // One player on several access points has an occupancy row on each, all naming the
    // same workstation, and the lookup answers with any of them.
    const { deps, insertSession } = makeDeps(async () => ({
      data: { ...OCCUPANT, essid: 'SOME-OTHER-WIFI' },
      error: null,
    }));

    await handleAuthElevateSession(
      envelope(generateIdentity(), { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(insertSession.mock.calls.map(([row]) => row.essid)).toEqual([ESSID]);
  });

  it('refuses a caller who holds no session on the box, whatever password they know', async () => {
    const stranger = generateIdentity();
    const { deps, insertSession, upsertPatch, findOccupantWorkstationByMachineId } = makeDeps(
      undefined,
      undefined,
      { findActiveSession: async () => ({ data: null, error: null }) },
    );

    const result = await handleAuthElevateSession(
      envelope(stranger, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(insertSession).not.toHaveBeenCalled();
    // Nothing about the box is read or written for somebody who is not on it.
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
    expect(deps.findPatches).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('reports a server error when the session lookup fails, rather than a refusal', async () => {
    const { deps, insertSession } = makeDeps(undefined, undefined, {
      findActiveSession: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleAuthElevateSession(
      envelope(generateIdentity(), { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('derives the userType from the passwd (a valid guest credential yields a guest session, not root)', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'guest' });
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      credentials: { username: 'guest', userType: 'guest' },
      kind: 'su',
    });
  });

  it('rejects a wrong root password as invalid_credentials without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'not-the-root-pw' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown username as invalid_credentials without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'ghost', password: 'whatever' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  describe('a session that is already root', () => {
    it('switches to an account on a generated machine without its password', async () => {
      const visitor = generateIdentity();
      const account = npcUsername(ESSID, NPC_HOST);
      const { deps, insertSession } = makeDeps(nobodysWorkstation, undefined, {
        findActiveSession: standingAs('root', 'root'),
      });

      const result = await handleAuthElevateSession(
        envelope(visitor, { machine_id: NPC_MACHINE, username: account, password: '' }),
        deps,
      );

      expect(result).toEqual({ status: 200, body: { ok: true, userType: 'user' } });
      expect(insertSession.mock.calls.map(([row]) => row)).toMatchObject([
        { machine_id: NPC_MACHINE, credentials: { username: account, userType: 'user' } },
      ]);
    });

    it("becomes the owner's passwordless user on a workstation", async () => {
      const { deps, insertSession } = makeDeps(undefined, undefined, {
        findActiveSession: standingAs('root', 'root'),
      });

      const result = await handleAuthElevateSession(
        envelope(generateIdentity(), { username: 'neo', password: '' }),
        deps,
      );

      expect(result).toEqual({ status: 200, body: { ok: true, userType: 'user' } });
      expect(insertSession.mock.calls.map(([row]) => row)).toMatchObject([
        { credentials: { username: 'neo', userType: 'user' } },
      ]);
    });

    it('still cannot become an account the box does not have', async () => {
      const { deps, insertSession } = makeDeps(undefined, undefined, {
        findActiveSession: standingAs('root', 'root'),
      });

      const result = await handleAuthElevateSession(
        envelope(generateIdentity(), { username: 'ghost', password: '' }),
        deps,
      );

      expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
      expect(insertSession).not.toHaveBeenCalled();
    });
  });

  it('asks a user-tier session for the password, as it asks a guest', async () => {
    const { deps, insertSession } = makeDeps(undefined, undefined, {
      findActiveSession: standingAs('neo', 'user'),
    });

    const result = await handleAuthElevateSession(
      envelope(generateIdentity(), { username: 'root', password: 'not-the-root-pw' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it("refuses to elevate to the owner's passwordless user (empty hash is unauthenticatable)", async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    // 'neo' is the owner's own user — empty hash. md5(anything) is never '', so no
    // password can ever match; a cross-player attacker can't ride the owner's
    // passwordless convenience account up to that account.
    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'neo', password: '' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports host_unreachable when the target is on no network, without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession, findOccupantWorkstationByMachineId } = makeDeps(async () => ({
      data: null,
      error: null,
    }));

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findOccupantWorkstationByMachineId).toHaveBeenCalledWith(MACHINE);
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('elevates against the occupant row that says whose box this is', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession, findOccupantWorkstationByMachineId } = makeDeps(async () => ({
      data: OCCUPANT,
      error: null,
    }));

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'root' });
    expect(findOccupantWorkstationByMachineId).toHaveBeenCalledWith(MACHINE);
    expect(insertSession.mock.calls[0]![0]).toMatchObject({ machine_id: MACHINE, kind: 'su' });
  });

  it('reports a server error when the occupancy lookup fails', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps(async () => ({
      data: null,
      error: new Error('db down'),
    }));

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'occupant_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the session insert fails', async () => {
    const attacker = generateIdentity();
    const { deps } = makeDeps(undefined, async () => ({ error: new Error('insert boom') }));

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });

  it('rejects an envelope that smuggles a client-supplied player_key without looking up or inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findOccupantWorkstationByMachineId, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999', player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied userType (the server derives the tier) without looking up or inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findOccupantWorkstationByMachineId, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999', userType: 'root' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();
    const signed = envelope(attacker, { username: 'root', password: 'matrix1999' });
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleAuthElevateSession(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the machine id without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      signRequest(attacker, 'suElevate', {
        session_id: 'su-root-1',
        username: 'root',
        password: 'matrix1999',
      }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(insertSession).not.toHaveBeenCalled();
  });

  // A resolved su attempt leaves a truthful auth.log trace on the box. Keystone: the
  // line is written under the key that owns the BOX's logs (the system owns its logs) so
  // several visitors' rows don't collapse under the last-write-wins fold — who it was
  // lives in the line content (the `from` user), never in writer_key. An unknown
  // machine_id (404) logs nothing (there is no reachable box to log on). su lines carry
  // no source IP.
  describe('su trace', () => {
    it("appends ONE 'Successful su' line on the WORKSTATION record under the OWNER's writer_key", async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps();

      const result = await handleAuthElevateSession(
        envelope(attacker, { username: 'root', password: 'matrix1999' }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(upsertPatch).toHaveBeenCalledTimes(1);
      expect(upsertPatch.mock.calls[0]![0]).toEqual({
        writer_key: OCCUPANT.owner_key,
        machine_id: MACHINE,
        path: AUTH_LOG_PATH,
        content: `${expectedSuLine('success', 'root', 'guest')}\n`,
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
        node_type: 'file',
      });
      // The provenance is the OWNER, never the attacker — the keystone.
      expect(upsertPatch.mock.calls[0]![0].writer_key).not.toBe(attacker.publicKeyHex);
    });

    it('appends a "FAILED su" line on a wrong password and still returns 401 without inserting', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch, insertSession } = makeDeps();

      const result = await handleAuthElevateSession(
        envelope(attacker, { username: 'root', password: 'not-the-root-pw' }),
        deps,
      );

      expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
      expect(insertSession).not.toHaveBeenCalled();
      expect(upsertPatch.mock.calls[0]![0].content).toBe(
        `${expectedSuLine('failure', 'root', 'guest')}\n`,
      );
    });

    it('names the account the session row holds, not one the request claims', async () => {
      const { deps, upsertPatch } = makeDeps(undefined, undefined, {
        findActiveSession: standingAs('trinity', 'user'),
      });

      await handleAuthElevateSession(
        envelope(generateIdentity(), {
          username: 'root',
          password: 'matrix1999',
          from_user: 'mallory',
        }),
        deps,
      );

      expect(upsertPatch.mock.calls.map(([row]) => row.content)).toEqual([
        `${expectedSuLine('success', 'root', 'trinity')}
`,
      ]);
    });

    it("files a generated machine's line under the network's key, in the box's own name", async () => {
      const visitor = generateIdentity();
      const { deps, upsertPatch } = makeDeps(nobodysWorkstation);

      await handleAuthElevateSession(
        envelope(visitor, { machine_id: NPC_MACHINE, username: 'root', password: 'wrong' }),
        deps,
      );

      expect(upsertPatch.mock.calls.map(([row]) => row)).toEqual([
        {
          writer_key: apGatewayLogWriterKey(ESSID),
          machine_id: NPC_MACHINE,
          path: AUTH_LOG_PATH,
          content: `${expectedSuLine('failure', 'root', 'guest', NPC_HOST.hostname)}
`,
          owner: AUTH_LOG_OWNER,
          permissions: AUTH_LOG_PERMISSIONS,
          node_type: 'file',
        },
      ]);
    });

    it('writes no auth.log line for an unregistered machine id (404, nothing to log on)', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps(async () => ({ data: null, error: null }));

      const result = await handleAuthElevateSession(
        envelope(attacker, { username: 'root', password: 'matrix1999' }),
        deps,
      );

      expect(result.status).toBe(404);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('skips the write when the auth.log read fails (RMW bails), and still elevates', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps(undefined, undefined, {
        readAuthLog: async () => ({ data: null, error: new Error('log read down') }),
      });

      const result = await handleAuthElevateSession(
        envelope(attacker, { username: 'root', password: 'matrix1999' }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('returns the auth result even when the log write throws (best-effort logging)', async () => {
      const attacker = generateIdentity();
      const { deps, insertSession } = makeDeps(undefined, undefined, {
        upsertPatch: async () => {
          throw new Error('write blew up');
        },
      });

      const result = await handleAuthElevateSession(
        envelope(attacker, { username: 'root', password: 'matrix1999' }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ ok: true, userType: 'root' });
      expect(insertSession).toHaveBeenCalledTimes(1);
    });
  });
});
