/**
 * `/etc/iptables/rules.v4` — the SINGLE parsed source of truth for a router's
 * NAT port forwards (Story 5.1). The owner edits this file (via `nano`) to opt a
 * workstation port in; the scan/ssh paths parse it to decide what the public IP
 * exposes. There is no separate `forward_table` column — the file IS the table.
 *
 * Grammar is deliberately simplified (NOT real iptables-save), ported from legacy
 * `src/network/iptablesParser.ts`:
 *   `forward <public_port> to <internal_ip>:<internal_port>`
 * Parsing is LENIENT — comments (`#`), blank lines, and malformed lines are
 * skipped rather than failing the whole file — and rejects out-of-range ports.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { Directory, FilePermissions } from '../filesystem/types';

/** The canonical `/etc/iptables/rules.v4` storage identity — one source of truth shared
 *  by the boot seed and by every server-side write, so the seeded file and each patch
 *  that edits it agree on path, owner and permissions. Root reads it and root edits it
 *  (`nano`), nobody else does either; a router has only a root account, so root-only is
 *  the whole boundary. Never executable: it is a table, not a program. */
export const RULES_V4_PATH: AbsPath = asAbsPath('/etc/iptables/rules.v4');
export const RULES_V4_OWNER = 'root';
export const RULES_V4_PERMISSIONS: FilePermissions = {
  read: ['root'],
  write: ['root'],
  execute: [],
};

/** One parsed NAT forward: a public port DNAT'd to `internalIp:internalPort`.
 *  Distinct from the old `{ publicPort, targetMachineId }` shape — this
 *  is what a `rules.v4` line denotes. */
export type NatForward = {
  readonly publicPort: number;
  readonly internalIp: string;
  readonly internalPort: number;
};

/** The router's `/etc/iptables/rules.v4` content, or '' when absent (missing
 *  `/etc`, the `iptables` dir, or the file). Walks the tree the way the port
 *  readers do — this layer has no path resolver. Shared by `scanResult` and
 *  `machineServing` so the NAT table is read exactly one way and the scan and
 *  ssh-routing paths can never disagree on what it says. */
export const readRulesV4 = (routerFs: Directory): string => {
  const etc = routerFs.entries.get('etc');
  if (etc?.kind !== 'directory') return '';
  const iptables = etc.entries.get('iptables');
  if (iptables?.kind !== 'directory') return '';
  const rules = iptables.entries.get('rules.v4');
  return rules?.kind === 'file' ? rules.content : '';
};

const FORWARD_RULE_RE = /^forward\s+(\d+)\s+to\s+([\d.]+):(\d+)$/;

const inPortRange = (port: number): boolean => port >= 1 && port <= 65535;

const parseForwardLine = (line: string): NatForward | null => {
  const match = FORWARD_RULE_RE.exec(line);
  if (match === null) return null;

  const publicPort = Number(match[1]);
  const internalIp = match[2]!;
  const internalPort = Number(match[3]);

  if (!inPortRange(publicPort) || !inPortRange(internalPort)) return null;

  return { publicPort, internalIp, internalPort };
};

export const parseForwardRules = (content: string): readonly NatForward[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .flatMap((line) => {
      const rule = parseForwardLine(line);
      return rule === null ? [] : [rule];
    });

/** Where a public port sends what arrives on it — a forward with its key left off,
 *  because the key is what the caller is naming when it asks. */
export type ForwardTarget = Pick<NatForward, 'internalIp' | 'internalPort'>;

/** One forward as this file writes it — the exact grammar `parseForwardLine` reads
 *  back, because it is the only shape the file has. */
const formatForwardLine = (publicPort: number, target: ForwardTarget): string =>
  `forward ${publicPort} to ${target.internalIp}:${target.internalPort}`;

/** The file's lines to edit, without the empty string a trailing newline leaves
 *  behind — so an append lands after the last rule rather than after the blank. */
const editableLines = (content: string): readonly string[] => {
  const lines = content.split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
};

/**
 * The file with `publicPort` left in the state `target` names: forwarding to that
 * destination, or (with `null`) forwarding nowhere. Add, overwrite and remove are one
 * operation because the value is a STATE rather than an instruction — the caller says
 * where the port should point and never which of the three it is asking for.
 *
 * A TEXT edit, deliberately. Re-rendering the file from `parseForwardRules` would be
 * shorter and would drop the header, the commented example, and whatever the owner
 * wrote in `nano` — one fact, but no longer their file. One line changes; every other
 * byte is the one that was already there.
 *
 * The line to change is found by PARSING each line, not by matching the port in the
 * text, so a rule the owner commented out is a comment and stays one.
 */
export const withForward = (
  content: string,
  publicPort: number,
  target: ForwardTarget | null,
): string => {
  const body = editableLines(content);
  const existing = body.findIndex(
    (line) => parseForwardLine(line.trim())?.publicPort === publicPort,
  );

  // Already in the state that was asked for. Returned untouched rather than rewritten,
  // so a no-op cannot normalize an owner's own formatting out from under them.
  if (target === null && existing === -1) return content;

  const edited =
    target === null
      ? [...body.slice(0, existing), ...body.slice(existing + 1)]
      : existing === -1
        ? [...body, formatForwardLine(publicPort, target)]
        : body.map((line, index) =>
            index === existing ? formatForwardLine(publicPort, target) : line,
          );

  return `${edited.join('\n')}\n`;
};
