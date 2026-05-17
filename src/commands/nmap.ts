import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { Port, RemoteMachine, Vulnerability } from '../network/types';
import { findExploitableCve } from '../generation/findExploitableCve';
import { isValidIP, parseIPRange } from '../utils/network';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

export type NmapScanAggregateInfo = {
  readonly targetIp: string;
  readonly probedPorts: readonly number[];
};

type NmapContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly findMachineByIp: (ip: string) => RemoteMachine | undefined;
  // Piece-2b lazy-subscribe variant: lets single-target scans of a
  // foreign public IP fall through to /api/lookup-home-network +
  // foreign-router regen instead of immediately reporting "host not
  // found". Range-scan and own-LAN paths stay sync.
  readonly findMachineByIpAsync: (ip: string) => Promise<RemoteMachine | undefined>;
  readonly getMachines: () => readonly RemoteMachine[];
  readonly getLocalIPs: () => ReadonlySet<string>;
  readonly getLocalHostname: () => string;
  readonly getGameTime?: () => number;
  readonly onScanAggregate?: (info: NmapScanAggregateInfo) => void;
};

const SCAN_DELAY_MS = 150;
const PORT_SCAN_DELAY_MS = 300;

const formatPortLine = (port: Port, versionScan: boolean): string => {
  const portStr = `${port.port}/${port.protocol ?? 'tcp'}`.padEnd(10);
  const state = port.open ? 'open' : 'closed';
  const stateService = `${state.padEnd(7)}${port.service.padEnd(16)}`;
  if (!versionScan) return `${portStr}${stateService}`;

  const version = port.open ? (port.serviceVersion ?? '') : '';
  return `${portStr}${stateService}${version}`;
};

const formatEffectHint = (effect: Vulnerability['effect']): string => {
  const tier = effect.tier;
  switch (effect.kind) {
    case 'shell_limited':
      return `limited remote shell as ${tier}`;
    case 'shell_full':
      return `full shell access as ${tier}`;
    case 'file_read':
      return `arbitrary file read as ${tier} (requires target path)`;
    case 'dir_list':
      return `directory listing as ${tier} (requires target path)`;
    case 'file_write':
      return `arbitrary file write as ${tier} (requires local:remote path)`;
    case 'password_reset':
      return `password reset for ${tier} account`;
    case 'backdoor_port_open':
      return `persistent backdoor on port ${effect.port} as ${tier}`;
    case 'script_exec':
      return `unauthenticated script execution as ${tier} (requires script path)`;
  }
};

const formatVulnerabilitySection = (
  machine: RemoteMachine,
  openPorts: readonly Port[],
  gameTime: number,
): readonly string[] => {
  const vulnEntries = openPorts.flatMap((p) => {
    const v = findExploitableCve(machine, p, gameTime);
    return v ? [{ port: p, vuln: v }] : [];
  });
  if (vulnEntries.length === 0) return [];

  return [
    '',
    'VULNERABILITIES:',
    ...vulnEntries.flatMap(({ port, vuln }) => [
      `  ${vuln.cve} - ${vuln.description}`,
      `    Affected: ${port.service} on port ${port.port}`,
      `    Severity: ${vuln.severity.toUpperCase()} \u2014 ${formatEffectHint(vuln.effect)}`,
    ]),
  ];
};

type NmapParsedArgs = {
  readonly target: string | undefined;
  readonly versionScan: boolean;
  readonly udpScan: boolean;
  readonly treeScan: boolean;
};

type DiscoveredHost = {
  readonly ip: string;
  readonly hostname: string;
  readonly isLocal: boolean;
  readonly ports: readonly Port[];
  readonly machine?: RemoteMachine;
};

// Parses args to detect -sV and -sU flags. Flags can appear in any position;
// the first non-flag argument is the target.
const parseNmapArgs = (args: readonly unknown[]): NmapParsedArgs => {
  const flags = new Set<string>();
  let target: string | undefined;

  for (const arg of args) {
    if (typeof arg !== 'string') continue;
    if (arg === '-sV' || arg === '-sU' || arg === '--tree') {
      flags.add(arg);
    } else if (target === undefined) {
      target = arg;
    }
  }

  return {
    target,
    versionScan: flags.has('-sV'),
    udpScan: flags.has('-sU'),
    treeScan: flags.has('--tree'),
  };
};

