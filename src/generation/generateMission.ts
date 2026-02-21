import { createPrng } from './prng';
import type { Prng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { generateAttackChain } from './attackChain';
import { generateFileSystems } from './filesystem';
import type { Difficulty, GeneratedMachine, MissionNetwork, SeedOverrides } from './types';
import type { Port, RemoteMachine, RemoteUser } from '../network/types';
import { vulnerabilityTemplates } from './pools';

// Parses keyword overrides from the seed string. Keywords are case-insensitive
// and matched via `includes()`. This lets players and devs control generation
// axes by embedding keywords in the seed (e.g. "HEIST-ssh-forwarded-tamper-hard").
export const parseSeedOverrides = (seed: string): SeedOverrides => {
  const lower = seed.toLowerCase();

  const difficulty = lower.includes('easy')
    ? 'easy'
    : lower.includes('medium')
      ? 'medium'
      : lower.includes('hard')
        ? 'hard'
        : undefined;

  const entryVariant = lower.includes('exploit')
    ? 'exploit'
    : lower.includes('ftp')
      ? 'ftp'
      : lower.includes('nc')
        ? 'nc'
        : lower.includes('ssh')
          ? 'ssh'
          : undefined;

  const forwarded = lower.includes('forwarded')
    ? true
    : lower.includes('router-first')
      ? false
      : undefined;

  const objectiveType = lower.includes('exfiltrate')
    ? 'exfiltrate'
    : lower.includes('tamper')
      ? 'tamper'
      : lower.includes('credential-theft')
        ? 'credential_theft'
        : undefined;

  return { difficulty, entryVariant, forwarded, objectiveType };
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
  const fallbacks: readonly ('root' | 'user' | 'guest')[] =
    preferredType === 'guest'
      ? ['user', 'root']
      : preferredType === 'user'
        ? ['guest', 'root']
        : ['user', 'guest'];
  for (const fb of fallbacks) {
    const fallback = users.find((u) => u.userType === fb);
    if (fallback) return fallback;
  }
  return undefined;
};

// For NC entry variant: assigns a user as owner of the backdoor port ('elite' service).
// Owner type is picked by PRNG (guest/user/root) for difficulty variety.
const addNcBackdoorOwner = (
  ports: readonly Port[],
  users: readonly RemoteUser[],
  prng: Prng,
): readonly Port[] => {
  const ownerType = pickOwnerType(prng);
  const owner = findUserByType(users, ownerType);
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

const enrichMachineWithUsers = (
  machine: GeneratedMachine,
  users: RemoteMachine['users'],
  entryVariantFlag: 'nc' | 'exploit' | null,
  prng: Prng,
): GeneratedMachine => ({
  ...machine,
  remoteMachine: {
    ...machine.remoteMachine,
    ports:
      entryVariantFlag === 'nc'
        ? addNcBackdoorOwner(machine.remoteMachine.ports, users, prng)
        : entryVariantFlag === 'exploit'
          ? addExploitVulnerability(machine.remoteMachine.ports, users, prng)
          : machine.remoteMachine.ports,
    users,
  },
});

export const generateMissionNetwork = (seed: string): MissionNetwork => {
  const prng = createPrng(seed);
  const overrides = parseSeedOverrides(seed);
  const difficulty = deriveDifficulty(seed, overrides);

  const topology = generateTopology(prng, difficulty, {
    entryVariantOverride: overrides.entryVariant,
    forwardedOverride: overrides.forwarded,
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
  const allUsersByMachine = {
    ...usersByMachine,
    ...routerUsersByMachine,
    [routerInternalIp]: routerUsers,
  };
  const allCredentials = {
    ...credentials,
    ...routerCredentials,
    [routerInternalIp]: routerCreds,
  };

  // Determine which machine gets entry variant enrichment.
  // In forwarded mode, the internal entry machine gets the variant.
  // In router-first mode, the router gets the variant.
  const isForwarded = topology.natForwarding !== undefined;
  const entryVariantTarget = isForwarded ? topology.entryPoint : topology.routerPublicIp;

  const isEntryVariant = (ip: string): 'nc' | 'exploit' | null =>
    ip === entryVariantTarget &&
    (topology.entryVariant === 'nc' || topology.entryVariant === 'exploit')
      ? topology.entryVariant
      : null;

  const machinesWithUsers: readonly GeneratedMachine[] = topology.machines.map((m) =>
    enrichMachineWithUsers(m, allUsersByMachine[m.ip] ?? [], isEntryVariant(m.ip), prng),
  );

  const routerWithUsers = enrichMachineWithUsers(
    topology.routerMachine,
    allUsersByMachine[topology.routerPublicIp] ?? [],
    isEntryVariant(topology.routerPublicIp),
    prng,
  );

  // Update network configs with populated users
  const updatedMachineConfigs = Object.fromEntries(
    Object.entries(topology.networkConfig.machineConfigs).map(([ip, config]) => [
      ip,
      {
        ...config,
        machines: config.machines.map((rm) => ({
          ...rm,
          users: allUsersByMachine[rm.ip] ?? [],
        })),
      },
    ]),
  );

  const { attackChain, credentialPlacements, objective, clientEmail } = generateAttackChain({
    prng,
    machines: machinesWithUsers,
    credentials: allCredentials,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
    difficulty,
    objectiveTypeOverride: overrides.objectiveType,
  });

  const fileSystems = generateFileSystems({
    prng,
    machines: machinesWithUsers,
    usersByMachine: allUsersByMachine,
    credentialPlacements,
    credentials: allCredentials,
    objective,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
    routerMachine: routerWithUsers,
  });

  // Extract entry credential for the mission briefing.
  // SSH variant uses a regular user account (so the player has user-tier commands).
  // Other variants use the port owner's account (guest/user/root, determined by PRNG).
  const credSourceIp = isForwarded ? topology.entryPoint : topology.routerPublicIp;
  const entryCredentials = allCredentials[credSourceIp] ?? [];
  const entryMachineForCred = isForwarded
    ? machinesWithUsers.find((m) => m.ip === credSourceIp)
    : routerWithUsers;
  const portOwner = entryMachineForCred?.remoteMachine.ports.find((p) => p.owner)?.owner;
  const entryCred =
    topology.entryVariant === 'ssh'
      ? entryCredentials.find((c) => c.username !== 'root' && c.username !== 'guest')
      : portOwner
        ? entryCredentials.find((c) => c.username === portOwner.username)
        : entryCredentials.find((c) => c.username === 'guest');

  return {
    seed,
    difficulty,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
    entryCredential: entryCred,
    machines: machinesWithUsers,
    fileSystems,
    networkConfig: { machineConfigs: updatedMachineConfigs },
    attackChain,
    objective,
    clientEmail,
    routerPublicIp: topology.routerPublicIp,
    routerMachine: routerWithUsers,
    natForwarding: topology.natForwarding,
  };
};
