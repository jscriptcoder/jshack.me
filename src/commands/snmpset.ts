import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { FileNode, MachineWriteOp } from '../filesystem/types';
import type { Credentials } from '../sessionRegistry/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

// Same shape as scp's transient-session callback. Optional for back-
// compat with tests; useNetworkCommands supplies it bound to identity.
export type SnmpsetTransientSession = (
  params: { readonly machine_id: string; readonly credentials: Credentials },
  body: () => void,
) => Promise<void>;

type SnmpsetContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly getNodeFromMachine: (machineIp: string, path: string, cwd: string) => FileNode | null;
  readonly writeFileToMachine: (op: MachineWriteOp) => void;
  readonly withTransientSession?: SnmpsetTransientSession;
};

const VALID_FIREWALL_VALUES = new Set(['permit', 'deny']);
const VALID_ACL_VALUES = new Set(['allow', 'deny']);
const SET_DELAY_MS = 300;

// Parses "oid=value" format, returning the OID name and value
const parseAssignment = (
  assignment: string,
): { readonly oid: string; readonly value: string } | null => {
  const eqIdx = assignment.indexOf('=');
  if (eqIdx === -1) return null;
  return { oid: assignment.slice(0, eqIdx), value: assignment.slice(eqIdx + 1) };
};

