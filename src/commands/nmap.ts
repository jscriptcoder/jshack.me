import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { Port, RemoteMachine } from '../network/types';
import { isValidIP, parseIPRange } from '../utils/network';
import { createCancellationToken } from '../utils/asyncCommand';

type NmapContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getMachines: () => readonly RemoteMachine[];
  readonly getLocalIP: () => string;
};

const SCAN_DELAY_MS = 150;
const PORT_SCAN_DELAY_MS = 300;

const formatPortLine = (port: Port, versionScan: boolean): string => {
  const portStr = `${port.port}/tcp`.padEnd(10);
  const stateService = `open   ${port.service}`;
  if (!versionScan) return `${portStr}${stateService}`;

  const version = port.vulnerability?.serviceVersion ?? '';
  return `${portStr}${stateService.padEnd(16)}${version}`;
};

const formatVulnerabilitySection = (openPorts: readonly Port[]): readonly string[] => {
  const vulnPorts = openPorts.filter((p) => p.vulnerability);
  if (vulnPorts.length === 0) return [];

  return [
    '',
    'VULNERABILITIES:',
    ...vulnPorts.flatMap((p) => {
      const v = p.vulnerability;
      if (!v) return [];
      return [
        `  ${v.cve} - ${v.description}`,
        `    Affected: ${p.service} on port ${p.port}`,
        '    Risk: CRITICAL \u2014 remote code execution',
      ];
    }),
  ];
};

// Parses args to detect the -sV flag. Returns the actual target and whether
// version scanning is enabled.
const parseNmapArgs = (
  args: readonly unknown[],
): { readonly target: string | undefined; readonly versionScan: boolean } => {
  const first = args[0] as string | undefined;
  const second = args[1] as string | undefined;

  if (first === '-sV') {
    return { target: second, versionScan: true };
  }
  return { target: first, versionScan: false };
};

export const createNmapCommand = (context: NmapContext): Command => ({
  name: 'nmap',
  description: 'Network exploration and port scanning',
  manual: {
    synopsis: 'nmap(["-sV",] target: string)',
    description:
      'Nmap ("Network Mapper") is a utility for network exploration and security auditing. It can discover hosts on a network and determine what services they are running. Use a single IP to scan ports on that host, or use a range (e.g., "192.168.1.1-254") to discover live hosts. Use -sV for service version detection and vulnerability scanning.',
    arguments: [
      {
        name: '-sV',
        description: 'Enable service version detection and vulnerability scanning (optional)',
        required: false,
      },
      {
        name: 'target',
        description: 'IP address or range to scan (e.g., "192.168.1.1" or "192.168.1.1-254")',
        required: true,
      },
    ],
    examples: [
      { command: 'nmap("192.168.1.1")', description: 'Scan ports on a single host' },
      { command: 'nmap("192.168.1.1-254")', description: 'Discover hosts in IP range' },
      {
        command: 'nmap("-sV", "192.168.1.1")',
        description: 'Scan with service version detection',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, getMachines, getLocalIP } = context;
    const { target, versionScan } = parseNmapArgs(args);

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
          const localIP = getLocalIP();
          const totalIPs = range.end - range.start + 1;

          onLine(`Starting Nmap scan on ${target}${versionScan ? ' (version detection)' : ''}`);
          onLine(`Scanning ${totalIPs} hosts...`);
          onLine('');

          const foundHosts: string[] = [];
          let scannedCount = 0;

          for (let i = range.start; i <= range.end; i++) {
            const index = i - range.start;
            token.schedule(() => {
              if (token.isCancelled()) return;

              const ip = `${range.baseIP}.${i}`;
              scannedCount++;

              if (ip === localIP) {
                foundHosts.push(`${ip} - localhost (this machine)`);
                onLine(`Host discovered: ${ip} (localhost)`);
              } else {
                const machine = machines.find((m) => m.ip === ip);
                if (machine) {
                  const openPorts = machine.ports.filter((p) => p.open);
                  const services = versionScan
                    ? openPorts
                        .map((p) =>
                          p.vulnerability
                            ? `${p.service} ${p.vulnerability.serviceVersion}`
                            : p.service,
                        )
                        .join(', ')
                    : openPorts.map((p) => p.service).join(', ');
                  foundHosts.push(`${ip} - ${machine.hostname} (${services || 'no open ports'})`);
                  onLine(`Host discovered: ${ip} (${machine.hostname})`);
                }
              }

              if (scannedCount === totalIPs) {
                token.schedule(() => {
                  if (token.isCancelled()) return;

                  onLine('');
                  if (foundHosts.length === 0) {
                    onLine('No hosts found in range.');
                  } else {
                    onLine('Scan complete. Summary:');
                    foundHosts.forEach((host) => onLine(`  ${host}`));
                  }
                  onLine('');
                  onLine(
                    `Nmap done: ${totalIPs} IP addresses scanned, ${foundHosts.length} hosts up`,
                  );
                  onComplete();
                }, 300);
              }
            }, index * SCAN_DELAY_MS);
          }
        },
        cancel: token.cancel,
      };
    }

    if (!isValidIP(target)) {
      throw new Error(`nmap: invalid target: ${target}`);
    }

    const localIP = getLocalIP();
    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        if (target === localIP || target === '127.0.0.1') {
          onLine(`Starting Nmap scan on ${target}`);
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine('');
            onLine(`Nmap scan report for localhost (${target})`);
            onLine('Host is up.');
            onLine('');
            onLine('All scanned ports are closed on this machine.');
            onComplete();
          }, 500);
          return;
        }

        const machine = getMachine(target);

        if (!machine) {
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
            }, 800);
            return;
          }
          throw new Error(`nmap: failed to resolve "${target}"`);
        }

        const openPorts = machine.ports.filter((p) => p.open);

        onLine(`Starting Nmap scan on ${target}${versionScan ? ' (version detection)' : ''}`);
        onLine('Scanning ports...');

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
        }, 400);

        if (openPorts.length === 0) {
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine('All scanned ports are closed.');
            onComplete();
          }, 600);
        } else {
          openPorts.forEach((port, index) => {
            token.schedule(
              () => {
                if (token.isCancelled()) return;
                onLine(formatPortLine(port, versionScan));

                if (index === openPorts.length - 1) {
                  token.schedule(() => {
                    if (token.isCancelled()) return;

                    if (versionScan) {
                      const vulnLines = formatVulnerabilitySection(openPorts);
                      vulnLines.forEach((line) => onLine(line));
                    }

                    onComplete();
                  }, 200);
                }
              },
              500 + (index + 1) * PORT_SCAN_DELAY_MS,
            );
          });
        }
      },
      cancel: token.cancel,
    };
  },
});
