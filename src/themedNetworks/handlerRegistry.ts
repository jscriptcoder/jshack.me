import type { MissionNetwork } from '../generation/types';
import type { WorldNetwork } from '../worldNetworks/types';
import { searchEngineHandler } from './handlers/searchEngine';
import type { RequestHandler } from './types';

// Theme-keyed registry. Each entry maps a `world_networks.theme` value
// to the handler that takes ownership of HTTP requests on machines in
// that themed network. Themes without an entry fall through to the
// static-file pipeline on every machine — no harm.
//
// Adding a new themed network with dynamic behavior = adding one entry
// here + the matching handler module under handlers/.
export const THEME_HANDLERS: Readonly<Record<string, RequestHandler>> = {
  'search-engine': searchEngineHandler,
};

export const getHandlerForTheme = (theme: string): RequestHandler | undefined =>
  THEME_HANDLERS[theme];

// Builds a Map<machineIp, RequestHandler> by pairing each world_networks
// row with its generated MissionNetwork (matched by public_ip ===
// routerMachine.ip) and looking up the row's theme in THEME_HANDLERS.
//
// The handler attaches to the network's router IP — currently all
// themed networks are single-machine, so the router IS the only
// machine. Multi-machine themed networks (university, etc.) will need
// a richer attachment strategy (per-machine themes, NAT-target
// awareness) when they ship.
//
// Rows whose theme has no registered handler, or whose public_ip
// doesn't match any network, are silently skipped — keeps the map
// honest if generation partially fails or if a row references a theme
// from a future code drop.
export const buildWorldHandlerMap = (
  rows: ReadonlyArray<WorldNetwork>,
  networks: ReadonlyArray<MissionNetwork>,
): ReadonlyMap<string, RequestHandler> => {
  const networkByIp = new Map(networks.map((n) => [n.routerMachine.ip, n]));
  const map = new Map<string, RequestHandler>();
  for (const row of rows) {
    const handler = getHandlerForTheme(row.theme);
    if (!handler) continue;
    const network = networkByIp.get(row.public_ip);
    if (!network) continue;
    map.set(network.routerMachine.ip, handler);
  }
  return map;
};
