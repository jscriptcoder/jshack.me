import type { Command, AsyncOutput } from '../components/Terminal/types';
import { WIFI_NETWORKS, type WifiNetwork } from '../network/wifiNetworks';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type AirdumpContext = {
  readonly isOnLocalhost: () => boolean;
  readonly isMonitorMode: () => boolean;
};

const padRight = (str: string, len: number): string =>
  str.length >= len ? str : str + ' '.repeat(len - str.length);

const padLeft = (str: string, len: number): string =>
  str.length >= len ? str : ' '.repeat(len - str.length) + str;

const formatNetworkRow = (network: WifiNetwork): string =>
  [
    padRight(network.bssid, 20),
    padLeft(String(network.power), 4),
    padLeft(String(network.channel), 4),
    padRight(network.encryption, 6),
    network.essid,
  ].join('  ');

const HEADER = [
  '',
  padRight('BSSID', 20) +
    '  ' +
    padLeft('PWR', 4) +
    '  ' +
    padLeft('CH', 4) +
    '  ' +
    padRight('ENC', 6) +
    '  ESSID',
  '',
].join('\n');

const SCAN_DELAY_MS = 600;

export const createAirdumpCommand = (context: AirdumpContext): Command => ({
  name: 'airdump',
  description: 'Scan for nearby wireless networks',
  manual: {
    synopsis: 'airdump()',
    description:
      'Capture and display wireless network traffic. Shows nearby access points with signal strength, channel, and encryption. Requires monitor mode to be enabled first via airmon("start", "wlan0").',
    examples: [{ command: 'airdump()', description: 'Scan for WiFi networks' }],
  },
  fn: (): AsyncOutput => {
    const { isOnLocalhost, isMonitorMode } = context;

    if (!isOnLocalhost()) {
      throw new Error('airdump: command not available on this machine');
    }

    if (!isMonitorMode()) {
      throw new Error('airdump: monitor mode not enabled — run airmon("start", "wlan0") first');
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(' CH  0 ][ Elapsed: 0 s ][ scanning...');
        onLine(HEADER);

        WIFI_NETWORKS.forEach((network, index) => {
          token.schedule(
            () => {
              if (token.isCancelled()) return;
              onLine(formatNetworkRow(network));

              if (index === WIFI_NETWORKS.length - 1) {
                token.schedule(() => {
                  if (token.isCancelled()) return;
                  onLine('');
                  onLine(`Scan complete — ${WIFI_NETWORKS.length} networks found`);
                  onComplete();
                }, jitter(SCAN_DELAY_MS));
              }
            },
            jitter((index + 1) * SCAN_DELAY_MS),
          );
        });
      },
      cancel: token.cancel,
    };
  },
});
