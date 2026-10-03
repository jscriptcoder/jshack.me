/**
 * generateWifi — the seeded WiFi-scan generator.
 *
 * Deterministic from the player's identity pubkey (like `buildWorkstationBaseFs`
 * and `buildColdStartConnectivity`): the same player always sees the same APs.
 * Ported + simplified from legacy `generation/generateWifi.ts`, dropping the
 * `tier` field (home-network density, deferred with the shared-LAN model).
 *
 * Two populations:
 *   - 2-3 CRACKABLE APs: WPA2, strong signal (-65..-35 dBm), visible ESSID,
 *     carrying a real password drawn from the encoded `WIFI_PASSWORDS` pool.
 *     Gate-passable by `aircrack-ng` (Slice 4).
 *   - 3-5 NOISE APs: each fails exactly ONE aircrack-ng gate — WPA3 (handshake
 *     unsupported), weak signal (< -80 dBm), or hidden ESSID — so `aircrack-ng`
 *     re-derives the failure from observable state, no separate tag needed.
 *
 * BSSIDs and crackable passwords both derive from the ESSID (`bssidFromEssid` /
 * `passwordForEssid`), not per-player PRNG state, so the same network shows the
 * same MAC and cracks to the same password for everyone who sees it (the basis
 * for two players sharing one access point, Story 7). Hidden APs derive their
 * BSSID from the ORIGINAL essid before the `<hidden>` substitution, else every
 * hidden entry would collide on one BSSID.
 *
 * Each scan is a FRESH ROLL, not a once-per-identity fixture: the seed mixes in
 * a per-scan index, so re-scanning ("relocating") re-draws which subset of APs is
 * in range. On top of the base draw from Ridgemont it can INJECT one network another
 * player occupies (the caller passes the occupancy table's names), as a normal
 * crackable AP — that is how a stranger stumbles onto another player's live network
 * and cracks it to the key that actually works. It happens in about one scan in
 * twenty, so landing on somebody's network stays rare in a world this size, and it
 * draws only from Ridgemont's own networks the scan does not already show: the
 * player stands in Ridgemont, so nothing else is in range.
 */

import { bssidFromEssid, type WifiNetwork } from '../network/wifi.js';
import { createPrng } from './prng.js';
import { secrets } from '../secrets/__encoded.js';
import { DECLARED_NETWORKS, RIDGEMONT } from './world.js';

const wifiPasswords: readonly string[] = JSON.parse(secrets.WIFI_PASSWORDS) as readonly string[];

// The crackable password is the network's IDENTITY (ESSID-seeded), like the
// BSSID — so the same AP cracks to the same password for every player who sees
// it, never a per-player draw. This is what lets two occupants of one ESSID
// agree on the credential (Story 7).
const passwordForEssid = (essid: string): string =>
  createPrng(`wifi-pw-${essid}`).pick(wifiPasswords);

// Every network in Ridgemont, where everybody stands, by the key it is known by: the
// landmarks in the catalog's order, then the networks the town draws. The scan picks from
// this list by position, so its order decides which networks every player is offered. A
// landmark's key is the name it broadcasts; a drawn network's is not, and is shown by its
// name wherever a player reads it.
export const crackableEssidPool: readonly string[] = DECLARED_NETWORKS.filter(
  (network) => network.town === RIDGEMONT,
).map((network) => network.key);

// Noise ESSIDs — cosmetic only, never crackable. Real-world consumer brand
// names, mobile hotspot defaults, joke / paranoia entries, big-chain free WiFi.
export const noiseEssidPool: readonly string[] = [
  // ISP / router defaults
  'NetGear-5G-Home',
  'FBI_Van_7',
  'xfinitywifi',
  'DIRECT-roku',
  'HP-Print-A3',
  'ATT-WIFI-9F2A',
  'Verizon_K8HGT4',
  'NETGEAR42',
  'linksys',
  'TP-LINK_GUEST',
  'HOME-WIFI-2.4G',
  'CenturyLink4521',
  'ORBI-MESH-5G',
  'Google_Fiber_AX',
  'Spectrum-WiFi-62',
  'ASUS_RT_AC68U',
  'Pretty_Fly_WiFi',
  'T-Mobile_Home_3B',
  'Eero-Living-Room',
  'DIRECT-hp-print',

  // Mobile hotspots — personal device defaults
  'iPhone von Klaus',
  "Mike's iPhone",
  'Galaxy-S25-AP',
  'Pixel-Hotspot-9',
  'OnePlus-AP',

  // Paranoia — surveillance jokes
  'CIA_SURVEILLANCE_VAN',
  'NSA_LISTENING_POST',
  'COPS_NEARBY',
  'DRONE_OVERHEAD',
  'BLACK_HELICOPTER',

  // Big-chain restaurant free WiFi
  'STARBUCKS',
  'MCDONALDS-WIFI',
  'SUBWAY_WIFI',
  'CHIPOTLE-GUEST',

  // Sad / vague atmospheric entries
  'my-wifi',
  'FREE_INTERNET',
  'password_is_password',
  'LAB_PROJECT_X',

  // Extra ISP / printer
  'COMCAST-HOMENET',
  'BROTHER-PRINTER',
];

