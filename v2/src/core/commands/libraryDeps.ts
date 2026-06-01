/**
 * Library dependency check — the RUNTIME side of the `/lib/*.so` model
 * (binary/availability model, Slice 3).
 *
 * `libraryDeps` maps a pre-installed command to the shared libraries it links.
 * `wrapWithLibraryCheck` verifies each linked `<lib>.so` exists on the current
 * machine BEFORE the command runs; the first missing one yields the canonical
 * glibc dynamic-linker error (exactly what real `ld.so` prints). The check is
 * FS-driven and opt-in: a command with no manifest entry passes through.
 *
 * Applied in `registry.ts` INSIDE the binary check
 * (`wrapWithBinaryCheck(wrapWithLibraryCheck(cmd))`), so a missing binary
 * reports `command not found` first and the linker error only fires once the
 * binary resolves.
 *
 * The mapping is ported VERBATIM from legacy `src/commands/libraryDeps.ts` —
 * these command→library links are the future privilege-escalation surface (a
 * live library CVE → `msfconsole --local <cmd>` → root), so they must not be
 * invented or simplified. Libraries are thematic capability groupings, not a
 * strict real-world dependency chart: regex tools (ls/find/grep/cat/strings/rm/
 * chmod/ps) link libpcre; service-control verbs (systemctl/reboot/kill) link
 * libsystemd; su links libpam+libcrypt; etc. Commands NOT listed (mkdir, echo,
 * man, ping, ifconfig, nmcli, …) run without a library check.
 */

import { asAbsPath } from '../types';
import type { Command, CommandResult } from './types';
import type { SystemLibrary } from '../generation/libraries';

export const libraryDeps: Readonly<Record<string, readonly SystemLibrary[]>> = {
  su: ['libpam', 'libcrypt'],
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
      const missing = deps.find((lib) => {
        const node = env.fs.stat(asAbsPath(`/lib/${lib}.so`));
        return node === null || node.kind !== 'file';
      });
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
