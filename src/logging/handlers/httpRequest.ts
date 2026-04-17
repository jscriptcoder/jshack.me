import { appendToMachineLog, type LogFileSystemDeps } from '../appendToMachineLog';
import { formatAccessLog } from '../formatters';
import { resolveLogSourceIP } from '../utils';

export type HttpRequestDeps = {
  readonly sessionMachine: string;
  readonly getLocalIP: () => string;
  readonly getPublicIP: () => string | null;
  readonly resolveNat: (
    ip: string,
    port: number,
  ) => { readonly ip: string; readonly port: number };
  readonly logFs: LogFileSystemDeps;
};

export type HttpRequestHandler = (
  targetIP: string,
  port: number,
  method: string,
  path: string,
  status: number,
  size: number,
) => void;

// Writes an Apache Combined-format access log entry to the target web
// server's filesystem. When the public port is NAT-forwarded (e.g.,
// router:8080 → backend:80), the log lands on the backend.
export const createHttpRequestHandler =
  (deps: HttpRequestDeps): HttpRequestHandler =>
  (targetIP, port, method, path, status, size) => {
    const { ip: logIp } = deps.resolveNat(targetIP, port);
    const sourceIp = resolveLogSourceIP(
      deps.sessionMachine,
      targetIP,
      deps.getLocalIP(),
      deps.getPublicIP(),
    );
    const logLine = formatAccessLog({
      date: new Date(),
      clientIp: sourceIp,
      method,
      path,
      status,
      size,
    });
    appendToMachineLog(logIp, '/var/log/access.log', logLine, deps.logFs);
  };
