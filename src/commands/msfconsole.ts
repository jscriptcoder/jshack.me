import type { Command, AsyncOutput, NcPromptData } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import { findVulnForService } from '../generation/pools/vulnerabilities';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type MsfconsoleContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
};

const MSFCONSOLE_PHASE_DELAY_MS = 600;

export const createMsfconsoleCommand = (context: MsfconsoleContext): Command => ({
  name: 'msfconsole',
  category: 'network',
  description: 'Exploit a vulnerable service for remote code execution',
  manual: {
    synopsis: 'msfconsole(host, port)',
    description:
      'Exploit a known vulnerability on a remote service to gain shell access. ' +
      'Use nmap("-sV", target) first to discover vulnerable services and their CVEs. ' +
      'Only works against ports with known vulnerabilities.',
    arguments: [
      { name: 'host', description: 'IP address or hostname of the target machine', required: true },
      { name: 'port', description: 'Port number of the vulnerable service', required: true },
    ],
    examples: [
      {
        command: 'msfconsole("10.50.100.10", 80)',
        description: 'Exploit a vulnerable HTTP service',
      },
      {
        command: 'msfconsole("web01.mission", 3306)',
        description: 'Exploit a vulnerable MySQL service',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, getLocalIP, resolveDomain } = context;

    const host = args[0] as string | undefined;
    const port = args[1] as number | undefined;

    if (!host) {
      throw new Error('msfconsole: missing host\nUsage: msfconsole("host", port)');
    }

    if (port === undefined || typeof port !== 'number') {
      throw new Error('msfconsole: missing or invalid port\nUsage: msfconsole("host", port)');
    }

    if (port < 1 || port > 65535) {
      throw new Error('msfconsole: port must be between 1 and 65535');
    }

    let targetIP = host;
    if (!host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      const record = resolveDomain(host);
      if (!record) {
        throw new Error(`msfconsole: ${host}: Name or service not known`);
      }
      targetIP = record.ip;
    }

    const localIP = getLocalIP();
    if (targetIP === localIP || targetIP === '127.0.0.1' || host === 'localhost') {
      throw new Error('msfconsole: cannot exploit localhost');
    }

    const machine = getMachine(targetIP);
    if (!machine) {
      throw new Error(`msfconsole: connect to ${targetIP}: Connection timed out`);
    }

    const targetPort = machine.ports.find((p) => p.port === port);
    if (!targetPort || !targetPort.open) {
      throw new Error(`msfconsole: ${targetIP}:${port}: Connection refused`);
    }

    const vulnerability = findVulnForService(targetPort.service, targetPort.serviceVersion ?? '');
    if (!vulnerability) {
      throw new Error(`msfconsole: no known vulnerability on ${targetIP}:${port}`);
    }

    if (!targetPort.owner) {
      throw new Error(`msfconsole: exploit failed — service not exploitable`);
    }

    const { owner } = targetPort;
    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`[*] Targeting ${targetIP}:${port} (${vulnerability.serviceVersion})`);

        let delay = jitter(MSFCONSOLE_PHASE_DELAY_MS);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`[*] Vulnerability: ${vulnerability.cve}`);
        }, delay);

        delay += jitter(MSFCONSOLE_PHASE_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('[*] Sending exploit payload...');
        }, delay);

        delay += jitter(MSFCONSOLE_PHASE_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('[*] Payload delivered, waiting for callback...');
        }, delay);

        delay += jitter(MSFCONSOLE_PHASE_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('[+] Exploit successful!');
          onLine(`[+] Got shell as ${owner.username}@${targetIP}`);
          onLine('');

          const ncPrompt: NcPromptData = {
            __type: 'nc_prompt',
            targetIP,
            targetPort: port,
            service: targetPort.service,
            username: owner.username,
            userType: owner.userType,
            homePath: owner.homePath,
          };

          onComplete(ncPrompt);
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
