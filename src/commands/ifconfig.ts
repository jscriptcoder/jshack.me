import type { Command } from '../components/Terminal/types';
import type { NetworkInterface } from '../network/types';

type IfconfigContext = {
  readonly getInterfaces: () => readonly NetworkInterface[];
  readonly getInterface: (name: string) => NetworkInterface | undefined;
};

const formatInterface = (iface: NetworkInterface): string => {
  const flags = iface.flags.join(',');
  return [
    `${iface.name}: flags=4163<${flags}>`,
    `      inet ${iface.inet}  netmask ${iface.netmask}`,
    `      gateway ${iface.gateway}`,
    `      ether ${iface.mac}`,
  ].join('\n');
};

export const createIfconfigCommand = (context: IfconfigContext): Command => ({
  name: 'ifconfig',
  category: 'network',
  description: 'Display network interface configuration',
  manual: {
    synopsis: 'ifconfig([interface])',
    description:
      'Display information about network interfaces. If no interface is specified, shows all active interfaces. Shows IP address, netmask, gateway, and MAC address for each interface.',
    arguments: [
      {
        name: 'interface',
        description: 'Name of the interface to display (e.g., "eth0")',
        required: false,
      },
    ],
    examples: [
      { command: 'ifconfig()', description: 'Show all network interfaces' },
      { command: 'ifconfig("eth0")', description: 'Show only eth0 interface' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const { getInterfaces, getInterface } = context;
    const interfaceName = args[0] as string | undefined;

    if (interfaceName) {
      const iface = getInterface(interfaceName);
      if (!iface) {
        throw new Error(`ifconfig: interface '${interfaceName}' not found`);
      }
      return formatInterface(iface);
    }

    const interfaces = getInterfaces();
    if (interfaces.length === 0) {
      return 'No active interfaces';
    }

    return interfaces.map(formatInterface).join('\n\n');
  },
});
