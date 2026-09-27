/**
 * ifconfig — display the current machine's network interfaces.
 *
 * Reads `env.network.interfaces()` (the connectivity model) and renders the
 * familiar net-tools layout. No argument shows only interfaces that are UP
 * (so a freshly booted player sees `lo` + an address-less `wlan0`, proof
 * they're offline); `-a` adds down interfaces (`eth0`); a named argument shows
 * exactly one, up or down.
 *
 * `netmask` and `gateway` are render-derived from the assigned IPv4 (a /24 home
 * network, gateway at `.1`) rather than stored — the connectivity model stays
 * lean (grill-me decision 3). They only appear once an interface has an address.
 */

import type { Command, TerminalLine } from './types';
import type { NetworkInterface } from '../network/interfaces';

const INDENT = '        ';

/** Interface flags in net-tools order. `RUNNING` means the link is
 *  operationally up (has carrier) — modelled here as "has an address". */
const flagsFor = (iface: NetworkInterface): string => {
  if (iface.kind === 'loopback') return 'UP,LOOPBACK,RUNNING';
  return [
    ...(iface.up ? ['UP'] : []),
    'BROADCAST',
    ...(iface.ipv4 !== null ? ['RUNNING'] : []),
    'MULTICAST',
  ].join(',');
};

const netmaskFor = (iface: NetworkInterface): string =>
  iface.kind === 'loopback' ? '255.0.0.0' : '255.255.255.0';

/** Home-network default gateway: the `.1` host of the interface's /24. */
const gatewayFor = (ipv4: string): string => {
  const [a, b, c] = ipv4.split('.');
  return `${a}.${b}.${c}.1`;
};

const renderInterface = (iface: NetworkInterface): readonly string[] => {
  const lines = [`${iface.name}: flags=<${flagsFor(iface)}>`];
  if (iface.ipv4 !== null) {
    lines.push(`${INDENT}inet ${iface.ipv4}  netmask ${netmaskFor(iface)}`);
    if (iface.kind !== 'loopback') {
      lines.push(`${INDENT}gateway ${gatewayFor(iface.ipv4)}`);
    }
  }
  if (iface.kind !== 'loopback') {
    lines.push(`${INDENT}ether ${iface.mac}`);
  }
  return lines;
};

/** Render interface blocks, blank-line separated, as terminal text lines. */
const toLines = (interfaces: readonly NetworkInterface[]): readonly TerminalLine[] =>
  interfaces.flatMap((iface, index) => [
    ...(index > 0 ? [{ kind: 'text' as const, content: '' }] : []),
    ...renderInterface(iface).map((content) => ({ kind: 'text' as const, content })),
  ]);

const execute: Command['execute'] = async (env, args, flags) => {
  const interfaces = env.network.interfaces();
  const requested = args[0];

  if (requested !== undefined) {
    const iface = interfaces.find((candidate) => candidate.name === requested);
    if (iface === undefined) {
      return {
        kind: 'sync',
        lines: [{ kind: 'error', content: `ifconfig: interface '${requested}' not found` }],
        exitCode: 1,
      };
    }
    return { kind: 'sync', lines: toLines([iface]), exitCode: 0 };
  }

  const showAll = flags.get('-a') === true;
  const selected = showAll ? interfaces : interfaces.filter((iface) => iface.up);
  return { kind: 'sync', lines: toLines(selected), exitCode: 0 };
};

export const ifconfig: Command = {
  name: 'ifconfig',
  description: 'Display network interface configuration',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-a': 'boolean' },
  manual: {
    synopsis: 'ifconfig [-a] [interface]',
    description:
      'Display network interface configuration. With no argument, shows interfaces that are up. Use -a to include down interfaces, or name an interface to show only that one.',
    arguments: [
      { name: 'interface', description: 'Name of the interface to display (e.g. wlan0)' },
    ],
    examples: [
      { command: 'ifconfig', description: 'Show all up interfaces' },
      { command: 'ifconfig -a', description: 'Show all interfaces, including down ones' },
      { command: 'ifconfig wlan0', description: 'Show only the wlan0 interface' },
    ],
  },
  execute,
};
