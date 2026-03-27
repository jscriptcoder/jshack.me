import { createPrng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { buildMissionObjective } from './attackChain';
import { generateFileSystems } from './filesystem';
import { enrichMachineWithUsers, applyPortClosures } from './enrichment';
import type {
  Difficulty,
  EntryVariant,
  GeneratedMachine,
  MissionNetwork,
  MissionObjectiveType,
  SeedOverrides,
} from './types';

// Parses keyword overrides from the seed string. Keywords are case-insensitive
// and matched via `includes()`. This lets players and devs control generation
// axes by embedding keywords in the seed (e.g. "HEIST-ssh-forwarded-tamper-hard").
export const parseSeedOverrides = (seed: string): SeedOverrides => {
  const lower = seed.toLowerCase();

  const difficulties: readonly Difficulty[] = ['easy', 'medium', 'hard'];
  const difficulty = difficulties.find((d) => lower.includes(d));

  const entryVariants: readonly (readonly [string, EntryVariant])[] = [
    ['exploit', 'exploit'],
    ['snmp', 'snmp'],
    ['http', 'http'],
    ['ftp', 'ftp'],
    ['nc', 'nc'],
    ['ssh', 'ssh'],
  ];
  const entryVariant = entryVariants.find(([keyword]) => lower.includes(keyword))?.[1];

  const forwarded = lower.includes('forwarded')
    ? true
    : lower.includes('router-first')
      ? false
      : undefined;

  const objectiveKeywords: readonly (readonly [string, MissionObjectiveType])[] = [
    ['portforward', 'portforward'],
    ['script-fix', 'script_fix'],
    ['sabotage', 'sabotage'],
    ['backdoor', 'backdoor'],
    ['exfiltrate', 'exfiltrate'],
    ['tamper', 'tamper'],
    ['credential-theft', 'credential_theft'],
    ['forensics', 'forensics'],
  ];
  const objectiveType = objectiveKeywords.find(([keyword]) => lower.includes(keyword))?.[1];

  const domainEntry = lower.includes('domain') ? true : undefined;

  // 'gpg' keyword forces encrypted exfiltrate mode
  const encrypted = lower.includes('gpg') ? true : undefined;

  return { difficulty, entryVariant, forwarded, objectiveType, domainEntry, encrypted };
};

// Derives difficulty from seed overrides or falls back to a simple character-sum
// hash mod 3. The double-mod `((hash % 3) + 3) % 3` handles negative values
// from the bitwise `|0` coercion.
const deriveDifficulty = (seed: string, overrides: SeedOverrides): Difficulty => {
  if (overrides.difficulty) return overrides.difficulty;
  const hash = [...seed].reduce((h, ch) => (h + ch.charCodeAt(0)) | 0, 0);
  const mod = ((hash % 3) + 3) % 3;
  return mod === 0 ? 'easy' : mod === 1 ? 'medium' : 'hard';
};

// Enrichment functions (pickOwnerType, addNcBackdoorOwner, addFtpServerOwner,
// addExploitVulnerability, enrichMachineWithUsers, applyPortClosures) are in
// src/generation/enrichment.ts — shared between mission and home network generation.

export const generateMissionNetwork = (
  seed: string,
  usedIps?: ReadonlySet<string>,
): MissionNetwork => {
  const prng = createPrng(seed);
  const overrides = parseSeedOverrides(seed);
  const difficulty = deriveDifficulty(seed, overrides);

  // portforward requires router-first mode (no pre-populated NAT rules)
  const effectiveForwarded =
    overrides.objectiveType === 'portforward' ? false : overrides.forwarded;

  // forensics always uses SSH entry (player is an authorized investigator)
  const effectiveEntryVariant =
    overrides.objectiveType === 'forensics' ? 'ssh' : overrides.entryVariant;

  const topology = generateTopology(prng, difficulty, {
    entryVariantOverride: effectiveEntryVariant,
    forwardedOverride: effectiveForwarded,
    usedIps,
  });

  // Generate users for internal machines
  const { usersByMachine, credentials } = generateUsers(
    prng,
    topology.machines,
    topology.entryPoint,
  );

  // Generate users for the router machine
  const { usersByMachine: routerUsersByMachine, credentials: routerCredentials } = generateUsers(
    prng,
    [topology.routerMachine],
    '', // router is never the entry point for user generation
  );

  // Merge router users into the main maps.
  // Also map the router's internal gateway IP (subnet.1) to the router's users,
  // so internal machines that reference the gateway IP can resolve users.
  const routerInternalIp = topology.entryPoint.replace(/\.\d+$/, '.1');
  const routerUsers = routerUsersByMachine[topology.routerPublicIp] ?? [];
  const routerCreds = routerCredentials[topology.routerPublicIp] ?? [];

  // Map inner gateways' downstream .1 IPs to their users. Inner gateways live in
  // topology.machines and already have users, but downstream machines reference them
  // by their .1 IP (the gateway address on the downstream subnet).
  const gatewayLayers = topology.layers.slice(1);
  const gatewayInternalIpMap: Record<string, typeof routerUsers> = Object.fromEntries(
    gatewayLayers.map((layer) => [`${layer.subnet}.1`, usersByMachine[layer.gateway.ip] ?? []]),
  );
  const gatewayInternalCredMap: Record<string, typeof routerCreds> = Object.fromEntries(
    gatewayLayers.map((layer) => [`${layer.subnet}.1`, credentials[layer.gateway.ip] ?? []]),
  );

  const allUsersByMachine = {
    ...usersByMachine,
    ...routerUsersByMachine,
    [routerInternalIp]: routerUsers,
    ...gatewayInternalIpMap,
  };
  const allCredentials = {
    ...credentials,
    ...routerCredentials,
    [routerInternalIp]: routerCreds,
    ...gatewayInternalCredMap,
  };

  // Enrich all machines with users and variant-specific port data (owners, vulnerabilities).
  // Each machine's own accessVariant determines which enrichment it gets.
  const machinesWithUsers: readonly GeneratedMachine[] = topology.machines.map((m) =>
    enrichMachineWithUsers(m, allUsersByMachine[m.ip] ?? [], prng),
  );

  const routerWithUsers = enrichMachineWithUsers(
    topology.routerMachine,
    allUsersByMachine[topology.routerPublicIp] ?? [],
    prng,
  );

  // Resolve objective type early so port closures can skip SSH closures for
  // script_fix (player needs shell access via node()).
  const effectiveObjectiveOverride = overrides.encrypted ? 'exfiltrate' : overrides.objectiveType;
  const objectiveTypes: readonly MissionObjectiveType[] = [
    'exfiltrate',
    'tamper',
    'credential_theft',
    'script_fix',
    'sabotage',
    'backdoor',
  ];
  const prngObjectiveType = prng.pick(objectiveTypes);
  const resolvedObjectiveType = effectiveObjectiveOverride ?? prngObjectiveType;

  // Apply PRNG-driven port closures (~30% SSH, ~30% FTP, independent rolls).
  // Entry machine and router are always protected from closures.
  const machinesAfterClosures = applyPortClosures(
    prng,
    machinesWithUsers,
    topology.entryPoint,
    resolvedObjectiveType,
  );

  // Update network configs with populated users and port closures
  const updatedMachineConfigs = Object.fromEntries(
    Object.entries(topology.networkConfig.machineConfigs).map(([ip, config]) => [
      ip,
      {
        ...config,
        machines: config.machines.map((rm) => {
          const updated = machinesAfterClosures.find((m) => m.ip === rm.ip);
          return {
            ...rm,
            users: allUsersByMachine[rm.ip] ?? [],
            ports: updated?.remoteMachine.ports ?? rm.ports,
          };
        }),
      },
    ]),
  );

  const { objective, clientEmail } = buildMissionObjective({
    prng,
    machines: machinesAfterClosures,
    credentials: allCredentials,
    entryPoint: topology.entryPoint,
    difficulty,
    objectiveTypeOverride: effectiveObjectiveOverride,
    encryptedOverride: overrides.encrypted,
    layers: topology.layers,
  });

  const fileSystems = generateFileSystems({
    prng,
    machines: machinesAfterClosures,
    usersByMachine: allUsersByMachine,
    credentials: allCredentials,
    objective,
    routerMachine: routerWithUsers,
    natForwarding: topology.natForwarding,
    entryVariant: topology.entryVariant,
    entryPoint: topology.entryPoint,
    difficulty,
    layers: topology.layers,
  });

  // Domain entry: when active, briefing shows router domain instead of IP.
  // Always consume a PRNG call to preserve sequence regardless of override.
  const domainRoll = prng.next();
  const domainThreshold = difficulty === 'easy' ? 0.3 : difficulty === 'medium' ? 0.5 : 0.7;
  const domainEntry = overrides.domainEntry ?? domainRoll < domainThreshold;
  const routerDomain = `${topology.routerMachine.hostname}.mission`;

  return {
    seed,
    difficulty,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
    machines: machinesAfterClosures,
    fileSystems,
    networkConfig: { machineConfigs: updatedMachineConfigs },
    objective,
    clientEmail,
    routerPublicIp: topology.routerPublicIp,
    routerMachine: routerWithUsers,
    natForwarding: topology.natForwarding,
    routerDomain,
    domainEntry,
    layers: topology.layers,
  };
};
