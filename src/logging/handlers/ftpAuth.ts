import { appendToMachineLog, type LogFileSystemDeps } from '../appendToMachineLog';
import { formatFtpConnect, formatFtpLoginFailed, formatFtpLoginOk } from '../formatters';
import { resolveLogSourceIP } from '../utils';

export type FtpAuthDeps = {
  readonly sessionMachine: string;
  readonly ownWorkstationId: string;
  readonly getLocalIP: () => string;
  readonly getPublicIP: () => string | null;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly logFs: LogFileSystemDeps;
};

export type FtpAuthEvent = {
  readonly success: boolean;
  readonly user: string;
  readonly targetIP: string;
  readonly port: number;
};

export type FtpAuthHandler = (event: FtpAuthEvent) => void;

// Writes a vsftpd.log entry to the FTP daemon's host. When the public
// port is NAT-forwarded, the log lands on the backend where vsftpd runs.
export const createFtpAuthHandler =
  (deps: FtpAuthDeps): FtpAuthHandler =>
  ({ success, user, targetIP, port }) => {
    const { ip: logIp } = deps.resolveNat(targetIP, port);
    const now = new Date();
    const sourceIp = resolveLogSourceIP(
      deps.sessionMachine,
      deps.ownWorkstationId,
      targetIP,
      deps.getLocalIP(),
      deps.getPublicIP(),
    );
    const connectLine = formatFtpConnect(now, sourceIp);
    const authLine = success
      ? formatFtpLoginOk({ date: now, clientIp: sourceIp, user })
      : formatFtpLoginFailed({ date: now, clientIp: sourceIp, user });
    appendToMachineLog(logIp, '/var/log/vsftpd.log', `${connectLine}\n${authLine}`, deps.logFs);
  };
