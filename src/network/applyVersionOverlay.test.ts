import { describe, it, expect } from 'vitest';
import type { RemoteMachine } from './types';
import type { MachineFileOp } from '../filesystem/types';
import { applyVersionOverlay, serviceVersionOverlayPath } from './applyVersionOverlay';

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
  (overlays: Readonly<Record<string, string>>) =>
  (op: MachineFileOp): string | null =>
    overlays[op.path] ?? null;

describe('applyVersionOverlay', () => {
  it('returns the machine unchanged when no overlay files exist', () => {
    const result = applyVersionOverlay(baseMachine, mkReader({}));
    expect(result.ports[0]?.serviceVersion).toBe('OpenSSH 8.9');
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.49');
    expect(result.ports[2]?.serviceVersion).toBe('nginx/1.20.0');
  });

  it('replaces serviceVersion with the overlay value when the file exists', () => {
    const reader = mkReader({
      [serviceVersionOverlayPath('http')]: 'Apache/2.4.60',
    });
    const result = applyVersionOverlay(baseMachine, reader);
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.60');
    // Other ports unchanged
    expect(result.ports[0]?.serviceVersion).toBe('OpenSSH 8.9');
    expect(result.ports[2]?.serviceVersion).toBe('nginx/1.20.0');
  });

  it('applies overlays to multiple ports independently', () => {
    const reader = mkReader({
      [serviceVersionOverlayPath('ssh')]: 'OpenSSH 9.7',
      [serviceVersionOverlayPath('http')]: 'Apache/2.4.60',
    });
    const result = applyVersionOverlay(baseMachine, reader);
    expect(result.ports[0]?.serviceVersion).toBe('OpenSSH 9.7');
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.60');
  });

  it('trims whitespace from the overlay content', () => {
    const reader = mkReader({
      [serviceVersionOverlayPath('http')]: '  Apache/2.4.60\n',
    });
    const result = applyVersionOverlay(baseMachine, reader);
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.60');
  });

  it('falls back to the generated version when the overlay file is empty or whitespace', () => {
    const reader = mkReader({
      [serviceVersionOverlayPath('http')]: '   \n  ',
    });
    const result = applyVersionOverlay(baseMachine, reader);
    expect(result.ports[1]?.serviceVersion).toBe('Apache/2.4.49');
  });

  it('reads the overlay file from the target machine, not from the caller', () => {
    const seen: string[] = [];
    const recordingReader = (op: MachineFileOp): string | null => {
      seen.push(op.machineId);
      return null;
    };
    applyVersionOverlay(baseMachine, recordingReader);
    expect(seen.every((id) => id === '10.0.0.5')).toBe(true);
  });

  it('reads as root (overlay files are root-owned in the filesystem)', () => {
    const seen: string[] = [];
    const recordingReader = (op: MachineFileOp): string | null => {
      seen.push(op.userType);
      return null;
    };
    applyVersionOverlay(baseMachine, recordingReader);
    expect(seen.every((t) => t === 'root')).toBe(true);
  });

  it('preserves port ordering and non-port fields', () => {
    const reader = mkReader({
      [serviceVersionOverlayPath('http')]: 'Apache/2.4.60',
    });
    const result = applyVersionOverlay(baseMachine, reader);
    expect(result.ip).toBe('10.0.0.5');
    expect(result.hostname).toBe('web01');
    expect(result.ports.map((p) => p.port)).toEqual([22, 80, 443]);
  });
});