const allChannels: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

type NoiseReason = 'wpa3' | 'weak-signal' | 'hidden';

const noiseReasons: readonly NoiseReason[] = ['wpa3', 'weak-signal', 'hidden'];

/** The share of scans that show another player's network, when one is in range. Rare
 *  enough that stumbling onto somebody is an event, common enough that two players who
 *  mean to meet do in about 16 rescans. */
const INJECT_CHANCE = 0.05;

export type GenerateWifiInput = {
  /** The player's identity pubkey — the per-identity half of the scan seed. */
  readonly seedPubkeyHex: string;
  /** Which scan this is (0, 1, 2, …) — the per-scan half of the seed, so
   *  re-scanning re-rolls. Defaults to the first scan. */
  readonly scanIndex?: number;
  /** Networks other players currently occupy (name-only). Now and then one in range
   *  is injected as a crackable AP so a stranger can discover a live network.
   *  Defaults to none (a plain own-LAN scan). */
  readonly occupiedEssids?: readonly string[];
};

export const generateWifi = ({
  seedPubkeyHex,
  scanIndex = 0,
  occupiedEssids = [],
}: GenerateWifiInput): readonly WifiNetwork[] => {
  const prng = createPrng(`wifi-${seedPubkeyHex}-${scanIndex}`);

  const crackableCount = prng.nextInt(2, 3);
  const pickedEssids = prng.pickN(crackableEssidPool, crackableCount);

  // Another player's network is in range only if it is one of Ridgemont's and the scan
  // does not already show it. Read in the pool's order, so the order the server lists
  // occupants in never changes a scan. With none in range the scan takes NO prng draw,
  // so it stays byte-identical to the base roll.
  const occupied = new Set(occupiedEssids);
  const injectableEssids = crackableEssidPool.filter(
    (essid) => occupied.has(essid) && !pickedEssids.includes(essid),
  );
  const injectedEssids =
    injectableEssids.length > 0 && prng.next() < INJECT_CHANCE ? [prng.pick(injectableEssids)] : [];
  const allCrackableEssids = [...pickedEssids, ...injectedEssids];

  const usedChannels = new Set<number>();
  const pickChannel = (): number => {
    const available = allChannels.filter((channel) => !usedChannels.has(channel));
    const channel = available.length > 0 ? prng.pick(available) : prng.pick(allChannels);
    usedChannels.add(channel);
    return channel;
  };

  const crackable: readonly WifiNetwork[] = allCrackableEssids.map((essid) => ({
    bssid: bssidFromEssid(essid),
    essid,
    power: prng.nextInt(-65, -35),
    channel: pickChannel(),
    encryption: 'WPA2',
    crackable: true,
    password: passwordForEssid(essid),
  }));

  const noiseCount = prng.nextInt(3, 5);
  const pickedNoiseEssids = prng.pickN(noiseEssidPool, noiseCount);

  const noise: readonly WifiNetwork[] = pickedNoiseEssids.map((essid) => {
    const reason = prng.pick(noiseReasons);
    const isHidden = reason === 'hidden';
    return {
      // Derive from the ORIGINAL essid (before the `<hidden>` placeholder) so
      // hidden entries don't collide on one BSSID.
      bssid: bssidFromEssid(essid),
      essid: isHidden ? '<hidden>' : essid,
      power: reason === 'weak-signal' ? prng.nextInt(-95, -81) : prng.nextInt(-78, -65),
      channel: pickChannel(),
      encryption: reason === 'wpa3' ? 'WPA3' : 'WPA2',
      crackable: false,
    };
  });

  return prng.shuffle([...crackable, ...noise]);
};
