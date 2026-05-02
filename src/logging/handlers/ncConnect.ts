import { appendToMachineLog, type LogFileSystemDeps } from '../appendToMachineLog';
import { formatXinetdConnection } from '../formatters';
import { generatePid, resolveHostname, resolveLogSourceIP } from '../utils';

export type NcConnectInfo = {
  readonly targetIp: string;
  readonly port: number;
  readonly service?: string;
  readonly success: boolean;
};

export type NcConnectDeps = {
  readonly sessionMachine: string;
  readonly ownWorkstationId: string;
  readonly getLocalIP: () => string;
  readonly getPublicIP: () => string | null;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly getMachine: (ip: string) => { readonly hostname: string } | undefined;
  readonly logFs: LogFileSystemDeps;
};

// Writes an xinetd connection entry to the target machine's syslog.
// When the public port is NAT-forwarded, the log lands on the backend
// where the listener actually runs.
export const createNcConnectHandler =
  (deps: NcConnectDeps): ((info: NcConnectInfo) => void) =>
  (info) => {
    const { ip: logIp } = deps.resolveNat(info.targetIp, info.port);
    const sourceIp = resolveLogSourceIP(
      deps.sessionMachine,
      deps.ownWorkstationId,
      deps.getLocalIP(),
      deps.getPublicIP(),
    );
    const hostname = resolveHostname(logIp, deps.getMachine);
    const line = formatXinetdConnection({
      date: new Date(),
      hostname,
      pid: generatePid(),
      sourceIp,
      port: info.port,
      success: info.success,
    });
    appendToMachineLog(logIp, '/var/log/syslog', line, deps.logFs);
  };
