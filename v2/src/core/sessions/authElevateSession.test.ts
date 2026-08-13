import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthElevateSession,
  type AuthElevateSessionDeps,
  type OccupantWorkstation,
  type SuSessionRow,
} from './authElevateSession';
import { workstationGuestPassword } from '../generation/workstationFs';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { md5 } from '../generation/md5';
import { asGameTime } from '../types';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSuAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleAuthElevateSession` is the server-authoritative `su`-to-root gate for a
 * CROSS-PLAYER hop (Story 4, slice 1). B, already ssh'd into A's box as guest,
 * runs `su` → this resolves A's REGISTERED workstation by its `machine_id`,
 * RECONSTRUCTS A's box from the persisted identity (owner_key + username +
 * md5(rootPassword)), validates the typed password against A's REAL `/etc/passwd`,
 * and on success inserts a root-tier `kind:'su'` session row for B on A's box.
 *
 * Why server-authoritative: the patch write path (L2) authorizes at the ACTIVE
 * session row's tier — a client-only `su` pushes a local session but no row, so
 * L2 would still see guest. Only a real `kind:'su'` root row makes B's later
 * writes authorize at root. Unknown-user and wrong-password collapse to one 401.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const MACHINE = 'skylab-deadbeef';
// 2026-06-19 12:00:00 UTC — the server clock the su auth.log line is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 19, 12, 0, 0);
// A's identity → owner_key; the guest password is seeded from it, so the dev (and
// a future cracker) recovers it via `workstationGuestPassword`.
const OWNER = generateIdentity();
const OCCUPANT: OccupantWorkstation = {
  owner_key: OWNER.publicKeyHex,
  workstation_machine_id: MACHINE,
  essid: 'BEAN-THERE-WIFI',
  workstation_username: 'neo',
  workstation_machine_name: 'nebuchadnezzar',
  workstation_root_hash: md5('matrix1999'),
};
const GUEST_PW = workstationGuestPassword(OWNER.publicKeyHex);

type LookupResult = { data: OccupantWorkstation | null; error: unknown };

/** Overrides for the system-logging deps (Story 6.3). Defaults: the fixed server
 *  clock, an empty auth.log (a resolved attempt appends one line), and a successful
 *  write. (No source-IP lookup — su lines are username-only.) */
type LogOverrides = {
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
  const deps: AuthElevateSessionDeps = {
    nonceStore: freshStore,
    findOccupantWorkstationByMachineId,
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
    from_user: 'guest',
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
): string =>
  formatSuAuthLine({
    outcome,
    targetUser,
    fromUser,
    hostname: OCCUPANT.workstation_machine_name,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

describe('handleAuthElevateSession', () => {
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
      source_ip: '192.168.1.5',
      kind: 'su',
      essid: 'BEAN-THERE-WIFI',
    });
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

  // Story 6.3: a resolved cross-player su attempt leaves a truthful auth.log trace on
  // A's shared WORKSTATION record. Keystone (decision 1): the line is written under the
  // TARGET OWNER's writer_key (the system owns its logs) so multi-attacker rows don't
  // collapse under the last-write-wins fold — the attacker's identity lives in the line
  // content (the `from` user), never in writer_key. An unknown machine_id (404) logs
  // nothing (there is no reachable box to log on). su lines carry no source IP.
  describe('cross-player su trace', () => {
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

    it('carries the from_user from the payload into the line (not a hardcoded user)', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps();

      await handleAuthElevateSession(
        envelope(attacker, { username: 'root', password: 'matrix1999', from_user: 'mallory' }),
        deps,
      );

      const content = upsertPatch.mock.calls[0]![0].content;
      expect(content).toContain('by mallory');
      expect(content).not.toContain('by guest');
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

    it('rejects an envelope missing from_user without looking up, inserting, or logging', async () => {
      const attacker = generateIdentity();
      const { deps, findOccupantWorkstationByMachineId, insertSession, upsertPatch } = makeDeps();

      const result = await handleAuthElevateSession(
        signRequest(attacker, 'suElevate', {
          session_id: 'su-root-1',
          machine_id: MACHINE,
          username: 'root',
          password: 'matrix1999',
        }),
        deps,
      );

      expect(result.status).toBe(400);
      expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
      expect(insertSession).not.toHaveBeenCalled();
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
