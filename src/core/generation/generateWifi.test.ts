import { describe, expect, it } from 'vitest';
import { generateWifi, wifiPoolOf } from './generateWifi.js';
import { startingTown } from './startingTown.js';
import { DECLARED_NETWORKS, isLandmark, RIDGEMONT, TOWNS } from './world.js';
import { ESSID_CATALOG } from './pools/essidCatalog.js';
import { bssidFromEssid, type WifiNetwork } from '../network/wifi.js';
import { secrets } from '../secrets/__encoded.js';

/**
 * `generateWifi` is the seeded WiFi-scan generator: deterministic from the
 * player's identity pubkey, like the workstation FS. It must yield a small set
 * of access points — a few crackable (carrying a real pool password) plus noise
 * APs that each fail exactly one aircrack-ng gate (WPA3 / weak signal / hidden) so
 * Slice 4's `aircrack-ng` can re-derive the failure from observable state.
 *
 * Tests assert the generation INVARIANTS the rest of the arc leans on, not a
 * hand-computed sequence — determinism via repeated calls, counts, and the
 * crackable/noise gate separation.
 */

const POOL = JSON.parse(secrets.WIFI_PASSWORDS) as readonly string[];

const SEED_A = 'a'.repeat(64);
const SEED_B = 'b'.repeat(64);
// This seed happens to roll a `hidden` noise AP — exercises the `<hidden>`
// ESSID substitution and the derive-BSSID-from-the-ORIGINAL-essid rule.
const SEED_HIDDEN = '0'.repeat(64);

/** The first `count` of the keys `<town>-0`, `<town>-1`, … that start a player in
 *  `town`, so a test can stand its players wherever it needs them. */
const keysIn = (town: string, count: number): readonly string[] => {
  const keys: string[] = [];
  for (let index = 0; keys.length < count; index++) {
    if (startingTown(`${town}-${index}`) === town) keys.push(`${town}-${index}`);
  }
  return keys;
};

/** A player who starts in Ridgemont. */
const RIDGEMONT_KEY = 'player-0';

/** The network the world declares under `key`. */
const declaredAs = (key: string) => DECLARED_NETWORKS.find((network) => network.key === key);

const isCrackable = (network: WifiNetwork): network is Extract<WifiNetwork, { crackable: true }> =>
  network.crackable;

/** The three aircrack-ng failure gates a noise AP must hit exactly one of. */
const failedGates = (network: WifiNetwork): readonly string[] =>
  [
    network.encryption === 'WPA3' ? 'wpa3' : null,
    network.power < -80 ? 'weak' : null,
    network.essid === '<hidden>' ? 'hidden' : null,
  ].filter((gate): gate is string => gate !== null);

