import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { FileNode } from '../filesystem/types';
import { isValidIP } from '../utils/network';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type GobusterContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly resolveNat: (ip: string) => string;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
};

const HTTP_SERVICES = ['http', 'https', 'http-alt'] as const;

const HEADER_DELAY_MS = 80;
const RESULT_DELAY_MS = 60;

type WebEntry = {
  readonly path: string;
  readonly isDirectory: boolean;
  readonly size: number;
};

const parseUrl = (urlStr: string): { readonly host: string; readonly port: number } | null => {
  const fullMatch = urlStr.match(/^https?:\/\/([^:/]+)(?::(\d+))?(\/.*)?$/);
  if (fullMatch) {
    const [, host, portStr] = fullMatch;
    const protocol = urlStr.startsWith('https') ? 'https' : 'http';
    return {
      host,
      port: portStr ? parseInt(portStr, 10) : protocol === 'https' ? 443 : 80,
    };
  }

  // Shorthand: "hostname" or "hostname:port" without protocol
  const shortMatch = urlStr.match(/^([^:/]+)(?::(\d+))?(\/.*)?$/);
  if (shortMatch) {
    const [, host, portStr] = shortMatch;
    return { host, port: portStr ? parseInt(portStr, 10) : 80 };
  }

  return null;
};

// Recursively walks a FileNode directory tree and collects all web-accessible entries.
// Filters out .headers sidecar files (internal mechanism for curl).
const collectWebEntries = (node: FileNode, prefix: string): readonly WebEntry[] => {
  if (!node.children) return [];

  return Object.values(node.children).flatMap((child) => {
    const childPath = `${prefix}/${child.name}`;

    // Skip .headers sidecar files — they're an internal mechanism
    if (child.name.endsWith('.headers')) return [];

    if (child.type === 'directory') {
      return [
        { path: childPath, isDirectory: true, size: 0 },
        ...collectWebEntries(child, childPath),
      ];
    }

    return [{ path: childPath, isDirectory: false, size: (child.content ?? '').length }];
  });
};

const formatEntry = (entry: WebEntry): string => {
  const status = entry.isDirectory ? '301' : '200';
  const size = entry.size;
  return `${entry.path.padEnd(22)}(Status: ${status}) [Size: ${size}]`;
};

export const createGobusterCommand = (context: GobusterContext): Command => ({
  name: 'gobuster',
  description: 'Directory/file enumeration on web servers',
  manual: {
    synopsis: 'gobuster("dir", url)',
    description:
      'Enumerate directories and files on a web server by scanning the target URL. Discovers hidden paths, admin panels, configuration files, and other web content. Only "dir" mode is supported.',
    arguments: [
      {
        name: 'mode',
        description: 'Scan mode — only "dir" (directory enumeration) is supported',
        required: true,
      },
      {
        name: 'url',
        description:
          'Target URL (e.g., "http://192.168.1.75", "http://webserver.local:8080", "192.168.1.75")',
        required: true,
      },
    ],
    examples: [
      { command: 'gobuster("dir", "http://192.168.1.75")', description: 'Scan a web server by IP' },
      {
        command: 'gobuster("dir", "http://webserver.local")',
        description: 'Scan using a domain name',
      },
      {
        command: 'gobuster("dir", "http://192.168.1.75:8080")',
        description: 'Scan a non-standard HTTP port',
      },
      { command: 'gobuster("dir", "192.168.1.75")', description: 'Scan without http:// prefix' },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, resolveDomain, resolveNat, getNodeFromMachine } = context;

    const mode = args[0] as string | undefined;
    const urlStr = args[1] as string | undefined;

    if (!mode) {
      throw new Error('gobuster: missing mode argument. Usage: gobuster("dir", url)');
    }

    if (mode !== 'dir') {
      throw new Error(`gobuster: unsupported mode '${mode}'. Only "dir" mode is supported`);
    }

    if (!urlStr) {
      throw new Error('gobuster: missing URL argument. Usage: gobuster("dir", url)');
    }

    const parsed = parseUrl(urlStr);
    if (!parsed) {
      throw new Error(`gobuster: invalid URL: ${urlStr}`);
    }

    const dnsRecord = resolveDomain(parsed.host);
    const targetIP = dnsRecord?.ip ?? parsed.host;

    if (!isValidIP(targetIP)) {
      throw new Error(`gobuster: Could not resolve host: ${parsed.host}`);
    }

    const machine = getMachine(targetIP);
    if (!machine) {
      throw new Error(
        `gobuster: Failed to connect to ${parsed.host} port ${parsed.port}: Connection refused`,
      );
    }

    const port = machine.ports.find((p) => p.port === parsed.port);
    if (!port || !port.open || !HTTP_SERVICES.some((s) => s === port.service)) {
      throw new Error(
        `gobuster: Failed to connect to ${parsed.host} port ${parsed.port}: Connection refused`,
      );
    }

    // Resolve NAT for filesystem reads (forwarded mode maps router to internal machine)
    const filesystemIP = resolveNat(targetIP);
    const webRoot = getNodeFromMachine(filesystemIP, '/var/www/html', '/');

    if (!webRoot || webRoot.type !== 'directory') {
      throw new Error(`gobuster: no web root found on ${parsed.host}`);
    }

    const entries = collectWebEntries(webRoot, '');
    const token = createCancellationToken();

    // Build display URL: use original url string but strip trailing path
    const displayUrl = urlStr.startsWith('http')
      ? `${urlStr.match(/^https?:\/\/[^/]+/)?.[0] ?? urlStr}`
      : `http://${parsed.host}${parsed.port !== 80 ? `:${parsed.port}` : ''}`;

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        const headerLines = [
          '===============================================================',
          'Gobuster v3.6',
          '===============================================================',
          `[+] Mode:         dir`,
          `[+] Url:          ${displayUrl}`,
          '[+] Wordlist:     /usr/share/wordlists/common.txt',
          '[+] Threads:      10',
          '===============================================================',
          'Starting scan',
          '===============================================================',
        ];

        let delay = 0;

        // Stream header lines
        headerLines.forEach((line) => {
          delay += jitter(HEADER_DELAY_MS);
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine(line);
          }, delay);
        });

        // Stream each discovered entry
        entries.forEach((entry) => {
          delay += jitter(RESULT_DELAY_MS);
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine(formatEntry(entry));
          }, delay);
        });

        // Footer
        delay += jitter(HEADER_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('===============================================================');
          onLine(`Scan complete: ${entries.length} results found`);
          onLine('===============================================================');
          onComplete();
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
