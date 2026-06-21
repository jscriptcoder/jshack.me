import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthCreateSessionSameLan,
  type AuthCreateSessionSameLanDeps,
  type OccupantConnectRow,
} from './authCreateSessionSameLan';
import type { AuthSessionRow } from './authCreateSession';
import { md5 } from '../generation/md5';
import { workstationGuestPassword } from '../generation/workstationFs';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { assignHomeNetwork } from '../network/homeNetwork';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import { formatSshdAuthLine, AUTH_LOG_PERMISSIONS } from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import { asGameTime } from '../types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleAuthCreateSessionSameLan` is the same-WiFi LAN connect front door. A fellow
 * occupant B's `ssh <user>@<A's LAN IP>` reaches A directly over the shared LAN — no
 * router, no NAT, no forward. The server reads the ESSID's occupancy, gates on B being
 * a live occupant, matches the target LAN IP to A's occupancy row, materializes A's
 * REAL workstation (base + journal), refuses a dark or non-listening box, and validates
 * the typed password against A's own `/etc/passwd` before landing a session on A's
 * workstation id. Unknown user and wrong password collapse to one 401.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

// B is the connecting occupant (a FIXED identity so its key sits in the occupancy
// rows); A is the target whose box B reaches.
const BOB = generateIdentity();
const ALICE = generateIdentity();

const ESSID = 'BEAN-THERE-WIFI';
const A_WS_ID = 'workstation-skylab01';
const A_WS_NAME = 'skylab';
const B_WS_ID = 'workstation-neb01';
const A_ROOT_HASH = md5('toor');

// A fixed server clock so the stamped auth.log line is deterministic in assertions.
const FIXED_NOW = 1_750_000_000_000;

// Both occupants' LAN IPs are pure functions of (owner_key, essid) — the same
// derivation the server re-runs to match a target IP to its occupant.
const A_LAN_IP = assignHomeNetwork(ALICE.publicKeyHex, ESSID).localIp;
const B_LAN_IP = assignHomeNetwork(BOB.publicKeyHex, ESSID).localIp;
// A's deterministic weak guest password — the credential B types to land a guest shell.
const GUEST_PW = workstationGuestPassword(ALICE.publicKeyHex);

const A_ROW: OccupantConnectRow = {
  owner_key: ALICE.publicKeyHex,
  workstation_machine_id: A_WS_ID,
  workstation_machine_name: A_WS_NAME,
  workstation_username: 'neo',
  workstation_root_hash: A_ROOT_HASH,
};
const B_ROW: OccupantConnectRow = {
  owner_key: BOB.publicKeyHex,
  workstation_machine_id: B_WS_ID,
  workstation_machine_name: 'neb',
  workstation_username: 'trinity',
  workstation_root_hash: md5('whatever'),
};
const OCCUPANTS: readonly OccupantConnectRow[] = [A_ROW, B_ROW];

/** A started the workstation's sshd — its pidfile on the ws journal makes `:22` a live
 *  service (a fresh ws has an empty `/var/run`, so a same-LAN ssh is refused until). */
const wsSshdUp: OwnerPatchRow = {
  path: '/var/run/sshd.pid',
  content: 'sshd:port=22',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-19T00:00:00.000Z',
  writer_key: ALICE.publicKeyHex,
};

/** A root `rm /boot/vmlinuz` tombstone — replayed over A's seeded base it deletes the
 *  kernel so `canBoot` reports the box bricked (dark to a same-LAN login). */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-19T00:00:00.000Z',
  writer_key: ALICE.publicKeyHex,
};

type OccupantsResult = { data: readonly OccupantConnectRow[] | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const makeDeps = (
  occupants: () => Promise<OccupantsResult> = async () => ({ data: OCCUPANTS, error: null }),
  patches: (query: { machine_id: string }) => Promise<PatchesResult> = async () => ({
    data: [wsSshdUp],
    error: null,
  }),
  insert: () => Promise<{ error: unknown }> = async () => ({ error: null }),
  readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult> = async () => ({
    data: null,
    error: null,
  }),
  upsert: (row: PatchRow) => Promise<{ error: unknown }> = async () => ({ error: null }),
) => {
  const listOccupantsByEssid = vi.fn<(essid: string) => Promise<OccupantsResult>>(occupants);
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(patches);
  const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(insert);
  const readAuthLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(readLog);
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(upsert);
  const deps: AuthCreateSessionSameLanDeps = {
    nonceStore: freshStore,
    listOccupantsByEssid,
    findPatches,
    insertSession,
    now: () => FIXED_NOW,
    readAuthLog,
    upsertPatch,
  };
  return { deps, listOccupantsByEssid, findPatches, insertSession, readAuthLog, upsertPatch };
};

/** The sshd auth.log line the server is expected to stamp for a same-LAN attempt at
 *  `FIXED_NOW`, on A's workstation hostname. The source IP defaults to B's LAN IP —
 *  the pure `assignHomeNetwork(B, essid).localIp`, never B's public IP or a client claim. */
const expectedSshdLine = (
  outcome: 'success' | 'failure',
  user: string,
  fromIp: string = B_LAN_IP,
): string =>
  formatSshdAuthLine({
    outcome,
    user,
    fromIp,
    hostname: A_WS_NAME,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

const envelope = (id: ReturnType<typeof generateIdentity>, fields: Record<string, unknown>) =>
  signRequest(id, 'authCreateSessionSameLan', {
    session_id: 'ssh-guest-1',
    essid: ESSID,
    target_ip: A_LAN_IP,
    parent_session_id: 'seed-session',
    source_ip: '192.168.29.50',
    ...fields,
  });

describe('handleAuthCreateSessionSameLan', () => {
  it("lands a guest session on A's workstation when a fellow occupant authenticates", async () => {
    const { deps, listOccupantsByEssid, findPatches, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'guest', machine_id: A_WS_ID });
    expect(listOccupantsByEssid).toHaveBeenCalledWith(ESSID);
    // The journal is read off A's WORKSTATION (the session target), not B's box.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: A_WS_ID });
    expect(insertSession).toHaveBeenCalledTimes(1);
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      session_id: 'ssh-guest-1',
      player_key: BOB.publicKeyHex,
      machine_id: A_WS_ID,
      credentials: { username: 'guest', userType: 'guest' },
      parent_session_id: 'seed-session',
      source_ip: '192.168.29.50',
      kind: 'ssh',
      essid: ESSID,
    });
  });

  it('refuses a caller who is not a live occupant before any password check or journal read', async () => {
    const stranger = generateIdentity();
    const { deps, findPatches, insertSession } = makeDeps();

    // A correct guest password must NOT matter — the LAN-boundary gate decides first.
    const result = await handleAuthCreateSessionSameLan(
      envelope(stranger, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 403, body: { error: 'not_an_occupant' } });
    expect(findPatches).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports host_unreachable when no occupant owns the target LAN IP, without reading the journal or inserting', async () => {
    const { deps, findPatches, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW, target_ip: '10.0.0.99' }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it("reports host_unreachable when B targets its OWN LAN IP (self is excluded — that's the own-LAN path)", async () => {
    const { deps, insertSession } = makeDeps();

    // B's OWN guest password against B's OWN LAN IP: were self not excluded, B's row
    // would match and this would succeed — so a 404 proves the front door skips self.
    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, {
        username: 'guest',
        password: workstationGuestPassword(BOB.publicKeyHex),
        target_ip: B_LAN_IP,
      }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a wrong password as invalid_credentials without inserting', async () => {
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: 'not-the-guest-pw' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown user as invalid_credentials without inserting', async () => {
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'ghost', password: 'anything' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports host_unreachable when the workstation sshd is down, even with a correct password', async () => {
    // A's ws journal is empty → empty /var/run → nothing listening.
    const { deps, insertSession } = makeDeps(undefined, async () => ({ data: [], error: null }));

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it("reports host_unreachable when the workstation serves sshd on a DIFFERENT port than asked", async () => {
    // A's sshd is bound to 22; B asks -p 2222 — the requested port is not listening.
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW, port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses a login to a BRICKED workstation as host_unreachable, even with sshd up and a correct password', async () => {
    const { deps, insertSession } = makeDeps(undefined, async () => ({
      data: [wsSshdUp, bootTombstone],
      error: null,
    }));

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the occupancy lookup fails, without reading the journal or inserting', async () => {
    const { deps, findPatches, insertSession } = makeDeps(async () => ({
      data: null,
      error: new Error('db down'),
    }));

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'occupants_lookup_failed' } });
    expect(findPatches).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the workstation journal lookup fails, without inserting', async () => {
    const { deps, insertSession } = makeDeps(undefined, async () => ({
      data: null,
      error: new Error('db down'),
    }));

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the session insert fails', async () => {
    const { deps } = makeDeps(undefined, undefined, async () => ({ error: new Error('insert boom') }));

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });

  it('rejects an envelope that smuggles a client-supplied player_key without looking up or inserting', async () => {
    const { deps, listOccupantsByEssid, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW, player_key: 'forged' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied owner_key without looking up or inserting', async () => {
    const { deps, listOccupantsByEssid, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionSameLan(
      envelope(BOB, { username: 'guest', password: GUEST_PW, owner_key: 'forged' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without inserting', async () => {
    const { deps, insertSession } = makeDeps();
    const signed = envelope(BOB, { username: 'guest', password: GUEST_PW });
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleAuthCreateSessionSameLan(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target IP without inserting', async () => {
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionSameLan(
      signRequest(BOB, 'authCreateSessionSameLan', {
        session_id: 'ssh-guest-1',
        essid: ESSID,
        username: 'guest',
        password: GUEST_PW,
      }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(insertSession).not.toHaveBeenCalled();
  });

  describe('the connect attempt leaves an auth.log trace on the target box', () => {
    it("appends one 'Accepted' line on A's workstation under A's owner key, sourced from B's LAN IP", async () => {
      const { deps, upsertPatch } = makeDeps();

      const result = await handleAuthCreateSessionSameLan(
        envelope(BOB, { username: 'guest', password: GUEST_PW }),
        deps,
      );

      expect(result.status).toBe(200);
      // Owner-keyed (writer = A, not the connecting B) on A's workstation record, so
      // multiple actors' lines accrete into ONE row — the Story-6 keystone. The
      // attacker's identity lives in the line's source IP, never the writer_key.
      expect(upsertPatch).toHaveBeenCalledTimes(1);
      expect(upsertPatch.mock.calls[0]![0]).toEqual({
        writer_key: ALICE.publicKeyHex,
        machine_id: A_WS_ID,
        path: '/var/log/auth.log',
        content: `${expectedSshdLine('success', 'guest')}\n`,
        owner: 'root',
        permissions: AUTH_LOG_PERMISSIONS,
        node_type: 'file',
      });
      expect(upsertPatch.mock.calls[0]![0].writer_key).not.toBe(BOB.publicKeyHex);
    });

    it("appends a 'Failed password' line on a wrong password and still returns 401 without inserting", async () => {
      const { deps, upsertPatch, insertSession } = makeDeps();

      const result = await handleAuthCreateSessionSameLan(
        envelope(BOB, { username: 'guest', password: 'not-the-guest-pw' }),
        deps,
      );

      expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
      expect(upsertPatch).toHaveBeenCalledTimes(1);
      expect(upsertPatch.mock.calls[0]![0].content).toBe(`${expectedSshdLine('failure', 'guest')}\n`);
      expect(insertSession).not.toHaveBeenCalled();
    });

    it("records B's LAN IP — never B's home public IP and never the client-claimed source_ip", async () => {
      const { deps, upsertPatch } = makeDeps();

      await handleAuthCreateSessionSameLan(
        // A forged source_ip in the envelope must be ignored: the source is derived
        // server-side from B's verified key + the ESSID.
        envelope(BOB, { username: 'guest', password: GUEST_PW, source_ip: '203.0.113.200' }),
        deps,
      );

      const content = upsertPatch.mock.calls[0]![0].content as string;
      expect(content).toContain(B_LAN_IP);
      expect(content).not.toContain('203.0.113.200');
      expect(content).not.toContain(assignHomeNetwork(BOB.publicKeyHex, ESSID).publicIp);
    });

    it('appends onto the existing auth.log content rather than clobbering it', async () => {
      const priorLine = expectedSshdLine('failure', 'guest', '192.168.50.9');
      const { deps, upsertPatch } = makeDeps(undefined, undefined, undefined, async () => ({
        data: { content: `${priorLine}\n` },
        error: null,
      }));

      await handleAuthCreateSessionSameLan(
        envelope(BOB, { username: 'guest', password: GUEST_PW }),
        deps,
      );

      expect(upsertPatch.mock.calls[0]![0].content).toBe(
        `${priorLine}\n${expectedSshdLine('success', 'guest')}\n`,
      );
    });

    it('writes no trace when no occupant owns the target LAN IP (nothing reachable to log on)', async () => {
      const { deps, upsertPatch } = makeDeps();

      await handleAuthCreateSessionSameLan(
        envelope(BOB, { username: 'guest', password: GUEST_PW, target_ip: '10.0.0.99' }),
        deps,
      );

      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes no trace when the target workstation sshd is down', async () => {
      const { deps, upsertPatch } = makeDeps(undefined, async () => ({ data: [], error: null }));

      await handleAuthCreateSessionSameLan(
        envelope(BOB, { username: 'guest', password: GUEST_PW }),
        deps,
      );

      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes no trace when the target workstation is bricked', async () => {
      const { deps, upsertPatch } = makeDeps(undefined, async () => ({
        data: [wsSshdUp, bootTombstone],
        error: null,
      }));

      await handleAuthCreateSessionSameLan(
        envelope(BOB, { username: 'guest', password: GUEST_PW }),
        deps,
      );

      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('still authenticates and inserts when the trace write throws (best-effort logging)', async () => {
      const { deps, insertSession } = makeDeps(undefined, undefined, undefined, undefined, async () => {
        throw new Error('log store down');
      });

      const result = await handleAuthCreateSessionSameLan(
        envelope(BOB, { username: 'guest', password: GUEST_PW }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(insertSession).toHaveBeenCalledTimes(1);
    });
  });
});
