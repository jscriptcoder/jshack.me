/**
 * Shared utilities for dump scripts (dumpMission, dumpHomeNetwork).
 *
 * ANSI color helpers, machine/port/user formatters, filesystem tree printer,
 * and --cat file viewer for inspecting individual files on machines.
 */

import type { FileNode } from '../../src/filesystem/types';
import type { GeneratedMachine } from '../../src/generation/types';
import type { Port, RemoteUser } from '../../src/network/types';
import { CVE_TIMING_CONFIG, findGeneratedVersion } from '../../src/generation/timeline';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export type PortPatchInfo = {
  readonly patchDelayDays: number;
  readonly fixReleasedAtDay: number;
};

// Walk far enough past the current game time to catch the version a player
// might plausibly be running. Mirrors the budget used elsewhere in the
// lookup layer so the debug view stays consistent with the game.
const PATCH_INFO_WALK_BUDGET_DAYS = 365 * 2;

/**
 * Returns patch-delay info for a procedural service version — the randomized
 * patchDelay drawn by the timeline walker plus the day on which the fix is
 * released (publishedAt + patchDelay). Returns undefined for hand-authored
 * CVEs (which have no patch delay) and for unknown services.
 */
export const resolvePortPatchInfo = (
  service: string,
  version: string,
): PortPatchInfo | undefined => {
  const entry = findGeneratedVersion(
    service,
    version,
    PATCH_INFO_WALK_BUDGET_DAYS,
    CVE_TIMING_CONFIG,
  );
  if (!entry) return undefined;
  return {
    patchDelayDays: entry.patchDelay,
    fixReleasedAtDay: entry.publishedAt + entry.patchDelay,
  };
};

// Port no longer carries a baked-in `vulnerability` — CVEs are looked up
// at exploit time via findExploitableCve(port, gameTime). For debug
// output we surface what's intrinsic to the port (serviceVersion, patch
// timeline, forcedEffect override). To see which CVE a given port
// resolves to at a given game time, use scripts/simulateExploit.ts or
// scripts/inspectPort.ts.
export const formatPort = (p: Port): string => {
  const state = p.open ? green('open') : red('closed');
  let extra = ` ${dim(p.serviceVersion)}`;
  const patch = resolvePortPatchInfo(p.service, p.serviceVersion);
  if (patch) {
    extra += ` ${dim(`patch=${patch.patchDelayDays}d fix@day${patch.fixReleasedAtDay}`)}`;
  }
  if (p.forcedEffect) {
    extra += ` ${red(`[forced=${p.forcedEffect.kind}/${p.forcedEffect.tier}]`)}`;
  }
  if (p.owner) {
    extra += ` ${dim(`owner=${p.owner.username}(${p.owner.userType})`)}`;
  }
  return `  ${p.port}/${p.service}  ${state}${extra}`;
};

export const formatUser = (u: RemoteUser): string => {
  // Hash lives in /etc/passwd content (dumped separately by the script's
  // FS printer). RemoteUser carries only username + userType post step 6.
  return `  ${u.username} (${u.userType})`;
};

// ---------------------------------------------------------------------------
// Filesystem tree printer
// ---------------------------------------------------------------------------

