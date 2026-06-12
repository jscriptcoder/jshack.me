import { describe, expect, it } from 'vitest';
import { asGameTime } from '../types';
import { formatNmapScanAggregate } from './kernLog';

/**
 * Kernel-log (`/var/log/kern.log`) line formatting for an nmap port scan — an
 * iptables LOG-target entry. Ported from legacy
 * `src/logging/formatters.ts:formatNmapScanAggregate`. One aggregate line per
 * sweep (not per probe). Pure: the timestamp is supplied, so the line is fully
 * assertable.
 */

// 2026-06-07 14:32:01 UTC — exercises month name, space-padded day, zero-padded time.
const JUN_7 = asGameTime(Date.UTC(2026, 5, 7, 14, 32, 1));

describe('formatNmapScanAggregate', () => {
  it('renders one aggregate iptables port-scan line in kern.log shape (no pid)', () => {
    const line = formatNmapScanAggregate({
      time: JUN_7,
      hostname: 'fileserver-7',
      sourceIp: '192.168.1.50',
      probedPorts: [22, 80],
    });

    expect(line).toBe(
      'Jun  7 14:32:01 fileserver-7 kernel: [iptables] Port scan from 192.168.1.50 — probed ports 22,80 (2 hits)',
    );
  });

  it('zero-pads time and space-pads the day-of-month (UTC)', () => {
    const line = formatNmapScanAggregate({
      time: asGameTime(Date.UTC(2026, 0, 3, 4, 5, 6)),
      hostname: 'rig',
      sourceIp: '10.0.0.5',
      probedPorts: [443],
    });

    expect(line).toBe(
      'Jan  3 04:05:06 rig kernel: [iptables] Port scan from 10.0.0.5 — probed ports 443 (1 hits)',
    );
  });

  it('comma-joins every probed port and counts the hits', () => {
    const line = formatNmapScanAggregate({
      time: JUN_7,
      hostname: 'box',
      sourceIp: '203.0.113.9',
      probedPorts: [21, 22, 80, 3306],
    });

    expect(line).toContain('probed ports 21,22,80,3306 (4 hits)');
  });

  it('renders a host with no open ports as a clean 0-hit line (no dangling list)', () => {
    // A scanned host that runs no services still records the probe (real iptables
    // logs it), so an empty port list must read cleanly, not "probed ports  (0 hits)".
    const line = formatNmapScanAggregate({
      time: JUN_7,
      hostname: 'idle-host',
      sourceIp: '192.168.1.50',
      probedPorts: [],
    });

    expect(line).toBe(
      'Jun  7 14:32:01 idle-host kernel: [iptables] Port scan from 192.168.1.50 — probed ports none (0 hits)',
    );
  });
});
