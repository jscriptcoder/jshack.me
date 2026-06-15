import { describe, expect, it } from 'vitest';
import { isCrossPlayerWorkstation } from './crossPlayerHop';
import { generateHomeLan } from '../generation/generateHomeLan';
import { hostMachineId } from '../generation/remoteHostId';
import { computeWorkstationId } from '../identity/workstation';

/**
 * `isCrossPlayerWorkstation` is the machine-level "am I standing on ANOTHER
 * player's registered box?" check — the shared core of `ui/activeRoot`'s
 * `isCrossPlayerHop` (which adds the ssh-kind requirement for served-tree
 * dispatch) AND `su`'s routing decision (which doesn't care about the kind, only
 * the machine). A box is cross-player when it is neither your own workstation nor
 * a host on the LAN you're connected to — the only way to be there is a public-IP
 * login into another identity's box.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const OWN_ID = computeWorkstationId('skylab', PUBKEY);
// A different identity's workstation — never a host on B's own LAN.
const FOREIGN_ID = computeWorkstationId('skylab', 'b'.repeat(64));

describe('isCrossPlayerWorkstation', () => {
  it('is true for a foreign workstation that is not a host on your LAN', () => {
    expect(isCrossPlayerWorkstation({ machineId: FOREIGN_ID, publicKeyHex: PUBKEY, essid: ESSID })).toBe(
      true,
    );
  });

  it('is false for a host that IS on your own LAN (an NPC ssh hop)', () => {
    const lanHopId = hostMachineId(generateHomeLan(PUBKEY, ESSID).hosts.at(-1)!, ESSID);
    expect(isCrossPlayerWorkstation({ machineId: lanHopId, publicKeyHex: PUBKEY, essid: ESSID })).toBe(
      false,
    );
  });

  it('is false for your own workstation', () => {
    expect(isCrossPlayerWorkstation({ machineId: OWN_ID, publicKeyHex: PUBKEY, essid: ESSID })).toBe(
      false,
    );
  });

  it('is false when offline (no essid to resolve a LAN against)', () => {
    expect(isCrossPlayerWorkstation({ machineId: FOREIGN_ID, publicKeyHex: PUBKEY, essid: null })).toBe(
      false,
    );
  });
});
