import type {
  Command,
  AsyncOutput,
  NcPromptData,
  ExploitShellData,
} from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import { findExploitableCve } from '../generation/findExploitableCve';
import { createCancellationToken, jitter } from '../utils/asyncCommand';
import { ncPidFilePath, createNcPidContent } from './nc';

export type ExploitAttemptInfo = {
  readonly targetIp: string;
  readonly port: number;
  readonly service?: string;
  readonly serviceVersion?: string;
  readonly success: boolean;
};

type MsfconsoleContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly getGameTime?: () => number;
  readonly onExploitAttempt?: (info: ExploitAttemptInfo) => void;
  readonly readRemoteFile?: (machineId: string, path: string) => string | null;
  readonly readLocalFile?: (path: string) => string | null;
  readonly writeRemoteFile?: (machineId: string, path: string, content: string) => void;
  readonly listRemoteDir?: (machineId: string, path: string) => readonly string[] | null;
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
    const { getMachine, getLocalIP, resolveDomain, onExploitAttempt } = context;

    const host = args[0] as string | undefined;
    const port = args[1] as number | undefined;
    const thirdArg = args[2] as string | undefined;

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
      onExploitAttempt?.({ targetIp: targetIP, port, success: false });
      throw new Error(`msfconsole: ${targetIP}:${port}: Connection refused`);
    }

    const gameTime = context.getGameTime?.() ?? 0;
    const vulnerability = findExploitableCve(machine, targetPort, gameTime);
    if (!vulnerability) {
      onExploitAttempt?.({
        targetIp: targetIP,
        port,
        service: targetPort.service,
        serviceVersion: targetPort.serviceVersion,
        success: false,
      });
      throw new Error(`msfconsole: no known vulnerability on ${targetIP}:${port}`);
    }

    if (!targetPort.owner) {
      onExploitAttempt?.({
        targetIp: targetIP,
        port,
        service: targetPort.service,
        serviceVersion: targetPort.serviceVersion,
        success: false,
      });
      throw new Error(`msfconsole: exploit failed — service not exploitable`);
    }

    onExploitAttempt?.({
      targetIp: targetIP,
      port,
      service: targetPort.service,
      serviceVersion: targetPort.serviceVersion,
      success: true,
    });

    const { owner } = targetPort;
    const { effect } = vulnerability;

    const requiresPath = effect.kind === 'file_read' || effect.kind === 'dir_list';
    const requiresLocalRemote = effect.kind === 'file_write';
    const requiresScript = effect.kind === 'script_exec';

    if ((requiresPath || requiresScript) && !thirdArg) {
      throw new Error(
        `msfconsole: this exploit requires a target path — usage: msfconsole(host, port, '/path')`,
      );
    }
    if (requiresLocalRemote && (!thirdArg || !thirdArg.includes(':'))) {
      throw new Error(
        `msfconsole: this exploit requires local:remote syntax — usage: msfconsole(host, port, '/local/file:/remote/path')`,
      );
    }

    const token = createCancellationToken();

    // For shell_full, the tier comes from the effect, not the port owner.
    // Resolve a plausible username and home path for the effect's tier.
    const resolveShellFullUser = (
      tier: 'guest' | 'user' | 'root',
    ): { readonly username: string; readonly homePath: string } => {
      if (tier === 'root') return { username: 'root', homePath: '/root' };
      const matchingUser = machine.users.find((u) => u.userType === tier);
      if (matchingUser) {
        return { username: matchingUser.username, homePath: `/home/${matchingUser.username}` };
      }
      return { username: tier, homePath: `/home/${tier}` };
    };

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

          switch (effect.kind) {
            case 'shell_full': {
              const shellUser = resolveShellFullUser(effect.tier);
              onLine('[+] Exploit successful!');
              onLine(`[+] Full shell as ${shellUser.username}@${targetIP}`);
              onLine('');
              const exploitShell: ExploitShellData = {
                __type: 'exploit_shell',
                targetIP,
                targetPort: port,
                service: targetPort.service,
                username: shellUser.username,
                userType: effect.tier,
                homePath: shellUser.homePath,
                tier: effect.tier,
              };
              onComplete(exploitShell);
              break;
            }
            case 'file_read': {
              const content = context.readRemoteFile?.(targetIP, thirdArg!) ?? null;
              onLine('[+] Exploit successful!');
              if (content !== null) {
                onLine(`[+] Reading ${thirdArg}:`);
                onLine('');
                content.split('\n').forEach((line) => onLine(line));
              } else {
                onLine(`[-] File not found or not readable: ${thirdArg}`);
              }
              onComplete();
              break;
            }
            case 'dir_list': {
              const entries = context.listRemoteDir?.(targetIP, thirdArg!) ?? null;
              onLine('[+] Exploit successful!');
              if (entries !== null) {
                onLine(`[+] Listing ${thirdArg}:`);
                onLine('');
                entries.forEach((entry) => onLine(entry));
              } else {
                onLine(`[-] Directory not found or not readable: ${thirdArg}`);
              }
              onComplete();
              break;
            }
            case 'file_write': {
              const colonIdx = thirdArg!.indexOf(':');
              const localPath = thirdArg!.slice(0, colonIdx);
              const remotePath = thirdArg!.slice(colonIdx + 1);
              const localContent = context.readLocalFile?.(localPath) ?? null;
              if (localContent === null) {
                onLine(`[-] Could not read local file: ${localPath}`);
              } else {
                context.writeRemoteFile?.(targetIP, remotePath, localContent);
                onLine('[+] Exploit successful!');
                onLine(`[+] Uploaded ${localPath} → ${remotePath} (${localContent.length} bytes)`);
              }
              onComplete();
              break;
            }
            case 'password_reset': {
              const tier = effect.tier;
              const newPassword = `pwned-${vulnerability.cve.slice(-4)}-${tier}`;
              const currentPasswd = context.readRemoteFile?.(targetIP, '/etc/passwd') ?? '';
              const targetUser =
                tier === 'root'
                  ? 'root'
                  : (machine.users.find((u) => u.userType === tier)?.username ?? tier);
              const updatedPasswd = currentPasswd
                .split('\n')
                .map((line) => {
                  const parts = line.split(':');
                  if (parts[0] === targetUser) {
                    return [parts[0], newPassword, ...parts.slice(2)].join(':');
                  }
                  return line;
                })
                .join('\n');
              context.writeRemoteFile?.(targetIP, '/etc/passwd', updatedPasswd);
              onLine('[+] Exploit successful!');
              onLine(`[+] Password reset for '${targetUser}' — new password: ${newPassword}`);
              onComplete();
              break;
            }
            case 'backdoor_port_open': {
              const backdoorPort = effect.port;
              const pidPath = ncPidFilePath(backdoorPort);
              const pidContent = createNcPidContent(backdoorPort, 'backdoor', 'root');
              context.writeRemoteFile?.(targetIP, pidPath, pidContent);
              onLine('[+] Exploit successful!');
              onLine(`[+] Backdoor planted on port ${backdoorPort} — connect with nc(target, ${backdoorPort})`);
              onComplete();
              break;
            }
            default: {
              // shell_limited + script_exec (not yet implemented) + future effects
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
            }
          }
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
