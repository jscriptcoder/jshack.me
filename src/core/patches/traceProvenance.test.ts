import { describe, expect, it, vi } from 'vitest';
import {
  resolveTraceProvenance,
  type TraceProvenanceDeps,
  type TraceVisit,
} from './traceProvenance.js';
import type {
  ActiveSession,
  FindActiveSession,
  FindActiveSessionResult,
} from './authorizeMachineAccess.js';
import type { OccupantWorkstation } from './remoteWritePermission.js';
import type { FindPublicIpByEssid } from '../logging/crossPlayerSourceIp.js';
import type { FindHomeVantage, FindWorkstationLease } from '../sessions/callerVantage.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { md5 } from '../generation/md5.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { leasedAddress } from '../network/lanAddress.js';

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
 *
 * The address is placed exactly as the login doors place theirs, so a trace line and the
 * `auth.log` login above it name the one address on every path: the LAN lease a fellow
 * occupant was seen at, the public address a visitor from another network wears, the
 * caller's own address at home.
 */

const ACTOR_KEY = 'a'.repeat(64);
const OWNER_KEY = 'd'.repeat(64);

const theirBox: OccupantWorkstation = {
  owner_key: OWNER_KEY,
  workstation_username: 'morpheus',
  workstation_root_hash: md5('toor'),
};

/** The network a generated box is regenerated from, as the caller's session row names it. */
const BOX_ESSID = 'BEAN-THERE-WIFI';

const ACTOR_HOME_ESSID = 'SKYLAB-HOUSE';
const ACTOR_HOME_OCTET = 42;
const ACTOR_HOME_IP = '198.51.100.22';

const PIVOT_ESSID = 'CAFE-DEL-MAR-GUEST';
const PIVOT_PUBLIC_IP = '203.0.113.199';
const PIVOT_MACHINE = 'workstation-p1v0t000';
const PIVOT_OCTET = 77;

/** A real generated box on `BOX_ESSID`: a hop a player could hold a session on, which
 *  the topology can place at an address. */
const hopOnBoxLan = () => {
  const host = generateHomeLan(BOX_ESSID).hosts.find((candidate) => candidate.kind === 'machine');
  if (host === undefined) throw new Error(`${BOX_ESSID} has no machine to hop onto`);
  return { machineId: resolveLanHostIdentity(host, BOX_ESSID).machineId, ip: host.ip };
};

const activeSession = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  username: 'guest',
  userType: 'guest',
  essid: BOX_ESSID,
  ...over,
});

/** A visitor at home reaching a box somebody owns, through a session on it. */
const visit = (over: Partial<TraceVisit> = {}): TraceVisit => ({
  actorKey: ACTOR_KEY,
  callerMachineId: undefined,
  owner: theirBox,
  boxEssid: BOX_ESSID,
  ...over,
});

const makeDeps = (over: Partial<TraceProvenanceDeps> = {}) => {
  // Where a named caller box sits: a session on `PIVOT_ESSID` by default, so a caller
  // naming it is placed on a network other than the target's.
  const findActiveSession = vi.fn<FindActiveSession>(
    async (): Promise<FindActiveSessionResult> => ({
      data: activeSession({ essid: PIVOT_ESSID }),
      error: null,
    }),
  );
  const findHomeVantage = vi.fn<FindHomeVantage>(async () => ({
    data: { essid: ACTOR_HOME_ESSID, octet: ACTOR_HOME_OCTET },
    error: null,
  }));
  const findWorkstationLease = vi.fn<FindWorkstationLease>(async () => ({
    data: PIVOT_OCTET,
    error: null,
  }));
  const findPublicIpByEssid = vi.fn<FindPublicIpByEssid>(async (essid) => ({
    data: {
      public_ip:
        essid === PIVOT_ESSID
          ? PIVOT_PUBLIC_IP
          : essid === ACTOR_HOME_ESSID
            ? ACTOR_HOME_IP
            : '192.0.2.1',
    },
    error: null,
  }));
  const deps: TraceProvenanceDeps = {
    findActiveSession,
    findHomeVantage,
    findWorkstationLease,
    findPublicIpByEssid,
    ...over,
  };
  return { deps, findActiveSession, findHomeVantage, findWorkstationLease, findPublicIpByEssid };
};

describe('a trace on a host nobody owns', () => {
  it('files under the key of the box’s network, naming the address the hop was seen at', async () => {
    const hop = hopOnBoxLan();
    const { deps } = makeDeps({
      findActiveSession: async () => ({ data: activeSession({ essid: BOX_ESSID }), error: null }),
    });

    const provenance = await resolveTraceProvenance(
      deps,
      visit({ owner: null, callerMachineId: hop.machineId }),
    );

    // Every occupant of the network reaches the identical generated box, so a row per
    // visitor would let each line erase the last; the network's own key is the one log
    // they all accrete into. The hop stands on this LAN, so the address it was seen at is
    // its own LAN address — derived from the topology, never a claim.
    expect(provenance).toEqual({
      ok: true,
      writerKey: apGatewayLogWriterKey(BOX_ESSID),
      fromIp: hop.ip,
    });
  });

  it('names an unknown client on the caller’s own box while they are on no network', async () => {
    const { deps } = makeDeps();

    const provenance = await resolveTraceProvenance(deps, visit({ owner: null, boxEssid: null }));

    // A workstation whose owner is on no WiFi has no occupancy row, so it reads as
    // ownerless — but it is the caller's own box, no network shares it, and there is no
    // network to place them on. The action still happened, so the client is named
    // unknown rather than left blank.
    expect(provenance).toEqual({ ok: true, writerKey: ACTOR_KEY, fromIp: 'unknown' });
  });
});

