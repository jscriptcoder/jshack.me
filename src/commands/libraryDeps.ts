import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import type { SystemLibrary } from '../generation/pools/systemLibraryTemplates';

// Static manifest mapping pre-installed system commands to the shared
// libraries they link. Libraries are treated as *thematic capability
// groupings*, not strict real-world dependency charts — so commands that
// would only link libc in reality get mapped to the library whose
// capability they thematically use (ls/find/grep/cat/strings/ps/rm/chmod →
// libpcre; reboot/kill → libsystemd). This keeps gameplay rich without
// modelling libc directly.
//
// Commands NOT in this map run without a library check — the check is
// opt-in per-command. That includes commands deliberately excluded for
// weak thematic fit (mkdir, echo, man, ping, ifconfig, nmcli) and every
// builtin / game command.
//
// Each mapping reflects the lib a real Linux binary would dynamically
// link to: PCRE for tools that support regex (ls/find/grep/cat/...),
// libpam+libcrypt for su, libsystemd for service-control verbs,
// libreadline for nano. The check is opt-in — commands not in this map
// run unconditionally.

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

// Higher-order function that wraps a command with a runtime library check.
// Before the command's body runs, verifies every library listed in
// libraryDeps[name] exists at /lib/<lib>.so. If any linked .so is missing,
// throws the canonical glibc dynamic-linker error — matching what real
// ld.so prints when a shared library can't be resolved. Players who
// recognise the format know the machine is in a broken state.
//
// Commands without a libraryDeps entry pass through untouched.
export const wrapWithLibraryCheck = (
  cmd: Command,
  name: string,
  getNode: (path: string) => FileNode | null,
): Command => {
  const deps = libraryDeps[name];
  if (!deps) return cmd;
  return {
    ...cmd,
    fn: (...args: unknown[]) => {
      for (const lib of deps) {
        if (getNode(`/lib/${lib}.so`) === null) {
          throw new Error(
            `${name}: error while loading shared libraries: ${lib}.so: cannot open shared object file: No such file or directory`,
          );
        }
      }
      return cmd.fn(...args);
    },
  };
};
