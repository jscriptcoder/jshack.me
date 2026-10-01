import { describe, expect, it } from 'vitest';
import { whois } from './whois.js';
import type { CommandEnv, CommandResult } from './types.js';
import {
  mockCommandEnv,
  mockIdentity,
  mockNetworkViewFromConnectivity,
} from '../../test/factories/commandEnv.js';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { DECLARED_NETWORKS, publicAddress, REGION_FIRST_OCTETS } from '../generation/world.js';
import { FINDIT_NETWORK } from '../generation/finditNetwork.js';
import { asPlayerKeyHex } from '../types.js';

/**
 * `whois <ip|domain>` — who holds this address?
 *
 * The registry answers from the world's declaration alone: every network's address is
 * derived from its place in the world, so the organisation, town and region behind any
 * address are known without asking anybody on it.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';

const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  const connected = { ...wlan0, association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' }, ipv4: localIp };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const onlineEnv = (): CommandEnv =>
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
  drain(await whois.execute(onlineEnv(), args, new Map()));

/** `api` with every function replaced by one that fails, as a server out of reach would.
 *  Rebuilt key by key, so the result has `api`'s shape; the assertion only restores the
 *  type `Object.fromEntries` cannot carry. */
const failing = <Api extends object>(api: Api): Api =>
  Object.fromEntries(
    Object.keys(api).map((name) => [
      name,
      () => {
        throw new Error(`whois reached a server through ${name}`);
      },
    ]),
  ) as Api;

/** Where a declared network answers. Every network these tests ask about is declared, so
 *  a missing address is a broken test, not an answer. */
const addressOf = (key: string): string => {
  const address = publicAddress(key);
  if (address === undefined) throw new Error(`${key} is not declared`);
  return address;
};

