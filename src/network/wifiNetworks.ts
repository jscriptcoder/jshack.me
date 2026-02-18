export type WifiNetwork = {
  readonly bssid: string;
  readonly essid: string;
  readonly power: number;
  readonly channel: number;
  readonly encryption: 'WPA2' | 'WPA3' | 'WEP' | 'OPEN';
  readonly crackable: boolean;
  readonly password?: string;
};

export const WIFI_NETWORKS: readonly WifiNetwork[] = [
  {
    bssid: 'A4:CF:12:D3:8B:7A',
    essid: 'JSHACK-CORP',
    power: -42,
    channel: 6,
    encryption: 'WPA2',
    crackable: true,
    password: 'cr4ck3d_w1f1',
  },
  {
    bssid: '8E:1F:64:A7:22:9C',
    essid: 'NetGear-5G-Home',
    power: -71,
    channel: 11,
    encryption: 'WPA3',
    crackable: false,
  },
  {
    bssid: 'D2:F0:B8:4E:91:C5',
    essid: 'FBI_Van_7',
    power: -85,
    channel: 1,
    encryption: 'WPA2',
    crackable: false,
  },
  {
    bssid: '00:11:22:33:44:55',
    essid: '<hidden>',
    power: -93,
    channel: 3,
    encryption: 'WPA2',
    crackable: false,
  },
];

export const findWifiNetwork = (bssid: string): WifiNetwork | undefined =>
  WIFI_NETWORKS.find((n) => n.bssid === bssid);

export const findWifiNetworkByEssid = (essid: string): WifiNetwork | undefined =>
  WIFI_NETWORKS.find((n) => n.essid === essid);
