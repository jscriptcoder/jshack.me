import { createPrng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { generateAttackChain } from './attackChain';
import { generateFileSystems } from './filesystem';
import type { Difficulty, GeneratedMachine, MissionNetwork } from './types';
import type { RemoteMachine } from '../network/types';

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

const enrichMachineWithUsers = (
  machine: GeneratedMachine,
  users: RemoteMachine['users'],
): GeneratedMachine => ({
  ...machine,
  remoteMachine: {
    ...machine.remoteMachine,
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
    enrichMachineWithUsers(m, usersByMachine[m.ip] ?? []),
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
    difficulty,
  });

  const fileSystems = generateFileSystems({
    prng,
    machines: machinesWithUsers,
    usersByMachine,
    credentialPlacements,
    objective,
  });

  return {
    seed,
    difficulty,
    entryPoint: topology.entryPoint,
    machines: machinesWithUsers,
    fileSystems,
    networkConfig: { machineConfigs: updatedMachineConfigs },
    attackChain,
    objective,
  };
};
