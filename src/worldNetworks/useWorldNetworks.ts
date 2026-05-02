import { useEffect, useState } from 'react';
import type { MissionNetwork } from '../generation/types';
import { selectGenerator } from '../themedNetworks/generators/registry';
import { buildWorldHandlerMap } from '../themedNetworks/handlerRegistry';
import type { RequestHandler } from '../themedNetworks/types';
import { listWorldNetworks } from './client';
import { generateWorldNetworks } from './generate';

export type WorldNetworkState = {
  readonly networks: ReadonlyArray<MissionNetwork>;
  // Public-IP → handler map derived from the row.theme of each loaded
  // network. Empty until generation completes; stays empty for rows
  // whose theme has no registered handler.
  readonly handlers: ReadonlyMap<string, RequestHandler>;
};

const EMPTY_STATE: WorldNetworkState = {
  networks: [],
  handlers: new Map(),
};

// Hook for the production world_networks feature. Fetches the list at
// mount, generates each row's full network via the mission generator
// (with a fake allocator pinning the row's public_ip so all players
// get identical machine_ids), builds the theme-keyed handler map, and
// exposes both.
//
// Returns empty state while the fetch + generation are in flight, or
// if env vars / DB are unavailable. Graceful degradation matches
// listWorldNetworks's behaviour — the app keeps working without world
// networks if the table can't be reached.
//
// Consumers (GameSession) destructure each network's fileSystems for
// FileSystemProvider, pass the networks to NetworkProvider so network
// commands (nmap / ssh / curl / etc.) can resolve world machine IPs,
// and pass the handlers so curl can dispatch to themed-network logic
// (search engine, future shop/forum themes, etc.).
export const useWorldNetworks = (): WorldNetworkState => {
  const [state, setState] = useState<WorldNetworkState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;

    const fetchAndGenerate = async (): Promise<void> => {
      const rows = await listWorldNetworks();
      if (cancelled || rows.length === 0) return;
      const generated = await generateWorldNetworks(rows, selectGenerator);
      if (cancelled) return;
      setState({
        networks: generated,
        handlers: buildWorldHandlerMap(rows, generated),
      });
    };

    void fetchAndGenerate();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};
