import { describe, expect, it } from 'vitest';
import { baseFsForLanHost, machineIdForLanHost } from './lanHostIdentity';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import type { Directory } from '../filesystem/types';

// Two representative Ed25519 pubkeys (64 hex chars). Any fixed pair works — the
// contract under test is that the AP gateway does NOT vary with them.
const OCCUPANT_KEY = 'a'.repeat(64);
const OTHER_OCCUPANT_KEY = 'b'.repeat(64);
const ESSID = 'BREW-AND-CODE';
const OTHER_ESSID = 'NAKATOMI-PLAZA';

const gatewayOn = (ownerKeyHex: string, essid: string): LanHost => {
  const gateway = generateHomeLan(ownerKeyHex, essid).hosts.find(
    (host) => Number(host.ip.split('.')[3]) === 1,
  );
  if (gateway === undefined) throw new Error(`no .1 gateway generated for ${essid}`);
  return gateway;
};

const readFile = (root: Directory, dirName: string, fileName: string): string => {
  const parent = root.entries.get(dirName);
  if (parent?.kind !== 'directory') throw new Error(`/${dirName} is not a directory`);
  const entry = parent.entries.get(fileName);
  if (entry?.kind !== 'file') throw new Error(`/${dirName}/${fileName} is not a file`);
  return entry.content;
};

describe('the AP gateway at .1', () => {
  // An access point has ONE gateway. Two players who crack the same ESSID are behind
  // the same NAT on the same public IP, so they must land on the same machine —
  // otherwise each holds a private `.1` that both claim that one public address.
  it('is the same machine for every occupant of an ESSID', () => {
    expect(machineIdForLanHost(gatewayOn(OCCUPANT_KEY, ESSID), OCCUPANT_KEY, ESSID)).toBe(
      machineIdForLanHost(gatewayOn(OTHER_OCCUPANT_KEY, ESSID), OTHER_OCCUPANT_KEY, ESSID),
    );
  });

  // The gateway's seeded world — its admin credential above all — belongs to the AP,
  // not to whoever joined. Both occupants face the same box and the same password, and
  // the server can recover that password from the ESSID alone for cross-player auth.
  it('seeds one identical filesystem for every occupant of an ESSID', () => {
    const asSeenByOccupant = baseFsForLanHost(gatewayOn(OCCUPANT_KEY, ESSID), OCCUPANT_KEY, ESSID);
    const asSeenByOther = baseFsForLanHost(
      gatewayOn(OTHER_OCCUPANT_KEY, ESSID),
      OTHER_OCCUPANT_KEY,
      ESSID,
    );

    expect(readFile(asSeenByOccupant, 'etc', 'passwd')).toBe(
      readFile(asSeenByOther, 'etc', 'passwd'),
    );
  });

  // Uniqueness still has to come from somewhere: it is now the ESSID that separates one
  // AP's gateway from another's, where it used to be the owner key.
  it('is a different machine on a different ESSID', () => {
    expect(machineIdForLanHost(gatewayOn(OCCUPANT_KEY, ESSID), OCCUPANT_KEY, ESSID)).not.toBe(
      machineIdForLanHost(gatewayOn(OCCUPANT_KEY, OTHER_ESSID), OCCUPANT_KEY, OTHER_ESSID),
    );
  });

  // The gateway shares a LAN with inner gateways and NPC siblings; an id collision
  // would silently route a session onto the wrong box's journal.
  it('never aliases another host on its own LAN', () => {
    const lan = generateHomeLan(OCCUPANT_KEY, ESSID);
    const gatewayId = machineIdForLanHost(gatewayOn(OCCUPANT_KEY, ESSID), OCCUPANT_KEY, ESSID);
    const otherIds = lan.hosts
      .filter((host) => Number(host.ip.split('.')[3]) !== 1)
      .map((host) => machineIdForLanHost(host, OCCUPANT_KEY, ESSID));

    expect(otherIds).not.toContain(gatewayId);
  });
});
