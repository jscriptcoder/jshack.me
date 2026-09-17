import { describe, expect, it } from 'vitest';
import { launchVantage } from './launchVantage';
import { mockSession } from '../../test/factories/commandEnv';
import { asMachineId } from '../types';

/**
 * Which box an action was launched FROM — the field a defender's log is addressed by.
 *
 * Tested directly because the tempting answer is wrong in a way that is invisible until
 * somebody reads their own log: for an action that happens where the player is STANDING
 * rather than on a target of its own, naming the active session would record the visit as
 * having come from the victim's own network.
 */

const OWN_BOX = asMachineId('workstation-0wnb0x00');
const PIVOT = asMachineId('workstation-p1v0t000');
const VICTIM = asMachineId('workstation-v1ct1m00');

const on = (machineId: string) => mockSession({ machineId: asMachineId(machineId) });

describe('the box an action was launched from', () => {
  it('is nothing at all at the base login, where there is no hop underneath', () => {
    // Handed to the server as "no box named", which resolves the address from the
    // actor's verified key — the network they own.
    expect(launchVantage([on(OWN_BOX)])).toBeUndefined();
  });

  it('is nothing for an empty stack, rather than throwing at a shell that has not started', () => {
    expect(launchVantage([])).toBeUndefined();
  });

  it('stays the player own workstation through an su elevation, which is not a hop', () => {
    // `su` pushes a session on the SAME machine. No special case earns its keep here:
    // the box underneath IS that workstation, and the server's own-box bypass resolves
    // it to the player's own network by the ordinary route.
    expect(launchVantage([on(OWN_BOX), on(OWN_BOX)])).toBe(OWN_BOX);
  });

  it('names the box below the hop, never the one the action lands on', () => {
    // The whole point. The active session is the VICTIM, and reporting that would
    // address the victim's own log from the victim's own network.
    const vantage = launchVantage([on(OWN_BOX), on(VICTIM)]);

    expect(vantage).toBe(OWN_BOX);
    expect(vantage).not.toBe(VICTIM);
  });

  it('names the PIVOT when the player hopped through one, not the box they set out from', () => {
    // The victim never saw the attacker's own address — it saw the pivot's. Reporting
    // the origin would name a network that never touched this box.
    const vantage = launchVantage([on(OWN_BOX), on(PIVOT), on(VICTIM)]);

    expect(vantage).toBe(PIVOT);
    expect(vantage).not.toBe(OWN_BOX);
    expect(vantage).not.toBe(VICTIM);
  });

  it('reads through an su elevation taken on the pivot itself', () => {
    // Rooting the pivot before hopping on adds a session without moving machines, so
    // the box below the victim is still the pivot.
    expect(launchVantage([on(OWN_BOX), on(PIVOT), on(PIVOT), on(VICTIM)])).toBe(PIVOT);
  });
});
