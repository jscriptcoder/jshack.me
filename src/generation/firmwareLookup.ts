import type { Vulnerability } from '../network/types';
import { buildTimelineFromTemplate, buildGeneratedVuln, CVE_TIMING_CONFIG } from './timeline';
import { firmwareTemplates, type FirmwareVendor } from './pools/routerFirmware';

// Firmware CVE lookup for router-role machines.
//
// Mirrors the shape of vulnerabilityLookup.findVulnForService but walks
// the per-vendor firmware timeline in pools/routerFirmware.ts instead of
// the service template table. There is no hand-authored "historical CVE"
// layer for firmware yet — every firmware CVE is procedurally generated.
//
// The `service` passed to buildGeneratedVuln is the vendor name. That
// keeps the CVE description strings readable ("mikrotik MikroTik RouterOS
// 7.14.2 remote code execution") and falls back to the generic syslog
// attack pattern since firmware doesn't have a service-specific log file.

const FIRMWARE_WALK_CAP_MULTIPLIER = 2;

export const findFirmwareCve = (
  vendor: FirmwareVendor,
  firmwareVersion: string,
  gameTime: number,
): Vulnerability | undefined => {
  const template = firmwareTemplates[vendor];
  if (!template) return undefined;

  // Walk past gameTime by enough that a player's "currently installed"
  // firmware version — which could have been pinned earlier via apt install
  // — is still findable in the timeline.
  const walkCap = gameTime + CVE_TIMING_CONFIG.maxSafeWindowDays * FIRMWARE_WALK_CAP_MULTIPLIER;
  const timeline = buildTimelineFromTemplate(
    template,
    `firmware:${vendor}`,
    walkCap,
    CVE_TIMING_CONFIG,
  );

  const entry = timeline.find((e) => e.version === firmwareVersion);
  if (!entry) return undefined;
  if (entry.publishedAt > gameTime) return undefined;

  const vuln = buildGeneratedVuln(vendor, entry);
  if (vuln.severity === 'info') return undefined;
  return vuln;
};

// Looks up a specific firmware version in a vendor's procedural timeline.
// Returns the walker entry if found within the walk budget, or undefined.
// Used by apt install firmware=<version> to validate a pinned version
// actually exists in the vendor's timeline before writing it to dpkg/status.
//
// The walk budget is intentionally generous (~2 years of game time past
// gameTime) so the player can pin reasonably-near-future versions.
const INSTALL_WALK_BUDGET_DAYS = 730;

export const findPinnableFirmwareVersion = (
  vendor: FirmwareVendor,
  firmwareVersion: string,
  gameTime: number,
): boolean => {
  const template = firmwareTemplates[vendor];
  if (!template) return false;

  const timeline = buildTimelineFromTemplate(
    template,
    `firmware:${vendor}`,
    gameTime + INSTALL_WALK_BUDGET_DAYS,
    CVE_TIMING_CONFIG,
  );
  return timeline.some((e) => e.version === firmwareVersion);
};

// Returns the newest firmware version for a vendor whose CVE has not yet
// been "published" at the given game time. apt upgrade firmware uses this
// to pick its upgrade target — analogous to getLatestSafeVersion but
// resolved against the per-vendor firmware timeline instead of the service
// template pool. Returns undefined for unknown vendors.
export const findLatestSafeFirmware = (
  vendor: FirmwareVendor,
  gameTime: number,
): string | undefined => {
  const template = firmwareTemplates[vendor];
  if (!template) return undefined;

  const timeline = buildTimelineFromTemplate(
    template,
    `firmware:${vendor}`,
    gameTime,
    CVE_TIMING_CONFIG,
  );
  for (const entry of timeline) {
    if (entry.publishedAt > gameTime) return entry.version;
  }
  return undefined;
};
