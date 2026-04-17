import { appendToMachineLog, type LogFileSystemDeps } from '../appendToMachineLog';
import { formatSshAccepted, formatSshAcceptedKey, formatSshFailed } from '../formatters';
import { generatePid, resolveHostname, resolveLogSourceIP } from '../utils';

export type SshAuthMethod = 'password' | 'publickey';

export type SshAuthDeps = {
  readonly sessionMachine: string;
  readonly getLocalIP: () => string;
  readonly getPublicIP: () => string | null;
  readonly resolveNat: (
    ip: string,
    port: number,
  ) => { readonly ip: string; readonly port: number };
  readonly getMachine: (ip: string) => { readonly hostname: string } | undefined;
  readonly logFs: LogFileSystemDeps;
};

export type SshAuthHandler = (
  success: boolean,
  user: string,
  targetIP: string,
  port: number,
  method: SshAuthMethod,
) => void;

// Writes an auth.log entry to the SSH daemon's host. When the public
// port is NAT-forwarded, the log lands on the backend where sshd runs.
export const createSshAuthHandler =
  (deps: SshAuthDeps): SshAuthHandler =>
  (success, user, targetIP, port, method) => {
    const { ip: logIp } = deps.resolveNat(targetIP, port);
    const hostname = resolveHostname(logIp, deps.getMachine);
    const pid = generatePid();
    const srcPort = Math.floor(Math.random() * 25536) + 40000;
    const sourceIp = resolveLogSourceIP(
      deps.sessionMachine,
      targetIP,
      deps.getLocalIP(),
      deps.getPublicIP(),
    );
    const opts = { date: new Date(), hostname, pid, user, fromIp: sourceIp, port: srcPort };
    const logLine = !success
      ? formatSshFailed(opts)
      : method === 'publickey'
        ? formatSshAcceptedKey(opts)
        : formatSshAccepted(opts);
    appendToMachineLog(logIp, '/var/log/auth.log', logLine, deps.logFs);
  };
