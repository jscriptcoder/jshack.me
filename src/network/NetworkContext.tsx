import { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import type {
  NetworkConfig,
  MachineNetworkConfig,
  NetworkInterface,
  RemoteMachine,
  RemoteUser,
  DnsRecord,
} from './types';
import type { GeneratedMachine, NatForwardingRule, SubnetLayer } from '../generation/types';
import { localhostDisconnectedInterfaces, localhostWlan0Down } from './initialNetwork';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import { useSession } from '../session/SessionContext';
import { useFileSystem } from '../filesystem';
import { parseIptablesRules } from './iptablesParser';
import { parseSnmpFirewallConfig } from './snmpFirewallParser';
import type { SnmpFirewallOverride } from './snmpFirewallParser';
import {
  collectGatewayIps,
  buildGatewayAliasMap,
  buildRouterRemoteView,
  applyDynamicOverrides,
  type DynamicOverrideContext,
} from './networkUtils';

type NetworkContextType = {
  readonly getInterface: (name: string) => NetworkInterface | undefined;
  readonly getInterfaces: () => readonly NetworkInterface[];
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getMachines: () => readonly RemoteMachine[];
  readonly getGateway: () => string;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly getDnsRecords: () => readonly DnsRecord[];
  readonly findMachineUsers: (ip: string) => readonly RemoteUser[];
  readonly getPublicIP: () => string | null;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
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
  readonly missionRouterMachine?: GeneratedMachine;
  readonly missionLayers?: readonly SubnetLayer[];
  readonly homeNetwork?: HomeNetwork | null;
};

export const NetworkProvider = ({
  children,
  missionNetworkConfig,
  missionMachines,
  missionRouterMachine,
  missionLayers,
  homeNetwork,
}: NetworkProviderProps) => {
  const { session, wifiConnected } = useSession();
  const { getNodeFromMachine } = useFileSystem();

  const isLocalhostDisconnected = session.machine === 'localhost' && !wifiConnected;

  const gatewayIps = useMemo(
    () => collectGatewayIps(missionRouterMachine, missionLayers, homeNetwork),
    [missionRouterMachine, missionLayers, homeNetwork],
  );

  const homeGatewayByAliasIp = useMemo(() => buildGatewayAliasMap(homeNetwork), [homeNetwork]);

  // Dynamic iptables rules: read and parse /etc/iptables/rules.v4 from all
  // gateway filesystems. When the player edits a file with nano, the filesystem
  // state updates, triggering re-render and re-parse.
  const allIptablesRules = useMemo((): ReadonlyMap<string, readonly NatForwardingRule[]> => {
    const map = new Map<string, readonly NatForwardingRule[]>();
    gatewayIps.forEach((ip) => {
      const node = getNodeFromMachine(ip, '/etc/iptables/rules.v4', '/');
      if (node?.type === 'file' && node.content) {
        const rules = parseIptablesRules(node.content);
        if (rules.length > 0) map.set(ip, rules);
      }
    });
    return map;
  }, [gatewayIps, getNodeFromMachine]);

  // Backward-compatible: border router iptables rules used in baseConfig
  const iptablesRules = allIptablesRules.get(missionRouterMachine?.ip ?? '') ?? [];

  // Dynamic SNMP firewall rules: read and parse /etc/snmp/snmpd.conf from all
  // gateway filesystems. When the player runs snmpset to modify firewall OIDs,
  // the filesystem state updates, triggering re-render and re-parse.
  const allSnmpOverrides = useMemo((): ReadonlyMap<string, readonly SnmpFirewallOverride[]> => {
    const map = new Map<string, readonly SnmpFirewallOverride[]>();
    gatewayIps.forEach((ip) => {
      const node = getNodeFromMachine(ip, '/etc/snmp/snmpd.conf', '/');
      if (node?.type === 'file' && node.content) {
        const overrides = parseSnmpFirewallConfig(node.content);
        if (overrides.length > 0) map.set(ip, overrides);
      }
    });
    return map;
  }, [gatewayIps, getNodeFromMachine]);

  // Backward-compatible: border router SNMP overrides used in baseConfig
  const snmpFirewallOverrides = allSnmpOverrides.get(missionRouterMachine?.ip ?? '') ?? [];

  // Dynamic localhost wlan0 interface based on home network subnet
  const localhostHomeInterfaces = useMemo((): readonly NetworkInterface[] | null => {
    if (!homeNetwork) return null;
    const loopback: NetworkInterface = {
      name: 'lo',
      flags: ['UP', 'LOOPBACK', 'RUNNING'],
      inet: '127.0.0.1',
      netmask: '255.0.0.0',
      gateway: '0.0.0.0',
      mac: '00:00:00:00:00:00',
    };
    const wlan0: NetworkInterface = {
      name: 'wlan0',
      flags: ['UP', 'BROADCAST', 'RUNNING', 'MULTICAST'],
      inet: homeNetwork.localhostIp,
      netmask: '255.255.255.0',
      gateway: homeNetwork.router.internalIp,
      mac: localhostWlan0Down.mac,
    };
    return [loopback, wlan0];
  }, [homeNetwork]);

  // Multi-tier network config resolution for the current machine:
  // 1. Mission config (if on a mission-generated machine)
  // 2. Home network config (if on a home network machine)
  // 3. Localhost with home network → home network machines + optional mission router
  // 4. Localhost disconnected → disconnected interfaces, no machines
  const baseConfig = useMemo((): MachineNetworkConfig => {
    const missionConfig = missionNetworkConfig?.machineConfigs[session.machine];
    if (missionConfig) return missionConfig;

    // Home network machine (SSH'd into a generated machine)
    const homeConfig = homeNetwork?.networkConfig.machineConfigs[session.machine];
    if (homeConfig) return homeConfig;

    if (isLocalhostDisconnected) {
      return {
        interfaces: localhostDisconnectedInterfaces,
        machines: [],
        dnsRecords: [],
      };
    }

    // Localhost with home network connected — show layer 0 machines only.
    // Deeper layers are reached by pivoting through gateways.
    if (session.machine === 'localhost' && homeNetwork && localhostHomeInterfaces) {
      // Grab a layer 0 machine's config — it already has the right visibility
      // (layer 0 peers + router at .1 + inner gateway if multi-layer).
      const layer0 = homeNetwork.layers[0];
      const sampleIp = layer0?.machines[0]?.ip ?? '';
      const sampleConfig = homeNetwork.networkConfig.machineConfigs[sampleIp];

      // Localhost sees everything the sample machine sees, plus the sample machine itself
      const sampleMachine = homeNetwork.machines.find((m) => m.ip === sampleIp);
      const visibleMachines = sampleConfig
        ? [...sampleConfig.machines, ...(sampleMachine ? [sampleMachine.remoteMachine] : [])]
        : [];

      const homeBase: MachineNetworkConfig = {
        interfaces: localhostHomeInterfaces,
        machines: visibleMachines,
        dnsRecords: sampleConfig?.dnsRecords ?? [],
      };

      // If mission is active, also make mission router visible from localhost
      if (missionNetworkConfig && missionRouterMachine) {
        const routerRemote = buildRouterRemoteView(
          missionRouterMachine,
          missionMachines ?? [],
          iptablesRules,
          snmpFirewallOverrides,
        );
        const externalDns: readonly DnsRecord[] = [
          {
            domain: `${missionRouterMachine.hostname}.mission`,
            ip: missionRouterMachine.ip,
            type: 'A' as const,
          },
        ];
        return {
          ...homeBase,
          machines: [...homeBase.machines, routerRemote],
          dnsRecords: [...homeBase.dnsRecords, ...externalDns],
        };
      }

      return homeBase;
    }

    // Localhost with mission but no WiFi — mission router visible
    if (session.machine === 'localhost' && missionNetworkConfig && missionRouterMachine) {
      const routerRemote = buildRouterRemoteView(
        missionRouterMachine,
        missionMachines ?? [],
        iptablesRules,
        snmpFirewallOverrides,
      );
      const externalDns: readonly DnsRecord[] = [
        {
          domain: `${missionRouterMachine.hostname}.mission`,
          ip: missionRouterMachine.ip,
          type: 'A' as const,
        },
      ];
      return {
        interfaces: localhostDisconnectedInterfaces,
        machines: [routerRemote],
        dnsRecords: externalDns,
      };
    }

    return defaultMachineConfig;
  }, [
    session.machine,
    isLocalhostDisconnected,
    missionNetworkConfig,
    missionMachines,
    iptablesRules,
    snmpFirewallOverrides,
    missionRouterMachine,
    homeNetwork,
    localhostHomeInterfaces,
  ]);

  // Dynamic overrides: for each visible machine, apply gateway enhancements
  // (NAT merged view, SNMP firewall) and daemon state (sshd, ftpd, nc).
  const overrideCtx = useMemo(
    (): DynamicOverrideContext => ({
      allIptablesRules,
      allSnmpOverrides,
      missionMachines,
      homeMachines: homeNetwork?.machines,
      homeGatewayByAliasIp,
      readNode: getNodeFromMachine,
    }),
    [
      allIptablesRules,
      allSnmpOverrides,
      missionMachines,
      homeNetwork,
      homeGatewayByAliasIp,
      getNodeFromMachine,
    ],
  );

  const currentConfig = useMemo(
    (): MachineNetworkConfig => ({
      ...baseConfig,
      machines: baseConfig.machines.map((m) => applyDynamicOverrides(m, overrideCtx)),
    }),
    [baseConfig, overrideCtx],
  );

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

  // Public IP: the home router's public-facing IP, used as the source address
  // when connecting from localhost to machines outside the home subnet (NAT).
  const getPublicIP = useCallback((): string | null => {
    if (!homeNetwork) return null;
    return homeNetwork.router.publicIp;
  }, [homeNetwork]);

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
    (ip: string): readonly RemoteUser[] => {
      const searchConfigs = (networkConfig: NetworkConfig): readonly RemoteUser[] => {
        const found = Object.values(networkConfig.machineConfigs)
          .flatMap((mc) => mc.machines)
          .find((m) => m.ip === ip);
        return found ? found.users : [];
      };

      if (homeNetwork) {
        const homeUsers = searchConfigs(homeNetwork.networkConfig);
        if (homeUsers.length > 0) return homeUsers;
      }

      if (missionNetworkConfig) {
        const missionUsers = searchConfigs(missionNetworkConfig);
        if (missionUsers.length > 0) return missionUsers;
      }

      // Router is never in any machineConfigs[*].machines array — it's only a key.
      // Check it directly so `su` works when SSH'd into the router.
      if (missionRouterMachine && missionRouterMachine.ip === ip) {
        return missionRouterMachine.remoteMachine.users;
      }

      if (homeNetwork?.routerMachine && homeNetwork.routerMachine.ip === ip) {
        return homeNetwork.routerMachine.remoteMachine.users;
      }

      return [];
    },
    [homeNetwork, missionNetworkConfig, missionRouterMachine],
  );

  // Port-aware NAT resolution: translates any gateway's IP + port to the
  // internal machine IP + port based on iptables rules parsed from that
  // gateway's filesystem. Works for both the border router and inner gateways.
  // Rules are dynamic — editing /etc/iptables/rules.v4 with nano takes effect
  // on the next connection/scan.
  const resolveNat = useCallback(
    (ip: string, port: number): { readonly ip: string; readonly port: number } => {
      const rules = allIptablesRules.get(ip);
      if (rules) {
        const rule = rules.find((r) => r.publicPort === port);
        if (rule) return { ip: rule.internalIp, port: rule.internalPort };
      }
      return { ip, port };
    },
    [allIptablesRules],
  );

  return (
    <NetworkContext.Provider
      value={{
        getInterface,
        getInterfaces,
        getMachine,
        getMachines,
        getGateway,
        getLocalIP,
        getPublicIP,
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

export const useNetwork = (): NetworkContextType => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};
