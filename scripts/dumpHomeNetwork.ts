/**
 * Debug script: dump all home networks for a game seed.
 *
 * Usage:
 *   npx tsx scripts/dumpHomeNetwork.ts <gameSeed> [wifiIndex]
 *   npx tsx scripts/dumpHomeNetwork.ts <gameSeed> <wifiIndex> --cat <ip|hostname>:<path>
 *
 * Prints WiFi networks, machines, ports, users,
 * and full filesystem trees with ANSI colors.
 *
 * If wifiIndex is provided, only that WiFi's home network is dumped.
 */

import { generateWifiNetworks } from '../src/generation/generateWifi';
import { generateHomeNetwork, type HomeNetwork } from '../src/generation/generateHomeNetwork';
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

const { positional, catTarget } = parseArgs(process.argv.slice(2));
const gameSeed = positional[0];
const wifiIndexArg = positional[1];

if (!gameSeed) {
  console.log(
    `Usage: npx tsx scripts/dumpHomeNetwork.ts <gameSeed> [wifiIndex] [--cat <ip|hostname>:<path>]`,
  );
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx scripts/dumpHomeNetwork.ts my-game-seed');
  console.log('  npx tsx scripts/dumpHomeNetwork.ts my-game-seed 0');
  console.log('  npx tsx scripts/dumpHomeNetwork.ts my-game-seed 0 --cat jump-box:/etc/passwd');
  console.log('  npx tsx scripts/dumpHomeNetwork.ts my-seed 1 --cat 192.168.1.5:/var/log/auth.log');
  process.exit(1);
}

// Generate WiFi networks to get essids and count
const wifiNetworks = generateWifiNetworks(gameSeed);
const crackable = wifiNetworks.filter((w) => w.crackable);

// --cat mode requires a wifiIndex
if (catTarget) {
  if (wifiIndexArg === undefined) {
    console.log(red('Error: --cat requires a wifiIndex argument'));
    console.log(dim('  Example: npx tsx scripts/dumpHomeNetwork.ts my-seed 0 --cat host:/path'));
    process.exit(1);
  }
  const idx = parseInt(wifiIndexArg, 10);
  if (idx < 0 || idx >= crackable.length) {
    console.log(red(`Error: WiFi index ${idx} out of range (0-${crackable.length - 1})`));
    process.exit(1);
  }
  const wifi = crackable[idx]!;
  const net = await generateHomeNetwork(gameSeed, idx, wifi.essid);
  handleCat(catTarget, net.fileSystems, net.machines, net.routerMachine);
  process.exit(0);
}

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

  const net = await generateHomeNetwork(gameSeed, idx, wifi.essid, usedIps);
  usedIps.add(net.router.publicIp);

  printOverview(net, idx);
  printMachines(net);
  printFileSystems(net);
}

console.log('');
