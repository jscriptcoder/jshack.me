import { describe, expect, it, vi } from 'vitest';
import { resolveCallerVantage, type CallerVantageDeps, type HomeVantage } from './callerVantage.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { machineIdForLanHost } from '../generation/lanTopology.js';
import { lanAddressFor } from '../network/lanAddress.js';
import { computeWorkstationId } from '../identity/workstation.js';
import type { ActiveSession, FindActiveSession } from '../patches/authorizeMachineAccess.js';

/**
 * The server's own answer to "where is this caller standing". It reads a held session
 * row for a named box and the caller's occupancy for their own workstation, and never
 * trusts a claim — a box with no live session, or no network at all, is a refusal.
 */

const CALLER = 'a'.repeat(64);
const HOME_ESSID = 'BEAN-THERE-WIFI';
const HOP_ESSID = 'RIDGEMONT-OFFICE';
const HOME_OCTET = 50;

const hopMachineOn = (essid: string) => {
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.kind === 'machine');
  if (host === undefined) throw new Error(`${essid} has no machine host`);
  return { machineId: machineIdForLanHost(host, essid), address: host.ip };
};

const makeDeps = (over: {
  readonly session?: ActiveSession | null;
  readonly sessionError?: unknown;
  readonly home?: HomeVantage | null;
  readonly homeError?: unknown;
  readonly workstationLease?: number | null;
  readonly workstationLeaseError?: unknown;
}): CallerVantageDeps => {
  const findActiveSession: FindActiveSession = vi.fn(async () => ({
    data: over.session ?? null,
    error: over.sessionError ?? null,
  }));
  const findHomeVantage = vi.fn(async () => ({
    data: over.home === undefined ? { essid: HOME_ESSID, octet: HOME_OCTET } : over.home,
    error: over.homeError ?? null,
  }));
  const findWorkstationLease = vi.fn(async () => ({
    data: over.workstationLease ?? null,
    error: over.workstationLeaseError ?? null,
  }));
  return { findActiveSession, findHomeVantage, findWorkstationLease };
};

describe('resolveCallerVantage', () => {
  it('stands a caller on their own workstation at the lease they hold on their network', async () => {
    const vantage = await resolveCallerVantage(makeDeps({}), CALLER, undefined);

    expect(vantage).toEqual({
      ok: true,
      essid: HOME_ESSID,
      sourceIp: lanAddressFor(HOME_ESSID, HOME_OCTET),
    });
  });

  it('stands a caller on the network of the hop they hold, at the hop’s own address', async () => {
    const hop = hopMachineOn(HOP_ESSID);
    const deps = makeDeps({
      session: { username: 'root', userType: 'root', essid: HOP_ESSID },
    });

    const vantage = await resolveCallerVantage(deps, CALLER, hop.machineId);

    expect(vantage).toEqual({ ok: true, essid: HOP_ESSID, sourceIp: hop.address });
  });

  it('stands a caller on another player’s box at the lease that player holds on its network', async () => {
    const someoneElsesBox = computeWorkstationId('rig', 'c'.repeat(64));
    const deps = makeDeps({
      session: { username: 'guest', userType: 'guest', essid: HOP_ESSID },
      workstationLease: 77,
    });

    const vantage = await resolveCallerVantage(deps, CALLER, someoneElsesBox);

    expect(vantage).toEqual({
      ok: true,
      essid: HOP_ESSID,
      sourceIp: lanAddressFor(HOP_ESSID, 77),
    });
  });

  it('traces a player’s box whose owner holds no lease there as unknown, still on its network', async () => {
    const someoneElsesBox = computeWorkstationId('rig', 'c'.repeat(64));
    const deps = makeDeps({
      session: { username: 'guest', userType: 'guest', essid: HOP_ESSID },
      workstationLease: null,
    });

    const vantage = await resolveCallerVantage(deps, CALLER, someoneElsesBox);

    expect(vantage).toEqual({ ok: true, essid: HOP_ESSID, sourceIp: null });
  });

  it('surfaces a 500 rather than an unknown source when the hop’s lease read fails', async () => {
    const someoneElsesBox = computeWorkstationId('rig', 'c'.repeat(64));
    const deps = makeDeps({
      session: { username: 'guest', userType: 'guest', essid: HOP_ESSID },
      workstationLeaseError: new Error('db down'),
    });

    const vantage = await resolveCallerVantage(deps, CALLER, someoneElsesBox);

    expect(vantage).toEqual({ ok: false, status: 500, error: 'vantage_lookup_failed' });
  });

  it('falls through to home when the caller names their OWN workstation (the own-box bypass)', async () => {
    const ownBox = computeWorkstationId('skylab', CALLER);

    const vantage = await resolveCallerVantage(makeDeps({}), CALLER, ownBox);

    expect(vantage).toEqual({
      ok: true,
      essid: HOME_ESSID,
      sourceIp: lanAddressFor(HOME_ESSID, HOME_OCTET),
    });
  });

  it('refuses a named box the caller holds no live session on', async () => {
    const hop = hopMachineOn(HOP_ESSID);
    const deps = makeDeps({ session: null });

    const vantage = await resolveCallerVantage(deps, CALLER, hop.machineId);

    expect(vantage).toEqual({ ok: false, status: 403, error: 'no_session' });
  });

  it('refuses a caller standing on no network at all — no held box, no occupancy', async () => {
    const vantage = await resolveCallerVantage(makeDeps({ home: null }), CALLER, undefined);

    expect(vantage).toEqual({ ok: false, status: 403, error: 'caller_not_on_network' });
  });

  it('traces a caller at home with no lease as unknown rather than inventing an address', async () => {
    const deps = makeDeps({ home: { essid: HOME_ESSID, octet: null } });

    const vantage = await resolveCallerVantage(deps, CALLER, undefined);

    expect(vantage).toEqual({ ok: true, essid: HOME_ESSID, sourceIp: null });
  });

  it('surfaces a 500 rather than a false placement when the occupancy read fails', async () => {
    const deps = makeDeps({ homeError: new Error('db down') });

    const vantage = await resolveCallerVantage(deps, CALLER, undefined);

    expect(vantage).toEqual({ ok: false, status: 500, error: 'vantage_lookup_failed' });
  });
});
