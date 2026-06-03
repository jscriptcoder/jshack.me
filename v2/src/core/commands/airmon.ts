/**
 * airmon — toggle wireless monitor mode (the airdump/aircrack prerequisite).
 *
 * Ported from legacy `airmon`, adapted to v2's connectivity model. Reads the
 * target interface from `env.network.interfaces()` and flips `monitorMode` via
 * the generic `env.setInterface` seam (policy lives here, the seam is dumb).
 *
 * Gate order (clean v2 ordering): own-workstation → usage → unknown interface
 * → non-wireless interface → already-associated → action. The non-wireless
 * distinction (`eth0`) is a v2 enrichment the discriminated union makes
 * possible — legacy only ever knew `wlan0`. Monitor mode and association are
 * mutually exclusive (you can't sniff a NIC that's joined to a network).
 */

import type { Command, CommandResult } from './types';
import { isOwnWorkstation } from '../identity/workstation';

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

/** The airmon-ng driver banner, ported verbatim (the chipset is flavour). */
const banner = (verb: 'enabled' | 'disabled'): readonly string[] => [
  'PHY     Interface       Driver          Chipset',
  'phy0    wlan0           ath9k_htc       Qualcomm Atheros AR9271',
  '',
  `                (monitor mode ${verb} on wlan0)`,
];

const execute: Command['execute'] = async (env, args) => {
  if (!isOwnWorkstation(env.session.machineId, env.identity.publicKeyHex)) {
    return error('airmon: command not available on this machine');
  }

  const [action, name] = args;
  // `name` (args[1]) absent ⇒ at most one token given ⇒ usage. A present
  // `name` always implies a present `action`, so this single check suffices.
  if (name === undefined) {
    return error('airmon: usage: airmon <start|stop> <interface>');
  }

  const iface = env.network.interfaces().find((candidate) => candidate.name === name);
  if (iface === undefined) {
    return error(`airmon: interface '${name}' not found`);
  }
  if (iface.kind !== 'wireless') {
    return error(`airmon: ${name} is not a wireless interface`);
  }
  if (iface.association !== null) {
    return error(`airmon: ${name} is already connected to a network`);
  }

  if (action === 'start') {
    if (iface.monitorMode) return text(['wlan0 is already in monitor mode']);
    env.setInterface(name, { ...iface, monitorMode: true });
    return text(banner('enabled'));
  }

  if (action === 'stop') {
    if (!iface.monitorMode) return text(['wlan0 is not in monitor mode']);
    env.setInterface(name, { ...iface, monitorMode: false });
    return text(banner('disabled'));
  }

  return error(`airmon: unknown action '${action}' — use "start" or "stop"`);
};

export const airmon: Command = {
  name: 'airmon',
  description: 'Enable/disable wireless monitor mode',
  category: 'wifi',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  manual: {
    synopsis: 'airmon <start|stop> <interface>',
    description:
      'Put a wireless interface into or out of monitor mode. Monitor mode is required before scanning for networks with airdump or cracking handshakes with aircrack.',
    arguments: [
      { name: 'action', description: '"start" or "stop"', required: true },
      { name: 'interface', description: 'Wireless interface name (e.g. wlan0)', required: true },
    ],
    examples: [
      { command: 'airmon start wlan0', description: 'Enable monitor mode on wlan0' },
      { command: 'airmon stop wlan0', description: 'Disable monitor mode on wlan0' },
    ],
  },
  execute,
};
