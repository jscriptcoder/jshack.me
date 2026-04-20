import type { Prng } from '../prng';
import type { VulnerabilityEffect } from '../../network/types';

// Per-system-command effect pools for local exploitation via
// `msfconsole --local <command>`.
//
// Under the library-CVE model, the library carries the *vulnerability*
// (shared across every command that links it) and the command carries
// the *exploitation semantics* — its own effect pool decides what kind of
// payload is delivered when one of its linked libraries is exploited.
//
// One libpcre CVE, rolled through `ls`, lands `dir_list`. Rolled through
// `grep`, it lands `file_read`. Rolled through `rm`, `file_write`
// (destructive). Same underlying bug, three different outcomes depending
// on which command surfaces it.
//
// Mirrors the `SERVICE_EFFECT_POOLS` shape in effectPicker.ts — an array
// of EffectFactory entries, rolled by index. Commands not in this map
// are not exploitable via --local.

type EffectFactory = (prng: Prng) => VulnerabilityEffect;

const BACKDOOR_PORTS = [31337, 4444, 1337, 12345, 8080] as const;

const shellLimitedRoot: EffectFactory = () => ({ kind: 'shell_limited', tier: 'root' });
const shellFullRoot: EffectFactory = () => ({ kind: 'shell_full', tier: 'root' });
const fileReadRoot: EffectFactory = () => ({ kind: 'file_read', tier: 'root' });
const dirListRoot: EffectFactory = () => ({ kind: 'dir_list', tier: 'root' });
const fileWriteRoot: EffectFactory = () => ({ kind: 'file_write', tier: 'root' });
const passwordResetRoot: EffectFactory = () => ({ kind: 'password_reset', tier: 'root' });
const backdoorPortOpen: EffectFactory = (prng) => ({
  kind: 'backdoor_port_open',
  port: prng.pick(BACKDOOR_PORTS),
  tier: 'root',
});
const scriptExecRoot: EffectFactory = () => ({ kind: 'script_exec', tier: 'root' });

// Per-command effect pool. Tier is baked into each entry — local exploits
// typically land at `root` (privesc from whatever shell tier the player
// already has). Mixing multiple entries of the same effect weights the
// distribution toward common outcomes.
export const SYSTEM_COMMAND_EFFECT_POOLS: Readonly<Record<string, readonly EffectFactory[]>> = {
  su: [shellFullRoot, shellFullRoot, passwordResetRoot],
  systemctl: [shellFullRoot, backdoorPortOpen, scriptExecRoot],
  reboot: [shellFullRoot, scriptExecRoot],
  kill: [shellFullRoot],
  nano: [fileReadRoot, fileWriteRoot],
  ls: [dirListRoot],
  find: [fileReadRoot, dirListRoot],
  grep: [fileReadRoot],
  cat: [fileReadRoot],
  strings: [fileReadRoot],
  rm: [fileWriteRoot],
  chmod: [fileWriteRoot],
  ps: [fileReadRoot],
  apt: [fileReadRoot, fileWriteRoot, scriptExecRoot],
  ssh: [shellFullRoot, shellLimitedRoot, scriptExecRoot],
  scp: [fileReadRoot, fileWriteRoot, shellLimitedRoot],
  curl: [fileReadRoot, shellLimitedRoot],
};

export const pickCommandEffect = (command: string, prng: Prng): VulnerabilityEffect | undefined => {
  const pool = SYSTEM_COMMAND_EFFECT_POOLS[command];
  if (!pool || pool.length === 0) return undefined;
  return prng.pick(pool)(prng);
};
