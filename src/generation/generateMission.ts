import { createPrng } from './prng';
import type { Prng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { buildMissionObjective } from './attackChain';
import { generateFileSystems } from './filesystem';
import type {
  Difficulty,
  EntryVariant,
  GeneratedMachine,
  MissionNetwork,
  MissionObjectiveType,
  SeedOverrides,
} from './types';
import type { Port, RemoteMachine, RemoteUser, ServiceOwner } from '../network/types';
import { backdoorPorts } from './pools';
import { vulnerabilityTemplates } from './pools';

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
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash + seed.charCodeAt(i)) | 0;
  }
  const mod = ((hash % 3) + 3) % 3;
  return mod === 0 ? 'easy' : mod === 1 ? 'medium' : 'hard';
};

// Picks an owner type for NC/exploit port owners with weighted distribution:
// guest (60%), user (30%), root (10%). Adds difficulty variety to restricted shells.
const pickOwnerType = (prng: Prng): 'root' | 'user' | 'guest' => {
  const roll = prng.next();
  if (roll < 0.6) return 'guest';
  if (roll < 0.9) return 'user';
  return 'root';
};

// Finds a user matching the preferred type, falling back to other types if needed.
// All machines have root + at least one user, so this always returns a match.
const findUserByType = (
  users: readonly RemoteUser[],
  preferredType: 'root' | 'user' | 'guest',
): RemoteUser | undefined => {
  const found = users.find((u) => u.userType === preferredType);
  if (found) return found;
  const fallbacksByType: Record<string, readonly ('root' | 'user' | 'guest')[]> = {
    guest: ['user', 'root'],
    user: ['guest', 'root'],
    root: ['user', 'guest'],
  };
  const fallbacks = fallbacksByType[preferredType];
  for (const fb of fallbacks) {
    const fallback = users.find((u) => u.userType === fb);
    if (fallback) return fallback;
  }
  return undefined;
};

// For NC entry variant: assigns a user as owner of the backdoor port ('elite' service).
// Owner type is picked by PRNG (guest/user) — root is excluded because a backdoor is
// planted by a prior attacker or rogue insider, not by root on their own machine.
const addNcBackdoorOwner = (
  ports: readonly Port[],
  users: readonly RemoteUser[],
  prng: Prng,
): readonly Port[] => {
  const ownerType = pickOwnerType(prng);
  // Backdoors aren't root-owned — remap to user to preserve PRNG sequence
  const effectiveOwnerType = ownerType === 'root' ? 'user' : ownerType;
  const owner = findUserByType(users, effectiveOwnerType);
  if (!owner) return ports;

  return ports.map((p) =>
    p.service === 'elite' && p.open
      ? {
          ...p,
          owner: {
            username: owner.username,
            userType: owner.userType,
            homePath: owner.userType === 'root' ? '/root' : `/home/${owner.username}`,
          },
        }
      : p,
  );
};

// For FTP entry variant: assigns a user as owner of the FTP port (port 21).
// Owner type is picked by PRNG (guest/user/root) for difficulty variety,
// matching the NC/exploit pattern. The FTP login user becomes this owner.
const addFtpServerOwner = (
  ports: readonly Port[],
  users: readonly RemoteUser[],
  prng: Prng,
): readonly Port[] => {
  const ownerType = pickOwnerType(prng);
  const owner = findUserByType(users, ownerType);
  if (!owner) return ports;

  return ports.map((p) =>
    p.service === 'ftp' && p.open
      ? {
          ...p,
          owner: {
            username: owner.username,
            userType: owner.userType,
            homePath: owner.userType === 'root' ? '/root' : `/home/${owner.username}`,
          },
        }
      : p,
  );
};

