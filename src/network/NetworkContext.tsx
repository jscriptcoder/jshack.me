import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';
import type {
  NetworkConfig,
  MachineNetworkConfig,
  NetworkInterface,
  RemoteMachine,
  DnsRecord,
} from './types';
import type { GeneratedMachine, NatForwarding } from '../generation/types';
import { createInitialNetwork, localhostDisconnectedInterfaces } from './initialNetwork';
import { useSession } from '../session/SessionContext';

type NetworkContextType = {
  readonly config: NetworkConfig;
  readonly getInterface: (name: string) => NetworkInterface | undefined;
  readonly getInterfaces: () => readonly NetworkInterface[];
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getMachines: () => readonly RemoteMachine[];
  readonly getGateway: () => string;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly getDnsRecords: () => readonly DnsRecord[];
  readonly findMachineUsers: (ip: string) => readonly string[];
  readonly resolveNat: (ip: string) => string;
};

const NetworkContext = createContext<NetworkContextType | null>(null);

const defaultMachineConfig: MachineNetworkConfig = {
  interfaces: [],
  machines: [],
  dnsRecords: [],
};

type NetworkProviderProps = {
  readonly children: ReactNode;
  readonly missionNetworkConfig?: NetworkConfig;
  readonly missionMachines?: readonly GeneratedMachine[];
  readonly missionNatForwarding?: NatForwarding;
  readonly missionRouterMachine?: GeneratedMachine;
};

