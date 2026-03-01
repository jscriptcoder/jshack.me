/**
 * Debug script: dump a full mission network from a seed.
 *
 * Usage: npx tsx scripts/dumpMission.ts <seed>
 *
 * Prints machines, ports, users, attack chain, objective,
 * and full filesystem trees with ANSI colors.
 */

import { generateMissionNetwork, parseSeedOverrides } from '../src/generation/generateMission';
import type { FileNode } from '../src/filesystem/types';
import type {
  AttackStep,
  GeneratedMachine,
  MissionNetwork,
  MissionObjective,
} from '../src/generation/types';
import type { Port, RemoteUser } from '../src/network/types';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

// ---------------------------------------------------------------------------
// Credential lookup — resolve password hashes to plaintext
// ---------------------------------------------------------------------------

const buildPasswordMap = (net: MissionNetwork): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  // Collect from attack chain steps
  net.attackChain.forEach((step) => {
    map.set(step.credential.username, step.credential.password);
  });
  // Collect from entry credential
  if (net.entryCredential) {
    map.set(net.entryCredential.username, net.entryCredential.password);
  }
  return map;
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const formatPort = (p: Port): string => {
  const state = p.open ? green('open') : red('closed');
  let extra = '';
  if (p.vulnerability) {
    extra += ` ${red(`[${p.vulnerability.cve}]`)} ${dim(p.vulnerability.serviceVersion)}`;
  }
  if (p.owner) {
    extra += ` ${dim(`owner=${p.owner.username}(${p.owner.userType})`)}`;
  }
  return `  ${p.port}/${p.service}  ${state}${extra}`;
};

const formatUser = (u: RemoteUser, knownPasswords: ReadonlyMap<string, string>): string => {
  const pw = knownPasswords.get(u.username);
  const pwStr = pw ? green(pw) : dim('(unknown)');
  return `  ${u.username} (${u.userType})  hash=${dim(u.passwordHash)}  pw=${pwStr}`;
};

// ---------------------------------------------------------------------------
// Filesystem tree printer
// ---------------------------------------------------------------------------