const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max)}…`);

export const printTree = (node: FileNode, prefix: string, isLast: boolean): void => {
  const connector = isLast ? '└── ' : '├── ';
  const ownerTag = dim(`[${node.owner}]`);

  if (node.type === 'file') {
    const len = node.content?.length ?? 0;
    const preview =
      len > 0 ? dim(` "${truncate(node.content!.replace(/\n/g, '\\n'), 60)}"`) : dim(' (empty)');
    console.log(`${prefix}${connector}${node.name} ${ownerTag} ${dim(`${len}b`)}${preview}`);
  } else {
    console.log(`${prefix}${connector}${cyan(node.name + '/')} ${ownerTag}`);
    const children = node.children ? Object.values(node.children) : [];
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    children.forEach((child, i) => {
      printTree(child, childPrefix, i === children.length - 1);
    });
  }
};

export const printFileSystem = (root: FileNode): void => {
  console.log(`  ${cyan('/')} ${dim(`[${root.owner}]`)}`);
  const children = root.children ? Object.values(root.children) : [];
  children.forEach((child, i) => {
    printTree(child, '  ', i === children.length - 1);
  });
};

// ---------------------------------------------------------------------------
// Section helpers
// ---------------------------------------------------------------------------

export const heading = (title: string): void => {
  console.log('');
  console.log(bold(`═══ ${title} ═══`));
};

export const printMachine = (m: GeneratedMachine, label: string): void => {
  console.log('');
  console.log(`  ${bold(m.hostname)} ${dim(`(${m.role})`)} ${label}  ${yellow(m.ip)}`);
  console.log(dim('  Ports:'));
  m.remoteMachine.ports.forEach((p) => console.log(formatPort(p)));
  console.log(dim('  Users:'));
  m.remoteMachine.users.forEach((u) => console.log(formatUser(u)));
};

// ---------------------------------------------------------------------------
// --cat: view full file content on a machine
// ---------------------------------------------------------------------------

/** Resolve a hostname or IP to an IP using the machines + router. */
export const resolveIp = (
  query: string,
  machines: readonly GeneratedMachine[],
  routerMachine: GeneratedMachine,
): string | undefined => {
  // Direct IP match
  if (machines.some((m) => m.ip === query) || routerMachine.ip === query) return query;
  // Hostname match
  const match =
    machines.find((m) => m.hostname === query) ??
    (routerMachine.hostname === query ? routerMachine : undefined);
  return match?.ip;
};

/** Traverse a filesystem tree to find a node at the given absolute path. */
export const resolveFileNode = (root: FileNode, path: string): FileNode | undefined => {
  const segments = path.split('/').filter((s) => s.length > 0);
  let current: FileNode = root;
  for (const seg of segments) {
    if (current.type !== 'directory' || !current.children?.[seg]) return undefined;
    current = current.children[seg];
  }
  return current;
};

/** Print the full content of a file, or list a directory's entries. */
const printNodeContent = (node: FileNode, path: string): void => {
  if (node.type === 'directory') {
    console.log(`  ${cyan(path)} is a directory. Contents:`);
    console.log('');
    const children = node.children ? Object.values(node.children) : [];
    if (children.length === 0) {
      console.log(dim('  (empty directory)'));
    } else {
      children.forEach((child) => {
        const indicator = child.type === 'directory' ? cyan(child.name + '/') : child.name;
        console.log(`  ${indicator}  ${dim(`[${child.owner}]`)}`);
      });
    }
    return;
  }

  const content = node.content ?? '';
  if (content.length === 0) {
    console.log(dim('  (empty file)'));
    return;
  }

  // Print with line numbers
  const lines = content.split('\n');
  const gutterWidth = String(lines.length).length;
  lines.forEach((line, i) => {
    const lineNum = dim(String(i + 1).padStart(gutterWidth));
    console.log(`  ${lineNum}  ${line}`);
  });
};

/**
 * Handle --cat flag: resolve machine, find file, print content.
 * Returns true if --cat was handled (caller should exit), false otherwise.
 */
export const handleCat = (
  catTarget: string,
  fileSystems: Readonly<Record<string, FileNode>>,
  machines: readonly GeneratedMachine[],
  routerMachine: GeneratedMachine,
): boolean => {
  const colonIdx = catTarget.indexOf(':');
  if (colonIdx === -1) {
    console.log(red('Error: --cat expects format <ip|hostname>:<path>'));
    console.log(dim('  Example: --cat 192.168.1.5:/etc/passwd'));
    return true;
  }

  const machineQuery = catTarget.slice(0, colonIdx);
  const filePath = catTarget.slice(colonIdx + 1);

  const ip = resolveIp(machineQuery, machines, routerMachine);
  if (!ip) {
    console.log(red(`Error: machine "${machineQuery}" not found`));
    console.log(dim('  Available machines:'));
    console.log(dim(`    ${routerMachine.hostname} (${routerMachine.ip})`));
    machines.forEach((m) => console.log(dim(`    ${m.hostname} (${m.ip})`)));
    return true;
  }

  const root = fileSystems[ip];
  if (!root) {
    console.log(red(`Error: no filesystem found for ${ip}`));
    return true;
  }

  const node = resolveFileNode(root, filePath);
  if (!node) {
    console.log(red(`Error: path "${filePath}" not found on ${machineQuery} (${ip})`));
    return true;
  }

  const machineName = machines.find((m) => m.ip === ip)?.hostname ?? routerMachine.hostname;

  heading(`${machineName} (${ip}) — ${filePath}`);
  console.log(`  Owner: ${dim(node.owner)}  Type: ${dim(node.type)}`);
  console.log('');
  printNodeContent(node, filePath);
  console.log('');

  return true;
};

// ---------------------------------------------------------------------------
// Argv helpers
// ---------------------------------------------------------------------------

type ParsedArgs = {
  readonly positional: readonly string[];
  readonly catTarget: string | undefined;
};

/** Extract --cat <target> from argv (process.argv.slice(2)), return remaining positional args. */
export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const positional: string[] = [];
  let catTarget: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cat' && i + 1 < argv.length) {
      catTarget = argv[i + 1];
      i++; // skip the value
    } else {
      positional.push(argv[i]!);
    }
  }

  return { positional, catTarget };
};
