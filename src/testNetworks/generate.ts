import type { FileNode } from '../filesystem/types.js';
import type { TestNetwork } from './types.js';

// Minimal slice of MissionNetwork the test-network path consumes.
// Kept narrow on purpose: the rest of the generated fields (objective,
// difficulty, routerMachine, etc.) are mission-specific UX that the
// playground intentionally ignores.
type GeneratedNetwork = {
  readonly fileSystems: Readonly<Record<string, FileNode>>;
};

// The generator signature mirrors generateMissionNetwork(seed, usedIps?,
// options?) — see src/generation/generateMission.ts. We pin a fake
// allocator that returns the test network's public_ip so generation is
// deterministic across players (same seed + same IP = same machines).
type TestNetworkGenerator = (
  seed: string,
  usedIps: ReadonlySet<string> | undefined,
  options: { readonly allocateIp: (kind: 'mission_instance') => Promise<string> },
) => Promise<GeneratedNetwork>;

// Generate filesystems for every supplied test network and merge them
// into one Record. The merge is a flat union of (machine_id → FileNode)
// — keys won't collide since each test network has a unique
// public_ip, and the generator allocates internal IPs from the seed
// deterministically.
//
// Generator is injectable so unit tests don't run the heavy mission
// generator; production callers pass `generateMissionNetwork`.
export const generateTestNetworkFileSystems = async (
  testNetworks: ReadonlyArray<TestNetwork>,
  generator: TestNetworkGenerator,
): Promise<Record<string, FileNode>> => {
  const networks = await Promise.all(
    testNetworks.map((tn) =>
      generator(tn.seed, undefined, {
        allocateIp: async () => tn.public_ip,
      }),
    ),
  );
  return Object.assign({}, ...networks.map((n) => n.fileSystems));
};
