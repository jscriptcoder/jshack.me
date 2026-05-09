/**
 * Debug script: dump home networks for a game seed.
 *
 * Usage:
 *   npx tsx scripts/dumpHomeNetwork.ts <gameSeed> [wifiIndex]
 *   npx tsx scripts/dumpHomeNetwork.ts <gameSeed> <wifiIndex> --cat <ip|hostname>:<path>
 *
 * Queries Supabase for the actual server-allocated home_networks row(s)
 * matching each WiFi's essid_template and dumps every instance using its
 * server-stored seed (`home-${publicIp}`). This matches what the player
 * sees in-game (subnets, IPs, occupants) — there's no longer a legacy
 * single-player path.
 *
 * Env loading is automatic via ./lib/loadEnv (reads .env.local +
 * .env.development.local). Just run plain:
 *
 *   npx tsx scripts/dumpHomeNetwork.ts <seed> [wifiIndex]
 *
 * If no home_networks row exists for an ESSID yet (no player has joined),
 * the script prints a notice and skips that WiFi — connect to it in-game
 * first to materialize the row.
 */

import './lib/loadEnv';
import { createClient } from '@supabase/supabase-js';
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

// ---------------------------------------------------------------------------
// Multiplayer seed lookup
// ---------------------------------------------------------------------------
//
// In-game, joinHomeNetwork creates / finds a home_networks row and uses its
// `seed` column (= `home-${publicIp}`) to generate the topology. The dump
// must use that same row to render what the player actually sees.

type MultiplayerInstance = {
  readonly publicIp: string;
  readonly seed: string;
  readonly densityTier: string;
  readonly maxSlots: number;
  readonly occupants: ReadonlyArray<{
    readonly playerKey: string;
    readonly lanIp: string;
    readonly hostname: string;
  }>;
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
  console.log(red('Error: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required.'));
  console.log(
    dim(
      '  Make sure .env.local and/or .env.development.local define them. lib/loadEnv loads both at startup.',
    ),
  );
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

const fetchMultiplayerInstances = async (
  essid: string,
): Promise<readonly MultiplayerInstance[]> => {
  const { data: networks, error } = await supabase
    .from('home_networks')
    .select('public_ip, density_tier, max_slots, seed')
    .eq('essid_template', essid)
    .order('created_at', { ascending: true });
  if (error) {
    console.log(red(`[supabase] home_networks lookup error for ${essid}: ${error.message}`));
    return [];
  }
  if (!networks || networks.length === 0) return [];
  const ips = networks.map((n) => n.public_ip);
  const { data: occupants } = await supabase
    .from('home_network_occupants')
    .select('network_id, player_key, lan_ip, hostname')
    .in('network_id', ips);
  return networks.map((n) => ({
    publicIp: n.public_ip,
    seed: n.seed,
    densityTier: n.density_tier,
    maxSlots: n.max_slots,
    occupants: (occupants ?? [])
      .filter((o) => o.network_id === n.public_ip)
      .map((o) => ({ playerKey: o.player_key, lanIp: o.lan_ip, hostname: o.hostname })),
  }));
};

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
  const instances = await fetchMultiplayerInstances(wifi.essid);
  if (instances.length === 0) {
    console.log(
      red(
        `Error: no home_networks row exists for ESSID "${wifi.essid}". Connect to it in-game first.`,
      ),
    );
    process.exit(1);
  }
  // For --cat, pick the first instance (oldest by created_at). For
  // crowded ESSIDs the unfiltered dump (no wifiIndex) lists all of them.
  // routerPublicIp must match instance.publicIp so PRNG state advances
  // identically to the in-game generation — see comment below.
  const net = await generateHomeNetwork({
    seed: instances[0]!.seed,
    essid: wifi.essid,
    routerPublicIp: instances[0]!.publicIp,
  });
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
const indicesToDump: readonly number[] =
  wifiIndexArg !== undefined ? [parseInt(wifiIndexArg, 10)] : crackable.map((_, i) => i);

for (const idx of indicesToDump) {
  if (idx < 0 || idx >= crackable.length) {
    console.log(red(`\nError: WiFi index ${idx} out of range (0-${crackable.length - 1})`));
    continue;
  }

  const wifi = crackable[idx]!;
  const instances = await fetchMultiplayerInstances(wifi.essid);

  if (instances.length === 0) {
    console.log('');
    console.log(bold(magenta(`╔══════════════════════════════════════╗`)));
    console.log(bold(magenta(`║     WIFI ${idx}: ${wifi.essid.padEnd(25)}║`)));
    console.log(bold(magenta(`╚══════════════════════════════════════╝`)));
    console.log(
      yellow(
        `  No home_networks row exists yet — connect to "${wifi.essid}" in-game to materialize it.`,
      ),
    );
    continue;
  }

  // Crowded ESSIDs may have multiple instances (one per LAN).
  for (let instanceIdx = 0; instanceIdx < instances.length; instanceIdx++) {
    const instance = instances[instanceIdx]!;
    console.log('');
    console.log(bold(magenta(`╔══════════════════════════════════════╗`)));
    const headerSuffix = instances.length > 1 ? ` [${instanceIdx + 1}/${instances.length}]` : '';
    console.log(bold(magenta(`║     WIFI ${idx}: ${(wifi.essid + headerSuffix).padEnd(25)}║`)));
    console.log(bold(magenta(`╚══════════════════════════════════════╝`)));
    console.log(`  Public IP:       ${cyan(instance.publicIp)}`);
    console.log(`  Density tier:    ${instance.densityTier}`);
    console.log(`  Slots:           ${instance.occupants.length} / ${instance.maxSlots}`);
    console.log(`  Server seed:     ${dim(instance.seed)}`);
    if (instance.occupants.length > 0) {
      console.log(`  Occupants:`);
      instance.occupants.forEach((o) => {
        console.log(
          `    - ${o.hostname}  ${cyan(o.lanIp)}  ${dim(`player_key=${o.playerKey.slice(0, 16)}…`)}`,
        );
      });
    }

    // routerPublicIp must match the home_networks row's public_ip so the
    // PRNG state advances identically to the in-game generation
    // (HomeNetworksContext.tsx passes result.public_ip when joining).
    // Without this, hostnames and gateway IPs diverge from what the
    // player actually sees.
    const net = await generateHomeNetwork({
      seed: instance.seed,
      essid: wifi.essid,
      routerPublicIp: instance.publicIp,
    });

    printOverview(net, idx);
    printMachines(net);
    printFileSystems(net);
  }
}

console.log('');
