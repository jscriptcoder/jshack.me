import { createPrng } from '../prng';
import { generateTopology } from '../topology';
import { generateUsers } from '../users';
import { buildMissionObjective } from '../attackChain';
import { generateFileSystems } from '.';
import type { MissionObjectiveType } from '../types';
import type { FileNode } from '../../filesystem/types';

export const buildTestData = (seed: string, difficulty: 'easy' | 'medium' | 'hard' = 'medium') => {
  const prng = createPrng(seed);
  const topology = generateTopology(prng, difficulty);
  const { usersByMachine, credentials } = generateUsers(
    prng,
    topology.machines,
    topology.entryPoint,
  );
  const { objective } = buildMissionObjective({
    prng,
    machines: topology.machines,
    credentials,
    entryPoint: topology.entryPoint,
    difficulty,
    layers: topology.layers,
  });
  const { fileSystems } = generateFileSystems({
    prng,
    machines: topology.machines,
    usersByMachine,
    credentials,
    objective,
    routerMachine: topology.routerMachine,
    layers: topology.layers,
  });
  return { topology, fileSystems, objective, credentials, usersByMachine };
};

export const buildTestDataWithOverride = (
  seed: string,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  objectiveTypeOverride?: MissionObjectiveType,
) => {
  const prng = createPrng(seed);
  const topology = generateTopology(prng, difficulty);
  const { usersByMachine, credentials } = generateUsers(
    prng,
    topology.machines,
    topology.entryPoint,
  );
  const { objective } = buildMissionObjective({
    prng,
    machines: topology.machines,
    credentials,
    entryPoint: topology.entryPoint,
    difficulty,
    objectiveTypeOverride,
    layers: topology.layers,
  });
  const { fileSystems } = generateFileSystems({
    prng,
    machines: topology.machines,
    usersByMachine,
    credentials,
    objective,
    routerMachine: topology.routerMachine,
    layers: topology.layers,
  });
  return { topology, fileSystems, objective, credentials, usersByMachine };
};

export const resolveNode = (root: FileNode, path: string): FileNode | undefined => {
  const parts = path.split('/').filter(Boolean);
  let current: FileNode | undefined = root;
  for (const part of parts) {
    if (current?.type !== 'directory' || !current.children) return undefined;
    current = current.children[part];
  }
  return current;
};

// Recursively collects all text content from a FileNode tree.
export const collectAllContent = (node: FileNode | undefined): readonly string[] => {
  if (!node) return [];
  if (node.type === 'file') return node.content ? [node.content] : [];
  return Object.values(node.children ?? {}).flatMap((child) => collectAllContent(child));
};

// Recursively collects all file names from a FileNode tree.
export const collectAllFileNames = (node: FileNode | undefined): readonly string[] => {
  if (!node) return [];
  if (node.type === 'file') return [node.name];
  return Object.values(node.children ?? {}).flatMap((child) => collectAllFileNames(child));
};

// Recursively collects all file nodes from a FileNode tree.
export const collectAllFiles = (node: FileNode | undefined): readonly FileNode[] => {
  if (!node) return [];
  if (node.type === 'file') return [node];
  return Object.values(node.children ?? {}).flatMap((child) => collectAllFiles(child));
};
