import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { WifiConnection } from '../network/wifiTypes';
import type { WifiNetwork } from '../network/wifiNetworks';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type NmcliContext = {
  readonly isOnLocalhost: () => boolean;
  readonly isWifiConnected: () => boolean;
  readonly connectedEssid: () => string | null;
  readonly setWifiConnected: (connection: WifiConnection | null) => void;
  readonly disconnectWifi: () => void;
  readonly getWifiNetworks: () => readonly WifiNetwork[];
};

const USAGE = [
  'Usage:',
  '  nmcli connect <ESSID> <password>  Connect to a WiFi network',
  '  nmcli disconnect                  Disconnect from WiFi',
  '  nmcli status                      Show connection status',
].join('\n');

const handleConnect = (
  context: NmcliContext,
  essid: string | undefined,
  password: string | undefined,
): string | AsyncOutput => {
  if (!context.isOnLocalhost()) {
    throw new Error('nmcli: WiFi management is only available on localhost');
  }

  // Already connected to the same network — no-op
  if (context.isWifiConnected() && context.connectedEssid() === essid) {
    return `Already connected to ${essid}`;
  }

  if (!essid || !password) {
    throw new Error('nmcli: usage: nmcli connect <ESSID> <password>');
  }

  const networks = context.getWifiNetworks();
  const network = networks.find((n: WifiNetwork) => n.essid === essid);

  if (!network) {
    throw new Error(`nmcli: network "${essid}" not found`);
  }

  if (network.password !== password) {
    throw new Error(`nmcli: authentication failed for "${essid}"`);
  }

  const previousEssid = context.connectedEssid();
  const token = createCancellationToken();

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      let delay = 0;

      if (previousEssid) {
        delay += jitter(300);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`Disconnected from ${previousEssid}`);
        }, delay);
      }

      delay += jitter(400);
      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine(`Connecting to ${essid}...`);
      }, delay);

      delay += jitter(1500);
      token.schedule(() => {
        if (token.isCancelled()) return;
        context.setWifiConnected({ essid: network.essid, bssid: network.bssid });
        onLine(`Connected to ${essid}`);
        onComplete();
      }, delay);
    },
    cancel: token.cancel,
  };
};

const handleDisconnect = (context: NmcliContext): string => {
  if (!context.isWifiConnected()) {
    throw new Error('nmcli: not connected to any network');
  }

  if (!context.isOnLocalhost()) {
    context.disconnectWifi();
    return [
      'nmcli: WiFi disconnected — network connection lost',
      'Connection to remote host closed.',
      'Returned to localhost',
    ].join('\n');
  }

  const current = context.connectedEssid() ?? 'unknown';
  context.setWifiConnected(null);
  return `Disconnected from ${current}`;
};

const handleStatus = (context: NmcliContext): string => {
  if (!context.isOnLocalhost()) {
    return 'wlan0: not available on this machine';
  }

  if (context.isWifiConnected()) {
    const current = context.connectedEssid() ?? 'unknown';
    return `wlan0: connected to ${current} (192.168.1.100/24)`;
  }

  return 'wlan0: disconnected';
};

export const createNmcliCommand = (context: NmcliContext): Command => ({
  name: 'nmcli',
  category: 'wifi',
  description: 'NetworkManager CLI — manage WiFi connections',
  manual: {
    synopsis: 'nmcli <subcommand> [args...]',
    description:
      'Manage WiFi network connections. Use "connect" to join a network, "disconnect" to leave, and "status" to check connection state.',
    arguments: [
      {
        name: 'subcommand',
        description: '"connect", "disconnect", or "status"',
        required: true,
        values: ['connect', 'disconnect', 'status'],
      },
    ],
    examples: [
      {
        command: 'nmcli connect <ESSID> <password>',
        description: 'Connect to a WiFi network',
      },
      { command: 'nmcli disconnect', description: 'Disconnect from WiFi' },
      { command: 'nmcli status', description: 'Show connection status' },
    ],
  },
  fn: (...args: readonly unknown[]): string | AsyncOutput => {
    const subcommand = args[0] as string | undefined;

    if (!subcommand) throw new Error(`nmcli: missing subcommand\n${USAGE}`);

    switch (subcommand) {
      case 'connect':
        return handleConnect(context, args[1] as string | undefined, args[2] as string | undefined);
      case 'disconnect':
        return handleDisconnect(context);
      case 'status':
        return handleStatus(context);
      default:
        throw new Error(`nmcli: unknown subcommand "${subcommand}"\n${USAGE}`);
    }
  },
});
