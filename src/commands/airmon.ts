import type { Command } from '../components/Terminal/types';

type AirmonContext = {
  readonly isOnLocalhost: () => boolean;
  readonly isWifiConnected: () => boolean;
  readonly isMonitorMode: () => boolean;
  readonly setMonitorMode: (enabled: boolean) => void;
};

export const createAirmonCommand = (context: AirmonContext): Command => ({
  name: 'airmon',
  category: 'wifi',
  description: 'Enable/disable wireless monitor mode',
  manual: {
    synopsis: 'airmon <action> <interface>',
    description:
      'Put a wireless interface into or out of monitor mode. Monitor mode is required before scanning for networks with airdump or cracking with aircrack.',
    arguments: [
      {
        name: 'action',
        description: '"start" or "stop"',
        required: true,
        values: ['start', 'stop'],
      },
      { name: 'interface', description: 'Wireless interface name (e.g., "wlan0")', required: true },
    ],
    examples: [
      { command: 'airmon start wlan0', description: 'Enable monitor mode on wlan0' },
      { command: 'airmon stop wlan0', description: 'Disable monitor mode on wlan0' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const { isOnLocalhost, isWifiConnected, isMonitorMode, setMonitorMode } = context;

    if (!isOnLocalhost()) {
      throw new Error('airmon: command not available on this machine');
    }

    if (isWifiConnected()) {
      throw new Error('airmon: wlan0 is already connected to a network');
    }

    const action = args[0] as string | undefined;
    const iface = args[1] as string | undefined;

    if (!action || !iface) {
      throw new Error('airmon: usage: airmon <start|stop> <interface>');
    }

    if (iface !== 'wlan0') {
      throw new Error(`airmon: interface '${iface}' not found`);
    }

    if (action === 'start') {
      if (isMonitorMode()) {
        return 'wlan0 is already in monitor mode';
      }
      setMonitorMode(true);
      return [
        'PHY     Interface       Driver          Chipset',
        'phy0    wlan0           ath9k_htc       Qualcomm Atheros AR9271',
        '',
        '                (monitor mode enabled on wlan0)',
      ].join('\n');
    }

    if (action === 'stop') {
      if (!isMonitorMode()) {
        return 'wlan0 is not in monitor mode';
      }
      setMonitorMode(false);
      return [
        'PHY     Interface       Driver          Chipset',
        'phy0    wlan0           ath9k_htc       Qualcomm Atheros AR9271',
        '',
        '                (monitor mode disabled on wlan0)',
      ].join('\n');
    }

    throw new Error(`airmon: unknown action '${action}' — use "start" or "stop"`);
  },
});
