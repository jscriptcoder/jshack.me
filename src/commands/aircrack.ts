import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { WifiNetwork } from '../network/wifiNetworks';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type AircrackContext = {
  readonly isOnLocalhost: () => boolean;
  readonly isMonitorMode: () => boolean;
  readonly getWifiNetworks: () => readonly WifiNetwork[];
};

const TOTAL_KEYS = 14344;
const KEYS_PER_SECOND = 1142;
const STEP_DELAY_MS = 400;

export const createAircrackCommand = (context: AircrackContext): Command => ({
  name: 'aircrack',
  category: 'wifi',
  description: 'Crack WPA/WPA2 wireless network keys',
  manual: {
    synopsis: 'aircrack <bssid>',
    description:
      'Attempt to crack the WPA/WPA2 key for a target wireless network using a wordlist attack. The BSSID can be found via airdump(). Requires monitor mode to be enabled.',
    arguments: [
      {
        name: 'bssid',
        description: 'Target network BSSID (e.g., "A4:CF:12:D3:8B:7A")',
        required: true,
      },
    ],
    examples: [{ command: 'aircrack A4:CF:12:D3:8B:7A', description: 'Crack the target network' }],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { isOnLocalhost, isMonitorMode } = context;

    if (!isOnLocalhost()) {
      throw new Error('aircrack: command not available on this machine');
    }

    if (!isMonitorMode()) {
      throw new Error('aircrack: monitor mode not enabled — run airmon start wlan0 first');
    }

    const bssid = args[0] as string | undefined;

    if (!bssid) {
      throw new Error('aircrack: missing BSSID — usage: aircrack <BSSID>');
    }

    const networks = context.getWifiNetworks();
    const network = networks.find((n: WifiNetwork) => n.bssid === bssid);

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
        }, jitter(STEP_DELAY_MS));

        token.schedule(
          () => {
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

            const steps = 6;
            const keysPerStep = Math.floor(TOTAL_KEYS / steps);

            let stepDelay = 0;

            for (let i = 1; i <= steps; i++) {
              const stepIndex = i;
              stepDelay += jitter(STEP_DELAY_MS);
              token.schedule(() => {
                if (token.isCancelled()) return;

                const tested = Math.min(stepIndex * keysPerStep, TOTAL_KEYS);
                const elapsed = String(stepIndex * 2).padStart(2, '0');
                onLine(
                  `[00:00:${elapsed}] ${tested}/${TOTAL_KEYS} keys tested (${KEYS_PER_SECOND} k/s)`,
                );

                if (stepIndex === steps) {
                  token.schedule(() => {
                    if (token.isCancelled()) return;

                    if (network.crackable && network.password) {
                      onLine('');
                      onLine(`                 KEY FOUND! [ ${network.password} ]`);
                    }
                    onComplete();
                  }, jitter(STEP_DELAY_MS));
                }
              }, stepDelay);
            }
          },
          jitter(2 * STEP_DELAY_MS),
        );
      },
      cancel: token.cancel,
    };
  },
});
