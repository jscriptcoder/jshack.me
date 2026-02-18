import type { Command } from '../components/Terminal/types';
import { findWifiNetworkByEssid } from '../network/wifiNetworks';

type NmcliContext = {
  readonly isOnLocalhost: () => boolean;
  readonly isWifiConnected: () => boolean;
  readonly setWifiConnected: (connected: boolean) => void;
  readonly disconnectWifi: () => void;
};

const USAGE = [
  'Usage:',
  '  nmcli("connect", "<ESSID>", "<password>")  Connect to a WiFi network',
  '  nmcli("disconnect")                         Disconnect from WiFi',
  '  nmcli("status")                             Show connection status',
].join('\n');

const handleConnect = (
  context: NmcliContext,
  essid: string | undefined,
  password: string | undefined,
): string => {
  if (!context.isOnLocalhost()) {
    throw new Error('nmcli: WiFi management is only available on localhost');
  }

  if (context.isWifiConnected()) {
    throw new Error('nmcli: already connected to JSHACK-CORP');
  }

  if (!essid || !password) {
    throw new Error('nmcli: usage: nmcli("connect", "<ESSID>", "<password>")');
  }

  const network = findWifiNetworkByEssid(essid);

  if (!network) {
    throw new Error(`nmcli: network "${essid}" not found`);
  }

  if (network.password !== password) {
    throw new Error(`nmcli: authentication failed for "${essid}"`);
  }

  context.setWifiConnected(true);
  return [
    `Connecting to ${essid}...`,
    `Connected to ${essid}`,
    'wlan0: DHCP assigned 192.168.1.100/24 via 192.168.1.1',
  ].join('\n');
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

  context.setWifiConnected(false);
  return 'Disconnected from JSHACK-CORP';
};

const handleStatus = (context: NmcliContext): string => {
  if (!context.isOnLocalhost()) {
    return 'wlan0: not available on this machine';
  }

  if (context.isWifiConnected()) {
    return 'wlan0: connected to JSHACK-CORP (192.168.1.100/24)';
  }

  return 'wlan0: disconnected';
};

export const createNmcliCommand = (context: NmcliContext): Command => ({
  name: 'nmcli',
  description: 'NetworkManager CLI — manage WiFi connections',
  manual: {
    synopsis: 'nmcli(subcommand: string, ...args: string[])',
    description:
      'Manage WiFi network connections. Use "connect" to join a network, "disconnect" to leave, and "status" to check connection state.',
    arguments: [
      {
        name: 'subcommand',
        description: '"connect", "disconnect", or "status"',
        required: true,
      },
    ],
    examples: [
      {
        command: 'nmcli("connect", "JSHACK-CORP", "cr4ck3d_w1f1")',
        description: 'Connect to a WiFi network',
      },
      { command: 'nmcli("disconnect")', description: 'Disconnect from WiFi' },
      { command: 'nmcli("status")', description: 'Show connection status' },
    ],
  },
  fn: (...args: readonly unknown[]): string => {
    const subcommand = args[0] as string | undefined;

    if (!subcommand) return USAGE;

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
