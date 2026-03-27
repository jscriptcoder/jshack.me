/**
 * Debug script: dump all home networks for a game seed.
 *
 * Usage: npx tsx scripts/dumpHomeNetwork.ts <gameSeed> [wifiIndex]
 *
 * Prints WiFi networks, machines, ports, users,
 * and full filesystem trees with ANSI colors.
 *
 * If wifiIndex is provided, only that WiFi's home network is dumped.
 */

import { generateWifiNetworks } from '../src/generation/generateWifi';
import { generateHomeNetwork, type HomeNetwork } from '../src/generation/generateHomeNetwork';
import type { FileNode } from '../src/filesystem/types';
import type { GeneratedMachine } from '../src/generation/types';
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

const formatUser = (u: RemoteUser): string => {
  return `  ${u.username} (${u.userType})  hash=${dim(u.passwordHash)}`;
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

const printFileSystem = (root: FileNode): void => {
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

const printOverview = (net: HomeNetwork, wifiIndex: number): void => {
  heading('OVERVIEW');
  console.log(`  ESSID:           ${yellow(net.essid)}`);
  console.log(`  WiFi index:      ${wifiIndex}`);
  console.log(`  Difficulty:      ${net.difficulty}`);
  console.log(`  Subnet layers:   ${net.layers.length}`);
  console.log(`  Total machines:  ${net.machines.length} (+ outer router)`);
  console.log(`  Entry variant:   ${cyan(net.entryVariant)}`);
  console.log(`  Entry point:     ${net.entryPoint}`);
  console.log(`  Router public:   ${net.router.publicIp}`);
  console.log(`  Router internal: ${net.router.internalIp}`);
  console.log(`  Localhost IP:    ${net.localhostIp}`);
  console.log(`  NAT mode:        ${net.natForwarding ? green('forwarded') : red('router-first')}`);
  if (net.natForwarding) {
    console.log(`  NAT public IP:   ${net.natForwarding.publicIp}`);
    net.natForwarding.rules.forEach((r) => {
      console.log(`  NAT rule:        :${r.publicPort} → ${r.internalIp}:${r.internalPort}`);
    });
  }

  // Per-layer summary
  if (net.layers.length > 1) {
    heading('LAYER TOPOLOGY');
    net.layers.forEach((layer, i) => {
      const gwLabel =
        i === 0
          ? `gateway=${net.routerMachine.hostname}(${net.router.publicIp})`
          : `gateway=${layer.gateway.hostname}(${layer.gateway.ip})`;
      const mode = layer.isForwarded ? green('forwarded') : red('router-first');
      console.log(
        `  Layer ${i}: ${cyan(layer.subnet + '.0/24')}  ${dim(gwLabel)}  variant=${cyan(layer.entryVariant)}  ${mode}  machines=${layer.machines.length}`,
      );
    });
  }
};

const printMachine = (m: GeneratedMachine, label: string): void => {
  console.log('');
  console.log(`  ${bold(m.hostname)} ${dim(`(${m.role})`)} ${label}  ${yellow(m.ip)}`);
  console.log(dim('  Ports:'));
  m.remoteMachine.ports.forEach((p) => console.log(formatPort(p)));
  console.log(dim('  Users:'));
  m.remoteMachine.users.forEach((u) => console.log(formatUser(u)));
};

const printMachines = (net: HomeNetwork): void => {
  heading('OUTER ROUTER');
  printMachine(net.routerMachine, magenta('[ROUTER]'));

  net.layers.forEach((layer, i) => {
    heading(`LAYER ${i} — ${layer.subnet}.0/24`);

    // Show the gateway into this layer (inner gateways only — outer router shown above)
    if (i > 0) {
      printMachine(layer.gateway, magenta('[GATEWAY]'));
    }

    // Show layer machines (match enriched versions from net.machines by IP)
    const layerIps = new Set(layer.machines.map((m) => m.ip));
    const enriched = net.machines.filter((m) => layerIps.has(m.ip));
    enriched.forEach((m) => {
      const tags: string[] = [];
      if (m.ip === net.entryPoint) tags.push(green('[ENTRY]'));
      printMachine(m, tags.join(' '));
    });
  });
};

const printFileSystems = (net: HomeNetwork): void => {
  heading('FILESYSTEMS');

  // Outer router filesystem
  const routerFs = net.fileSystems[net.router.publicIp];
  if (routerFs) {
    console.log('');
    console.log(
      bold(`  ── ${net.routerMachine.hostname} (${net.router.publicIp}) ${magenta('[ROUTER]')} ──`),
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
        console.log(bold(`  ── ${m.hostname} (${m.ip}) ${tags.join(' ')} ──`));
        printFileSystem(fs);
      }
    });
  });
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const gameSeed = process.argv[2];
const wifiIndexArg = process.argv[3];

if (!gameSeed) {
  console.log(`Usage: npx tsx scripts/dumpHomeNetwork.ts <gameSeed> [wifiIndex]`);
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx scripts/dumpHomeNetwork.ts my-game-seed');
  console.log('  npx tsx scripts/dumpHomeNetwork.ts my-game-seed 0');
  console.log('  npx tsx scripts/dumpHomeNetwork.ts my-game-seed 1');
  process.exit(1);
}

// Generate WiFi networks to get essids and count
const wifiNetworks = generateWifiNetworks(gameSeed);
const crackable = wifiNetworks.filter((w) => w.crackable);

console.log(bold(magenta(`\n╔══════════════════════════════════════╗`)));
console.log(bold(magenta(`║     HOME NETWORK DUMP                ║`)));
console.log(bold(magenta(`╚══════════════════════════════════════╝`)));

heading('WIFI NETWORKS');
console.log(`  Game seed:       ${yellow(gameSeed)}`);
console.log(`  Total networks:  ${wifiNetworks.length}`);
console.log(`  Crackable:       ${crackable.length}`);
console.log('');
wifiNetworks.forEach((w, i) => {
  const tag = w.crackable ? green('[CRACKABLE]') : dim('[noise]');
  const pw = w.crackable && w.password ? ` pw=${dim(w.password)}` : '';
  console.log(`  ${i}: ${w.essid}  ${w.bssid}  ch=${w.channel}  ${w.encryption}  ${tag}${pw}`);
});

// Determine which WiFi indices to dump
const usedIps = new Set<string>();
const indicesToDump: readonly number[] =
  wifiIndexArg !== undefined ? [parseInt(wifiIndexArg, 10)] : crackable.map((_, i) => i);

for (const idx of indicesToDump) {
  if (idx < 0 || idx >= crackable.length) {
    console.log(red(`\nError: WiFi index ${idx} out of range (0-${crackable.length - 1})`));
    continue;
  }

  const wifi = crackable[idx]!;

  console.log('');
  console.log(bold(magenta(`╔══════════════════════════════════════╗`)));
  console.log(bold(magenta(`║     WIFI ${idx}: ${wifi.essid.padEnd(25)}║`)));
  console.log(bold(magenta(`╚══════════════════════════════════════╝`)));

  const net = generateHomeNetwork(gameSeed, idx, wifi.essid, usedIps);
  usedIps.add(net.router.publicIp);

  printOverview(net, idx);
  printMachines(net);
  printFileSystems(net);
}

console.log('');
