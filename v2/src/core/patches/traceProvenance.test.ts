import { describe, expect, it, vi } from 'vitest';
import { resolveTraceProvenance, type TraceProvenanceDeps } from './traceProvenance';
import type { ActiveSession, FindActiveSessionResult } from './authorizeMachineAccess';
import type { OccupantWorkstation } from './remoteWritePermission';
import type {
  FindHomeNetworkByOwnerKey,
  FindPublicIpByEssid,
} from '../logging/crossPlayerSourceIp';
import { computeWorkstationId } from '../identity/workstation';
import { md5 } from '../generation/md5';

/**
 * The one rule deciding whose row a cross-player trace lands in, and which address it
 * names — shared by every endpoint that writes into a machine its caller may not own.
 *
 * Tested here rather than only through the handlers that call it. Both answers are
 * security-relevant: a line filed under the visitor's key instead of the owner's lands in
 * a different row from the login that preceded it, the journal replays with the latest
 * write to a path winning, and the owner reads half a visit while a second visitor
 * quietly erases the first. A rule that consequential earns tests that name it directly,
 * where a failure says which rule broke rather than which endpoint noticed.
 */

const ACTOR_KEY = 'a'.repeat(64);
const OWNER_KEY = 'd'.repeat(64);

const theirBox: OccupantWorkstation = {
  owner_key: OWNER_KEY,
  workstation_username: 'morpheus',
  workstation_root_hash: md5('toor'),
};

const ACTOR_HOME_IP = '198.51.100.22';
const PIVOT_ESSID = 'CAFE-DEL-MAR-GUEST';
const PIVOT_PUBLIC_IP = '203.0.113.199';
const PIVOT_MACHINE = 'workstation-p1v0t000';

const activeSession = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  username: 'guest',
  userType: 'guest',
  essid: 'BEAN-THERE-WIFI',
  ...over,
});

const makeDeps = (over: Partial<TraceProvenanceDeps> = {}) => {
  const findActiveSession = vi.fn<() => Promise<FindActiveSessionResult>>(async () => ({
    data: activeSession({ essid: PIVOT_ESSID }),
    error: null,
  }));
  const findHomeNetworkByOwnerKey = vi.fn<FindHomeNetworkByOwnerKey>(async () => ({
    data: { public_ip: ACTOR_HOME_IP },
    error: null,
  }));
  const findPublicIpByEssid = vi.fn<FindPublicIpByEssid>(async () => ({
    data: { public_ip: PIVOT_PUBLIC_IP },
    error: null,
  }));
  const deps: TraceProvenanceDeps = {
    findActiveSession,
    findHomeNetworkByOwnerKey,
    findPublicIpByEssid,
    ...over,
  };
  return { deps, findActiveSession, findHomeNetworkByOwnerKey, findPublicIpByEssid };
};

describe('a trace on a host nobody owns', () => {
  it('keeps the caller own row and the address they reported', async () => {
    const { deps, findHomeNetworkByOwnerKey } = makeDeps();

    const provenance = await resolveTraceProvenance(deps, {
      actorKey: ACTOR_KEY,
      callerMachineId: undefined,
      claimedIp: '10.0.0.9',
      owner: null,
    });

    // Nobody else writes to a generated host, so the caller's own row IS the record —
    // and the LAN address they report is the only one that box could have seen. Nothing
    // is derived, which is why no lookup is worth paying for.
    expect(provenance).toEqual({ ok: true, writerKey: ACTOR_KEY, fromIp: '10.0.0.9' });
    expect(findHomeNetworkByOwnerKey).not.toHaveBeenCalled();
  });

  it('names an unknown client when the caller is on no network to report', async () => {
    const { deps } = makeDeps();

    const provenance = await resolveTraceProvenance(deps, {
      actorKey: ACTOR_KEY,
      callerMachineId: undefined,
      claimedIp: null,
      owner: null,
    });

    // The action still happened, so the line is still written — with the client named
    // as unknown rather than left blank, which reads as a corrupt log.
    expect(provenance).toEqual({ ok: true, writerKey: ACTOR_KEY, fromIp: 'unknown' });
  });
});

