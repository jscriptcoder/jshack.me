import { describe, expect, it } from 'vitest';
import { asMachineId, asPlayerKeyHex } from '../types.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { machineIdForLanHost } from '../generation/lanTopology.js';
import { computeWorkstationId } from '../identity/workstation.js';
import {
  buildColdStartConnectivity,
  type ConnectivityState,
  type WirelessInterface,
} from '../network/interfaces.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { commandRegistry } from './registry.js';
import { ifconfig } from './ifconfig.js';

/**
 * `ifconfig` is the player's window onto their connectivity. Cold start: they
 * see `lo` and an up-but-address-less `wlan0` — proof they're offline. `-a`
 * also reveals the down `eth0`. Tests assert the rendered text (the contract)
 * across no-arg / `-a` / named / unknown, plus the online rendering an
 * associated `wlan0` produces (exercised here via a synthetic state; nmcli
 * produces it for real in a later slice).
 */

const NO_FLAGS = new Map<string, string | true>();
const ALL_FLAG = new Map<string, string | true>([['-a', true]]);
const PUBKEY = asPlayerKeyHex('a'.repeat(64));

const renderText = async (
  state: ConnectivityState,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true> = NO_FLAGS,
): Promise<{ readonly text: string; readonly exitCode: number }> => {
  const env = mockCommandEnv({ network: mockNetworkViewFromConnectivity(state) });
  const result = await ifconfig.execute(env, args, flags);
  if (result.kind !== 'sync') throw new Error('ifconfig should return a sync result');
  return {
    text: result.lines.map((line) => line.content).join('\n'),
    exitCode: result.exitCode,
  };
};

const associatedWlan0 = (state: ConnectivityState): ConnectivityState => {
  const wlan0 = state.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('unreachable');
  const online: WirelessInterface = {
    ...wlan0,
    association: { essid: 'HomeWiFi', bssid: 'AA:BB:CC:DD:EE:FF' },
    ipv4: '192.168.1.37',
  };
  return { interfaces: new Map(state.interfaces).set('wlan0', online) };
};

describe('ifconfig', () => {
  it('lists only up interfaces (lo + wlan0) with no argument', async () => {
    const { text, exitCode } = await renderText(buildColdStartConnectivity(PUBKEY), []);
    expect(text).toContain('lo: flags=<UP,LOOPBACK,RUNNING>');
    expect(text).toContain('wlan0: flags=<UP,BROADCAST,MULTICAST>');
    expect(text).not.toContain('eth0');
    expect(exitCode).toBe(0);
  });

  it('renders loopback inet + netmask, indented, but no ether and no gateway line', async () => {
    const { text } = await renderText(buildColdStartConnectivity(PUBKEY), []);
    // the address line is indented one level under the interface header
    expect(text).toContain('\n        inet 127.0.0.1  netmask 255.0.0.0');
    // loopback has no hardware address and no default gateway
    const loBlock = text.split('\n\n')[0] ?? text;
    expect(loBlock).not.toContain('ether');
    expect(loBlock).not.toContain('gateway');
  });

  it('separates interface blocks with a single blank line and no leading blank', async () => {
    const env = mockCommandEnv({
      network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
    });
    const result = await ifconfig.execute(env, [], NO_FLAGS);
    if (result.kind !== 'sync') throw new Error('sync expected');
    const contents = result.lines.map((line) => line.content);
    // no leading blank — the first line is the lo header
    expect(contents[0]).toMatch(/^lo:/);
    // exactly one blank, sitting between the two blocks (lo … <blank> wlan0 …)
    expect(contents.filter((content) => content === '')).toHaveLength(1);
    const blankIndex = contents.indexOf('');
    expect(contents[blankIndex + 1]).toMatch(/^wlan0:/);
  });

  it('renders the wlan0 hardware address but no inet when unassociated', async () => {
    const state = buildColdStartConnectivity(PUBKEY);
    const wlan0 = state.interfaces.get('wlan0');
    if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('unreachable');
    const { text } = await renderText(state, ['wlan0']);
    expect(text).toContain(`ether ${wlan0.mac}`);
    expect(text).not.toContain('inet ');
  });

  it('reveals the down eth0 with -a', async () => {
    const { text } = await renderText(buildColdStartConnectivity(PUBKEY), [], ALL_FLAG);
    expect(text).toContain('eth0: flags=<BROADCAST,MULTICAST>');
  });

  it('shows a single named interface even when it is down', async () => {
    const { text } = await renderText(buildColdStartConnectivity(PUBKEY), ['eth0']);
    expect(text).toContain('eth0: flags=<BROADCAST,MULTICAST>');
    expect(text).not.toContain('lo:');
    expect(text).not.toContain('wlan0:');
  });

  it('errors on an unknown interface', async () => {
    const env = mockCommandEnv({
      network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
    });
    const result = await ifconfig.execute(env, ['eth9'], NO_FLAGS);
    if (result.kind !== 'sync') throw new Error('sync expected');
    expect(result.exitCode).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual({
      kind: 'error',
      content: "ifconfig: interface 'eth9' not found",
    });
  });

  it('resolves by name and parses -a through the shell pipeline', async () => {
    // Integration seam: drives the real registry (name lookup + binary gate)
    // and bindFlags (`-a` must be a declared boolean), not the bare execute.
    const tree = buildDirectory({
      bin: buildDirectory({
        ifconfig: buildFile('', {
          owner: 'root',
          perms: { execute: ['root', 'user', 'guest'] },
        }),
      }),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
      network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
    });
    const { runCommandLine } = await import('../shell/runLine.js');

    const result = await runCommandLine(env, 'ifconfig -a', commandRegistry);

    if (result.kind !== 'sync') throw new Error('sync expected');
    const text = result.lines.map((line) => line.content).join('\n');
    // -a was parsed (eth0, which is down, is revealed) and the name resolved
    expect(text).toContain('eth0: flags=<BROADCAST,MULTICAST>');
    expect(text).toContain('wlan0:');
  });

  it('renders inet, netmask, gateway and the RUNNING flag once associated', async () => {
    const online = associatedWlan0(buildColdStartConnectivity(PUBKEY));
    const { text } = await renderText(online, ['wlan0']);
    expect(text).toContain('wlan0: flags=<UP,BROADCAST,RUNNING,MULTICAST>');
    expect(text).toContain('inet 192.168.1.37  netmask 255.255.255.0');
    expect(text).toContain('gateway 192.168.1.1');
  });
});

