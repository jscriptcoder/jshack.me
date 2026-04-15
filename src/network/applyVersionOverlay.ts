import type { MachineFileOp } from '../filesystem/types';
import type { RemoteMachine } from './types';
import { DPKG_STATUS_PATH, parseDpkgVersions } from './dpkgStatus';
import { DEFAULT_LATEST_VERSION } from '../generation/timeline';

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

  // Firmware package is router-only. Non-routers won't have one and non-
  // routers' firmwareVersion stays undefined regardless.
  const firmwareOverlay = versions.get('firmware');

  return {
    ...machine,
    ports: machine.ports.map((port) => {
      const overlay = versions.get(port.service);
      // Skip override when the dpkg entry is the 'latest' sentinel — that's
      // the untouched default, not a real apt-upgrade result. Important for
      // NAT-forwarded ports where the router's dpkg may have a same-named
      // service entry that would otherwise clobber the backend's real version.
      if (overlay === undefined || overlay === DEFAULT_LATEST_VERSION) return port;
      return { ...port, serviceVersion: overlay };
    }),
    ...(firmwareOverlay !== undefined && firmwareOverlay !== DEFAULT_LATEST_VERSION
      ? { firmwareVersion: firmwareOverlay }
      : {}),
  };
};
