import type { MachineFileOp } from '../filesystem/types';
import type { RemoteMachine } from './types';

// Phase 3 file-based service-version overlay. When a player runs
// `apt upgrade` or `apt install service=version` on a machine, the new
// service version is written to /var/lib/apt/service_versions/<service>
// on that machine's filesystem (via the existing IndexedDB patch stream).
//
// applyVersionOverlay wraps a RemoteMachine so that port-version reads
// see the overlay'd version instead of the generation-time default.
// Consumers (nmap, msfconsole, the exploit-logging callback) don't need
// to know the overlay exists — they get an "effective machine" view.

export const SERVICE_VERSION_OVERLAY_DIR = '/var/lib/apt/service_versions';

export const serviceVersionOverlayPath = (service: string): string =>
  `${SERVICE_VERSION_OVERLAY_DIR}/${service}`;

type ReadFromMachine = (op: MachineFileOp) => string | null;

export const applyVersionOverlay = (
  machine: RemoteMachine,
  readFileFromMachine: ReadFromMachine,
): RemoteMachine => ({
  ...machine,
  ports: machine.ports.map((port) => {
    const overlay = readFileFromMachine({
      machineId: machine.ip,
      path: serviceVersionOverlayPath(port.service),
      cwd: '/',
      userType: 'root',
    });
    if (overlay === null) return port;
    const trimmed = overlay.trim();
    if (trimmed.length === 0) return port;
    return { ...port, serviceVersion: trimmed };
  }),
});