describe('generateWifi', () => {
  it('is deterministic — the same identity and scan index yield byte-identical networks', () => {
    expect(generateWifi({ seedPubkeyHex: SEED_A })).toEqual(generateWifi({ seedPubkeyHex: SEED_A }));
  });

  it('yields different networks for different identities', () => {
    const bssidsA = generateWifi({ seedPubkeyHex: SEED_A }).map((network) => network.bssid);
    const bssidsB = generateWifi({ seedPubkeyHex: SEED_B }).map((network) => network.bssid);
    expect(bssidsA).not.toEqual(bssidsB);
  });

  it('offers a player in Ridgemont the same crackable networks they have always been offered', () => {
    // The scan picks from the town's networks by position, so this holds their order:
    // reordering them would hand every player a different set of networks.
    const offered = (seedPubkeyHex: string): readonly string[] =>
      generateWifi({ seedPubkeyHex })
        .filter(isCrackable)
        .map((network) => network.essid);

    expect(['player-0', 'player-5', 'player-9'].map((key) => startingTown(key))).toEqual([
      RIDGEMONT,
      RIDGEMONT,
      RIDGEMONT,
    ]);
    expect(offered('player-0')).toEqual(['OSCORP-GUEST', 'BREW-AND-CODE']);
    expect(offered('player-5')).toEqual(['r0/t0/n118', 'r0/t0/n120']);
    expect(offered('player-9')).toEqual(['LIBRARY-PATRON', 'r0/t0/n134']);
  });

  it("draws a player in Ridgemont from every one of its 178 networks, the landmarks first in the catalog's order", () => {
    const drawn = DECLARED_NETWORKS.filter(
      (network) => network.town === RIDGEMONT && !isLandmark(network.key),
    );
    expect(drawn).toHaveLength(121);
    expect(wifiPoolOf(RIDGEMONT)).toEqual([
      ...ESSID_CATALOG.map((entry) => entry.essid),
      ...drawn.map((network) => network.key),
    ]);
  });

  it('offers a network Ridgemont draws as it offers a landmark, under the key its password and BSSID derive from', () => {
    const offered = Array.from({ length: 40 }, (_, scanIndex) =>
      generateWifi({ seedPubkeyHex: RIDGEMONT_KEY, scanIndex }).filter(isCrackable),
    ).flat();
    const drawn = offered.filter((network) => network.essid.startsWith('r0/t0/'));
    expect(drawn.length).toBeGreaterThan(0);
    for (const network of drawn) {
      expect(network.bssid).toBe(bssidFromEssid(network.essid));
      expect(POOL).toContain(network.password);
      expect(network.encryption).toBe('WPA2');
    }
  });

  it("offers only the networks of the town the player's key starts them in, homes among them", () => {
    // Another town's networks are out of wifi range and reachable over the internet alone.
    for (const town of TOWNS) {
      const offered = keysIn(town.name, 5).flatMap((seedPubkeyHex) =>
        Array.from({ length: 100 }, (_, scanIndex) =>
          generateWifi({ seedPubkeyHex, scanIndex }).filter(isCrackable),
        ).flat(),
      );
      const elsewhere = offered
        .map((network) => ({ essid: network.essid, town: declaredAs(network.essid)?.town }))
        .filter((network) => network.town !== town.name);

      expect(elsewhere).toEqual([]);
      expect(offered.some((network) => declaredAs(network.essid)?.category === 'residential')).toBe(
        true,
      );
    }
  });

  it("offers a town's networks in the order the world declares them", () => {
    for (const town of TOWNS) {
      expect(wifiPoolOf(town.name)).toEqual(
        DECLARED_NETWORKS.filter((network) => network.town === town.name).map(
          (network) => network.key,
        ),
      );
    }
  });

  it('yields 2-3 crackable and 3-5 noise networks', () => {
    const networks = generateWifi({ seedPubkeyHex: SEED_A });
    const crackable = networks.filter(isCrackable);
    const noise = networks.filter((network) => !network.crackable);

    expect(crackable.length).toBeGreaterThanOrEqual(2);
    expect(crackable.length).toBeLessThanOrEqual(3);
    expect(noise.length).toBeGreaterThanOrEqual(3);
    expect(noise.length).toBeLessThanOrEqual(5);
  });

  it('derives each crackable AP password from its ESSID (same network → same password for everyone)', () => {
    // Sweep many identities and group every crackable sighting by ESSID. The
    // password is the network's IDENTITY (ESSID-seeded), like the BSSID — so the
    // same AP must crack to the same password for whoever sees it, never a
    // per-player draw.
    const occurrences = new Map<string, string[]>();
    for (let index = 0; index < 80; index++) {
      const seed = index.toString().padStart(64, '0');
      for (const network of generateWifi({ seedPubkeyHex: seed }).filter(isCrackable)) {
        const passwords = occurrences.get(network.essid) ?? [];
        passwords.push(network.password);
        occurrences.set(network.essid, passwords);
      }
    }

    const repeated = [...occurrences.values()].filter((passwords) => passwords.length > 1);
    // The sweep must actually surface a repeated ESSID, else the check is vacuous.
    expect(repeated.length).toBeGreaterThan(0);
    // Each repeated ESSID carries ONE password across every sighting.
    for (const passwords of repeated) {
      expect(new Set(passwords).size).toBe(1);
    }
    // ...and the password tracks the ESSID, not a constant: distinct ESSIDs do
    // not all collapse onto a single password (kills a constant-seed mutant).
    const distinctPasswords = new Set([...occurrences.values()].map((passwords) => passwords[0]!));
    expect(distinctPasswords.size).toBeGreaterThan(1);
  });

  it('gives every crackable AP a real pool password and makes it gate-passable', () => {
    for (const network of generateWifi({ seedPubkeyHex: SEED_A }).filter(isCrackable)) {
      expect(POOL).toContain(network.password);
      expect(network.encryption).toBe('WPA2');
      // Strong, realistic signal band: comfortably above the -80 weak gate so
      // the AP is always crackable. The tight band also pins the seeded range.
      expect(network.power).toBeGreaterThanOrEqual(-65);
      expect(network.power).toBeLessThanOrEqual(-35);
      expect(network.essid).not.toBe('<hidden>');
      expect(network.bssid).toBe(bssidFromEssid(network.essid));
    }
  });

  it('makes every noise AP fail exactly one aircrack-ng gate and carry no password', () => {
    for (const network of generateWifi({ seedPubkeyHex: SEED_A }).filter(
      (candidate) => !candidate.crackable,
    )) {
      expect(failedGates(network)).toHaveLength(1);
      expect('password' in network).toBe(false);
      // Realistic dBm band spanning both the weak (-95..-81) and non-weak
      // (-78..-65) noise ranges — pins the seeded power, no positive values.
      expect(network.power).toBeGreaterThanOrEqual(-95);
      expect(network.power).toBeLessThanOrEqual(-65);
    }
  });

  it('shuffles crackable and noise together into a stable seeded order', () => {
    // Golden snapshot for SEED_A's first scan: locks the seeded selection +
    // interleave. SEED_A starts in Stonebury, so its crackable APs are two of that town's
    // networks (its town hall and GATEWAY-SYSTEMS, under their keys). They sit at
    // positions 3 and 6, interleaved with noise rather than grouped — proof the final
    // shuffle actually mixes the two populations.
    const order = generateWifi({ seedPubkeyHex: SEED_A }).map((network) => ({
      essid: network.essid,
      encryption: network.encryption,
      crackable: network.crackable,
    }));
    expect(order).toEqual([
      { essid: '<hidden>', encryption: 'WPA2', crackable: false },
      { essid: '<hidden>', encryption: 'WPA2', crackable: false },
      { essid: 'r0/t10/n0', encryption: 'WPA2', crackable: true },
      { essid: 'SUBWAY_WIFI', encryption: 'WPA2', crackable: false },
      { essid: 'FREE_INTERNET', encryption: 'WPA3', crackable: false },
      { essid: 'r0/t10/n8', encryption: 'WPA2', crackable: true },
      { essid: 'ASUS_RT_AC68U', encryption: 'WPA3', crackable: false },
    ]);
  });

  it('assigns each AP a distinct channel from the 1-11 band', () => {
    const channels = generateWifi({ seedPubkeyHex: SEED_A }).map((network) => network.channel);
    expect(new Set(channels).size).toBe(channels.length);
    for (const channel of channels) {
      expect(channel).toBeGreaterThanOrEqual(1);
      expect(channel).toBeLessThanOrEqual(11);
    }
  });

  it('keeps every power inside its realistic dBm band across many identities', () => {
    // Sweep many seeds so a widened range (a mutated bound) eventually emits an
    // out-of-band value — a single seed's small PRNG fractions can hide it.
    for (let index = 0; index < 40; index++) {
      const seed = index.toString().padStart(64, '0');
      for (const network of generateWifi({ seedPubkeyHex: seed })) {
        if (network.crackable) {
          expect(network.power).toBeGreaterThanOrEqual(-65);
          expect(network.power).toBeLessThanOrEqual(-35);
        } else {
          expect(network.power).toBeGreaterThanOrEqual(-95);
          expect(network.power).toBeLessThanOrEqual(-65);
        }
      }
    }
  });

  it('derives visible BSSIDs from the ESSID (uppercase six-octet MAC)', () => {
    for (const network of generateWifi({ seedPubkeyHex: SEED_A })) {
      expect(network.bssid).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
      if (network.essid !== '<hidden>') {
        expect(network.bssid).toBe(bssidFromEssid(network.essid));
      }
    }
  });

  it('masks a hidden AP as <hidden> but keeps its real (original-ESSID) BSSID', () => {
    const hidden = generateWifi({ seedPubkeyHex: SEED_HIDDEN }).filter(
      (network) => network.essid === '<hidden>',
    );
    expect(hidden.length).toBeGreaterThan(0);
    for (const network of hidden) {
      // BSSID is derived from the ORIGINAL essid, so it must NOT collide on the
      // placeholder's hash — that's what stops every hidden AP sharing one MAC.
      expect(network.bssid).not.toBe(bssidFromEssid('<hidden>'));
      expect(network.bssid).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
    }
  });

  it('re-rolls per scan index — re-scanning need not yield the same networks', () => {
    const rolls = [0, 1, 2, 3, 4].map((scanIndex) =>
      generateWifi({ seedPubkeyHex: SEED_A, scanIndex })
        .map((network) => network.essid)
        .join(','),
    );
    // The scan index is mixed into the seed, so five consecutive scans are not all
    // identical — re-scanning is a fresh roll ("relocating").
    expect(new Set(rolls).size).toBeGreaterThan(1);
  });

  it('is deterministic for a given identity and scan index', () => {
    expect(generateWifi({ seedPubkeyHex: SEED_A, scanIndex: 7 })).toEqual(
      generateWifi({ seedPubkeyHex: SEED_A, scanIndex: 7 }),
    );
  });

  describe("another player's network", () => {
    const RIDGEMONT_CROWD = keysIn(RIDGEMONT, 40);

    // A scan of a player standing in the crowd's town: many players, each scanning many
    // times.
    const scanOf = (
      index: number,
      occupiedEssids: readonly string[] = [],
      crowd: readonly string[] = RIDGEMONT_CROWD,
    ): readonly WifiNetwork[] =>
      generateWifi({
        seedPubkeyHex: crowd[index % crowd.length]!,
        scanIndex: index,
        occupiedEssids,
      });

    /** The networks a scan shows only because somebody occupies them. */
    const injectedInto = (
      index: number,
      occupiedEssids: readonly string[],
      crowd: readonly string[] = RIDGEMONT_CROWD,
    ): readonly WifiNetwork[] => {
      const drawn = new Set(
        scanOf(index, [], crowd)
          .filter(isCrackable)
          .map((network) => network.essid),
      );
      return scanOf(index, occupiedEssids, crowd).filter(
        (network) => network.crackable && !drawn.has(network.essid),
      );
    };

    const SCANS = 2000;
    const OCCUPIED_IN_RIDGEMONT = ['r0/t0/n100', 'CITY-HALL-WIFI', 'r0/t0/n60'];

    it('surfaces in about one scan in twenty, and never two at once', () => {
      const injections = Array.from({ length: SCANS }, (_, index) =>
        injectedInto(index, OCCUPIED_IN_RIDGEMONT),
      );

      const share = injections.filter((injected) => injected.length > 0).length / SCANS;
      expect(share).toBeGreaterThanOrEqual(0.03);
      expect(share).toBeLessThanOrEqual(0.07);
      expect(Math.max(...injections.map((injected) => injected.length))).toBe(1);
    });

    it('surfaces only from the town the player stands in', () => {
      const firstIn = (town: string): string => {
        const network = DECLARED_NETWORKS.find((declared) => declared.town === town);
        if (network === undefined) throw new Error(`${town} declares no network`);
        return network.key;
      };
      // One network in each town, a lab network a dev stack admits, and a name nobody
      // declares.
      const occupied = [
        ...TOWNS.map((town) => firstIn(town.name)),
        'MYSQL-LAB-3',
        'PLAYER-A-LIVE-NET',
      ];

      for (const town of [RIDGEMONT, 'Kingsford', 'Ely']) {
        const crowd = keysIn(town, 40);
        const surfaced = new Set(
          Array.from({ length: SCANS }, (_, index) =>
            injectedInto(index, occupied, crowd).map((network) => network.essid),
          ).flat(),
        );

        expect({ town, surfaced: [...surfaced] }).toEqual({ town, surfaced: [firstIn(town)] });
      }
    });

    it('leaves a scan with nothing to inject exactly as it would be with nobody about', () => {
      for (let index = 0; index < 200; index++) {
        const alone = scanOf(index);
        const shown = alone.filter(isCrackable).map((network) => network.essid);

        expect(scanOf(index, ['MYSQL-LAB-3', 'PLAYER-A-LIVE-NET'])).toEqual(alone);
        expect(scanOf(index, shown)).toEqual(alone);
      }
    });

    it('reads the same whatever order the occupied networks are listed in', () => {
      const occupied = wifiPoolOf(RIDGEMONT).slice(40, 80);
      const reversed = [...occupied].reverse();

      for (let index = 0; index < SCANS; index++) {
        expect(scanOf(index, reversed)).toEqual(scanOf(index, occupied));
      }
    });

    it('surfaces as any crackable network, under the BSSID and password of its key', () => {
      const key = 'r0/t0/n100';
      const sightings = Array.from({ length: SCANS }, (_, index) =>
        injectedInto(index, [key]),
      ).flat();
      const drawn = Array.from({ length: SCANS }, (_, index) => scanOf(index))
        .flat()
        .find((network) => network.essid === key);
      if (drawn === undefined || !drawn.crackable) throw new Error(`no scan draws ${key}`);

      expect(sightings.length).toBeGreaterThan(0);
      for (const network of sightings) {
        expect(network).toEqual({
          bssid: bssidFromEssid(key),
          essid: key,
          power: expect.any(Number),
          channel: expect.any(Number),
          encryption: 'WPA2',
          crackable: true,
          password: drawn.password,
        });
        expect(network.power).toBeGreaterThanOrEqual(-65);
        expect(network.power).toBeLessThanOrEqual(-35);
      }
    });

    it('never doubles a network the scan already shows', () => {
      for (let scanIndex = 0; scanIndex < 20; scanIndex++) {
        const base = generateWifi({ seedPubkeyHex: SEED_A, scanIndex });
        const baseCrackable = base.filter(isCrackable).map((network) => network.essid);
        const roll = generateWifi({
          seedPubkeyHex: SEED_A,
          scanIndex,
          occupiedEssids: [...baseCrackable, ...OCCUPIED_IN_RIDGEMONT],
        });
        for (const essid of baseCrackable) {
          expect(roll.filter((network) => network.essid === essid)).toHaveLength(1);
        }
      }
    });
  });
});