// For exploit entry variant: attaches a vulnerability and owner to the
// non-SSH open port on the entry machine. Owner type is picked by PRNG
// (guest/user/root) for difficulty variety.
const addExploitVulnerability = (
  ports: readonly Port[],
  users: readonly RemoteUser[],
  prng: Prng,
): readonly Port[] => {
  const ownerType = pickOwnerType(prng);
  const owner = findUserByType(users, ownerType);
  if (!owner) return ports;

  return ports.map((p) => {
    if (p.service === 'ssh' || !p.open) return p;

    const vuln = vulnerabilityTemplates.find((v) => v.service === p.service);
    if (!vuln) return p;

    return {
      ...p,
      vulnerability: vuln.vulnerability,
      owner: {
        username: owner.username,
        userType: owner.userType,
        homePath: owner.userType === 'root' ? '/root' : `/home/${owner.username}`,
      },
    };
  });
};

// Derives the enrichment flag from a machine's access variant.
// NC, exploit, and FTP variants need port owners/vulnerabilities attached.
const variantEnrichmentFlag = (variant: EntryVariant): 'nc' | 'exploit' | 'ftp' | null =>
  variant === 'nc' || variant === 'exploit' || variant === 'ftp' ? variant : null;

const enrichMachineWithUsers = (
  machine: GeneratedMachine,
  users: RemoteMachine['users'],
  prng: Prng,
): GeneratedMachine => {
  const flag = variantEnrichmentFlag(machine.accessVariant);
  return {
    ...machine,
    remoteMachine: {
      ...machine.remoteMachine,
      ports:
        flag === 'nc'
          ? addNcBackdoorOwner(machine.remoteMachine.ports, users, prng)
          : flag === 'exploit'
            ? addExploitVulnerability(machine.remoteMachine.ports, users, prng)
            : flag === 'ftp'
              ? addFtpServerOwner(machine.remoteMachine.ports, users, prng)
              : machine.remoteMachine.ports,
      users,
    },
  };
};

