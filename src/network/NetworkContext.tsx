import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';
import type {
  NetworkConfig,
  MachineNetworkConfig,
  NetworkInterface,
  RemoteMachine,
  DnsRecord,
} from './types';
import type { GeneratedMachine } from '../generation/types';
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
};

export const NetworkProvider = ({
  children,
  missionNetworkConfig,
  missionMachines,
}: NetworkProviderProps) => {
  const [config] = useState<NetworkConfig>(createInitialNetwork);
  const { session } = useSession();

  const isLocalhostDisconnected = session.machine === 'localhost' && !session.wifiConnected;

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

    if (session.machine === 'localhost' && missionNetworkConfig) {
      const missionRemoteMachines: readonly RemoteMachine[] = (missionMachines ?? []).map(
        (m) => m.remoteMachine,
      );

      const missionIps = Object.keys(missionNetworkConfig.machineConfigs);
      const missionDns = missionIps.flatMap((ip) => {
        const mc = missionNetworkConfig.machineConfigs[ip];
        return mc ? mc.dnsRecords : [];
      });
      const uniqueDns = missionDns.filter(
        (d, i, arr) => arr.findIndex((x) => x.domain === d.domain) === i,
      );

      return {
        ...base,
        machines: [...base.machines, ...missionRemoteMachines],
        dnsRecords: [...base.dnsRecords, ...uniqueDns],
      };
    }

    return base;
  }, [
    config.machineConfigs,
    session.machine,
    isLocalhostDisconnected,
    missionNetworkConfig,
    missionMachines,
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
        return searchConfigs(missionNetworkConfig);
      }

      return [];
    },
    [config, missionNetworkConfig],
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
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = (): NetworkContextType => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};
