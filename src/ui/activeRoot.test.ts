import { describe, expect, it } from 'vitest';
import { needsFreshTree } from './activeRoot.js';
import { generateHomeLan } from '../core/generation/generateHomeLan.js';
import { hostMachineId } from '../core/generation/remoteHostId.js';
import { computeWorkstationId } from '../core/identity/workstation.js';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../core/types.js';
import type { Session } from '../core/commands/types.js';

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const OWN_ID = computeWorkstationId('skylab', PUBKEY);

const session = (machineId: string, kind: Session['kind'] = 'su'): Session => ({
  id: 'sess-1',
  playerKey: asPlayerKeyHex(PUBKEY),
  machineId: asMachineId(machineId),
  username: 'root',
  userType: 'root',
  kind,
  createdAt: asEpochMs(0),
  essid: null,
});

/**
 * Which sessions have to re-read the box before the next line runs.
 *
 * It used to be one: a backdoor, because a planted listener can be killed from
 * under it. A reboot makes that true of every session on a box that is not yours —
 * the rows close server-side in one stroke, and the only thing that tells a shell
 * already standing there is the marker on the box's own tree. Reading a tree
 * fetched when the player walked in would answer with the box they walked into.
 *
 * The line it must NOT charge is a line on your own box. That is a shipped, priced
 * claim and it survives here intact: your own workstation is the one machine
 * nothing has to be re-asked about, because the tree is already local and a session
 * you hold on it cannot be closed without you.
 */
describe('needsFreshTree', () => {
  it('re-asks the box a shell stands on across the network', () => {
    const theirBox = computeWorkstationId('nakatomi', 'b'.repeat(64));

    expect(needsFreshTree(session(theirBox, 'ssh'), OWN_ID)).toBe(true);
    expect(needsFreshTree(session(theirBox, 'exploit'), OWN_ID)).toBe(true);
    expect(needsFreshTree(session(theirBox, 'exploit_limited'), OWN_ID)).toBe(true);
    expect(needsFreshTree(session(theirBox, 'su'), OWN_ID)).toBe(true);
  });

  // A generated host on a shared LAN is nobody's box, and a fellow occupant can
  // reboot it out from under you — so the hop pays for freshness there too.
  it('re-asks a generated host on the LAN, which is not your box either', () => {
    const lanHost = hostMachineId(generateHomeLan(ESSID).hosts.at(-1)!, ESSID);

    expect(needsFreshTree(session(lanHost, 'ssh'), OWN_ID)).toBe(true);
  });

  it('charges nothing for a line on your own box', () => {
    expect(needsFreshTree(session(OWN_ID, 'su'), OWN_ID)).toBe(false);
  });

  // The original case, kept whole: the one door that can be taken away while it is
  // being held, even on the player's own machine, where a visitor holding a session
  // can `kill` the listener that admitted them.
  it('still re-asks for a backdoor, including one on your own box', () => {
    expect(needsFreshTree(session(OWN_ID, 'nc'), OWN_ID)).toBe(true);
  });
});