describe('a trace on a box somebody owns', () => {
  it('files under the OWNER key, never the visitor own', async () => {
    const { deps } = makeDeps();

    const provenance = await resolveTraceProvenance(deps, {
      actorKey: ACTOR_KEY,
      callerMachineId: undefined,
      claimedIp: '10.0.0.9',
      owner: theirBox,
    });

    // Under the visitor's key the line lands in a different row from the login that
    // preceded it, and the journal replays with one row winning outright — so the owner
    // reads half a visit, and a second visitor erases the first.
    expect(provenance).toMatchObject({ ok: true, writerKey: OWNER_KEY });
    expect(provenance).not.toMatchObject({ writerKey: ACTOR_KEY });
  });

  it('derives the address from the verified key, ignoring what the caller claimed', async () => {
    const { deps, findHomeNetworkByOwnerKey } = makeDeps();

    const provenance = await resolveTraceProvenance(deps, {
      actorKey: ACTOR_KEY,
      callerMachineId: undefined,
      claimedIp: '10.0.0.9',
      owner: theirBox,
    });

    // The address is the owner's only evidence of who reached them, so a claimed one
    // would let a visitor write somebody else's name on their own visit.
    expect(findHomeNetworkByOwnerKey).toHaveBeenCalledWith(ACTOR_KEY);
    expect(provenance).toEqual({ ok: true, writerKey: OWNER_KEY, fromIp: ACTOR_HOME_IP });
  });

  it('traces an action run from a box the visitor is STANDING on to that network', async () => {
    const { deps, findPublicIpByEssid, findHomeNetworkByOwnerKey } = makeDeps();

    const provenance = await resolveTraceProvenance(deps, {
      actorKey: ACTOR_KEY,
      callerMachineId: PIVOT_MACHINE,
      claimedIp: null,
      owner: theirBox,
    });

    // The visitor's own address never touched the target; the box they launched from is
    // what it actually saw. The ESSID comes off the session row, where the server
    // stamped it when the hop was made — so it is evidence, not a claim.
    expect(findPublicIpByEssid).toHaveBeenCalledWith(PIVOT_ESSID);
    expect(findHomeNetworkByOwnerKey).not.toHaveBeenCalled();
    expect(provenance).toEqual({ ok: true, writerKey: OWNER_KEY, fromIp: PIVOT_PUBLIC_IP });
  });

  it('uses the address the visitor OWNS when the box they launched from is their own', async () => {
    const { deps, findPublicIpByEssid } = makeDeps();

    const provenance = await resolveTraceProvenance(deps, {
      actorKey: ACTOR_KEY,
      callerMachineId: computeWorkstationId('skylab', ACTOR_KEY),
      claimedIp: null,
      owner: theirBox,
    });

    // Reaching out from home is the ordinary case and holds no session row — the own-box
    // bypass hands one back as null. No network being borrowed means the address is the
    // one they own.
    expect(findPublicIpByEssid).not.toHaveBeenCalled();
    expect(provenance).toEqual({ ok: true, writerKey: OWNER_KEY, fromIp: ACTOR_HOME_IP });
  });

  it('refuses a visitor claiming to stand on a box they hold no session on', async () => {
    const { deps } = makeDeps({
      findActiveSession: async () => ({ data: null, error: null }),
    });

    const provenance = await resolveTraceProvenance(deps, {
      actorKey: ACTOR_KEY,
      callerMachineId: PIVOT_MACHINE,
      claimedIp: null,
      owner: theirBox,
    });

    // Believing a claim about where an action came from defeats the whole point of
    // deriving the address server-side — a visitor could write their attack up as
    // somebody else's network.
    expect(provenance).toEqual({ ok: false, status: 403, error: 'no_session' });
  });

  it('reports a lookup failure on the standing box as a server error, not a refusal', async () => {
    const { deps } = makeDeps({
      findActiveSession: async () => ({ data: null, error: new Error('db down') }),
    });

    const provenance = await resolveTraceProvenance(deps, {
      actorKey: ACTOR_KEY,
      callerMachineId: PIVOT_MACHINE,
      claimedIp: null,
      owner: theirBox,
    });

    // A false 403 would tell an honest caller they are not standing where they are.
    expect(provenance).toEqual({ ok: false, status: 500, error: 'session_lookup_failed' });
  });

  it('degrades to an unknown client rather than guessing when the address cannot be resolved', async () => {
    const { deps } = makeDeps({
      findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
    });

    const provenance = await resolveTraceProvenance(deps, {
      actorKey: ACTOR_KEY,
      callerMachineId: undefined,
      claimedIp: '10.0.0.9',
      owner: theirBox,
    });

    // A false origin in someone's log is worse than no origin — and note it does NOT
    // fall back to the address the caller claimed, which is exactly the value this whole
    // path exists to stop trusting.
    expect(provenance).toEqual({ ok: true, writerKey: OWNER_KEY, fromIp: 'unknown' });
  });
});
