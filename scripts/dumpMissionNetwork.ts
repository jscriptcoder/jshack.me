/**
 * Debug script: dump a full mission network from a seed.
 *
 * Usage:
 *   npx tsx scripts/dumpMissionNetwork.ts <seed>
 *   npx tsx scripts/dumpMissionNetwork.ts <seed> --cat <ip|hostname>:<path>
 *
 * Prints machines, ports, users, objective,
 * and full filesystem trees with ANSI colors.
 */

import { generateMissionNetwork, parseSeedOverrides } from '../src/generation/generateMission';
import type { MissionNetwork, MissionObjective } from '../src/generation/types';
import {
  bold,
  cyan,
  dim,
  green,
  heading,
  magenta,
  red,
  yellow,
  handleCat,
  parseArgs,
  printFileSystem,
  printMachine,
} from './lib/dumpUtils';

// ---------------------------------------------------------------------------
// Section printers
// ---------------------------------------------------------------------------

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
  console.log(`  Subnet layers:   ${net.layers.length}`);
  console.log(`  Total machines:  ${net.machines.length} (+ outer router)`);
  console.log(`  Entry variant:   ${cyan(net.entryVariant)}`);
  console.log(`  Entry point:     ${net.entryPoint}`);
  console.log(`  Router public:   ${net.routerPublicIp}`);
  console.log(`  NAT mode:        ${net.natForwarding ? green('forwarded') : red('router-first')}`);
  if (net.natForwarding) {
    console.log(`  NAT public IP:   ${net.natForwarding.publicIp}`);
    net.natForwarding.rules.forEach((r) => {
      console.log(`  NAT rule:        :${r.publicPort} → ${r.internalIp}:${r.internalPort}`);
    });
  }
  console.log(`  Router domain:   ${net.routerDomain}`);
  console.log(`  Domain entry:    ${net.domainEntry ? green('yes') : 'no'}`);
  console.log(`  Client email:    ${net.clientEmail}`);

  // Per-layer summary
  if (net.layers.length > 1) {
    heading('LAYER TOPOLOGY');
    net.layers.forEach((layer, i) => {
      const gwLabel =
        i === 0
          ? `gateway=${net.routerMachine.hostname}(${net.routerPublicIp})`
          : `gateway=${layer.gateway.hostname}(${layer.gateway.ip})`;
      const mode = layer.isForwarded ? green('forwarded') : red('router-first');
      console.log(
        `  Layer ${i}: ${cyan(layer.subnet + '.0/24')}  ${dim(gwLabel)}  variant=${cyan(layer.entryVariant)}  ${mode}  machines=${layer.machines.length}`,
      );
    });
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
  if (obj.binary) {
    console.log(`  Binary:          ${yellow('yes')}`);
  }
  if (obj.encrypted) {
    console.log(`  Encrypted:       ${yellow('yes')}`);
    if (obj.encryptionKey) {
      console.log(`  Encryption key:  ${dim(obj.encryptionKey)}`);
    }
  }
  if (obj.keyPlacement) {
    console.log(`  Key placement:   ${obj.keyPlacement.machineIp}:${obj.keyPlacement.filePath}`);
  }
  if (obj.scriptBugType) {
    console.log(`  Script bug:      ${magenta(obj.scriptBugType)}`);
    if (obj.scriptHintPath) {
      console.log(`  Script hint:     ${obj.scriptHintPath}`);
    }
  }
  if (obj.expectedChecksum) {
    console.log(`  Expected chksum: ${dim(obj.expectedChecksum)}`);
  }
};

const printMachines = (net: MissionNetwork): void => {
  heading('OUTER ROUTER');
  printMachine(net.routerMachine, magenta('[ROUTER]'));

  net.layers.forEach((layer, i) => {
    heading(`LAYER ${i} — ${layer.subnet}.0/24`);

    // Show the gateway into this layer (inner gateways only — outer router shown above)
    if (i > 0) {
      const isTarget = layer.gateway.ip === net.objective.targetMachine;
      printMachine(layer.gateway, magenta('[GATEWAY]') + (isTarget ? ` ${red('[TARGET]')}` : ''));
    }

    // Show layer machines (match enriched versions from net.machines by IP)
    const layerIps = new Set(layer.machines.map((m) => m.ip));
    const enriched = net.machines.filter((m) => layerIps.has(m.ip));
    enriched.forEach((m) => {
      const tags: string[] = [];
      if (m.ip === net.entryPoint) tags.push(green('[ENTRY]'));
      if (m.ip === net.objective.targetMachine) tags.push(red('[TARGET]'));
      printMachine(m, tags.join(' '));
    });
  });
};

const printFileSystems = (net: MissionNetwork): void => {
  heading('FILESYSTEMS');

  // Outer router filesystem
  const routerFs = net.fileSystems[net.routerMachine.ip];
  if (routerFs) {
    console.log('');
    console.log(
      bold(
        `  ── ${net.routerMachine.hostname} (${net.routerMachine.ip}) ${magenta('[ROUTER]')} ──`,
      ),
    );
    printFileSystem(routerFs);
  }

  // Per-layer filesystems
  net.layers.forEach((layer, i) => {
    if (net.layers.length > 1) {
      console.log('');
      console.log(dim(`  ─── Layer ${i}: ${layer.subnet}.0/24 ───`));
    }

    // Inner gateway filesystem
    if (i > 0) {
      const gwFs = net.fileSystems[layer.gateway.ip];
      if (gwFs) {
        console.log('');
        console.log(
          bold(`  ── ${layer.gateway.hostname} (${layer.gateway.ip}) ${magenta('[GATEWAY]')} ──`),
        );
        printFileSystem(gwFs);
      }
    }

    // Layer machine filesystems
    const layerIps = new Set(layer.machines.map((m) => m.ip));
    const enriched = net.machines.filter((m) => layerIps.has(m.ip));
    enriched.forEach((m) => {
      const fs = net.fileSystems[m.ip];
      if (fs) {
        console.log('');
        const tags: string[] = [];
        if (m.ip === net.entryPoint) tags.push(green('[ENTRY]'));
        if (m.ip === net.objective.targetMachine) tags.push(red('[TARGET]'));
        console.log(bold(`  ── ${m.hostname} (${m.ip}) ${tags.join(' ')} ──`));
        printFileSystem(fs);
      }
    });
  });
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { positional, catTarget } = parseArgs(process.argv.slice(2));
const seed = positional[0];

if (!seed) {
  console.log(`Usage: npx tsx scripts/dumpMissionNetwork.ts <seed> [--cat <ip|hostname>:<path>]`);
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx scripts/dumpMissionNetwork.ts MEDTECH-4A7F-easy');
  console.log('  npx tsx scripts/dumpMissionNetwork.ts GRADE-TAMPER-74');
  console.log('  npx tsx scripts/dumpMissionNetwork.ts my-seed --cat jump-box:/etc/passwd');
  console.log(
    '  npx tsx scripts/dumpMissionNetwork.ts my-seed --cat 192.168.1.5:/var/log/auth.log',
  );
  process.exit(1);
}

const net = generateMissionNetwork(seed);

// --cat mode: just print the file and exit
if (catTarget) {
  handleCat(catTarget, net.fileSystems, net.machines, net.routerMachine);
  process.exit(0);
}

console.log(bold(magenta(`\n╔══════════════════════════════════════╗`)));
console.log(bold(magenta(`║     MISSION NETWORK DUMP             ║`)));
console.log(bold(magenta(`╚══════════════════════════════════════╝`)));

printOverview(net);
printObjective(net.objective);
printMachines(net);
printFileSystems(net);

console.log('');