describe('whois', () => {
  it("names the network behind a sited landmark's address, its organisation, domain, town and region", async () => {
    const address = addressOf('CITY-HALL-WIFI');

    const { lines, exitCode } = await run(address);

    expect({ lines, exitCode }).toEqual({
      lines: [
        '% Harrow Valley registry',
        '',
        `inetnum:        ${address} - ${address}`,
        'netname:        CITY-HALL-WIFI',
        'org-name:       City of Ridgemont',
        'domain:         ridgemont.gov',
        'city:           Ridgemont',
        'region:         Harrow Valley',
      ],
      exitCode: 0,
    });
  });

  it("names the town's ISP as the organisation of a network that publishes no site, and no domain", async () => {
    const address = addressOf('CASA-DE-RAMIREZ');

    const { lines, exitCode } = await run(address);

    expect({ lines, exitCode }).toEqual({
      lines: [
        '% Harrow Valley registry',
        '',
        `inetnum:        ${address} - ${address}`,
        'netname:        CASA-DE-RAMIREZ',
        'org-name:       Ridgemont Broadband',
        'city:           Ridgemont',
        'region:         Harrow Valley',
      ],
      exitCode: 0,
    });
  });

  it("names a home in another town by its wifi, with that town's ISP as its organisation", async () => {
    const home = DECLARED_NETWORKS.find(
      (network) => network.town === 'Millbrook' && network.category === 'residential',
    );
    if (home === undefined) throw new Error('Millbrook declares no home');
    const address = addressOf(home.key);

    const { lines, exitCode } = await run(address);

    expect({ lines, exitCode }).toEqual({
      lines: [
        '% Harrow Valley registry',
        '',
        `inetnum:        ${address} - ${address}`,
        `netname:        ${home.essid}`,
        'org-name:       Millbrook Broadband',
        'city:           Millbrook',
        'region:         Harrow Valley',
      ],
      exitCode: 0,
    });
  });

  it("names a corporation's branch after the company that holds its line, in the branch's town", async () => {
    // A real registry names the company holding the line, not the village office.
    const branch = DECLARED_NETWORKS.find(
      (network) => network.town === 'Millbrook' && network.parent !== undefined,
    );
    if (branch === undefined) throw new Error('Millbrook declares no branch');
    const parent = DECLARED_NETWORKS.find((network) => network.key === branch.parent);
    const address = addressOf(branch.key);

    const { lines, exitCode } = await run(address);

    expect({ lines, exitCode }).toEqual({
      lines: [
        '% Harrow Valley registry',
        '',
        `inetnum:        ${address} - ${address}`,
        `netname:        ${branch.essid}`,
        `org-name:       ${parent?.site?.name}`,
        'city:           Millbrook',
        'region:         Harrow Valley',
      ],
      exitCode: 0,
    });
    expect(parent?.site?.name).toBe('Lorimer Group');
  });

  it('names no town or region for a corporation, which stands in none', async () => {
    const address = addressOf('ACME-CORP');

    const { lines, exitCode } = await run(address);

    expect({ lines, exitCode }).toEqual({
      lines: [
        '% Harrow Valley registry',
        '',
        `inetnum:        ${address} - ${address}`,
        'netname:        ACME-CORP',
        'org-name:       Acme Corporation',
        'domain:         acme.com',
      ],
      exitCode: 0,
    });
  });

  it('names findit, which broadcasts no wifi, by its domain spelt as a network name', async () => {
    const address = addressOf(FINDIT_NETWORK);

    const { lines, exitCode } = await run(address);

    expect({ lines, exitCode }).toEqual({
      lines: [
        '% Harrow Valley registry',
        '',
        `inetnum:        ${address} - ${address}`,
        'netname:        FINDIT-IO',
        'org-name:       findit.io',
        'domain:         findit.io',
      ],
      exitCode: 0,
    });
  });

  it('names a network in another town by the wifi it broadcasts, never by its key', async () => {
    const townHall = DECLARED_NETWORKS.find(
      (network) => network.town === 'Millbrook' && network.essid === 'TOWN-HALL-WIFI',
    );
    if (townHall === undefined) throw new Error("Millbrook's town hall is not declared");
    const address = addressOf(townHall.key);

    const { lines, exitCode } = await run(address);

    expect({ lines, exitCode }).toEqual({
      lines: [
        '% Harrow Valley registry',
        '',
        `inetnum:        ${address} - ${address}`,
        'netname:        TOWN-HALL-WIFI',
        'org-name:       Millbrook Town Council',
        'domain:         millbrook.gov',
        'city:           Millbrook',
        'region:         Harrow Valley',
      ],
      exitCode: 0,
    });
  });

  it('names every network the world declares at its own address, and where it stands', async () => {
    const answers = await Promise.all(
      DECLARED_NETWORKS.map(async (network) => ({
        network,
        address: addressOf(network.key),
        lines: (await run(addressOf(network.key))).lines,
      })),
    );

    answers.forEach(({ network, address, lines }) => {
      expect(lines).toContain(`netname:        ${network.essid}`);
      // A network stands in a town exactly when its address is in a region's block; the
      // catalog's corporations answer in the placeless one.
      const inTown = REGION_FIRST_OCTETS.includes(Number(address.split('.')[0]));
      const place = lines.filter((line) => line.startsWith('city:') || line.startsWith('region:'));
      expect(place).toEqual(
        inTown ? [`city:           ${network.town}`, 'region:         Harrow Valley'] : [],
      );
    });
  });

  it('answers a domain with the record of the network whose site it names, in any case', async () => {
    const byAddress = await run(addressOf('CITY-HALL-WIFI'));

    const byDomain = await run('RIDGEMONT.gov');

    expect(byDomain).toEqual(byAddress);
  });

  it.each([
    ['an address in a town block that no network holds', '87.1.0.1'],
    ["a private address on somebody's LAN", '192.168.1.10'],
    ['a domain nobody holds', 'nowhere.example'],
    ["a network's own name, which is neither an address nor a domain", 'CITY-HALL-WIFI'],
    ['a lab network the world does not declare', 'MYSQL-LAB-3'],
    ['junk', 'not-an-address!'],
  ])('finds no entry for %s', async (_what, query) => {
    const { lines, exitCode } = await run(query);

    expect({ lines, exitCode }).toEqual({
      lines: ['% Harrow Valley registry', '', '%ERROR:101: no entries found'],
      exitCode: 1,
    });
  });

  it('reports usage when asked about nothing, even with no network joined', async () => {
    const result = await drain(await whois.execute(mockCommandEnv(), [], new Map()));

    expect(result).toEqual({ lines: ['whois: usage: whois <ip|domain>'], exitCode: 1 });
  });

  it('asks nobody on the network: it answers the same with every server out of reach', async () => {
    const env = onlineEnv();
    const unreachable = mockCommandEnv({
      ...env,
      remote: failing(env.remote),
      scan: failing(env.scan),
      log: failing(env.log),
      homeNetwork: failing(env.homeNetwork),
      patches: failing(env.patches),
      ssh: failing(env.ssh),
      nc: failing(env.nc),
      ftp: failing(env.ftp),
      mysql: failing(env.mysql),
      redis: failing(env.redis),
      snmp: failing(env.snmp),
      scp: failing(env.scp),
      apt: failing(env.apt),
      su: failing(env.su),
      reboot: failing(env.reboot),
      hydra: failing(env.hydra),
      exploit: failing(env.exploit),
    });
    const address = addressOf('CITY-HALL-WIFI');

    const answer = await drain(await whois.execute(unreachable, [address], new Map()));

    expect(answer).toEqual(await run(address));
  });

  it('cannot reach the registry with no network joined', async () => {
    const result = await drain(
      await whois.execute(mockCommandEnv(), [addressOf('CITY-HALL-WIFI')], new Map()),
    );

    expect(result).toEqual({
      lines: ['whois: network is unreachable — connect to a network first'],
      exitCode: 1,
    });
  });
});
