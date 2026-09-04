import { describe, expect, it } from 'vitest';
import { nslookup } from './nslookup';
import type { CommandResult } from './types';
import {
  mockCommandEnv,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
  mockScanApi,
} from '../../test/factories/commandEnv';
import type { OccupantProjection } from '../network/resolveOccupants';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { asPlayerKeyHex } from '../types';

/**
 * `nslookup <name>` — what is this thing called, and where is it?
 *
 * The access point's gateway is the resolver, so this works on the first network
 * a player cracks rather than on the rare one carrying a name server of its own.
 * It answers for THAT network only: there is no world DNS behind it.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const SLUG = 'bean-there-wifi';

const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  const connected = { ...wlan0, association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' }, ipv4: localIp };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const onlineEnv = () =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
  });

const drain = async (
  result: CommandResult,
): Promise<{ lines: readonly string[]; exitCode: number }> => {
  if (result.kind === 'sync') {
    return { lines: result.lines.map((line) => line.content), exitCode: result.exitCode };
  }
  if (result.kind !== 'async') throw new Error('expected sync or async result');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { lines, exitCode: await result.exitCode() };
};

const run = async (...args: readonly string[]) =>
  drain(await nslookup.execute(onlineEnv(), args, new Map()));

/** Any generated NPC machine on the LAN — a real name a scan would print. */
const hostOnLan = (): LanHost => {
  const host = generateHomeLan(ESSID).hosts.find((candidate) => candidate.kind === 'machine');
  if (host === undefined) throw new Error('expected a generated host on the LAN');
  return host;
};

/** The access point's gateway, which is the resolver answering every lookup. */
const gatewayIp = (): string => `${generateHomeLan(ESSID).subnet}.1`;