// Replaces a firewall OID line in snmpd.conf content
const replaceFirewallOid = (content: string, oid: string, newValue: string): string =>
  content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${oid} `)) return `${oid} ${newValue}`;
      return line;
    })
    .join('\n');

// Reads the current value of a firewall OID from snmpd.conf
const readFirewallValue = (content: string, oid: string): string | undefined => {
  const match = content
    .split('\n')
    .map((line) => line.trim())
    .find((trimmed) => trimmed.startsWith(`${oid} `));
  return match ? match.slice(oid.length + 1) : undefined;
};

export const createSnmpsetCommand = (context: SnmpsetContext): Command => ({
  name: 'snmpset',
  category: 'network',
  description: 'SNMP SET — modify SNMP OID values',
  manual: {
    synopsis: 'snmpset <host> <community> <oid=value>',
    description:
      'Set a writable SNMP OID on a remote host. Requires a read-write community string. ' +
      'Writable OIDs: firewall OIDs (firewallSSH, firewallHTTP) with values "permit"/"deny", ' +
      'and ACL OIDs (aclSSH, aclHTTP, aclFTP) with values "allow"/"deny".',
    arguments: [
      { name: 'host', description: 'IP address of the target machine', required: true },
      { name: 'community', description: 'SNMP read-write community string', required: true },
      {
        name: 'oid=value',
        description: 'OID assignment (e.g., "firewallSSH=permit" or "aclSSH=allow")',
        required: true,
      },
    ],
    examples: [
      {
        command: 'snmpset 192.168.1.1 private firewallSSH=permit',
        description: 'Open SSH through the firewall (router)',
      },
      {
        command: 'snmpset 192.168.1.1 private aclSSH=allow',
        description: 'Allow SSH through ACL (switch)',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, getLocalIP, resolveDomain, getNodeFromMachine, writeFileToMachine } =
      context;

    const host = args[0] as string | undefined;
    const community = args[1] as string | undefined;
    const assignment = args[2] as string | undefined;

    if (!host || !community || !assignment) {
      throw new Error(
        'snmpset: missing host, community, or assignment\nUsage: snmpset <host> <community> <oid=value>',
      );
    }

    // Resolve target
    const targetIP = host.match(/^\d+\.\d+\.\d+\.\d+$/)
      ? host
      : (() => {
          const record = resolveDomain(host);
          if (!record) throw new Error(`snmpset: ${host}: Name or service not known`);
          return record.ip;
        })();

    if (targetIP === getLocalIP() || host === 'localhost' || host === '127.0.0.1') {
      throw new Error('snmpset: cannot modify localhost');
    }

    const machine = getMachine(targetIP);
    if (!machine) {
      throw new Error(`snmpset: ${targetIP}: Connection timed out`);
    }

    // Check SNMP port
    const snmpPort = machine.ports.find(
      (p) => p.service === 'snmp' && p.open && p.protocol === 'udp',
    );
    if (!snmpPort) {
      throw new Error(`snmpset: ${targetIP}: no SNMP service on target`);
    }

    // Read snmpd.conf
    const confNode = getNodeFromMachine(targetIP, '/etc/snmp/snmpd.conf', '/');
    if (!confNode || confNode.type !== 'file' || !confNode.content) {
      throw new Error(`snmpset: ${targetIP}: Timeout — no response from SNMP agent`);
    }

    const confContent = confNode.content;

    // Validate community string
    const { rwCommunity, roCommunity } = confContent.split('\n').reduce(
      (acc, line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('rwcommunity '))
          return { ...acc, rwCommunity: trimmed.slice('rwcommunity '.length) };
        if (trimmed.startsWith('rocommunity '))
          return { ...acc, roCommunity: trimmed.slice('rocommunity '.length) };
        return acc;
      },
      { rwCommunity: '', roCommunity: '' },
    );

    if (community === roCommunity) {
      throw new Error(
        `snmpset: community "${community}" is read-only — cannot perform SET operation`,
      );
    }
    if (community !== rwCommunity) {
      throw new Error(
        `snmpset: ${targetIP}: Authentication failure (unknown community "${community}")`,
      );
    }

    // Parse assignment
    const parsed = parseAssignment(assignment);
    if (!parsed) {
      throw new Error(`snmpset: expected format "oid=value" (e.g., "firewallSSH=permit")`);
    }

    const { oid, value } = parsed;

    // Validate OID is writable (firewall OIDs for routers, ACL OIDs for switches)
    const isFirewallOid = oid.startsWith('firewall');
    const isAclOid = oid.startsWith('acl');
    if (!isFirewallOid && !isAclOid) {
      throw new Error(`snmpset: OID "${oid}" is not writable`);
    }

    // Validate value based on OID type
    const validValues = isAclOid ? VALID_ACL_VALUES : VALID_FIREWALL_VALUES;
    const expectedDesc = isAclOid ? '"allow" or "deny"' : '"permit" or "deny"';
    if (!validValues.has(value)) {
      throw new Error(`snmpset: invalid value "${value}" for ${oid} — expected ${expectedDesc}`);
    }

    // Read current value
    const oldValue = readFirewallValue(confContent, oid);
    if (oldValue === undefined) {
      throw new Error(`snmpset: OID "${oid}" not found on target`);
    }

    // MIB prefix depends on OID type
    const mibPrefix = isAclOid ? 'ACL-MIB' : 'FIREWALL-MIB';

    // Build updated config
    const updatedContent = replaceFirewallOid(confContent, oid, value);

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        let delay = 0;

        delay += jitter(SET_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`Connecting to ${targetIP}:161 (SNMP)...`);
        }, delay);

        delay += jitter(SET_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`Authenticating with community "${community}"...`);
        }, delay);

        delay += jitter(SET_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('');
          onLine(`${mibPrefix}::${oid}.0: ${oldValue} → ${value}`);
        }, delay);

        delay += jitter(SET_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          // Write the updated config back to the filesystem.
          // Wrap in a transient session so the L1 patch-validation gate
          // sees a session row at fire time. snmpset writes as the
          // implicit SNMP admin — no user-level credentials in this
          // game model — so we synthesize 'snmp' / 'root' for the
          // session row. (snmpset writes as root in practice; the
          // permissions check on the file uses userType: 'root' too.)
          const doWrite = () => {
            writeFileToMachine({
              machineId: targetIP,
              path: '/etc/snmp/snmpd.conf',
              cwd: '/',
              content: updatedContent,
              userType: 'root',
            });
            onLine('Value updated successfully.');
          };

          if (context.withTransientSession) {
            void context
              .withTransientSession(
                {
                  machine_id: targetIP,
                  credentials: { username: 'snmp', userType: 'root' },
                },
                doWrite,
              )
              .catch((error) => {
                console.error('[snmpset] transient session push failed:', error);
                onLine('Error: session push failed.');
              })
              .finally(() => {
                onComplete();
              });
          } else {
            doWrite();
            onComplete();
          }
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
