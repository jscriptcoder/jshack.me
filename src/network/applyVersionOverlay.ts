import type { MachineFileOp } from '../filesystem/types';
import type { RemoteMachine } from './types';
import { DPKG_STATUS_PATH, parseDpkgVersions } from './dpkgStatus';

// Phase 3 service-version overlay. When a player runs `apt upgrade` on a
// machine, the new service version is persisted in the machine's
// /var/lib/dpkg/status file (the real path Debian/Ubuntu uses for package
// metadata). This function wraps a RemoteMachine so that port.serviceVersion
// reads come from that file if an entry exists for the port's service name;
// otherwise it falls through to the generation-time default.
//
// Consumers (nmap, msfconsole, the exploit-logging callback) get the overlay
// applied transparently via useNetworkCommands wrapping getMachine/etc.

type ReadFromMachine = (op: MachineFileOp) => string | null;

export const applyVersionOverlay = (
  machine: RemoteMachine,
  readFileFromMachine: ReadFromMachine,
): RemoteMachine => {
  const content = readFileFromMachine({
    machineId: machine.ip,
    path: DPKG_STATUS_PATH,
    cwd: '/',
    userType: 'root',
  });
  if (content === null || content.trim().length === 0) return machine;

  const versions = parseDpkgVersions(content);
  if (versions.size === 0) return machine;

  return {
    ...machine,
    ports: machine.ports.map((port) => {
      const overlay = versions.get(port.service);
      return overlay === undefined ? port : { ...port, serviceVersion: overlay };
    }),
  };
};