const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max)}…`);

const printTree = (node: FileNode, prefix: string, isLast: boolean): void => {
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

const printFileSystem = (machineId: string, root: FileNode): void => {
  console.log(`  ${cyan('/')} ${dim(`[${root.owner}]`)}`);
  const children = root.children ? Object.values(root.children) : [];
  children.forEach((child, i) => {
    printTree(child, '  ', i === children.length - 1);
  });
};

// ---------------------------------------------------------------------------
// Section printers
// ---------------------------------------------------------------------------

const heading = (title: string): void => {
  console.log('');
  console.log(bold(`═══ ${title} ═══`));
};

const printOverview = (net: MissionNetwork): void => {
  heading('OVERVIEW');
  const overrides = parseSeedOverrides(net.seed);
  const activeOverrides = Object.entries(overrides)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  console.log(`  Seed:            ${yellow(net.seed)}`);
  if (activeOverrides.length > 0) {
    console.log(`  Overrides:       ${magenta(activeOverrides.join(', '))}`);
  }
  console.log(`  Difficulty:      ${net.difficulty}`);
  console.log(`  Entry variant:   ${cyan(net.entryVariant)}`);
  console.log(`  Entry point:     ${net.entryPoint}`);
  console.log(`  Router public:   ${net.routerPublicIp}`);
  console.log(`  NAT mode:        ${net.natForwarding ? green('forwarded') : red('router-first')}`);
  if (net.natForwarding) {
    console.log(
      `  NAT:             ${net.natForwarding.publicIp} → ${net.natForwarding.internalIp}`,
    );
  }
  console.log(`  Client email:    ${net.clientEmail}`);
  if (net.entryCredential) {
    console.log(
      `  Entry cred:      ${net.entryCredential.username} / ${green(net.entryCredential.password)}`,
    );
  }
};

const printObjective = (obj: MissionObjective): void => {
  heading('OBJECTIVE');
  console.log(`  Type:            ${yellow(obj.type)}`);
  console.log(`  Description:     ${obj.description}`);
  console.log(`  Target machine:  ${obj.targetMachine}`);
  if (obj.targetPath) {
    console.log(`  Target path:     ${obj.targetPath}`);
  }
  if (obj.tamperOldValue !== undefined) {
    console.log(`  Tamper old:      ${red(obj.tamperOldValue)}`);
    console.log(`  Tamper new:      ${green(obj.tamperNewValue ?? '')}`);
  }
  if (obj.expectedProof) {
    console.log(`  Expected proof:  ${green(obj.expectedProof)}`);
  }
};

const printAttackChain = (chain: readonly AttackStep[]): void => {
  heading('ATTACK CHAIN');
  chain.forEach((step, i) => {
    console.log(
      `  ${bold(`${i + 1}.`)} ${step.fromMachine} → ${step.toMachine}  ` +
        `${cyan(step.method)}  ${step.credential.username}/${green(step.credential.password)}`,
    );
    console.log(`     ${dim(step.hint)}`);
  });
};

const printMachine = (
  m: GeneratedMachine,
  knownPasswords: ReadonlyMap<string, string>,
  label: string,
): void => {
  console.log('');
  console.log(`  ${bold(m.hostname)} ${dim(`(${m.role})`)} ${label}  ${yellow(m.ip)}`);
  console.log(dim('  Ports:'));
  m.remoteMachine.ports.forEach((p) => console.log(formatPort(p)));
  console.log(dim('  Users:'));
  m.remoteMachine.users.forEach((u) => console.log(formatUser(u, knownPasswords)));
};

const printMachines = (net: MissionNetwork, knownPasswords: ReadonlyMap<string, string>): void => {
  heading('ROUTER');
  printMachine(net.routerMachine, knownPasswords, magenta('[ROUTER]'));

  heading('INTERNAL MACHINES');
  // Find internal machines (everything except the router)
  const internal = net.machines.filter((m) => m.ip !== net.routerMachine.ip);
  internal.forEach((m) => {
    const label = m.ip === net.entryPoint ? green('[ENTRY]') : '';
    printMachine(m, knownPasswords, label);
  });
};

const printFileSystems = (net: MissionNetwork): void => {
  heading('FILESYSTEMS');

  // Router filesystem
  const routerFs = net.fileSystems[net.routerMachine.ip];
  if (routerFs) {
    console.log('');
    console.log(bold(`  ── ${net.routerMachine.hostname} (${net.routerMachine.ip}) ──`));
    printFileSystem(net.routerMachine.ip, routerFs);
  }

  // Internal machines
  const internal = net.machines.filter((m) => m.ip !== net.routerMachine.ip);
  internal.forEach((m) => {
    const fs = net.fileSystems[m.ip];
    if (fs) {
      console.log('');
      const tag = m.ip === net.entryPoint ? ` ${green('[ENTRY]')}` : '';
      console.log(bold(`  ── ${m.hostname} (${m.ip})${tag} ──`));
      printFileSystem(m.ip, fs);
    }
  });
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const seed = process.argv[2];

if (!seed) {
  console.log(`Usage: npx tsx scripts/dumpMission.ts <seed>`);
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx scripts/dumpMission.ts MEDTECH-4A7F-easy');
  console.log('  npx tsx scripts/dumpMission.ts GRADE-TAMPER-74');
  console.log('  npx tsx scripts/dumpMission.ts my-custom-seed');
  process.exit(1);
}

const net = generateMissionNetwork(seed);
const knownPasswords = buildPasswordMap(net);

console.log(bold(magenta(`\n╔══════════════════════════════════════╗`)));
console.log(bold(magenta(`║     MISSION NETWORK DUMP             ║`)));
console.log(bold(magenta(`╚══════════════════════════════════════╝`)));

printOverview(net);
printObjective(net.objective);
printAttackChain(net.attackChain);
printMachines(net, knownPasswords);
printFileSystems(net);

console.log('');
