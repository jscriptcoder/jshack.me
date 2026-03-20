import type { WifiNetwork } from '../network/wifiNetworks';
import { createPrng } from './prng';

const crackableEssids: readonly string[] = [
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
];

const noiseEssids: readonly string[] = [
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
];

// Password pool for crackable networks — short, dictionary-style words
// that feel realistic for WPA2 cracking with a wordlist
const wifiPasswords: readonly string[] = [
  'sunshine2024',
  'football99',
  'iloveyou!',
  'princess01',
  'trustno1',
  'letmein123',
  'welcome1',
  'shadow2024',
  'master2024',
  'dragon123',
  'qwerty2024',
  'monkey123',
  'passw0rd!',
  'batman2024',
  'access2024',
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
  const pickedEssids = prng.pickN(crackableEssids, crackableCount);
  const pickedPasswords = prng.pickN(wifiPasswords, crackableCount);
  const usedChannels = new Set<number>();

  const pickChannel = (): number => {
    const available = allChannels.filter((c) => !usedChannels.has(c));
    const channel = available.length > 0 ? prng.pick(available) : prng.pick(allChannels);
    usedChannels.add(channel);
    return channel;
  };

  const crackable: readonly WifiNetwork[] = pickedEssids.map((essid, i) => ({
    bssid: generateMac(prng),
    essid,
    power: prng.nextInt(-65, -35),
    channel: pickChannel(),
    encryption: 'WPA2' as const,
    crackable: true,
    password: pickedPasswords[i],
  }));

  // 3-5 noise networks
  const noiseCount = prng.nextInt(3, 5);
  const pickedNoiseEssids = prng.pickN(noiseEssids, noiseCount);

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
