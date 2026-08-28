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

import { asAbsPath, type AbsPath } from '../types';
import type { Directory, FilePermissions } from '../filesystem/types';

/** The canonical `/etc/switch/acl.conf` storage identity, at the same root-only
 *  boundary its router counterpart keeps and for the same reason: a gateway device has
 *  one account, and the file it routes by is that account's to edit. */
export const ACL_CONF_PATH: AbsPath = asAbsPath('/etc/switch/acl.conf');
export const ACL_CONF_OWNER = 'root';
export const ACL_CONF_PERMISSIONS: FilePermissions = {
  read: ['root'],
  write: ['root'],
  execute: [],
};

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

/** The file's lines to edit, without the empty string a trailing newline leaves
 *  behind. This file SHIPS without one where `rules.v4` ships with one, so an append
 *  that trusted either shape would glue two rules into `deny 8080deny 22`. */
const editableLines = (content: string): readonly string[] => {
  const lines = content.split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
};

/**
 * The file with `port` left in the state `denied` names: blocked behind the switch, or
 * open to the segment. The mirror of the router's `withForward`, and simpler for one
 * reason — a deny carries no destination, so there is nothing to overwrite and a port
 * already in the state asked for is returned untouched.
 *
 * A TEXT edit, like its router counterpart: the header, the usage note and whatever the
 * owner added stay exactly where they were, and re-opening a port removes precisely the
 * line deleting it by hand would have.
 *
 * The line is found by PARSING, never by matching the port in the text, so a deny the
 * owner commented out is a comment and stays one.
 */
export const withDeny = (content: string, port: number, denied: boolean): string => {
  const body = editableLines(content);
  const existing = body.findIndex((line) => parseDenyLine(line.trim()) === port);

  if (denied === (existing !== -1)) return content;

  const edited = denied
    ? [...body, `deny ${port}`]
    : [...body.slice(0, existing), ...body.slice(existing + 1)];

  return `${edited.join('\n')}\n`;
};
