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
 *     Gate-passable by `aircrack` (Slice 4).
 *   - 3-5 NOISE APs: each fails exactly ONE aircrack gate — WPA3 (handshake
 *     unsupported), weak signal (< -80 dBm), or hidden ESSID — so `aircrack`
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
 * in range. On top of the base catalog draw it can INJECT currently-occupied
 * ESSIDs (passed in by the caller, read name-only from the occupancy table) as
 * normal crackable APs — that is how a stranger stumbles onto another player's
 * live network and cracks it to the key that actually works. The injected sample
 * is random and may be empty, so visibility stays chance-based, not guaranteed;
 * an occupied ESSID the base draw already produced is never doubled.
 */

import { bssidFromEssid, type WifiNetwork } from '../network/wifi';
import { createPrng } from './prng';
import { secrets } from '../secrets/__encoded';

const wifiPasswords: readonly string[] = JSON.parse(secrets.WIFI_PASSWORDS) as readonly string[];

// The crackable password is the network's IDENTITY (ESSID-seeded), like the
// BSSID — so the same AP cracks to the same password for every player who sees
// it, never a per-player draw. This is what lets two occupants of one ESSID
// agree on the credential (Story 7).
const passwordForEssid = (essid: string): string =>
  createPrng(`wifi-pw-${essid}`).pick(wifiPasswords);

// Crackable ESSID catalog (ported verbatim, minus the `tier` field). Convention:
// crackable ESSIDs are fictional/parody; real-world brand names live in the
// noise pool. Grouped by category for readability — selection is flat-random.
export const crackableEssidPool: readonly string[] = [
  // Corporate parody — pop-culture / sci-fi mega-corps and small offices (20)
  'ACME-CORP',
  'INITECH-5G',
  'GLOBEX-NET',
  'WAYSTAR-WIFI',
  'DUNDER-LAN',
  'HOOLI-SEC',
  'UMBRELLA-NET',
  'STARK-WIFI',
  'CYBERDYNE-5G',
  'OSCORP-GUEST',
  'WEYLAND-NET',
  'TYRELL-CORP',
  'APERTURE-WIFI',
  'SHINRA-5G',
  'ABSTERGO-NET',
  'WONKA-LABS',
  'OMNI-CORP',
  'PIED-PIPER',
  'VANDELAY-INDUSTRIES',
  'NAKATOMI-PLAZA',

  // Café — public seating, high foot traffic (6)
  'BREW-AND-CODE',
  'BEAN-THERE-WIFI',
  'MIDNIGHT-DINER',
  'NIGHT-OWL-CAFE',
  'GROUND-ZERO-COFFEE',
  'ESPRESSO-EXPRESS',

  // Residential — apartments and family homes (6)
  'APT-3B-WIFI',
  'UPSTAIRS-NEIGHBOR',
  'FAMILY-WIFI-2G',
  'CASA-DE-RAMIREZ',
  'SUITE-401',
  'HOUSE-OF-CARDS',

  // University — dorms, labs, campus open networks (5)
  'UNIV-DORM-7',
  'CS-DEPT-LAB',
  'GRAD-STUDENT-WIFI',
  'CAMPUS-GUEST-OPEN',
  'LIB-2ND-FLOOR',

  // Public infrastructure — libraries, parks, transit (5)
  'LIBRARY-PATRON',
  'CITY-PARK-WIFI',
  'METRO-COMMUTER',
  'AIRPORT-LOUNGE-VIP',
  'TRAIN-STATION-FREE',

  // IoT defaults — single-device APs left in factory config (4)
  'SMART-FRIDGE-NET',
  'EV-CHARGER-LOT-3',
  'DOORBELL-CAM-OPEN',
  'ROBOVAC-AP',

  // Hacker scene easter eggs (4)
  'DEFCON-VILLAGE',
  'HACKERSPACE-2600',
  'BOFH-KEEPOUT',
  'NULL-BYTE',
];

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

/** At most this many occupied ESSIDs surface in any single scan — keeps an
 *  injected list realistic and bounds the per-scan reveal. */
const INJECT_MAX = 3;

export type GenerateWifiInput = {
  /** The player's identity pubkey — the per-identity half of the scan seed. */
  readonly seedPubkeyHex: string;
  /** Which scan this is (0, 1, 2, …) — the per-scan half of the seed, so
   *  re-scanning re-rolls. Defaults to the first scan. */
  readonly scanIndex?: number;
  /** ESSIDs other players currently occupy (name-only). A random subset is
   *  injected as crackable APs so a stranger can discover a live network.
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

  // Inject a random subset of currently-occupied ESSIDs, deduped against the base
  // draw so an already-shown network is never doubled. An empty injectable set
  // takes NO prng draw, so a plain scan stays byte-identical to the base roll.
  const injectableEssids = occupiedEssids.filter((essid) => !pickedEssids.includes(essid));
  const injectCount =
    injectableEssids.length === 0
      ? 0
      : prng.nextInt(0, Math.min(injectableEssids.length, INJECT_MAX));
  const injectedEssids = prng.pickN(injectableEssids, injectCount);
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
