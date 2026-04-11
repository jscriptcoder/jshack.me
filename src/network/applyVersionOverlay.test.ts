import { describe, it, expect } from 'vitest';
import type { RemoteMachine } from './types';
import type { MachineFileOp } from '../filesystem/types';
import { applyVersionOverlay } from './applyVersionOverlay';
import { DPKG_STATUS_PATH } from './dpkgStatus';

const baseMachine: RemoteMachine = {
  ip: '10.0.0.5',
  hostname: 'web01',
  ports: [
    { port: 22, service: 'ssh', serviceVersion: 'OpenSSH 8.9', open: true },
    { port: 80, service: 'http', serviceVersion: 'Apache/2.4.49', open: true },
    { port: 443, service: 'https', serviceVersion: 'nginx/1.20.0', open: false },
  ],
  users: [],
};

const mkReader =
  (statusContent: string | null) =>
  (op: MachineFileOp): string | null => {
    if (op.path === DPKG_STATUS_PATH) return statusContent;
    return null;
  };

describe('applyVersionOverlay', () => {
  it('returns the machine unchanged when the status file does not exist', () => {
    const result = applyVersionOverlay(baseMachine, mkReader(null));
    expect(result.ports[0]?.serviceVersion).toBe('OpenSSH 8.9');
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.49');
    expect(result.ports[2]?.serviceVersion).toBe('nginx/1.20.0');
  });

  it('returns the machine unchanged when the status file is empty', () => {
    const result = applyVersionOverlay(baseMachine, mkReader(''));
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.49');
  });

  it('replaces serviceVersion with the status-file version when present', () => {
    const content = `Package: http
Status: install ok installed
Version: Apache/2.4.60
`;
    const result = applyVersionOverlay(baseMachine, mkReader(content));
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.60');
    // Other ports fall through to the generated version
    expect(result.ports[0]?.serviceVersion).toBe('OpenSSH 8.9');
    expect(result.ports[2]?.serviceVersion).toBe('nginx/1.20.0');
  });

  it('applies overlays to multiple ports independently', () => {
    const content = `Package: ssh
Status: install ok installed
Version: OpenSSH 9.7

Package: http
Status: install ok installed
Version: Apache/2.4.60
`;
    const result = applyVersionOverlay(baseMachine, mkReader(content));
    expect(result.ports[0]?.serviceVersion).toBe('OpenSSH 9.7');
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.60');
  });

  it('reads the status file from the target machine, not from the caller', () => {
    const seen: string[] = [];
    const recordingReader = (op: MachineFileOp): string | null => {
      seen.push(op.machineId);
      return null;
    };
    applyVersionOverlay(baseMachine, recordingReader);
    expect(seen).toContain('10.0.0.5');
    expect(seen.every((id) => id === '10.0.0.5')).toBe(true);
  });

  it('reads the status file as root (file is root-owned in real Linux)', () => {
    const seen: string[] = [];
    const recordingReader = (op: MachineFileOp): string | null => {
      seen.push(op.userType);
      return null;
    };
    applyVersionOverlay(baseMachine, recordingReader);
    expect(seen.every((t) => t === 'root')).toBe(true);
  });

  it('reads from the real /var/lib/dpkg/status path', () => {
    const seen: string[] = [];
    const recordingReader = (op: MachineFileOp): string | null => {
      seen.push(op.path);
      return null;
    };
    applyVersionOverlay(baseMachine, recordingReader);
    expect(seen).toContain('/var/lib/dpkg/status');
  });

  it('preserves port ordering and non-port fields', () => {
    const content = `Package: http
Status: install ok installed
Version: Apache/2.4.60
`;
    const result = applyVersionOverlay(baseMachine, mkReader(content));
    expect(result.ip).toBe('10.0.0.5');
    expect(result.hostname).toBe('web01');
    expect(result.ports.map((p) => p.port)).toEqual([22, 80, 443]);
  });

  it('ignores status entries for services not on the machine', () => {
    const content = `Package: mysql
Status: install ok installed
Version: MySQL 8.0.35
`;
    const result = applyVersionOverlay(baseMachine, mkReader(content));
    // No mysql port on the machine, so nothing changes
    expect(result.ports[0]?.serviceVersion).toBe('OpenSSH 8.9');
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.49');
  });

  it('sets firmwareVersion on a router from the firmware package entry', () => {
    const routerMachine: RemoteMachine = {
      ...baseMachine,
      firmwareVendor: 'mikrotik',
    };
    const content = `Package: ssh
Status: install ok installed
Version: OpenSSH 8.9

Package: firmware
Status: install ok installed
Version: MikroTik RouterOS 7.14.2
`;
    const result = applyVersionOverlay(routerMachine, mkReader(content));
    expect(result.firmwareVersion).toBe('MikroTik RouterOS 7.14.2');
  });

  it('leaves firmwareVersion undefined when dpkg/status has no firmware entry', () => {
    const routerMachine: RemoteMachine = {
      ...baseMachine,
      firmwareVendor: 'mikrotik',
    };
    const content = `Package: ssh
Status: install ok installed
Version: OpenSSH 9.7
`;
    const result = applyVersionOverlay(routerMachine, mkReader(content));
    expect(result.firmwareVersion).toBeUndefined();
  });
});