/**
 * On a hop, `ifconfig` is the player's readout of where they stand: the hop's own wired
 * interface and its address on the hop's LAN. The radio stays with the player's body, so
 * their `wlan0` is not on a box they are only logged into.
 */
describe('ifconfig on a hop', () => {
  const HOP_ESSID = 'RIDGEMONT-OFFICE';
  const hosts = generateHomeLan(HOP_ESSID).hosts.filter((host) => host.kind === 'machine');
  const hop = hosts[0]!;
  const otherHop = hosts[1]!;

  const onHop = async (
    machineId: string,
    args: readonly string[] = [],
  ): Promise<{ readonly text: string; readonly exitCode: number }> => {
    const env = mockCommandEnv({
      network: mockNetworkViewFromConnectivity(associatedWlan0(buildColdStartConnectivity(PUBKEY))),
      session: mockSession({ machineId: asMachineId(machineId), essid: HOP_ESSID, kind: 'ssh' }),
    });
    const result = await ifconfig.execute(env, args, NO_FLAGS);
    if (result.kind !== 'sync') throw new Error('sync expected');
    return {
      text: result.lines.map((line) => line.content).join('\n'),
      exitCode: result.exitCode,
    };
  };

  it('shows the hop’s own wired interface at its address on the hop’s LAN', async () => {
    const { text, exitCode } = await onHop(machineIdForLanHost(hop, HOP_ESSID));
    const subnet = hop.ip.split('.').slice(0, 3).join('.');

    expect(text).toContain('lo: flags=<UP,LOOPBACK,RUNNING>');
    expect(text).toContain('eth0: flags=<UP,BROADCAST,RUNNING,MULTICAST>');
    expect(text).toContain(`inet ${hop.ip}  netmask 255.255.255.0`);
    expect(text).toContain(`gateway ${subnet}.1`);
    expect(exitCode).toBe(0);
  });

  it('never shows the player’s own wlan0 or the address they were leased at home', async () => {
    const { text } = await onHop(machineIdForLanHost(hop, HOP_ESSID));

    expect(text).not.toContain('wlan0');
    expect(text).not.toContain('192.168.1.37');
  });

  it('has no wlan0 to name on a hop', async () => {
    const { text, exitCode } = await onHop(machineIdForLanHost(hop, HOP_ESSID), ['wlan0']);

    expect(text).toBe("ifconfig: interface 'wlan0' not found");
    expect(exitCode).toBe(1);
  });

  it('gives each hop a hardware address of its own, the same on every look', async () => {
    const etherOf = (text: string) => text.split('\n').find((line) => line.includes('ether'));
    const first = etherOf((await onHop(machineIdForLanHost(hop, HOP_ESSID))).text);
    const again = etherOf((await onHop(machineIdForLanHost(hop, HOP_ESSID))).text);
    const other = etherOf((await onHop(machineIdForLanHost(otherHop, HOP_ESSID))).text);
    const home = buildColdStartConnectivity(PUBKEY).interfaces.get('eth0');

    expect(first).toMatch(/ether 02(:[0-9a-f]{2}){5}$/);
    expect(again).toBe(first);
    expect(other).not.toBe(first);
    expect(first).not.toContain(home?.kind === 'ethernet' ? home.mac : 'unreachable');
  });

  it('shows the interface up with no address on a hop whose place on the LAN is unknown', async () => {
    const someoneElsesBox = computeWorkstationId('rig', 'c'.repeat(64));

    const { text } = await onHop(someoneElsesBox);

    expect(text).toContain('eth0: flags=<UP,BROADCAST,MULTICAST>');
    expect(text).not.toContain('inet 192');
    expect(text).not.toContain('gateway');
  });
});