// Filters ports by protocol: -sU shows only UDP, default shows only TCP (including unset)
const filterPortsByProtocol = (ports: readonly Port[], udpScan: boolean): readonly Port[] =>
  udpScan ? ports.filter((p) => p.protocol === 'udp') : ports.filter((p) => p.protocol !== 'udp');

// Formats a single host line for tree output: "hostname (ip) [:port1 :port2]"
const formatTreeHostLine = (host: DiscoveredHost, udpScan: boolean): string => {
  if (host.isLocal) return `${host.hostname} (${host.ip})`;
  const filtered = filterPortsByProtocol(host.ports, udpScan);
  const openPorts = filtered.filter((p) => p.open);
  const portSuffix =
    openPorts.length > 0 ? ` [${openPorts.map((p) => `:${p.port}`).join(' ')}]` : '';
  return `${host.hostname} (${host.ip})${portSuffix}`;
};

// Formats CVE sub-lines for a host in tree output
const formatTreeCVELines = (
  host: DiscoveredHost,
  continuationPrefix: string,
  udpScan: boolean,
  gameTime: number,
): readonly string[] => {
  if (host.isLocal || !host.machine) return [];
  const filtered = filterPortsByProtocol(host.ports, udpScan);
  const vulnEntries = filtered.flatMap((p) => {
    if (!p.open) return [];
    const v = findExploitableCve(host.machine!, p, gameTime);
    return v ? [{ port: p, vuln: v }] : [];
  });
  if (vulnEntries.length === 0) return [];

  return vulnEntries.map(({ port, vuln }, i) => {
    const isLastCVE = i === vulnEntries.length - 1;
    const connector = isLastCVE ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
    return `${continuationPrefix}${connector}\u26A0 ${vuln.cve} (${port.service}:${port.port}) CRITICAL`;
  });
};

// Renders the full network tree from discovered hosts
const renderNetworkTree = (
  hosts: readonly DiscoveredHost[],
  versionScan: boolean,
  udpScan: boolean,
  gameTime: number,
): readonly string[] => {
  if (hosts.length === 0) return ['No hosts found in range.'];

  const lines: string[] = [];
  const gateway = hosts.find((h) => h.ip.endsWith('.1'));
  const children = gateway ? hosts.filter((h) => h !== gateway) : [];

  if (gateway) {
    lines.push('');
    lines.push('Network topology:');
    lines.push('');
    lines.push(formatTreeHostLine(gateway, udpScan));

    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
      const continuation = isLast ? '    ' : '\u2502   ';

      lines.push(`${connector}${formatTreeHostLine(child, udpScan)}`);
      if (versionScan) {
        lines.push(...formatTreeCVELines(child, continuation, udpScan, gameTime));
      }
    });
  } else {
    lines.push('');
    lines.push('Network topology:');
    lines.push('');
    hosts.forEach((host) => {
      lines.push(formatTreeHostLine(host, udpScan));
      if (versionScan) {
        lines.push(...formatTreeCVELines(host, '  ', udpScan, gameTime));
      }
    });
  }

  return lines;
};

// Builds the scan mode label for output lines
const scanModeLabel = (versionScan: boolean, udpScan: boolean): string => {
  const parts: string[] = [];
  if (udpScan) parts.push('UDP scan');
  if (versionScan) parts.push('version detection');
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
};

