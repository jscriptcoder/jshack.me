/**
 * `/etc/switch/acl.conf` — the SINGLE parsed source of truth for a switch's port
 * access-control list, the switch's answer to a router's `/etc/iptables/rules.v4`.
 * Where a router DEFAULT-DENIES and opts ports in with `forward` lines, a switch
 * DEFAULT-ALLOWS and opts ports OUT with `deny` lines. The owner edits this file
 * (via `nano`) to block a port behind the switch; deleting the line re-opens it.
 *
 * Grammar is deliberately simplified (a sibling of `iptablesRules`):
 *   `deny <port>`
 * Parsing is LENIENT — comments (`#`), blank lines, and malformed lines are skipped
 * rather than failing the whole file — and rejects out-of-range ports.
 */

import type { Directory } from '../filesystem/types';

/** The switch's `/etc/switch/acl.conf` content, or '' when absent (missing `/etc`,
 *  the `switch` dir, or the file). Walks the tree the way the port readers do — this
 *  layer has no path resolver. The mirror of `readRulesV4` for the switch device. */
export const readAclConf = (switchFs: Directory): string => {
  const etc = switchFs.entries.get('etc');
  if (etc?.kind !== 'directory') return '';
  const switchDir = etc.entries.get('switch');
  if (switchDir?.kind !== 'directory') return '';
  const acl = switchDir.entries.get('acl.conf');
  return acl?.kind === 'file' ? acl.content : '';
};

const DENY_RULE_RE = /^deny\s+(\d+)$/;

const inPortRange = (port: number): boolean => port >= 1 && port <= 65535;

const parseDenyLine = (line: string): number | null => {
  const match = DENY_RULE_RE.exec(line);
  if (match === null) return null;

  const port = Number(match[1]);
  return inPortRange(port) ? port : null;
};

/** The ports a switch's ACL blocks behind it — one per valid `deny <port>` line.
 *  Default-allow: the empty/all-comment file denies nothing. `parseDenyLine` is the
 *  single validity gate — blanks, comments, and malformed lines all fail its match
 *  and drop out, so no separate pre-filter is needed. */
export const parseAclDenies = (content: string): readonly number[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => {
      const port = parseDenyLine(line);
      return port === null ? [] : [port];
    });
