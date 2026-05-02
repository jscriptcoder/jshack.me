import { generateMissionNetwork } from '../../generation/generateMission';
import type { ThemedGenerator } from '../../worldNetworks/generate';
import { generateSearchEngineNetwork } from './searchEngineNetwork';

// Default generator for world_networks rows whose theme has no
// dedicated generator. Wraps generateMissionNetwork so existing rows
// (playground today, future themes that lean on mission infrastructure)
// keep working unchanged.
//
// usedIps is left undefined — world networks each have their own
// pinned IP via the allocator, and IP collisions across world rows
// would have been caught at migration time, not here.
const defaultGenerator: ThemedGenerator = async (row, ctx) =>
  generateMissionNetwork(row.seed, undefined, { allocateIp: ctx.allocateIp });

// Theme → generator. Themes without an entry fall back to the mission-
// shaped default. Adding a new themed network with a custom shape =
// adding one entry here + the matching generator module.
const THEME_GENERATORS: Readonly<Record<string, ThemedGenerator>> = {
  'search-engine': generateSearchEngineNetwork,
};

export const selectGenerator = (theme: string): ThemedGenerator =>
  THEME_GENERATORS[theme] ?? defaultGenerator;