export const createNmapCommand = (context: NmapContext): Command => ({
  name: 'nmap',
  category: 'network',
  description: 'Network exploration and port scanning',
  manual: {
    synopsis: 'nmap <target> [-sV] [-sU] [--tree]',
    description:
      'Nmap ("Network Mapper") is a utility for network exploration and security auditing. It can discover hosts on a network and determine what services they are running. Use a single IP to scan ports on that host, or use a range (e.g., "192.168.1.1-254") to discover live hosts. Use -sV for service version detection and vulnerability scanning. Use -sU for UDP port scanning. Use --tree with a range scan to display discovered hosts as a network topology tree.',
    arguments: [
      {
        name: '-sV',
        description: 'Enable service version detection and vulnerability scanning (optional)',
        required: false,
      },
      {
        name: '-sU',
        description: 'Scan UDP ports instead of TCP (optional)',
        required: false,
      },
      {
        name: '--tree',
        description:
          'Display results as a network topology tree (range scans only). The gateway (.1) becomes the root node.',
        required: false,
      },
      {
        name: 'target',
        description: 'IP address or range to scan (e.g., "192.168.1.1" or "192.168.1.1-254")',
        required: true,
      },
    ],
    examples: [
      { command: 'nmap 192.168.1.1', description: 'Scan ports on a single host' },
      { command: 'nmap 192.168.1.1-254', description: 'Discover hosts in IP range' },
      {
        command: 'nmap -sV 192.168.1.1',
        description: 'Scan with service version detection',
      },
      {
        command: 'nmap 192.168.1.1-254 --tree',
        description: 'Show network topology tree',
      },
      {
        command: 'nmap 192.168.1.1-254 --tree -sV',
        description: 'Topology tree with vulnerability info',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const {
      getMachine,
      findMachineByIp,
      findMachineByIpAsync,
      getMachines,
      getLocalIPs,
      getLocalHostname,
      onScanAggregate,
    } = context;
    const gameTime = context.getGameTime?.() ?? 0;
    const { target, versionScan, udpScan, treeScan } = parseNmapArgs(args);

    if (!target) {
      throw new Error('nmap: missing target specification');
    }

    const range = parseIPRange(target);

    if (range) {
      const token = createCancellationToken();

      return {
        __type: 'async',
        start: (onLine, onComplete) => {
          const machines = getMachines();
          const localIPs = getLocalIPs();
          const totalIPs = range.end - range.start + 1;

          onLine(`Starting Nmap scan on ${target}${scanModeLabel(versionScan, udpScan)}`);
          onLine(`Scanning ${totalIPs} hosts...`);
          onLine('');

          const discoveredHosts: DiscoveredHost[] = [];
          let scannedCount = 0;
          let delay = 0;

          for (let i = range.start; i <= range.end; i++) {
            delay += jitter(SCAN_DELAY_MS);
            token.schedule(() => {
              if (token.isCancelled()) return;

              const ip = `${range.baseIP}.${i}`;
              scannedCount++;

              if (localIPs.has(ip)) {
                const localHostname = getLocalHostname();
                const localMachine = findMachineByIp(ip);
                const localPorts = localMachine?.ports ?? [];
                discoveredHosts.push({
                  ip,
                  hostname: localHostname,
                  isLocal: true,
                  ports: localPorts,
                });
                onLine(`Host discovered: ${ip} (${localHostname})`);
              } else {
                const machine = machines.find((m) => m.ip === ip);
                if (machine) {
                  discoveredHosts.push({
                    ip,
                    hostname: machine.hostname,
                    isLocal: false,
                    ports: machine.ports,
                    machine,
                  });
                  onLine(`Host discovered: ${ip} (${machine.hostname})`);
                }
              }

              if (scannedCount === totalIPs) {
                // Fire aggregated scan callback for each non-local target that
                // was actually touched. Matches how real iptables LOG would
                // capture one packet-burst per target machine.
                discoveredHosts
                  .filter((h) => !h.isLocal)
                  .forEach((h) =>
                    onScanAggregate?.({
                      targetIp: h.ip,
                      probedPorts: h.ports.map((p) => p.port),
                    }),
                  );

                token.schedule(() => {
                  if (token.isCancelled()) return;

                  if (discoveredHosts.length === 0) {
                    onLine('');
                    onLine('No hosts found in range.');
                  } else if (treeScan) {
                    renderNetworkTree(discoveredHosts, versionScan, udpScan, gameTime).forEach(
                      (line) => onLine(line),
                    );
                  } else {
                    onLine('');
                    onLine('Scan complete. Summary:');
                    discoveredHosts.forEach((host) => {
                      if (host.isLocal) {
                        onLine(`  ${host.ip} - ${host.hostname} (this machine)`);
                      } else {
                        const openPorts = host.ports.filter((p) => p.open);
                        const services = versionScan
                          ? openPorts
                              .map((p) =>
                                p.serviceVersion ? `${p.service} ${p.serviceVersion}` : p.service,
                              )
                              .join(', ')
                          : openPorts.map((p) => p.service).join(', ');
                        onLine(`  ${host.ip} - ${host.hostname} (${services || 'no open ports'})`);
                      }
                    });
                  }
                  onLine('');
                  onLine(
                    `Nmap done: ${totalIPs} IP addresses scanned, ${discoveredHosts.length} hosts up`,
                  );
                  onComplete();
                }, jitter(300));
              }
            }, delay);
          }
        },
        cancel: token.cancel,
      };
    }

    if (treeScan) {
      throw new Error('nmap: --tree requires an IP range target');
    }

    if (!isValidIP(target)) {
      throw new Error(`nmap: invalid target: ${target}`);
    }

    const localIPs = getLocalIPs();
    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        if (localIPs.has(target)) {
          const localMachine = findMachineByIp(target);
          onLine(`Starting Nmap scan on ${target}`);
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine('');
            onLine(`Nmap scan report for ${getLocalHostname()} (${target})`);
            onLine('Host is up.');
            onLine('');
            if (localMachine) {
              const protocolPorts = filterPortsByProtocol(localMachine.ports, udpScan);
              const sortedPorts = [...protocolPorts].sort((a, b) => {
                if (a.open !== b.open) return a.open ? -1 : 1;
                return a.port - b.port;
              });
              const portLines = sortedPorts.map((p) => formatPortLine(p, versionScan));
              onLine('PORT      STATE  SERVICE');
              portLines.forEach((line) => onLine(line));
            } else {
              onLine('All scanned ports are closed on this machine.');
            }
            onComplete();
          }, jitter(500));
          return;
        }

        // Scan runner — invoked once we have a resolved RemoteMachine,
        // whether from the sync local view (getMachine) or from the
        // foreign-router fallthrough (findMachineByIpAsync).
        const startScan = (machine: RemoteMachine): void => {
          // Filter by protocol, then sort: open first, then closed, by port number
          const protocolPorts = filterPortsByProtocol(machine.ports, udpScan);
          const sortedPorts = [...protocolPorts].sort((a, b) => {
            if (a.open !== b.open) return a.open ? -1 : 1;
            return a.port - b.port;
          });
          const openPorts = sortedPorts.filter((p) => p.open);

          // Single aggregated log entry for the whole scan on this target.
          onScanAggregate?.({
            targetIp: target,
            probedPorts: machine.ports.map((p) => p.port),
          });

          onLine(`Starting Nmap scan on ${target}${scanModeLabel(versionScan, udpScan)}`);
          onLine(`Scanning ${udpScan ? 'UDP ' : ''}ports...`);

          let delay = jitter(400);

          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine('');
            onLine(`Nmap scan report for ${machine.hostname} (${machine.ip})`);
            onLine('Host is up.');
            onLine('');
            const header = versionScan
              ? 'PORT      STATE  SERVICE         VERSION'
              : 'PORT      STATE  SERVICE';
            onLine(header);
          }, delay);

          if (sortedPorts.length === 0) {
            delay += jitter(200);
            token.schedule(() => {
              if (token.isCancelled()) return;
              onLine('All scanned ports are closed.');
              onComplete();
            }, delay);
            return;
          }

          sortedPorts.forEach((port, index) => {
            delay += jitter(PORT_SCAN_DELAY_MS);
            token.schedule(() => {
              if (token.isCancelled()) return;
              onLine(formatPortLine(port, versionScan));

              if (index === sortedPorts.length - 1) {
                token.schedule(() => {
                  if (token.isCancelled()) return;

                  if (versionScan) {
                    const vulnLines = formatVulnerabilitySection(machine, openPorts, gameTime);
                    vulnLines.forEach((line) => onLine(line));
                  }

                  onComplete();
                }, jitter(200));
              }
            }, delay);
          });
        };

        const localMachine = getMachine(target);
        if (localMachine) {
          startScan(localMachine);
          return;
        }

        if (target.startsWith('192.168.1.')) {
          onLine(`Starting Nmap scan on ${target}`);
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine('');
            onLine(`Nmap scan report for ${target}`);
            onLine('Host seems down.');
            onLine('');
            onLine('Note: Host may be blocking ping probes.');
            onComplete();
          }, jitter(800));
          return;
        }

        // Foreign-router lazy resolve (piece 2b). For public IPv4 misses,
        // findMachineByIpAsync hits /api/lookup-home-network, regenerates
        // the foreign home network's router locally, and subscribes the
        // player to its patch stream. On miss, surface the same "failed
        // to resolve" message the old sync path emitted via throw —
        // .then() runs after the sync try/catch in Terminal, so we route
        // through onLine + onComplete instead.
        void findMachineByIpAsync(target).then((asyncMachine) => {
          if (token.isCancelled()) return;
          if (!asyncMachine) {
            onLine(`nmap: failed to resolve "${target}"`);
            onComplete();
            return;
          }
          startScan(asyncMachine);
        });
      },
      cancel: token.cancel,
    };
  },
});
