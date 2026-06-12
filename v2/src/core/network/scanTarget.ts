/**
 * Scan-target parsing + host selection — the shared knowledge of "which hosts on
 * a LAN does target `T` select", used by BOTH the `nmap` command display and the
 * server-side scan logger. Keeping it in one place is load-bearing: the hosts a
 * scan SHOWS and the hosts it LOGS must never drift.
 *
 * Target syntax matches the legacy CLI: a single IP (`x.y.z.w`) or a host range
 * (`x.y.z.A-B`). Pure, framework-agnostic (core/).
 */

import type { HomeLan, LanHost } from '../generation/generateHomeLan';

/** Highest scannable host octet (.255 is the broadcast address). */
const MAX_OCTET = 254;

export type ScanTarget =
  | { readonly kind: 'single'; readonly octet: number }
  | { readonly kind: 'range'; readonly start: number; readonly end: number };

export type ParseScanTargetResult =
  | { readonly ok: true; readonly target: ScanTarget }
  | { readonly ok: false; readonly reason: 'usage' | 'foreign' };

const RANGE_PATTERN = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})-(\d{1,3})$/;
const SINGLE_PATTERN = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/;

export const parseScanTarget = (target: string, subnet: string): ParseScanTargetResult => {
  const rangeMatch = target.match(RANGE_PATTERN);
  if (rangeMatch) {
    const [, base, startStr, endStr] = rangeMatch;
    const start = Number(startStr);
    const end = Number(endStr);
    // A start above MAX_OCTET needs no separate check: it always implies either
    // end > MAX_OCTET (when end >= start) or an inverted range (start > end).
    if (end > MAX_OCTET || start > end) {
      return { ok: false, reason: 'usage' };
    }
    if (base !== subnet) {
      return { ok: false, reason: 'foreign' };
    }
    return { ok: true, target: { kind: 'range', start, end } };
  }

  const singleMatch = target.match(SINGLE_PATTERN);
  if (singleMatch) {
    const [, base, octetStr] = singleMatch;
    const octet = Number(octetStr);
    if (octet > MAX_OCTET) {
      return { ok: false, reason: 'usage' };
    }
    if (base !== subnet) {
      return { ok: false, reason: 'foreign' };
    }
    return { ok: true, target: { kind: 'single', octet } };
  }

  return { ok: false, reason: 'usage' };
};

const lastOctet = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** The hosts on `lan` a parsed target selects: the single matching host (empty
 *  when that octet is down / has no host), or the in-range slice for a range. */
export const hostsInScanTarget = (lan: HomeLan, target: ScanTarget): readonly LanHost[] => {
  if (target.kind === 'single') {
    const host = lan.hosts.find((candidate) => lastOctet(candidate) === target.octet);
    return host === undefined ? [] : [host];
  }
  return lan.hosts.filter((host) => lastOctet(host) >= target.start && lastOctet(host) <= target.end);
};
