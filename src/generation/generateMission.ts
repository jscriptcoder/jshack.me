import { createPrng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { generateAttackChain } from './attackChain';
import { generateFileSystems } from './filesystem';
import type { Difficulty, GeneratedMachine, MissionNetwork } from './types';
import type { Port, RemoteMachine, RemoteUser } from '../network/types';

// Derives difficulty from seed string: explicit keywords ('easy'/'hard') take priority,
// otherwise falls back to a simple character-sum hash mod 3. The double-mod `((hash % 3) + 3) % 3`
// handles negative values from the bitwise `|0` coercion.
const deriveDifficulty = (seed: string): Difficulty => {
  const lower = seed.toLowerCase();
  if (lower.includes('easy')) return 'easy';
  if (lower.includes('hard')) return 'hard';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash + seed.charCodeAt(i)) | 0;
  }
  const mod = ((hash % 3) + 3) % 3;
  return mod === 0 ? 'easy' : mod === 1 ? 'medium' : 'hard';
};

// For NC entry variant: assigns the guest user as owner of the backdoor port ('elite' service).
// This controls who can access the netcat backdoor on the entry machine.
const addNcBackdoorOwner = (
  ports: readonly Port[],
  users: readonly RemoteUser[],
): readonly Port[] => {
  const guestUser = users.find((u) => u.userType === 'guest');
  if (!guestUser) return ports;

  return ports.map((p) =>
    p.service === 'elite' && p.open
      ? {
          ...p,
          owner: {
            username: guestUser.username,
            userType: guestUser.userType,
            homePath: `/home/${guestUser.username}`,
          },
        }
      : p,
  );
};

const enrichMachineWithUsers = (
  machine: GeneratedMachine,
  users: RemoteMachine['users'],
  isNcEntry: boolean,
): GeneratedMachine => ({
  ...machine,
  remoteMachine: {
    ...machine.remoteMachine,
    ports: isNcEntry
      ? addNcBackdoorOwner(machine.remoteMachine.ports, users)
      : machine.remoteMachine.ports,
    users,
  },
});

export const generateMissionNetwork = (seed: string): MissionNetwork => {
  const prng = createPrng(seed);
  const difficulty = deriveDifficulty(seed);

  const topology = generateTopology(prng, difficulty);
  const { usersByMachine, credentials } = generateUsers(
    prng,
    topology.machines,
    topology.entryPoint,
  );

  const machinesWithUsers: readonly GeneratedMachine[] = topology.machines.map((m) =>
    enrichMachineWithUsers(
      m,
      usersByMachine[m.ip] ?? [],
      m.ip === topology.entryPoint && topology.entryVariant === 'nc',
    ),
  );

  const updatedMachineConfigs = Object.fromEntries(
    Object.entries(topology.networkConfig.machineConfigs).map(([ip, config]) => [
      ip,
      {
        ...config,
        machines: config.machines.map((rm) => ({
          ...rm,
          users: usersByMachine[rm.ip] ?? [],
        })),
      },
    ]),
  );

  const { attackChain, credentialPlacements, objective } = generateAttackChain({
    prng,
    machines: machinesWithUsers,
    credentials,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
    difficulty,
  });

  const fileSystems = generateFileSystems({
    prng,
    machines: machinesWithUsers,
    usersByMachine,
    credentialPlacements,
    credentials,
    objective,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
  });

  return {
    seed,
    difficulty,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
    machines: machinesWithUsers,
    fileSystems,
    networkConfig: { machineConfigs: updatedMachineConfigs },
    attackChain,
    objective,
  };
};
