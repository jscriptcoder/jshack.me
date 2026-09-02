/**
 * System-binary generation (binary/availability model — Slice 1).
 *
 * Commands are gated by the presence of a binary file on the current machine's
 * filesystem: system utilities live in `/bin`. This module is the GENERATION
 * side — it knows which binaries exist and what execute-permissions they carry,
 * and stamps them into the workstation base tree.
 *
 * The RUNTIME side (`core/commands/availability.ts`) is deliberately decoupled:
 * it never imports these name lists. It reads `env.fs` directly — the filesystem
 * IS the source of truth for "what can I run here." That one-way split (this
 * module stamps perms; the wrapper reads them) is what lets a removed/restored
 * binary flip a command between not-found and working with no list to keep in
 * sync.
 *
 * Ported from legacy `src/commands/availability.ts`, simplified to the v2
 * `FileNode` shape and to `/bin` only (`/usr/bin` + `/lib` land in slices 2-3).
 */

import type { UserType } from '../types';
import type { FileNode, FilePermissions } from '../filesystem/types';

/** Looks like an ELF header (magic `\x7fELF`) — what `cat`/`strings` would show.
 *  The content is never executed; presence + perms are all that gate dispatch.
 *  MUST be NUL-free: `apt install` persists this content to the patch store's
 *  Postgres TEXT column, which rejects the NUL byte (U+0000) — a real ELF
 *  header's padding NULs would fail the write with a network_error. The bytes
 *  here are cosmetic, so a NUL-free ELF-ish prefix suffices. */
export const BINARY_STUB = '\x7fELF\x02\x01\x01\x03\x3e\x01';

/** Default execute set for a system binary — world-executable. */
const WORLD_EXECUTABLE: readonly UserType[] = ['root', 'user', 'guest'];

/**
 * System utilities always present in `/bin` on every machine. Ported from
 * legacy `SYSTEM_UTILITY_NAMES`, plus `touch` (a v2 coreutils command that
 * postdates the legacy list — it belongs in `/bin` alongside `mkdir`/`rm`).
 */
export const SYSTEM_UTILITY_NAMES = [
  'ls',
  'cat',
  'clear',
  'whoami',
  'find',
  'grep',
  'su',
  'man',
  'nano',
  'strings',
  'ssh',
  'ping',
  'ifconfig',
  'curl',
  'nslookup',
  'dig',
  'nmcli',
  'apt',
  'rm',
  'mkdir',
  'touch',
  'chmod',
  'scp',
  'reboot',
  'ps',
  'kill',
  'ldd',
] as const;

/**
 * Apt tools PRE-INSTALLED in `/usr/bin` on every player workstation. The WiFi-
 * cracking tools are bundled because the player needs them BEFORE they have any
 * network access (no apt without internet, no internet without cracking WiFi).
 *
 * Deliberately NOT including `node` / `gpg`: a fresh box ships neither a JS
 * runtime nor GPG, so they stay apt-installable (their hint still resolves via
 * the package catalog). Don't "restore" them here.
 */
export const LOCALHOST_PREINSTALLED_TOOLS = ['airmon-ng', 'airodump-ng', 'aircrack-ng'] as const;

/**
 * System daemons PRE-INSTALLED in `/usr/sbin` on every machine. These are the
 * admin binaries you run to bring a service UP (root-only at runtime). `sshd`
 * opens the SSH port; like the `ssh` client (in `/bin`), the daemon ships
 * everywhere, so the per-host generator (Slice 2) plants this same set on
 * generated machines. World-executable stubs — the daemon self-gates root.
 */
export const SYSTEM_DAEMON_NAMES = ['sshd', 'vsftpd'] as const;

/**
 * Service-management tools PRE-INSTALLED in `/usr/bin` on every machine. These
 * are the admin tools you run to control services that are already there, as
 * opposed to the daemons themselves (`/usr/sbin`) — so they ship everywhere a
 * daemon can run, including generated hosts and routers.
 *
 * Not apt-installable: a box you have rooted must be controllable with what is
 * already on it, or stopping a service would depend on the box having internet.
 * World-executable, like `sshd` — `systemctl` gates its write verbs on root at
 * runtime and answers `status` to any tier.
 */
export const SERVICE_CONTROL_TOOLS = ['systemctl'] as const;

/**
 * Binaries whose execute permission is restricted to root. Everything else
 * defaults to world-executable. Of the `/bin` set, only `reboot` is restricted
 * (the other admin daemons — gpg/vsftpd/systemctl — live in `/usr/bin` or
 * `/usr/sbin`, deferred to later slices). `sshd` is world-executable: a real
 * `/usr/sbin/sshd` is 755 and refuses non-root at RUNTIME, which the command
 * models with its own root check.
 */
export const RESTRICTED_EXECUTE: Readonly<Record<string, readonly UserType[]>> = {
  reboot: ['root'],
};

const binaryPerms = (name: string): FilePermissions => ({
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: RESTRICTED_EXECUTE[name] ?? WORLD_EXECUTABLE,
});

/**
 * Build binary stub `FileNode` entries for populating `/bin`. Each is a
 * root-owned stub file whose execute permission decides which tiers may run it.
 */
export const createBinaryEntries = (names: readonly string[]): Readonly<Record<string, FileNode>> =>
  Object.fromEntries(
    names.map((name) => [
      name,
      {
        kind: 'file' as const,
        content: BINARY_STUB,
        owner: 'root',
        perms: binaryPerms(name),
      } satisfies FileNode,
    ]),
  );
