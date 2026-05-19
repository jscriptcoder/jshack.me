import type { RemoteMachine } from './types';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import { isPublicIpv4 } from '../foreignNetworks/isPublicIpv4';
import { findMachineInHomeNetworks } from './networkUtils';

// Async wrapper around sync findMachineByIp that triggers the cross-LAN
// resolver when the target IP is a publicly-addressable IPv4 but the
// local network state doesn't know it yet. Returns the resolved
// RemoteMachine directly (not via React state) so the caller has the
// found machine in hand without waiting for the foreignNetworks prop
// to re-render through NetworkProvider.
//
// Side effect: a successful resolution also leaves the foreign
// HomeNetwork in the useForeignNetworks cache (the resolver mutated
// the ref + bumped the version counter), so subsequent sync
// findMachineByIp calls — after the next render — see it too.
//
// Pure orchestration helper. Tests inject the sync find + resolver as
// vi.fn() doubles.
export const resolveMachineByIpAsync = async (
  ip: string,
  syncFind: (ip: string) => RemoteMachine | undefined,
  ensureForeignReachable: (publicIp: string) => Promise<HomeNetwork | null>,
): Promise<RemoteMachine | undefined> => {
  const syncResult = syncFind(ip);
  if (syncResult) return syncResult;
  if (!isPublicIpv4(ip)) return undefined;
  const network = await ensureForeignReachable(ip);
  if (network === null) return undefined;
  return findMachineInHomeNetworks(ip, [network]);
};
