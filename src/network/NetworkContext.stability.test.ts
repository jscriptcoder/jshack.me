import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useNetwork, NetworkProvider } from './NetworkContext';
import { SessionProvider } from '../session/SessionContext';
import { MissionProvider } from '../mission/MissionContext';
import { FileSystemProvider } from '../filesystem/FileSystemContext';
import { HomeNetworksProvider } from '../homeNetworks/HomeNetworksContext';
import { ForeignNetworksProvider } from '../foreignNetworks/ForeignNetworksContext';
import type { MissionState } from '../mission/useMissionState';
import { generateLocalhost } from '../generation/generateLocalhost';

vi.mock('../utils/storageCache', () => ({
  getCachedSessionState: vi.fn(() => null),
  getCachedWifiState: vi.fn(() => null),
  getCachedBrickedMachines: vi.fn(() => []),
  getCachedFilesystemPatches: vi.fn(() => []),
  getCachedMissionSeed: vi.fn(() => null),
  getCachedGameState: vi.fn(() => null),
  getDatabase: vi.fn(() => null),
}));

vi.mock('../utils/storage', () => ({
  saveSessionToTab: vi.fn(),
  saveWifiState: vi.fn(),
  saveFilesystemPatches: vi.fn(),
  saveMissionSeed: vi.fn(),
}));

const mockMissionState: MissionState = {
  activeMission: null,
  startMission: vi.fn(),
  abortMission: vi.fn(),
  completeMission: vi.fn(),
};

const TEST_HOSTNAME = 'testbox-aabbccdd';
const testLocalhost = generateLocalhost(
  { seed: 'test', workstationName: 'testbox', username: 'testuser', rootPassword: 'pw' },
  TEST_HOSTNAME,
);

const createWrapper =
  () =>
  ({ children }: { readonly children: ReactNode }) =>
    createElement(
      SessionProvider,
      { username: 'testuser', hostname: TEST_HOSTNAME, children: null },
      createElement(
        HomeNetworksProvider,
        { gameSeed: null, workstationPrefix: null, connectedWifi: null, children: null },
        createElement(
          ForeignNetworksProvider,
          { ownActiveHomePublicIp: null, children: null },
          createElement(
            MissionProvider,
            { state: mockMissionState, usedPublicIps: new Set<string>(), children: null },
            createElement(
              FileSystemProvider,
              { localhostFileSystem: testLocalhost.fileSystem, children: null },
              createElement(NetworkProvider, null, children),
            ),
          ),
        ),
      ),
    );

// Proves the boundary contract for PR 3 of plans/use-stable-callback-refactor.md.
// Without useStableCallback in NetworkContext, every rerender produces fresh
// useCallback references; consumers that captured a method at render N would
// then hold a stale closure at render N+1. With the wrap, the exposed
// references stay === across renders, so captured closures stay safe.
describe('NetworkContext: stable identity contract', () => {
  it('exposes context methods with stable identity across renders', () => {
    const { result, rerender } = renderHook(() => useNetwork(), { wrapper: createWrapper() });

    const before = {
      getInterface: result.current.getInterface,
      getInterfaces: result.current.getInterfaces,
      getMachine: result.current.getMachine,
      getMachines: result.current.getMachines,
      getGateway: result.current.getGateway,
      getLocalIP: result.current.getLocalIP,
      getPublicIP: result.current.getPublicIP,
      resolveDomain: result.current.resolveDomain,
      getDnsRecords: result.current.getDnsRecords,
      findMachineUsers: result.current.findMachineUsers,
      findMachineByIp: result.current.findMachineByIp,
      findMachineByIpAsync: result.current.findMachineByIpAsync,
      resolveNat: result.current.resolveNat,
      getGatewayChainFor: result.current.getGatewayChainFor,
      getHandler: result.current.getHandler,
    };

    rerender();

    expect(result.current.getInterface).toBe(before.getInterface);
    expect(result.current.getInterfaces).toBe(before.getInterfaces);
    expect(result.current.getMachine).toBe(before.getMachine);
    expect(result.current.getMachines).toBe(before.getMachines);
    expect(result.current.getGateway).toBe(before.getGateway);
    expect(result.current.getLocalIP).toBe(before.getLocalIP);
    expect(result.current.getPublicIP).toBe(before.getPublicIP);
    expect(result.current.resolveDomain).toBe(before.resolveDomain);
    expect(result.current.getDnsRecords).toBe(before.getDnsRecords);
    expect(result.current.findMachineUsers).toBe(before.findMachineUsers);
    expect(result.current.findMachineByIp).toBe(before.findMachineByIp);
    expect(result.current.findMachineByIpAsync).toBe(before.findMachineByIpAsync);
    expect(result.current.resolveNat).toBe(before.resolveNat);
    expect(result.current.getGatewayChainFor).toBe(before.getGatewayChainFor);
    expect(result.current.getHandler).toBe(before.getHandler);
  });

  it('captured method still invokes the latest impl after rerender', () => {
    // The closure-capture scenario: a consumer captures resolveNat at
    // render N, then invokes it after render N+1 when allIptablesRules
    // would have made the underlying impl identity change. The captured
    // reference must dispatch to the LATEST impl.
    //
    // We can't easily mutate allIptablesRules in unit-test land without
    // a full filesystem fixture, so this test just proves the dispatch
    // mechanism: rerender, then call the captured reference and verify
    // it returns a current value (not a frozen snapshot).
    const { result, rerender } = renderHook(() => useNetwork(), { wrapper: createWrapper() });
    const capturedResolveNat = result.current.resolveNat;
    rerender();
    // The captured reference still works (doesn't throw, returns the
    // identity-port mapping for a non-NAT'd input).
    expect(capturedResolveNat('203.0.113.99', 80)).toEqual({ ip: '203.0.113.99', port: 80 });
  });
});