// Applies PRNG-driven port closures to increase lateral movement variety.
// At most one SSH closure and one FTP closure per network. When SSH is closed
// on a machine, FTP port 21 is ensured open and an NC backdoor with root owner
// is guaranteed (existing backdoor upgraded, or new one added). A dual closure
// (~15%) closes both SSH and FTP, adding an NC backdoor with root owner.
// Always consumes 8 PRNG calls for sequence stability.
const applyPortClosures = (
  prng: Prng,
  machines: readonly GeneratedMachine[],
  entryPoint: string,
  objectiveType: MissionObjectiveType,
): readonly GeneratedMachine[] => {
  // Always consume 8 PRNG calls regardless of whether closures apply
  const sshRoll = prng.next();
  const sshTargetIdx = prng.nextInt(0, Math.max(0, machines.length - 1));
  const ftpRoll = prng.next();
  const ftpTargetIdx = prng.nextInt(0, Math.max(0, machines.length - 1));
  const dualRoll = prng.next();
  const dualTargetIdx = prng.nextInt(0, Math.max(0, machines.length - 1));
  const dualBackdoorPort = prng.pick(backdoorPorts);
  const sshBackdoorPort = prng.pick(backdoorPorts);

  // script_fix, sabotage, backdoor, and portforward need SSH shell access — skip all closures
  if (
    objectiveType === 'script_fix' ||
    objectiveType === 'sabotage' ||
    objectiveType === 'backdoor' ||
    objectiveType === 'portforward'
  )
    return machines;

  // Eligible machines: internal (non-router), non-entry
  const eligible = machines.filter((m) => m.role !== 'router' && m.ip !== entryPoint);
  if (eligible.length === 0) return machines;

  // Dual closure: ~15% chance to close both SSH and FTP, adding an NC backdoor.
  // Skip machines that need specific ports (ssh/ftp variants) or already have
  // a backdoor (nc variant).
  const dualTarget = eligible[dualTargetIdx % eligible.length];
  const dualTargetVariant = dualTarget?.accessVariant;
  const dualVariantBlocked =
    dualTargetVariant === 'ssh' || dualTargetVariant === 'ftp' || dualTargetVariant === 'nc';
  const dualClosureIp = dualRoll < 0.15 && !dualVariantBlocked ? dualTarget?.ip : undefined;

  const sshTarget = eligible[sshTargetIdx % eligible.length];
  const sshClosureIp =
    sshRoll < 0.3 && sshTarget?.accessVariant !== 'ssh' && sshTarget?.ip !== dualClosureIp
      ? sshTarget?.ip
      : undefined;
  const ftpTarget = eligible[ftpTargetIdx % eligible.length];
  const ftpClosureIp =
    ftpRoll < 0.3 && ftpTarget?.accessVariant !== 'ftp' && ftpTarget?.ip !== dualClosureIp
      ? ftpTarget?.ip
      : undefined;

  // Never close both SSH and FTP on the same machine (unless dual closure)
  const effectiveFtpClosureIp =
    ftpClosureIp !== undefined && ftpClosureIp === sshClosureIp ? undefined : ftpClosureIp;

  if (
    sshClosureIp === undefined &&
    effectiveFtpClosureIp === undefined &&
    dualClosureIp === undefined
  )
    return machines;

  return machines.map((m) => {
    if (m.ip === dualClosureIp) {
      // Dual closure: close SSH and FTP, add NC backdoor with root owner
      const rootUser = m.remoteMachine.users.find((u) => u.userType === 'root');
      const ports: readonly Port[] = [
        ...m.remoteMachine.ports.map((p) =>
          p.port === 22 || p.port === 21 ? { ...p, open: false } : p,
        ),
        {
          port: dualBackdoorPort,
          service: 'elite',
          open: true,
          owner: rootUser
            ? { username: rootUser.username, userType: 'root', homePath: '/root' }
            : undefined,
        },
      ];
      return { ...m, remoteMachine: { ...m.remoteMachine, ports } };
    }

    if (m.ip === sshClosureIp) {
      // Close SSH, ensure FTP port 21 is open, ensure NC backdoor with root owner.
      // Root is required so the player can run `sshd` to re-enable SSH access.
      const rootUser = m.remoteMachine.users.find((u) => u.userType === 'root');
      const rootOwner: ServiceOwner | undefined = rootUser
        ? { username: rootUser.username, userType: 'root', homePath: '/root' }
        : undefined;
      const hasElite = m.remoteMachine.ports.some((p) => p.service === 'elite' && p.open);
      const hasFtp = m.remoteMachine.ports.some((p) => p.port === 21);

      // Close SSH and upgrade any existing backdoor owner to root
      const portsWithClosedSsh = m.remoteMachine.ports.map((p) =>
        p.port === 22
          ? { ...p, open: false }
          : p.service === 'elite' && p.open
            ? { ...p, owner: rootOwner }
            : p,
      );

      // Ensure FTP port 21 is open
      const withFtp = hasFtp
        ? portsWithClosedSsh.map((p) => (p.port === 21 ? { ...p, open: true } : p))
        : [...portsWithClosedSsh, { port: 21, service: 'ftp', open: true }];

      // Add NC backdoor with root owner if none exists
      const ports = hasElite
        ? withFtp
        : [...withFtp, { port: sshBackdoorPort, service: 'elite', open: true, owner: rootOwner }];

      return {
        ...m,
        remoteMachine: { ...m.remoteMachine, ports },
      };
    }

    if (m.ip === effectiveFtpClosureIp) {
      // Close FTP port 21 if present and open (cosmetic — only affects fileservers)
      const hasFtpOpen = m.remoteMachine.ports.some((p) => p.port === 21 && p.open);
      if (!hasFtpOpen) return m;

      return {
        ...m,
        remoteMachine: {
          ...m.remoteMachine,
          ports: m.remoteMachine.ports.map((p) => (p.port === 21 ? { ...p, open: false } : p)),
        },
      };
    }

    return m;
  });
};

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
  const gatewayInternalIpMap: Record<string, typeof routerUsers> = {};
  const gatewayInternalCredMap: Record<string, typeof routerCreds> = {};
  for (let i = 1; i < topology.layers.length; i++) {
    const gateway = topology.layers[i]!.gateway;
    const downstreamSubnet = topology.layers[i]!.subnet;
    const gatewayInternalIp = `${downstreamSubnet}.1`;
    gatewayInternalIpMap[gatewayInternalIp] = usersByMachine[gateway.ip] ?? [];
    gatewayInternalCredMap[gatewayInternalIp] = credentials[gateway.ip] ?? [];
  }

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
