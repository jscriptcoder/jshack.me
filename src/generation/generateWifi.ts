import type { WifiNetwork, WifiTier } from '../network/wifiNetworks';
import { createPrng } from './prng';
import { secrets } from '../secrets/__encoded';

const wifiPasswords: readonly string[] = JSON.parse(secrets.WIFI_PASSWORDS) as readonly string[];

export type CrackablePoolEntry = {
  readonly essid: string;
  readonly tier: WifiTier;
};

// Crackable ESSID catalog. Each entry carries a density tier consumed by the
// future home-network occupant allocator (crowded = 4-8 slots, shared = 2-3,
// solo = 1). Convention: crackable ESSIDs are fictional/parody; real-world
// brand names live in the noise pool below. Grouped by category for
// readability — selection is flat-random, not category-balanced.
export const crackableEssidPool: readonly CrackablePoolEntry[] = [
  // Corporate parody — pop-culture / sci-fi mega-corps and small offices (20)
  { essid: 'ACME-CORP', tier: 'solo' },
  { essid: 'INITECH-5G', tier: 'shared' },
  { essid: 'GLOBEX-NET', tier: 'solo' },
  { essid: 'WAYSTAR-WIFI', tier: 'solo' },
  { essid: 'DUNDER-LAN', tier: 'shared' },
  { essid: 'HOOLI-SEC', tier: 'solo' },
  { essid: 'UMBRELLA-NET', tier: 'solo' },
  { essid: 'STARK-WIFI', tier: 'solo' },
  { essid: 'CYBERDYNE-5G', tier: 'solo' },
  { essid: 'OSCORP-GUEST', tier: 'shared' },
  { essid: 'WEYLAND-NET', tier: 'solo' },
  { essid: 'TYRELL-CORP', tier: 'solo' },
  { essid: 'APERTURE-WIFI', tier: 'solo' },
  { essid: 'SHINRA-5G', tier: 'solo' },
  { essid: 'ABSTERGO-NET', tier: 'solo' },
  { essid: 'WONKA-LABS', tier: 'solo' },
  { essid: 'OMNI-CORP', tier: 'solo' },
  { essid: 'PIED-PIPER', tier: 'shared' },
  { essid: 'VANDELAY-INDUSTRIES', tier: 'solo' },
  { essid: 'NAKATOMI-PLAZA', tier: 'solo' },

  // Café — public seating, high foot traffic (6)
  { essid: 'BREW-AND-CODE', tier: 'crowded' },
  { essid: 'BEAN-THERE-WIFI', tier: 'crowded' },
  { essid: 'MIDNIGHT-DINER', tier: 'crowded' },
  { essid: 'NIGHT-OWL-CAFE', tier: 'crowded' },
  { essid: 'GROUND-ZERO-COFFEE', tier: 'crowded' },
  { essid: 'ESPRESSO-EXPRESS', tier: 'crowded' },

  // Residential — apartments and family homes (6)
  { essid: 'APT-3B-WIFI', tier: 'shared' },
  { essid: 'UPSTAIRS-NEIGHBOR', tier: 'shared' },
  { essid: 'FAMILY-WIFI-2G', tier: 'shared' },
  { essid: 'CASA-DE-RAMIREZ', tier: 'shared' },
  { essid: 'SUITE-401', tier: 'shared' },
  { essid: 'HOUSE-OF-CARDS', tier: 'shared' },

  // University — dorms, labs, campus open networks (5)
  { essid: 'UNIV-DORM-7', tier: 'crowded' },
  { essid: 'CS-DEPT-LAB', tier: 'shared' },
  { essid: 'GRAD-STUDENT-WIFI', tier: 'shared' },
  { essid: 'CAMPUS-GUEST-OPEN', tier: 'crowded' },
  { essid: 'LIB-2ND-FLOOR', tier: 'crowded' },

  // Public infrastructure — libraries, parks, transit (5)
  { essid: 'LIBRARY-PATRON', tier: 'crowded' },
  { essid: 'CITY-PARK-WIFI', tier: 'crowded' },
  { essid: 'METRO-COMMUTER', tier: 'crowded' },
  { essid: 'AIRPORT-LOUNGE-VIP', tier: 'crowded' },
  { essid: 'TRAIN-STATION-FREE', tier: 'crowded' },

  // IoT defaults — single-device APs left in factory config (4)
  { essid: 'SMART-FRIDGE-NET', tier: 'solo' },
  { essid: 'EV-CHARGER-LOT-3', tier: 'solo' },
  { essid: 'DOORBELL-CAM-OPEN', tier: 'solo' },
  { essid: 'ROBOVAC-AP', tier: 'solo' },

  // Hacker scene easter eggs (4)
  { essid: 'DEFCON-VILLAGE', tier: 'crowded' },
  { essid: 'HACKERSPACE-2600', tier: 'shared' },
  { essid: 'BOFH-KEEPOUT', tier: 'solo' },
  { essid: 'NULL-BYTE', tier: 'solo' },
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

const generateMac = (prng: ReturnType<typeof createPrng>): string => {
  const hex = () => prng.nextInt(0, 255).toString(16).padStart(2, '0').toUpperCase();
  return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
};

const allChannels: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

type NoiseReason = 'wpa3' | 'weak-signal' | 'hidden';

const noiseReasons: readonly NoiseReason[] = ['wpa3', 'weak-signal', 'hidden'];

export const generateWifiNetworks = (seed: string): readonly WifiNetwork[] => {
  const prng = createPrng(`wifi-${seed}`);

  // 2-3 crackable networks
  const crackableCount = prng.nextInt(2, 3);
  const pickedEntries = prng.pickN(crackableEssidPool, crackableCount);
  const pickedPasswords = prng.pickN(wifiPasswords, crackableCount);
  const usedChannels = new Set<number>();

  const pickChannel = (): number => {
    const available = allChannels.filter((c) => !usedChannels.has(c));
    const channel = available.length > 0 ? prng.pick(available) : prng.pick(allChannels);
    usedChannels.add(channel);
    return channel;
  };

  const crackable: readonly WifiNetwork[] = pickedEntries.map((entry, i) => ({
    bssid: generateMac(prng),
    essid: entry.essid,
    power: prng.nextInt(-65, -35),
    channel: pickChannel(),
    encryption: 'WPA2' as const,
    crackable: true,
    password: pickedPasswords[i],
    tier: entry.tier,
  }));

  // 3-5 noise networks
  const noiseCount = prng.nextInt(3, 5);
  const pickedNoiseEssids = prng.pickN(noiseEssidPool, noiseCount);

  const noise: readonly WifiNetwork[] = pickedNoiseEssids.map((essid) => {
    const reason = prng.pick(noiseReasons);
    const isHidden = reason === 'hidden';
    return {
      bssid: generateMac(prng),
      essid: isHidden ? '<hidden>' : essid,
      power: reason === 'weak-signal' ? prng.nextInt(-95, -81) : prng.nextInt(-78, -65),
      channel: pickChannel(),
      encryption: reason === 'wpa3' ? ('WPA3' as const) : ('WPA2' as const),
      crackable: false,
    };
  });

  // Shuffle all networks together
  return prng.shuffle([...crackable, ...noise]);
};
