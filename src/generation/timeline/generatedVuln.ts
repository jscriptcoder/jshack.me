import { createPrng, type Prng } from '../prng';
import type { Severity, Vulnerability } from '../../network/types';
import type { GeneratedVersion } from './walker';
import { pickEffect } from './effectPicker';
import { serviceTemplates } from '../pools/serviceTemplates';
import { firmwareTemplates } from '../pools/routerFirmware';
import { describeEffect } from '../describeEffect';
import { pickPatternForEffect } from '../attackPatterns';

// Stable numeric ID per service/firmware-vendor name. Used to pack the CVE
// serial so (service, index) pairs always produce unique ids across the
// whole game — no collisions even when 100s of CVEs publish in the same year.
// Sorted alphabetically so the map is deterministic regardless of insertion
// order; safe because CVE ids are not persisted and are regenerated each run.
const TEMPLATE_KEY_IDS: Readonly<Record<string, number>> = (() => {
  const allKeys = [...Object.keys(serviceTemplates), ...Object.keys(firmwareTemplates)].sort();
  return Object.fromEntries(allKeys.map((k, i) => [k, i]));
})();

// Deterministic CVE construction for procedurally generated timeline entries.
// Each generated CVE has:
// - A CVE id derived from (service, index) — uniqueness-guaranteed
// - An effect rolled from the service's effect pool
// - An effect-aware attack pattern (log entry that matches what the exploit did)
// - A description that matches the effect kind
// - A weighted-random severity
// - publishedAt copied from the walker entry

const pickGeneratedSeverity = (prng: Prng): Severity => {
  // Weighted toward high (the "typical" CVE). Critical is rare but present.
  // Info is never generated in Phase 3 — activated in Phase 4 with typed effects.
  const roll = prng.nextInt(0, 99);
  if (roll < 10) return 'critical'; // 10%
  if (roll < 60) return 'high'; // 50%
  if (roll < 90) return 'medium'; // 30%
  return 'low'; // 10%
};

// Deterministically build a Vulnerability object from a generated timeline
// entry. Every generated CVE for the same (service, index) produces the
// same result regardless of when it's called.
export const buildGeneratedVuln = (service: string, entry: GeneratedVersion): Vulnerability => {
  const prng = createPrng(`generated-cve:${service}:${entry.index}`);

  // CVE id: CVE-YYYY-NNNNNNN with YYYY derived from publishedAt (roughly calendar
  // year) and the 7-digit serial encoded as `${templateId}${entry.index}` so
  // (service, index) pairs produce unique ids across the whole game. Uses a
  // stable alphabetical template ordering; no PRNG in the serial since the
  // deterministic encoding already guarantees uniqueness.
  const year = 2026 + Math.floor(entry.publishedAt / 365);
  const templateId = TEMPLATE_KEY_IDS[service] ?? 99;
  // templateId takes 2 leading digits (supports up to 100 templates); entry.index
  // takes 5 trailing digits (supports up to 100000 CVEs per template).
  const serial = templateId * 100000 + entry.index;
  const cve = `CVE-${year}-${String(serial).padStart(7, '0')}`;

  const severity = pickGeneratedSeverity(prng);
  const effect = pickEffect(service, prng);
  const attackPattern = pickPatternForEffect(service, effect, prng);

  return {
    cve,
    description: describeEffect(service, entry.version, cve, effect),
    serviceVersion: entry.version,
    attackPattern,
    severity,
    publishedAt: entry.publishedAt,
    effect,
  };
};
