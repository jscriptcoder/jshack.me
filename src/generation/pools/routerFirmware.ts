import type { VersionTemplate } from './serviceTemplates';

// Router firmware vendors. Each vendor has a VersionTemplate identical in
// shape to the service templates, so the procedural walker in
// src/generation/timeline/walker.ts can walk firmware timelines via
// buildTimelineFromTemplate without any special-casing.
//
// Starting tuples are chosen to look plausible as "currently shipping"
// versions circa 2026. Procedural walking advances them over game time,
// same as services.

export type FirmwareVendor = 'cisco' | 'mikrotik' | 'ddwrt' | 'openwrt' | 'pfsense' | 'ubiquiti';

export const firmwareTemplates: Readonly<Record<FirmwareVendor, VersionTemplate>> = {
  cisco: { prefix: 'Cisco IOS ', separator: '.', startTuple: [15, 9, 3] },
  mikrotik: { prefix: 'MikroTik RouterOS ', separator: '.', startTuple: [7, 14, 2] },
  ddwrt: { prefix: 'DD-WRT v', separator: '.', startTuple: [24, 0, 1] },
  openwrt: { prefix: 'OpenWRT ', separator: '.', startTuple: [23, 5, 0] },
  pfsense: { prefix: 'pfSense ', separator: '.', startTuple: [2, 7, 2] },
  ubiquiti: { prefix: 'EdgeOS ', separator: '.', startTuple: [2, 0, 9] },
};

export const FIRMWARE_VENDORS: readonly FirmwareVendor[] = Object.keys(
  firmwareTemplates,
) as readonly FirmwareVendor[];