describe('nslookup', () => {
  it('answers a name on the connected network, naming the resolver that answered', async () => {
    const machine = hostOnLan();

    const { lines, exitCode } = await run(machine.hostname);

    expect(lines).toEqual([
      `Server:  ${gatewayIp()}`,
      `Address: ${gatewayIp()}#53`,
      '',
      'Non-authoritative answer:',
      `Name:    ${machine.hostname}.${SLUG}.lan`,
      `Address: ${machine.ip}`,
    ]);
    expect(exitCode).toBe(0);
  });

  it('resolves the fully qualified form to the same address', async () => {
    const machine = hostOnLan();

    const { lines } = await run(`${machine.hostname}.${SLUG}.lan`);

    expect(lines).toContain(`Address: ${machine.ip}`);
  });

  it('answers NXDOMAIN for a name this network has never heard of', async () => {
    const { lines, exitCode } = await run('nosuchbox');

    expect(lines).toEqual([
      `Server:  ${gatewayIp()}`,
      `Address: ${gatewayIp()}#53`,
      '',
      "** server can't find nosuchbox: NXDOMAIN",
    ]);
    expect(exitCode).toBe(1);
  });

  it('answers NXDOMAIN for a name belonging to a different network', async () => {
    // The host is real and the name is well formed — it is simply not this
    // network's to answer, and there is no world DNS standing behind it.
    const machine = hostOnLan();

    const { lines, exitCode } = await run(`${machine.hostname}.acme-corp.lan`);

    expect(lines).toContain(`** server can't find ${machine.hostname}.acme-corp.lan: NXDOMAIN`);
    expect(exitCode).toBe(1);
  });

  it('answers at once, with nothing to wait for or interrupt', async () => {
    // A lookup on your own LAN is a question the resolver already knows the answer
    // to. Pacing it would spend real seconds performing a delay the game does not
    // model, so the whole block arrives in one piece.
    const result = await nslookup.execute(onlineEnv(), [hostOnLan().hostname], new Map());

    expect(result.kind).toBe('sync');
  });

  it('reports usage when asked to look up nothing', async () => {
    const { lines, exitCode } = await run();

    expect(lines).toEqual(['nslookup: usage: nslookup <name>']);
    expect(exitCode).toBe(1);
  });

  describe('a fellow player standing on the same network', () => {
    const envWithOccupants = (occupants: readonly OccupantProjection[]) =>
      mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
        scan: mockScanApi({ resolveOccupants: async () => occupants }),
      });

    const alice: OccupantProjection = {
      workstation_machine_id: 'skylab-aaaa',
      localIp: `${generateHomeLan(ESSID).subnet}.88`,
      machineName: 'alice-rig',
    };

    it('resolves an occupant machine name to the address they hold', async () => {
      // A real player's box is not in the generated population — their lease is
      // issued server-side — so the only way their name can answer is to ask who
      // else is here.
      const { lines, exitCode } = await drain(
        await nslookup.execute(envWithOccupants([alice]), ['alice-rig'], new Map()),
      );

      expect(lines).toEqual([
        `Server:  ${gatewayIp()}`,
        `Address: ${gatewayIp()}#53`,
        '',
        'Non-authoritative answer:',
        `Name:    alice-rig.${SLUG}.lan`,
        `Address: ${alice.localIp}`,
      ]);
      expect(exitCode).toBe(0);
    });

    it('resolves an occupant by their fully qualified name too', async () => {
      const { lines } = await drain(
        await nslookup.execute(
          envWithOccupants([alice]),
          [`alice-rig.${SLUG}.lan`],
          new Map(),
        ),
      );

      expect(lines).toContain(`Address: ${alice.localIp}`);
    });

    it('answers NXDOMAIN when nobody can say who else is here', async () => {
      // An empty list is what an unreachable server produces — the occupant read
      // degrades rather than throwing — so the lookup answers a plain "no" instead
      // of failing the command.
      const { lines, exitCode } = await drain(
        await nslookup.execute(envWithOccupants([]), ['alice-rig'], new Map()),
      );

      expect(lines).toContain("** server can't find alice-rig: NXDOMAIN");
      expect(exitCode).toBe(1);
    });

    it('does not hand a stranger name whichever occupant happens to be first', async () => {
      // The fallback matches a NAME. Without that, the first player standing on the
      // network would answer for every name nobody owns — and a player who typoed a
      // hostname would be handed somebody else's box.
      const { lines, exitCode } = await drain(
        await nslookup.execute(envWithOccupants([alice]), ['nosuchbox'], new Map()),
      );

      expect(lines).toContain("** server can't find nosuchbox: NXDOMAIN");
      expect(exitCode).toBe(1);
    });

    it('prefers the network own name when an occupant answers to the same one', async () => {
      // The generated population is the network's own record of itself. An occupant
      // claiming a name already on it does not get to move that name.
      const npc = hostOnLan();
      const impostor: OccupantProjection = { ...alice, machineName: npc.hostname };

      const { lines } = await drain(
        await nslookup.execute(envWithOccupants([impostor]), [npc.hostname], new Map()),
      );

      expect(lines).toContain(`Address: ${npc.ip}`);
    });
  });

  describe('with no network to ask', () => {
    it('refuses while offline, even with a fully associated, addressed wlan0', async () => {
      const conn = onlineConnectivity(ESSID);
      const env = mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkView({
          isOnline: () => false,
          interfaces: () => [...conn.interfaces.values()],
        }),
      });

      const { lines, exitCode } = await drain(await nslookup.execute(env, ['gw-main'], new Map()));

      expect(lines).toEqual(['nslookup: network is unreachable — connect to a network first']);
      expect(exitCode).toBe(1);
    });

    it('refuses when online but wlan0 is associated with nothing', async () => {
      const env = mockCommandEnv({
        identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
        network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
      });

      const { lines, exitCode } = await drain(await nslookup.execute(env, ['gw-main'], new Map()));

      expect(lines).toEqual(['nslookup: network is unreachable — connect to a network first']);
      expect(exitCode).toBe(1);
    });
  });
});
