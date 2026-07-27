import { describe, expect, it } from 'vitest';
import {
  baseFsForLanHost,
  machineIdForLanHost,
  ownChainBaseFsForMachineId,
} from './lanHostIdentity';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import type { Directory } from '../filesystem/types';

// Two representative Ed25519 pubkeys (64 hex chars). Any fixed pair works — the
// contract under test is that the LAN's boxes do NOT vary with them.
const OCCUPANT_KEY = 'a'.repeat(64);
const OTHER_OCCUPANT_KEY = 'b'.repeat(64);
const ESSID = 'BREW-AND-CODE';
const OTHER_ESSID = 'NAKATOMI-PLAZA';

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

const hostOn = (essid: string, match: (host: LanHost) => boolean): LanHost => {
  const host = generateHomeLan(essid).hosts.find(match);
  if (host === undefined) throw new Error(`no matching host generated for ${essid}`);
  return host;
};

const gatewayOn = (essid: string): LanHost => hostOn(essid, (host) => octetOf(host) === 1);
const innerGatewayOn = (essid: string): LanHost =>
  hostOn(essid, (host) => host.kind === 'router' && octetOf(host) !== 1);
const switchOn = (essid: string): LanHost => hostOn(essid, (host) => host.kind === 'switch');
const siblingOn = (essid: string): LanHost => hostOn(essid, (host) => host.kind === 'machine');

const readFile = (root: Directory, dirName: string, fileName: string): string => {
  const parent = root.entries.get(dirName);
  if (parent?.kind !== 'directory') throw new Error(`/${dirName} is not a directory`);
  const entry = parent.entries.get(fileName);
  if (entry?.kind !== 'file') throw new Error(`/${dirName}/${fileName} is not a file`);
  return entry.content;
};

describe('the AP gateway at .1', () => {
  // Uniqueness has to come from somewhere: it is the ESSID that separates one AP's
  // gateway from another's, where it used to be the owner key.
  it('is a different machine on a different ESSID', () => {
    expect(machineIdForLanHost(gatewayOn(ESSID), ESSID)).not.toBe(
      machineIdForLanHost(gatewayOn(OTHER_ESSID), OTHER_ESSID),
    );
  });

  // The gateway shares a LAN with inner gateways and NPC siblings; an id collision
  // would silently route a session onto the wrong box's journal.
  it('never aliases another host on its own LAN', () => {
    const gatewayId = machineIdForLanHost(gatewayOn(ESSID), ESSID);
    const otherIds = generateHomeLan(ESSID)
      .hosts.filter((host) => octetOf(host) !== 1)
      .map((host) => machineIdForLanHost(host, ESSID));

    expect(otherIds).not.toContain(gatewayId);
  });
});

describe('every host on an AP’s LAN', () => {
  // An access point has ONE of each of these boxes. Two occupants who reach the same
  // address must land on the same machine record, or a write by one is invisible to
  // the other — and for the gateways, each would hold a private box claiming one
  // public address. The resolver takes no viewer at all now, so the way this is put
  // under test is that the whole set is a function of the ESSID and nothing else.
  it('resolves to distinct machines, none aliasing another', () => {
    const ids = generateHomeLan(ESSID).hosts.map((host) => machineIdForLanHost(host, ESSID));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives the inner gateway and the switch different machines from each other', () => {
    expect(machineIdForLanHost(innerGatewayOn(ESSID), ESSID)).not.toBe(
      machineIdForLanHost(switchOn(ESSID), ESSID),
    );
  });

  it('re-keys every kind of host when the ESSID changes', () => {
    // Router, switch and ordinary NPC each take a different derivation, so each needs
    // its own evidence that the ESSID is what separates one AP's box from another's.
    for (const pick of [gatewayOn, innerGatewayOn, switchOn, siblingOn]) {
      expect(machineIdForLanHost(pick(ESSID), ESSID)).not.toBe(
        machineIdForLanHost(pick(OTHER_ESSID), OTHER_ESSID),
      );
    }
  });

  // The seeded world — the admin credential above all — belongs to the AP, not to
  // whoever joined, so the ESSID is what has to move it. A box whose accounts did not
  // re-roll per network would wear one password across every access point in the game.
  it('seeds each box its own accounts, re-rolled per ESSID', () => {
    for (const pick of [gatewayOn, innerGatewayOn, switchOn, siblingOn]) {
      expect(readFile(baseFsForLanHost(pick(ESSID), ESSID), 'etc', 'passwd')).not.toBe(
        readFile(baseFsForLanHost(pick(OTHER_ESSID), OTHER_ESSID), 'etc', 'passwd'),
      );
    }
  });
});

describe('resolving a machine id back to its box', () => {
  // This is where a viewer still exists to vary, so it is where "two occupants share
  // one machine" is actually provable: occupant B resolves an id derived from the LAN
  // and rebuilds the SAME tree occupant A would — which is what makes A's journal
  // replay onto the box B is standing on.
  it('gives two occupants of an ESSID the same tree for the same inner gateway', () => {
    const gatewayId = machineIdForLanHost(innerGatewayOn(ESSID), ESSID);

    expect(ownChainBaseFsForMachineId(OTHER_OCCUPANT_KEY, ESSID, gatewayId)).toEqual(
      ownChainBaseFsForMachineId(OCCUPANT_KEY, ESSID, gatewayId),
    );
  });

  it('gives two occupants of an ESSID the same tree for the same NPC sibling', () => {
    const siblingId = machineIdForLanHost(siblingOn(ESSID), ESSID);

    expect(ownChainBaseFsForMachineId(OTHER_OCCUPANT_KEY, ESSID, siblingId)).toEqual(
      ownChainBaseFsForMachineId(OCCUPANT_KEY, ESSID, siblingId),
    );
  });

  it('resolves an inner gateway and an NPC to trees that are not each other', () => {
    // Guards the pair above against passing on two nulls: a resolution that found
    // nothing would satisfy "both occupants agree" while proving nothing at all.
    const gatewayFs = ownChainBaseFsForMachineId(
      OCCUPANT_KEY,
      ESSID,
      machineIdForLanHost(innerGatewayOn(ESSID), ESSID),
    );
    const siblingFs = ownChainBaseFsForMachineId(
      OCCUPANT_KEY,
      ESSID,
      machineIdForLanHost(siblingOn(ESSID), ESSID),
    );

    expect(gatewayFs).not.toBeNull();
    expect(siblingFs).not.toBeNull();
    expect(gatewayFs).not.toEqual(siblingFs);
  });
});
