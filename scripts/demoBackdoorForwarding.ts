/**
 * Demo: shows NAT chain forwarding when a backdoor is planted on an
 * internal machine. Generates a real multi-layer home network from a
 * seed, picks a target machine in the deepest layer, and simulates the
 * exploit: calls chainForwardBackdoor directly, then prints every
 * gateway's /etc/iptables/rules.v4 before and after.
 *
 * Usage:
 *   npx tsx scripts/demoBackdoorForwarding.ts [gameSeed] [wifiIndex]
 *
 * Defaults to `bd-0` / wifi index 0 if args are omitted.
 */

import { generateWifiNetworks } from '../src/generation/generateWifi';
import { generateHomeNetwork } from '../src/generation/generateHomeNetwork';
import {
  chainForwardBackdoor,
  type BackdoorForwardDeps,
} from '../src/network/backdoorForwarding';
import { findGatewayChainFor } from '../src/network/gatewayChain';

const gameSeed = process.argv[2] ?? 'bd-0';
const wifiIndex = Number(process.argv[3] ?? 0);

const wifis = generateWifiNetworks(gameSeed).filter((w) => w.crackable);
if (wifiIndex >= wifis.length) {
  console.error(`wifi index ${wifiIndex} out of range (found ${wifis.length} crackable networks)`);
  process.exit(1);
}
const net = generateHomeNetwork(gameSeed, wifiIndex, wifis[wifiIndex]!.essid);

console.log(`=== Home network: ${net.essid} (seed=${gameSeed}, wifi=${wifiIndex}) ===`);
console.log(`difficulty: ${net.difficulty}, layers: ${net.layers.length}`);
console.log(`router public: ${net.router.publicIp}\n`);

if (net.layers.length < 2) {
  console.log('Single-layer network — pick a higher wifi index or try another seed for multi-layer');
}

// Pick target: the first machine in the deepest layer.
const deepestLayer = net.layers[net.layers.length - 1]!;
const targetMachine = deepestLayer.machines[0];
if (!targetMachine) {
  console.error('no machines in deepest layer');
  process.exit(1);
}

const BACKDOOR_PORT = 31337;
console.log(`Target: ${targetMachine.hostname} (${targetMachine.ip}) — planting backdoor on port ${BACKDOOR_PORT}\n`);

// Resolve the gateway chain for the target, just like NetworkContext does.
const chain = findGatewayChainFor(targetMachine.ip, net.layers);
console.log(`Gateway chain (innermost → edge): ${chain.map((g) => `${g.hostname}(${g.ip})`).join(' → ')}\n`);

// Simulate the iptables filesystem with an in-memory store seeded from the
// generated filesystems (matches what the game would read at runtime).
const store = new Map<string, string>();
for (const gateway of chain) {
  const fs = net.fileSystems[gateway.ip];
  const rulesNode = fs?.children?.['etc']?.children?.['iptables']?.children?.['rules.v4'];
  if (rulesNode?.type === 'file' && rulesNode.content) {
    store.set(gateway.ip, rulesNode.content);
  }
}

// ---- BEFORE ----
console.log('=== BEFORE (each gateway\'s /etc/iptables/rules.v4) ===');
for (const gateway of chain) {
  console.log(`\n--- ${gateway.hostname} (${gateway.ip}) ---`);
  console.log(store.get(gateway.ip) ?? '(file absent — would be created)');
}

// ---- Invoke the feature ----
const deps: BackdoorForwardDeps = {
  readIptables: (ip) => store.get(ip) ?? null,
  writeIptables: (ip, content) => store.set(ip, content),
};
const result = chainForwardBackdoor({
  machineIp: targetMachine.ip,
  internalPort: BACKDOOR_PORT,
  gatewayChain: chain,
  deps,
});

// ---- AFTER ----
console.log('\n=== AFTER ===');
for (const gateway of chain) {
  console.log(`\n--- ${gateway.hostname} (${gateway.ip}) ---`);
  console.log(store.get(gateway.ip));
}

console.log('\n=== Installed rules ===');
for (const rule of result.rules) {
  console.log(
    `  on ${rule.gatewayIp}: forward ${rule.publicPort} → ${rule.internalIp}:${rule.internalPort}`,
  );
}
console.log(
  `\nPublic-edge reach: ${chain[chain.length - 1]!.ip}:${result.publicEdgePort} (what msfconsole would report)`,
);
