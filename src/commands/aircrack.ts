import type { Command, AsyncOutput } from '../components/Terminal/types';
import { findWifiNetwork } from '../network/wifiNetworks';
import { createCancellationToken } from '../utils/asyncCommand';

type AircrackContext = {
  readonly isOnLocalhost: () => boolean;
  readonly isMonitorMode: () => boolean;
  readonly setWifiConnected: (connected: boolean) => void;
};

const TOTAL_KEYS = 14344;
const KEYS_PER_SECOND = 1142;
const STEP_DELAY_MS = 400;

export const createAircrackCommand = (context: AircrackContext): Command => ({
  name: 'aircrack',
  description: 'Crack WPA/WPA2 wireless network keys',
  manual: {
    synopsis: 'aircrack(bssid: string)',
    description:
      'Attempt to crack the WPA/WPA2 key for a target wireless network using a wordlist attack. The BSSID can be found via airdump(). Requires monitor mode to be enabled.',
    arguments: [
      {
        name: 'bssid',
        description: 'Target network BSSID (e.g., "A4:CF:12:D3:8B:7A")',
        required: true,
      },
    ],
    examples: [
      { command: 'aircrack("A4:CF:12:D3:8B:7A")', description: 'Crack the target network' },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { isOnLocalhost, isMonitorMode, setWifiConnected } = context;

    if (!isOnLocalhost()) {
      throw new Error('aircrack: command not available on this machine');
    }

    if (!isMonitorMode()) {
      throw new Error('aircrack: monitor mode not enabled — run airmon("start", "wlan0") first');
    }

    const bssid = args[0] as string | undefined;

    if (!bssid) {
      throw new Error('aircrack: missing BSSID — usage: aircrack("AA:BB:CC:DD:EE:FF")');
    }

    const network = findWifiNetwork(bssid);

    if (!network) {
      throw new Error(`aircrack: BSSID ${bssid} not found — run airdump() to scan for networks`);
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`Opening capture file for ${network.essid} (${bssid})...`);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('Reading packets from capture file...');
        }, STEP_DELAY_MS);

        token.schedule(() => {
          if (token.isCancelled()) return;

          if (network.encryption === 'WPA3') {
            onLine(`${network.essid} uses WPA3 — handshake capture not supported`);
            onLine('');
            onLine('Quitting aircrack...');
            onComplete();
            return;
          }

          if (network.power < -80) {
            onLine(`Signal too weak (${network.power} dBm) — no handshake captured`);
            onLine('');
            onLine('Quitting aircrack...');
            onComplete();
            return;
          }

          onLine('Launching aircrack with /usr/share/wordlists/rockyou.txt...');
          onLine('');

          const steps = 6;
          const keysPerStep = Math.floor(TOTAL_KEYS / steps);

          for (let i = 1; i <= steps; i++) {
            const stepIndex = i;
            token.schedule(
              () => {
                if (token.isCancelled()) return;

                const tested = Math.min(stepIndex * keysPerStep, TOTAL_KEYS);
                const elapsed = String(stepIndex * 2).padStart(2, '0');
                onLine(
                  `[00:00:${elapsed}] ${tested}/${TOTAL_KEYS} keys tested (${KEYS_PER_SECOND} k/s)`,
                );

                if (stepIndex === steps) {
                  token.schedule(
                    () => {
                      if (token.isCancelled()) return;

                      if (network.crackable && network.password) {
                        onLine('');
                        onLine(`                 KEY FOUND! [ ${network.password} ]`);
                        onLine('');
                        onLine(`Connecting to ${network.essid}...`);
                        onLine(`Successfully connected to ${network.essid}`);
                        onLine('wlan0: DHCP assigned 192.168.1.100/24 via 192.168.1.1');
                        setWifiConnected(true);
                      }
                      onComplete();
                    },
                    STEP_DELAY_MS,
                  );
                }
              },
              (i + 1) * STEP_DELAY_MS,
            );
          }
        }, 2 * STEP_DELAY_MS);
      },
      cancel: token.cancel,
    };
  },
});
