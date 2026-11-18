/**
 * Library dependency check — the RUNTIME side of the `/lib/*.so` model
 * (binary/availability model, Slice 3).
 *
 * `libraryDeps` maps a pre-installed command to the shared libraries it links.
 * `wrapWithLibraryCheck` verifies each linked `<lib>.so` loads on the current
 * machine BEFORE the command runs — from `/lib`, or failing that from the
 * directory the binary sits in — and the first that loads from neither yields
 * the canonical glibc dynamic-linker error (exactly what real `ld.so` prints).
 * The check is FS-driven and opt-in: a command with no manifest entry passes
 * through. A library beside the binary only lets it START: the library-CVE
 * route (`msfconsole --local`) still reads `/lib` alone.
 *
 * Applied in `registry.ts` INSIDE the binary check
 * (`wrapWithBinaryCheck(wrapWithLibraryCheck(cmd))`), so a missing binary
 * reports `command not found` first and the linker error only fires once the
 * binary resolves.
 *
 * These command→library links ARE the privilege-escalation surface (a live
 * library CVE → `msfconsole --local <cmd>` → root), so they are never invented
 * or simplified ad hoc. The base system commands are ported verbatim from
 * legacy `src/commands/libraryDeps.ts`; the apt-installed toolchain below them
 * is this game's own, and follows the same rule the ported ones do.
 *
 * Libraries are thematic capability groupings, not a strict real-world
 * dependency chart: regex tools (ls/find/grep/cat/strings/rm/chmod/ps) link
 * libpcre; service-control verbs (systemctl/reboot/kill) link libsystemd; su
 * and passwd link libpam+libcrypt; anything speaking TLS or the network links libssl; an
 * interactive prompt links libreadline; a markup reader links libxml2; and
 * anything handling hashes or ciphers links libcrypt. A tool that belongs to
 * two groups links BOTH, and the group it belongs to most links first, because
 * a severity tie falls to link order — which is why hydra leads with libcrypt:
 * it is a password tool that happens to use the network, not the reverse.
 *
 * Daemons stay out (a player never runs one directly), and so do the utilities
 * that belong to no group at all (mkdir, touch, man, ping, ifconfig, nmcli,
 * clear, whoami) — they run without a library check.
 */

import { asAbsPath, type AbsPath } from '../types.js';
import type { Command, CommandEnv, CommandResult } from './types.js';
import type { SystemLibrary } from '../generation/libraries.js';
import { stubName } from '../generation/binaries.js';
import { dirname, resolveAbsPath } from '../filesystem/path.js';
import { resolveBinaryPath } from './availability.js';

export const libraryDeps: Readonly<Record<string, readonly SystemLibrary[]>> = {
  su: ['libpam', 'libcrypt'],
  passwd: ['libpam', 'libcrypt'],
  systemctl: ['libsystemd'],
  reboot: ['libsystemd'],
  kill: ['libsystemd'],
  nano: ['libreadline'],
  ls: ['libpcre'],
  find: ['libpcre'],
  grep: ['libpcre'],
  cat: ['libpcre'],
  strings: ['libpcre'],
  rm: ['libpcre'],
  chmod: ['libpcre'],
  ps: ['libpcre'],
  apt: ['libz', 'libxml2'],
  ssh: ['libssl', 'libreadline'],
  scp: ['libssl'],
  curl: ['libssl'],

  // The apt-installed toolchain. Every one of these is a client binary a player
  // chose to buy and install, so tooling up widens a player's OWN local attack
  // surface — the defensive cost of being equipped.
  nmap: ['libssl'],
  dig: ['libssl'],
  nslookup: ['libssl'],
  nc: ['libssl'],
  snmpwalk: ['libssl'],
  snmpset: ['libssl'],
  ftp: ['libssl', 'libreadline'],
  msfconsole: ['libssl', 'libreadline'],
  mysql: ['libssl', 'libreadline'],
  'redis-cli': ['libssl', 'libreadline'],
  hydra: ['libcrypt', 'libssl'],
  gobuster: ['libssl', 'libpcre'],
  lynx: ['libssl', 'libxml2'],
  john: ['libcrypt'],
  gpg: ['libcrypt'],
  wallet: ['libssl', 'libcrypt'],
  'airmon-ng': ['libcrypt'],
  'airodump-ng': ['libcrypt'],
  'aircrack-ng': ['libcrypt'],
  node: ['libreadline'],
  mail: ['libssl'],
  whois: ['libssl'],
};

/** Whether `<library>.so` is loadable on the current machine — the one test
 *  both the start-up check and `ldd` apply, so they cannot disagree. */
export const libraryPresent = (env: CommandEnv, library: SystemLibrary): boolean =>
  env.fs.stat(asAbsPath(`/lib/${library}.so`))?.kind === 'file';

/** The binary a typed token names: a token with a `/` is a path, resolved
 *  against the cwd; a bare name is wherever the search path finds it. Null when
 *  a bare name resolves nowhere. */
export const binaryPathFor = (env: CommandEnv, token: string): AbsPath | null =>
  token.includes('/') ? resolveAbsPath(env.fs.cwd(), token) : resolveBinaryPath(env, token);

/**
 * Where `library` loads from for the binary at `binaryPath`, or null when it
 * loads from nowhere. `/lib` first; failing that, the binary's own directory,
 * so a player without root can carry a library in beside a tool. Only `/lib` is
 * root-writable, so beside the binary the file must BE that library — a
 * `touch`ed or renamed file cannot stand in for one, or deleting a library
 * would stop defending a box.
 */
export const resolveLibrary = (
  env: CommandEnv,
  library: SystemLibrary,
  binaryPath: AbsPath | null,
): AbsPath | null => {
  if (libraryPresent(env, library)) return asAbsPath(`/lib/${library}.so`);
  if (binaryPath === null) return null;
  const beside = resolveAbsPath(dirname(binaryPath), `${library}.so`);
  const node = env.fs.stat(beside);
  return node?.kind === 'file' && stubName(node.content) === `${library}.so` ? beside : null;
};

/**
 * Wrap a command with a runtime shared-library check. A command not in
 * `libraryDeps` is returned untouched (opt-in). Otherwise, at execution time,
 * the first linked library whose `/lib/<lib>.so` is missing produces the
 * dynamic-linker error; all present → the real command runs. Metadata is
 * preserved so `help`/`man` and the binary-check wrapper see the real command.
 */
export const wrapWithLibraryCheck = (command: Command): Command => {
  const deps = libraryDeps[command.name];
  if (deps === undefined) return command;
  return {
    ...command,
    execute: async (env, args, flags): Promise<CommandResult> => {
      // argv[0] is how the shell reached this binary; a command reached outside
      // the shell has none, and is looked up by its own name.
      const binaryPath = binaryPathFor(env, env.argv0 ?? command.name);
      const missing = deps.find((lib) => resolveLibrary(env, lib, binaryPath) === null);
      if (missing !== undefined) {
        return {
          kind: 'sync',
          lines: [
            {
              kind: 'error',
              content: `${command.name}: error while loading shared libraries: ${missing}.so: cannot open shared object file: No such file or directory`,
            },
          ],
          exitCode: 127,
        };
      }
      return command.execute(env, args, flags);
    },
  };
};
