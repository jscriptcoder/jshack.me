import type { VulnerabilityEffect } from '../network/types';

// Builds a one-line human-readable description of a vulnerability whose
// wording matches the typed effect. Shared by the procedural walker and
// (implicitly, via the copy-paste templates) hand-authored entries.
//
// Invariant: description always contains service name, version, and CVE id
// so the player can correlate what they see in logs with what the CVE feed
// reports. The prose after that block is effect-specific.
export const describeEffect = (
  service: string,
  version: string,
  cve: string,
  effect: VulnerabilityEffect,
): string => {
  const prefix = `${service} ${version}`;
  const suffix = `(${cve})`;

  switch (effect.kind) {
    case 'shell_limited':
      return `${prefix} remote code execution ${suffix}`;
    case 'shell_full':
      return `${prefix} authenticated ${effect.tier} shell via protocol abuse ${suffix}`;
    case 'file_read':
      return `${prefix} arbitrary file read via path traversal ${suffix}`;
    case 'dir_list':
      return `${prefix} directory listing disclosure ${suffix}`;
    case 'file_write':
      return `${prefix} arbitrary file write via upload bypass ${suffix}`;
    case 'password_reset':
      return `${prefix} auth bypass allowing ${effect.tier} credential override ${suffix}`;
    case 'backdoor_port_open':
      return `${prefix} persistent backdoor on port ${effect.port} ${suffix}`;
    case 'script_exec':
      return `${prefix} unauthenticated script execution as ${effect.tier} ${suffix}`;
  }
};
