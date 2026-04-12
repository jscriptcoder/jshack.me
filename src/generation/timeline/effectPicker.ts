import type { Prng } from '../prng';
import type { VulnerabilityEffect } from '../../network/types';

// Per-service effect pools. Each entry is a factory that takes the prng
// and returns a fully-formed VulnerabilityEffect. The picker rolls an
// index into the pool and calls the factory.
//
// Services NOT in this table fall through to shell_limited (safe default,
// preserves Phase 3 behaviour for unknown services).

type EffectFactory = (prng: Prng) => VulnerabilityEffect;

const BACKDOOR_PORTS = [31337, 4444, 1337, 12345, 8080] as const;

const TIERS = ['guest', 'user', 'root'] as const;

const shellLimited: EffectFactory = () => ({ kind: 'shell_limited' });
const shellFull: EffectFactory = (prng) => ({ kind: 'shell_full', tier: prng.pick(TIERS) });
const fileRead: EffectFactory = () => ({ kind: 'file_read' });
const dirList: EffectFactory = () => ({ kind: 'dir_list' });
const fileWrite: EffectFactory = () => ({ kind: 'file_write' });
const passwordReset: EffectFactory = (prng) => ({ kind: 'password_reset', tier: prng.pick(TIERS) });
const backdoorPortOpen: EffectFactory = (prng) => ({
  kind: 'backdoor_port_open',
  port: prng.pick(BACKDOOR_PORTS),
});
const scriptExec: EffectFactory = (prng) => ({ kind: 'script_exec', tier: prng.pick(TIERS) });

// Per-service effect distribution. Backdoor is weighted low (~5-10%).
// Other effects are roughly uniform within their service pool.
const SERVICE_EFFECT_POOLS: Readonly<Record<string, readonly EffectFactory[]>> = {
  ssh: [
    shellLimited,
    shellFull,
    shellFull,
    fileRead,
    fileRead,
    dirList,
    fileWrite,
    passwordReset,
    scriptExec,
    backdoorPortOpen,
  ],
  ftp: [fileRead, fileRead, fileRead, fileWrite, fileWrite, dirList, dirList, backdoorPortOpen],
  http: [shellFull, shellFull, fileRead, fileRead, fileWrite, scriptExec, backdoorPortOpen],
  'http-alt': [shellFull, shellFull, fileRead, fileRead, fileWrite, scriptExec, backdoorPortOpen],
  https: [shellFull, shellFull, fileRead, fileRead, fileWrite, scriptExec, backdoorPortOpen],
  mysql: [shellFull, fileRead, fileRead, fileWrite, passwordReset, scriptExec, backdoorPortOpen],
  postgresql: [
    shellFull,
    fileRead,
    fileRead,
    fileWrite,
    passwordReset,
    scriptExec,
    backdoorPortOpen,
  ],
  mongodb: [
    shellFull,
    fileRead,
    fileWrite,
    passwordReset,
    scriptExec,
    scriptExec,
    backdoorPortOpen,
  ],
  redis: [shellFull, fileRead, fileWrite, passwordReset, scriptExec, scriptExec, backdoorPortOpen],
  elasticsearch: [
    shellFull,
    fileRead,
    fileWrite,
    passwordReset,
    scriptExec,
    scriptExec,
    backdoorPortOpen,
  ],
  smb: [fileRead, fileRead, fileWrite, fileWrite, dirList, dirList, shellFull, backdoorPortOpen],
  rsync: [fileRead, fileRead, fileWrite, fileWrite, dirList, dirList, shellFull, backdoorPortOpen],
  smtp: [shellFull, shellFull, fileRead, backdoorPortOpen],
  imap: [shellFull, shellFull, fileRead, backdoorPortOpen],
  pop3: [shellFull, shellFull, fileRead, backdoorPortOpen],
  vnc: [shellFull, shellFull, shellFull, backdoorPortOpen],
  openvpn: [shellFull, shellFull, shellFull, backdoorPortOpen],
  modbus: [shellFull, shellFull, shellFull, backdoorPortOpen],
  dns: [shellFull, shellFull, shellFull, backdoorPortOpen],
  mqtt: [shellFull, shellFull, shellFull, backdoorPortOpen],
};

export const pickEffect = (service: string, prng: Prng): VulnerabilityEffect => {
  const pool = SERVICE_EFFECT_POOLS[service];
  if (!pool) return shellLimited(prng);
  return prng.pick(pool)(prng);
};