export const NetworkProvider = ({
  children,
  missionNetworkConfig,
  missionMachines,
  missionNatForwarding,
  missionRouterMachine,
}: NetworkProviderProps) => {
  const [config] = useState<NetworkConfig>(createInitialNetwork);
  const { session, wifiConnected } = useSession();

  const isLocalhostDisconnected = session.machine === 'localhost' && !wifiConnected;

  // Multi-tier network config resolution for the current machine:
  // 1. Mission config (if on a mission-generated machine)
  // 2. Static config (tutorial machines)
  // 3. WiFi gating (localhost with WiFi off → disconnected interfaces, no machines)
  // 4. Localhost with active mission → only router is visible from localhost
  //    (internal machines are behind the router)
  const currentConfig = useMemo((): MachineNetworkConfig => {
    const missionConfig = missionNetworkConfig?.machineConfigs[session.machine];
    if (missionConfig) return missionConfig;

    const base = config.machineConfigs[session.machine] ?? defaultMachineConfig;

    if (isLocalhostDisconnected) {
      return {
        interfaces: localhostDisconnectedInterfaces,
        machines: [],
        dnsRecords: [],
      };
    }

    if (session.machine === 'localhost' && missionNetworkConfig && missionRouterMachine) {
      // From localhost, only the router's public IP is reachable.
      // In forwarded mode, the router appears to have the entry machine's ports/users.
      const routerRemote: RemoteMachine = missionNatForwarding
        ? buildForwardedRouterMachine(
            missionRouterMachine,
            missionMachines ?? [],
            missionNatForwarding,
          )
        : missionRouterMachine.remoteMachine;

      // External DNS: only router's public IP
      const externalDns: readonly DnsRecord[] = [
        {
          domain: `${missionRouterMachine.hostname}.mission`,
          ip: missionRouterMachine.ip,
          type: 'A' as const,
        },
      ];

      return {
        ...base,
        machines: [...base.machines, routerRemote],
        dnsRecords: [...base.dnsRecords, ...externalDns],
      };
    }

    return base;
  }, [
    config.machineConfigs,
    session.machine,
    isLocalhostDisconnected,
    missionNetworkConfig,
    missionMachines,
    missionNatForwarding,
    missionRouterMachine,
  ]);

  const getInterface = useCallback(
    (name: string): NetworkInterface | undefined => {
      return currentConfig.interfaces.find((iface) => iface.name === name);
    },
    [currentConfig.interfaces],
  );

  const getInterfaces = useCallback((): readonly NetworkInterface[] => {
    return currentConfig.interfaces;
  }, [currentConfig.interfaces]);

  const getMachine = useCallback(
    (ip: string): RemoteMachine | undefined => {
      return currentConfig.machines.find((machine) => machine.ip === ip);
    },
    [currentConfig.machines],
  );

  const getMachines = useCallback((): readonly RemoteMachine[] => {
    return currentConfig.machines;
  }, [currentConfig.machines]);

  const getGateway = useCallback((): string => {
    const primary = currentConfig.interfaces.find(
      (iface) => iface.name !== 'lo' && iface.flags.includes('UP'),
    );
    return primary?.gateway ?? '0.0.0.0';
  }, [currentConfig.interfaces]);

  const getLocalIP = useCallback((): string => {
    const primary = currentConfig.interfaces.find(
      (iface) => iface.name !== 'lo' && iface.flags.includes('UP'),
    );
    return primary?.inet ?? '0.0.0.0';
  }, [currentConfig.interfaces]);

  const resolveDomain = useCallback(
    (domain: string): DnsRecord | undefined => {
      const normalizedDomain = domain.toLowerCase();
      return currentConfig.dnsRecords.find(
        (record) => record.domain.toLowerCase() === normalizedDomain,
      );
    },
    [currentConfig.dnsRecords],
  );

  const getDnsRecords = useCallback((): readonly DnsRecord[] => {
    return currentConfig.dnsRecords;
  }, [currentConfig.dnsRecords]);

  // Searches for users by IP across both static and mission networks.
  // Needed by `su` to validate user names on any machine (tutorial or mission-generated).
  // The router is a special case: it's a key in machineConfigs but never listed in any
  // config's .machines array, so we check missionRouterMachine separately.
  const findMachineUsers = useCallback(
    (ip: string): readonly string[] => {
      const searchConfigs = (networkConfig: NetworkConfig): readonly string[] => {
        const found = Object.values(networkConfig.machineConfigs)
          .flatMap((mc) => mc.machines)
          .find((m) => m.ip === ip);
        return found ? found.users.map((u) => u.username) : [];
      };

      const staticUsers = searchConfigs(config);
      if (staticUsers.length > 0) return staticUsers;

      if (missionNetworkConfig) {
        const missionUsers = searchConfigs(missionNetworkConfig);
        if (missionUsers.length > 0) return missionUsers;
      }

      // Router is never in any machineConfigs[*].machines array — it's only a key.
      // Check it directly so `su` works when SSH'd into the router.
      if (missionRouterMachine && missionRouterMachine.ip === ip) {
        return missionRouterMachine.remoteMachine.users.map((u) => u.username);
      }

      return [];
    },
    [config, missionNetworkConfig, missionRouterMachine],
  );

  // NAT resolution: translates the router's public IP to the internal entry machine IP
  // when port forwarding is active. Identity function otherwise.
  const resolveNat = useCallback(
    (ip: string): string => {
      if (missionNatForwarding && ip === missionNatForwarding.publicIp) {
        return missionNatForwarding.internalIp;
      }
      return ip;
    },
    [missionNatForwarding],
  );

  return (
    <NetworkContext.Provider
      value={{
        config,
        getInterface,
        getInterfaces,
        getMachine,
        getMachines,
        getGateway,
        getLocalIP,
        resolveDomain,
        getDnsRecords,
        findMachineUsers,
        resolveNat,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
};

// In forwarded mode, the router appears from localhost as having the entry machine's
// ports and users, so `ssh("guest", routerPublicIp)` transparently connects to the
// internal entry machine.
const buildForwardedRouterMachine = (
  routerMachine: GeneratedMachine,
  missionMachines: readonly GeneratedMachine[],
  natForwarding: NatForwarding,
): RemoteMachine => {
  const entryMachine = missionMachines.find((m) => m.ip === natForwarding.internalIp);
  if (!entryMachine) return routerMachine.remoteMachine;

  return {
    ip: routerMachine.ip,
    hostname: routerMachine.hostname,
    ports: entryMachine.remoteMachine.ports,
    users: entryMachine.remoteMachine.users,
  };
};

export const useNetwork = (): NetworkContextType => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};
