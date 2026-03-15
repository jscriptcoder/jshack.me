import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { RemoteMachine } from '../network/types';
import type { DnsRecord } from '../network/types';
import type { FileNode } from '../filesystem/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type SnmpwalkContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly getNodeFromMachine: (machineIp: string, path: string, cwd: string) => FileNode | null;
};

// Lines from snmpd.conf that are safe for read-only (public) community access
const isPublicOid = (line: string): boolean =>
  line.startsWith('sysDescr') ||
  line.startsWith('sysName') ||
  line.startsWith('sysContact') ||
  line.startsWith('ifDescr') ||
  line.startsWith('ifAddr');

// All OID data lines (excluding comments, blank lines, and community config)
const isOidLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return false;
  if (trimmed.startsWith('rocommunity') || trimmed.startsWith('rwcommunity')) return false;
  return true;
};

// Formats an OID data line with SNMP MIB prefix for display
const formatOidLine = (line: string): string => {
  if (line.startsWith('sysDescr')) return `SNMPv2-MIB::${line.replace(' ', '.0 = STRING: ')}`;
  if (line.startsWith('sysName')) return `SNMPv2-MIB::${line.replace(' ', '.0 = STRING: ')}`;
  if (line.startsWith('sysContact')) return `SNMPv2-MIB::${line.replace(' ', '.0 = STRING: ')}`;
  if (line.startsWith('ifDescr')) return `IF-MIB::${line.replace(' ', ' = STRING: ')}`;
  if (line.startsWith('ifAddr')) return `IF-MIB::${line.replace(' ', ' = STRING: ')}`;
  if (line.startsWith('nsExtendArgs'))
    return `NET-SNMP-EXTEND-MIB::${line.replace(' ', ' = STRING: ')}`;
  if (line.startsWith('firewall')) return `FIREWALL-MIB::${line.replace(' ', '.0 = STRING: ')}`;
  return line;
};

const parseCommunityStrings = (
  content: string,
): { readonly roCommunity: string; readonly rwCommunity: string } => {
  let roCommunity = 'public';
  let rwCommunity = '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('rocommunity ')) roCommunity = trimmed.slice('rocommunity '.length);
    if (trimmed.startsWith('rwcommunity ')) rwCommunity = trimmed.slice('rwcommunity '.length);
  }

  return { roCommunity, rwCommunity };
};

const OID_DELAY_MS = 200;

export const createSnmpwalkCommand = (context: SnmpwalkContext): Command => ({
  name: 'snmpwalk',
  category: 'network',
  description: 'SNMP MIB tree walker',
  manual: {
    synopsis: 'snmpwalk(host[, community])',
    description:
      'Walk the SNMP MIB tree on a remote host. Default community string is "public" (read-only). ' +
      'Use the correct read-write community string to access sensitive OIDs including firewall configuration.',
    arguments: [
      { name: 'host', description: 'IP address of the target machine', required: true },
      {
        name: 'community',
        description: 'SNMP community string (default: "public")',
      },
    ],
    examples: [
      { command: 'snmpwalk("192.168.1.1")', description: 'Walk with default public community' },
      {
        command: 'snmpwalk("192.168.1.1", "private")',
        description: 'Walk with read-write community',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, getLocalIP, resolveDomain, getNodeFromMachine } = context;

    const host = args[0] as string | undefined;
    const community = (args[1] as string | undefined) ?? 'public';

    if (!host) {
      throw new Error('snmpwalk: missing host\nUsage: snmpwalk("host"[, "community"])');
    }

    if (host === 'localhost' || host === '127.0.0.1') {
      throw new Error('snmpwalk: cannot query localhost');
    }

    // Resolve domain to IP if needed
    const targetIP = host.match(/^\d+\.\d+\.\d+\.\d+$/)
      ? host
      : (() => {
          const record = resolveDomain(host);
          if (!record) throw new Error(`snmpwalk: ${host}: Name or service not known`);
          return record.ip;
        })();

    const localIP = getLocalIP();
    if (targetIP === localIP) {
      throw new Error('snmpwalk: cannot query localhost');
    }

    const machine = getMachine(targetIP);
    if (!machine) {
      throw new Error(`snmpwalk: ${targetIP}: Connection timed out`);
    }

    // Check for SNMP port
    const snmpPort = machine.ports.find(
      (p) => p.service === 'snmp' && p.open && p.protocol === 'udp',
    );
    if (!snmpPort) {
      throw new Error(`snmpwalk: ${targetIP}: no SNMP service on target`);
    }

    // Read snmpd.conf from the machine's filesystem
    const confNode = getNodeFromMachine(targetIP, '/etc/snmp/snmpd.conf', '/');
    if (!confNode || confNode.type !== 'file' || !confNode.content) {
      throw new Error(`snmpwalk: ${targetIP}: Timeout — no response from SNMP agent`);
    }

    const confContent = confNode.content;
    const { roCommunity, rwCommunity } = parseCommunityStrings(confContent);

    // Validate community string
    const isReadWrite = community === rwCommunity;
    const isReadOnly = community === roCommunity;

    if (!isReadWrite && !isReadOnly) {
      throw new Error(`snmpwalk: ${targetIP}: Authentication failure (unknown community "${community}")`);
    }

    // Collect OID lines to display
    const allOidLines = confContent
      .split('\n')
      .filter(isOidLine)
      .map((line) => line.trim());

    const visibleLines = isReadWrite
      ? allOidLines
      : allOidLines.filter(isPublicOid);

    const formattedLines = visibleLines.map(formatOidLine);

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        let delay = 0;

        // Header
        delay += jitter(OID_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(
            `Querying ${targetIP} with community string "${community}"...`,
          );
        }, delay);

        // Access level banner
        delay += jitter(OID_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(
            isReadWrite
              ? '[READ-WRITE] Community string accepted.'
              : `[READ-ONLY] Community "${community}" accepted.`,
          );
          onLine('');
        }, delay);

        // Stream OID lines
        formattedLines.forEach((line) => {
          delay += jitter(OID_DELAY_MS);
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine(line);
          }, delay);
        });

        // Summary
        delay += jitter(OID_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('');
          onLine(`${formattedLines.length} OIDs returned.`);
          if (!isReadWrite) {
            onLine(
              'Community "public" is READ-ONLY — try a read-write community string for full access.',
            );
          }
          onComplete();
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
