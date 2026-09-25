import { describe, expect, it } from 'vitest';
import { hostMac } from './hostMac';
import { generateHomeLan } from './generateHomeLan';
import { generateDeepLayer } from './generateDeepLayer';
import { chainLinks, machineIdForLanHost } from './lanTopology';
import { hostMachineId } from './remoteHostId';
import { ALL_ESSIDS } from '../../test/worldContent';

/** Every generated host a network holds, by machine id: its LAN (the access point, its
 *  gateways and machines), every gateway down its chain, and each deep layer's NPC. A
 *  Layer-1 gateway is both on the LAN and the chain's first link, so it is counted once. */
const machineIdsOn = (essid: string): readonly string[] => [
  ...new Set([
    ...generateHomeLan(essid).hosts.map((host) => machineIdForLanHost(host, essid)),
    ...chainLinks(essid).flatMap((link) => [
      link.machineId,
      hostMachineId(
        generateDeepLayer(
          essid,
          { machineId: link.machineId, kind: link.host.kind },
          { hangsChild: link.hangsChild },
        ).host,
        essid,
      ),
    ]),
  ]),
];

const firstOctet = (mac: string): number => Number.parseInt(mac.slice(0, 2), 16);

describe('hostMac', () => {
  it('gives every host a unicast, maker-assigned MAC in six lowercase hex octets', () => {
    for (const essid of ALL_ESSIDS) {
      for (const machineId of machineIdsOn(essid)) {
        const mac = hostMac(machineId);
        expect(mac).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/);
        // Bit 0 set would make it multicast; bit 1 set, locally administered (the
        // player's own NICs use that range, so a generated host never looks like one).
        expect(firstOctet(mac) & 0b11).toBe(0);
      }
    }
  });

  it('names a host by the same MAC every time it is asked', () => {
    expect(hostMac('printer-44-7c1e')).toBe(hostMac('printer-44-7c1e'));
  });

  it('never gives two hosts on one network the same MAC', () => {
    for (const essid of ALL_ESSIDS) {
      const macs = machineIdsOn(essid).map(hostMac);
      expect(new Set(macs).size).toBe(macs.length);
    }
  });

  it('draws hosts from more than one maker across the world', () => {
    const makers = new Set(
      ALL_ESSIDS.flatMap(machineIdsOn).map((machineId) => hostMac(machineId).slice(0, 8)),
    );
    expect(makers.size).toBeGreaterThan(5);
  });
});