describe('a trace on a box somebody owns', () => {
  it('files under the OWNER key, never the visitor’s own', async () => {
    const { deps } = makeDeps();

    const provenance = await resolveTraceProvenance(deps, visit({ callerMachineId: PIVOT_MACHINE }));

    // Under the visitor's key the line lands in a different row from the login that
    // preceded it, and the journal replays with one row winning outright — so the owner
    // reads half a visit, and a second visitor erases the first.
    expect(provenance).toMatchObject({ ok: true, writerKey: OWNER_KEY });
    expect(provenance).not.toMatchObject({ writerKey: ACTOR_KEY });
  });

  it('names the public address of the network a cross-network visitor stands on', async () => {
    const { deps, findPublicIpByEssid } = makeDeps();

    const provenance = await resolveTraceProvenance(deps, visit({ callerMachineId: PIVOT_MACHINE }));

    // The visitor's own LAN address never touched the target; it reached across a NAT, so
    // the only address the target saw is the public one the pivot's network wears. The
    // ESSID comes off the session row, where the server stamped it when the hop was made.
    expect(findPublicIpByEssid).toHaveBeenCalledWith(PIVOT_ESSID);
    expect(provenance).toEqual({ ok: true, writerKey: OWNER_KEY, fromIp: PIVOT_PUBLIC_IP });
  });

  it('names a fellow occupant by the LAN lease the owner saw, not a public address', async () => {
    const { deps, findPublicIpByEssid, findWorkstationLease } = makeDeps({
      findActiveSession: async () => ({ data: activeSession({ essid: BOX_ESSID }), error: null }),
    });

    const provenance = await resolveTraceProvenance(deps, visit({ callerMachineId: PIVOT_MACHINE }));

    // A neighbour on the target's own LAN was seen at their LAN lease — the same address
    // the login on this box recorded. Reading it as a public address would make the
    // rollback line disagree with the auth.log line directly above it.
    expect(findWorkstationLease).toHaveBeenCalledWith(BOX_ESSID, PIVOT_MACHINE);
    expect(findPublicIpByEssid).not.toHaveBeenCalled();
    expect(provenance).toEqual({
      ok: true,
      writerKey: OWNER_KEY,
      fromIp: leasedAddress(BOX_ESSID, PIVOT_OCTET),
    });
  });

  it('names an unknown client on the target’s own LAN when the neighbour has no readable lease', async () => {
    const { deps } = makeDeps({
      findActiveSession: async () => ({ data: activeSession({ essid: BOX_ESSID }), error: null }),
      findWorkstationLease: async () => ({ data: null, error: null }),
    });

    const provenance = await resolveTraceProvenance(deps, visit({ callerMachineId: PIVOT_MACHINE }));

    // A neighbour on the target's own LAN whose lease the network cannot place: the trace
    // still writes — the client named unknown rather than left blank, which reads as a
    // corrupt log — and never a public address, since they never crossed a NAT.
    expect(provenance).toEqual({ ok: true, writerKey: OWNER_KEY, fromIp: 'unknown' });
  });

  it('names the visitor’s own public address when they reach out from home', async () => {
    const { deps, findHomeVantage, findPublicIpByEssid } = makeDeps();

    const provenance = await resolveTraceProvenance(
      deps,
      visit({ callerMachineId: computeWorkstationId('skylab', ACTOR_KEY) }),
    );

    // Reaching out from home holds no session row — the own-box bypass hands one back as
    // null, so the caller is placed on their own home network. The target is elsewhere,
    // so it saw that network's public address.
    expect(findHomeVantage).toHaveBeenCalledWith(ACTOR_KEY);
    expect(findPublicIpByEssid).toHaveBeenCalledWith(ACTOR_HOME_ESSID);
    expect(provenance).toEqual({ ok: true, writerKey: OWNER_KEY, fromIp: ACTOR_HOME_IP });
  });

  it('refuses a visitor claiming to stand on a box they hold no session on', async () => {
    const { deps } = makeDeps({
      findActiveSession: async () => ({ data: null, error: null }),
    });

    const provenance = await resolveTraceProvenance(deps, visit({ callerMachineId: PIVOT_MACHINE }));

    // Believing a claim about where an action came from defeats the whole point of
    // deriving the address server-side — a visitor could write their visit up as
    // somebody else's network.
    expect(provenance).toEqual({ ok: false, status: 403, error: 'no_session' });
  });

  it('reports a lookup failure on the standing box as a server error, not a refusal', async () => {
    const { deps } = makeDeps({
      findActiveSession: async () => ({ data: null, error: new Error('db down') }),
    });

    const provenance = await resolveTraceProvenance(deps, visit({ callerMachineId: PIVOT_MACHINE }));

    // A false 403 would tell an honest caller they are not standing where they are.
    expect(provenance).toEqual({ ok: false, status: 500, error: 'session_lookup_failed' });
  });

  it('degrades to an unknown client rather than guessing when the public address is unresolved', async () => {
    const { deps } = makeDeps({
      findPublicIpByEssid: async () => ({ data: null, error: null }),
    });

    const provenance = await resolveTraceProvenance(deps, visit({ callerMachineId: PIVOT_MACHINE }));

    // A false origin in someone's log is worse than no origin.
    expect(provenance).toEqual({ ok: true, writerKey: OWNER_KEY, fromIp: 'unknown' });
  });
});
