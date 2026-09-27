/**
 * nmcli — NetworkManager CLI; the arc's finish line: connect to a cracked AP
 * and go ONLINE.
 *
 * Ported from legacy `nmcli`, adapted to v2's connectivity model + the async
 * `env.homeNetwork.join` seam. `connect` validates the cracked password, awaits
 * the join (the future server boundary), then assigns `wlan0` an association +
 * IP via `env.setInterface` — flipping `isOnline()` true. `disconnect` clears
 * that state; `status` reports it.
 *
 * Preconditions: own workstation (`isOwnWorkstation`), and — the mutual-
 * exclusivity tightening over legacy — `wlan0` must NOT be in monitor mode
 * (airmon-ng enforces the reverse: you can't monitor an associated NIC). A
 * non-crackable AP has no `password` on the discriminated union, so it can
 * never authenticate — the password compare is the single gate.
 *
 * Connect streams its progress (`Connecting…` → `Connected…`) as an async
 * result so the join shows as a step now and, when it becomes a real server
 * round-trip, the latency surfaces without a UI change.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import type { WirelessInterface } from '../network/interfaces';
import type { HomeNetworkAssignment } from '../network/homeNetwork';
import { isOwnWorkstation } from '../identity/workstation';

const USAGE = [
  'nmcli: usage:',
  '  nmcli connect <ESSID> <password>   Connect to a WiFi network',
  '  nmcli disconnect                   Disconnect from WiFi',
  '  nmcli status                       Show connection status',
].join('\n');

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const text = (lines: readonly string[]): CommandResult => ({
  kind: 'sync',
  lines: lines.map((content) => ({ kind: 'text', content })),
  exitCode: 0,
});

const line = (content: string): TerminalLine => ({ kind: 'text', content });

/** Connect happy path — streamed so the join reads as a step (and, once it's a
 *  real server call, its latency surfaces). The monitor-off + password gates
 *  have already passed; `wlan0`'s monitorMode is false, so spreading it keeps
 *  the radio out of monitor mode while adding the association + IP. */
async function* connectStream(
  env: CommandEnv,
  wlan0: WirelessInterface,
  essid: string,
  bssid: string,
  joined: Promise<HomeNetworkAssignment | null>,
): AsyncIterable<TerminalLine> {
  yield line(`Connecting to ${essid}...`);
  const assignment = await joined;
  // No lease, no connection. The address is the server's to grant — and no copy of
  // an earlier grant was remembered for this network — so there is nothing to put on
  // wlan0. Deriving one locally is exactly what the lease replaced: it could be an
  // address another occupant already holds, and it would change under the player on
  // the next successful join.
  if (assignment === null) {
    yield {
      kind: 'error',
      content: `nmcli: could not get an address on ${essid} — the network is unreachable`,
    };
    return;
  }
  env.setInterface('wlan0', {
    ...wlan0,
    association: { essid, bssid },
    ipv4: assignment.localIp,
  });
  yield line(`Connected to ${essid} — assigned ${assignment.localIp}`);
}

const handleConnect = (
  env: CommandEnv,
  wlan0: WirelessInterface,
  essid: string | undefined,
  password: string | undefined,
): CommandResult => {
  if (wlan0.monitorMode) {
    return error("nmcli: wlan0 is in monitor mode — run 'airmon-ng stop wlan0' first");
  }
  // Reconnecting to the network you're already on is a no-op (no re-join).
  if (essid !== undefined && wlan0.association?.essid === essid) {
    return text([`Already connected to ${essid}`]);
  }
  if (essid === undefined || password === undefined) {
    return error('nmcli: usage: nmcli connect <ESSID> <password>');
  }

  const network = env.network.wifiNetworks().find((candidate) => candidate.essid === essid);
  if (network === undefined) {
    return error(`nmcli: network "${essid}" not found`);
  }
  // A non-crackable AP carries no password on the union, so it can never match.
  if (!network.crackable || network.password !== password) {
    return error(`nmcli: authentication failed for "${essid}"`);
  }

  // ONE join, awaited in two places: the stream renders its outcome, the exit code
  // reports it. Started here rather than inside the stream so both read the same
  // result — a second call would be a second allocation attempt.
  const joined = env.homeNetwork.join(network.essid);
  return {
    kind: 'async',
    lines: connectStream(env, wlan0, network.essid, network.bssid, joined),
    exitCode: async () => ((await joined) === null ? 1 : 0),
  };
};

const handleDisconnect = (env: CommandEnv, wlan0: WirelessInterface): CommandResult => {
  if (wlan0.association === null) {
    return error('nmcli: not connected to any network');
  }
  const essid = wlan0.association.essid;
  // Fire-and-forget occupancy cleanup: remove our row from the ESSID's LAN so we
  // vanish for other occupants (Story 7). Local disconnect proceeds regardless.
  env.homeNetwork.leave(essid);
  env.setInterface('wlan0', { ...wlan0, association: null, ipv4: null });
  return text([`Disconnected from ${essid}`]);
};

const handleStatus = (wlan0: WirelessInterface): CommandResult => {
  if (wlan0.association === null) {
    return text(['wlan0: disconnected']);
  }
  const ip = wlan0.ipv4;
  const suffix = ip === null ? '' : ` (${ip}/24)`;
  return text([`wlan0: connected to ${wlan0.association.essid}${suffix}`]);
};

const execute: Command['execute'] = async (env, args) => {
  if (!isOwnWorkstation(env.session.machineId, env.identity.publicKeyHex)) {
    return error('nmcli: command not available on this machine');
  }

  const wlan0 = env.network.interfaces().find((iface) => iface.name === 'wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') {
    return error('nmcli: no wireless interface available');
  }

  const [subcommand, essid, password] = args;
  if (subcommand === undefined) {
    return error(USAGE);
  }
  if (subcommand === 'connect') {
    return handleConnect(env, wlan0, essid, password);
  }
  if (subcommand === 'disconnect') {
    return handleDisconnect(env, wlan0);
  }
  if (subcommand === 'status') {
    return handleStatus(wlan0);
  }
  return error(`nmcli: unknown subcommand '${subcommand}'\n${USAGE}`);
};

export const nmcli: Command = {
  name: 'nmcli',
  description: 'Manage WiFi network connections',
  category: 'wifi',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  manual: {
    synopsis: 'nmcli <connect|disconnect|status> [ESSID] [password]',
    description:
      'NetworkManager CLI. Use "connect" to join a WiFi network with its cracked password, "disconnect" to leave, and "status" to show the current connection. Requires monitor mode to be off — run "airmon-ng stop wlan0" first.',
    arguments: [
      { name: 'subcommand', description: '"connect", "disconnect", or "status"', required: true },
      { name: 'ESSID', description: 'Network name (connect only)' },
      { name: 'password', description: 'Network password from aircrack-ng (connect only)' },
    ],
    examples: [
      {
        command: 'nmcli connect HOME-WIFI hunter2',
        description: 'Connect to HOME-WIFI with the cracked password',
      },
      { command: 'nmcli disconnect', description: 'Disconnect from the current network' },
      { command: 'nmcli status', description: 'Show the current connection status' },
    ],
  },
  execute,
};
