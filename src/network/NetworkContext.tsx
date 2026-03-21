import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';
import type {
  NetworkConfig,
  MachineNetworkConfig,
  NetworkInterface,
  RemoteMachine,
  RemoteUser,
  DnsRecord,
} from './types';
import type { GeneratedMachine, NatForwardingRule } from '../generation/types';
import {
  createInitialNetwork,
  localhostDisconnectedInterfaces,
  localhostWlan0Down,
} from './initialNetwork';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import { useSession } from '../session/SessionContext';
import { useFileSystem } from '../filesystem';
import { parseIptablesRules } from './iptablesParser';
import { parseSnmpFirewallConfig } from './snmpFirewallParser';
import type { SnmpFirewallOverride } from './snmpFirewallParser';
import { parseSshdState } from './sshdStateParser';
import { parseFtpdState } from './ftpdStateParser';
import { parseNcPidFiles } from './ncStateParser';
import { SSH_PID_FILE_PATH } from '../commands/sshd';
import { FTP_PID_FILE_PATH } from '../commands/ftpd';
import { ipToMachineId } from '../filesystem/machineFileSystems';
import {
  buildMergedRouterView,
  applySnmpFirewallOverrides,
  applyDaemonOverrides,
} from './networkUtils';

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
  readonly homeNetwork?: HomeNetwork | null;
};

export const NetworkProvider = ({
  children,
  missionNetworkConfig,
  missionMachines,
  missionRouterMachine,
  homeNetwork,
}: NetworkProviderProps) => {
  const [config] = useState<NetworkConfig>(createInitialNetwork);
  const { session, wifiConnected } = useSession();
  const { getNodeFromMachine } = useFileSystem();

  const isLocalhostDisconnected = session.machine === 'localhost' && !wifiConnected;

  // Dynamic iptables rules: read and parse /etc/iptables/rules.v4 from the
  // router's filesystem on every render. When the player edits the file with
  // nano, the filesystem state updates, triggering re-render and re-parse.
  const iptablesRules = useMemo((): readonly NatForwardingRule[] => {
    if (!missionRouterMachine) return [];
    const node = getNodeFromMachine(missionRouterMachine.ip, '/etc/iptables/rules.v4', '/');
    if (!node || node.type !== 'file' || !node.content) return [];
    return parseIptablesRules(node.content);
  }, [missionRouterMachine, getNodeFromMachine]);

  // Dynamic SNMP firewall rules: read and parse /etc/snmp/snmpd.conf from the
  // router's filesystem. When the player runs snmpset to modify firewall OIDs,
  // the filesystem state updates, triggering re-render and re-parse.
  const snmpFirewallOverrides = useMemo((): readonly SnmpFirewallOverride[] => {
    if (!missionRouterMachine) return [];
    const node = getNodeFromMachine(missionRouterMachine.ip, '/etc/snmp/snmpd.conf', '/');
    if (!node || node.type !== 'file' || !node.content) return [];
    return parseSnmpFirewallConfig(node.content);
  }, [missionRouterMachine, getNodeFromMachine]);

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
  // 3. Static config (tutorial/fallback machines)
  // 4. WiFi gating (localhost with WiFi off → disconnected interfaces, no machines)
  // 5. Localhost with active mission → mission router visible from localhost
  const baseConfig = useMemo((): MachineNetworkConfig => {
    const missionConfig = missionNetworkConfig?.machineConfigs[session.machine];
    if (missionConfig) return missionConfig;

    // Home network machine (SSH'd into a generated machine)
    const homeConfig = homeNetwork?.networkConfig.machineConfigs[session.machine];
    if (homeConfig) return homeConfig;

    const base = config.machineConfigs[session.machine] ?? defaultMachineConfig;

    if (isLocalhostDisconnected) {
      return {
        interfaces: localhostDisconnectedInterfaces,
        machines: [],
        dnsRecords: [],
      };
    }

    // Localhost with home network connected — show home network machines
    if (session.machine === 'localhost' && homeNetwork && localhostHomeInterfaces) {
      const homeMachines = homeNetwork.machines.map((m) => m.remoteMachine);
      // Include the router as a reachable machine from localhost
      const routerRemote: RemoteMachine = {
        ip: homeNetwork.router.internalIp,
        hostname: homeNetwork.router.hostname,
        ports: [
          { port: 22, service: 'ssh', open: true },
          { port: 80, service: 'http', open: true },
        ],
        users: [],
      };
      const homeBase: MachineNetworkConfig = {
        interfaces: localhostHomeInterfaces,
        machines: [...homeMachines, routerRemote],
        dnsRecords:
          homeNetwork.networkConfig.machineConfigs[homeNetwork.machines[0]?.ip ?? '']?.dnsRecords ??
          [],
      };

      // If mission is active, also make mission router visible from localhost
      if (missionNetworkConfig && missionRouterMachine) {
        const baseRouterRemote: RemoteMachine =
          iptablesRules.length > 0
            ? buildMergedRouterView(missionRouterMachine, missionMachines ?? [], iptablesRules)
            : missionRouterMachine.remoteMachine;
        const routerRemoteFinal: RemoteMachine =
          snmpFirewallOverrides.length > 0
            ? applySnmpFirewallOverrides(baseRouterRemote, snmpFirewallOverrides)
            : baseRouterRemote;
        const externalDns: readonly DnsRecord[] = [
          {
            domain: `${missionRouterMachine.hostname}.mission`,
            ip: missionRouterMachine.ip,
            type: 'A' as const,
          },
        ];
        return {
          ...homeBase,
          machines: [...homeBase.machines, routerRemoteFinal],
          dnsRecords: [...homeBase.dnsRecords, ...externalDns],
        };
      }

      return homeBase;
    }

    if (session.machine === 'localhost' && missionNetworkConfig && missionRouterMachine) {
      // From localhost, only the router's public IP is reachable.
      // When iptables has forwarding rules, the router shows its own ports +
      // forwarded ports and merged users (so SSH user check works before NAT).
      // Rules come from the filesystem dynamically — player edits with nano.
      const baseRouterRemote: RemoteMachine =
        iptablesRules.length > 0
          ? buildMergedRouterView(missionRouterMachine, missionMachines ?? [], iptablesRules)
          : missionRouterMachine.remoteMachine;

      // Apply SNMP firewall overrides (snmpset changes port open/closed state)
      const routerRemote: RemoteMachine =
        snmpFirewallOverrides.length > 0
          ? applySnmpFirewallOverrides(baseRouterRemote, snmpFirewallOverrides)
          : baseRouterRemote;

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
    iptablesRules,
    snmpFirewallOverrides,
    missionRouterMachine,
    homeNetwork,
    localhostHomeInterfaces,
  ]);

  // Dynamic daemon state: for each machine, check if sshd/ftpd pid files exist
  // and apply port overrides. This enables dynamic port opening when the player
  // starts daemons from an NC shell (same pattern as SNMP firewall overrides).
  const currentConfig = useMemo((): MachineNetworkConfig => {
    const machines = baseConfig.machines.map((machine) => {
      // Resolve IP to filesystem machine ID (localhost uses "localhost" as ID, not its IP)
      const fsId = ipToMachineId[machine.ip] ?? machine.ip;

      let result = machine;

      // sshd state
      const sshdNode = getNodeFromMachine(fsId, SSH_PID_FILE_PATH, '/');
      if (sshdNode?.type === 'file' && sshdNode.content) {
        const overrides = parseSshdState(sshdNode.content);
        if (overrides.length > 0) result = applyDaemonOverrides(result, overrides);
      }

      // ftpd state
      const ftpdNode = getNodeFromMachine(fsId, FTP_PID_FILE_PATH, '/');
      if (ftpdNode?.type === 'file' && ftpdNode.content) {
        const overrides = parseFtpdState(ftpdNode.content);
        if (overrides.length > 0) result = applyDaemonOverrides(result, overrides);
      }

      // nc listener state — scan /var/run/ for nc-*.pid files
      const varRunNode = getNodeFromMachine(fsId, '/var/run', '/');
      const ncOverrides = parseNcPidFiles(varRunNode);
      if (ncOverrides.length > 0) result = applyDaemonOverrides(result, ncOverrides);

      return result;
    });
    return machines === baseConfig.machines ? baseConfig : { ...baseConfig, machines };
  }, [baseConfig, getNodeFromMachine]);

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

      const staticUsers = searchConfigs(config);
      if (staticUsers.length > 0) return staticUsers;

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

      return [];
    },
    [config, homeNetwork, missionNetworkConfig, missionRouterMachine],
  );

  // Port-aware NAT resolution: translates the router's public IP + port to the
  // internal machine IP + port based on iptables rules parsed from the router's
  // filesystem. Rules are dynamic — editing /etc/iptables/rules.v4 with nano
  // takes effect on the next connection/scan.
  const resolveNat = useCallback(
    (ip: string, port: number): { readonly ip: string; readonly port: number } => {
      if (missionRouterMachine && ip === missionRouterMachine.ip) {
        const rule = iptablesRules.find((r) => r.publicPort === port);
        if (rule) return { ip: rule.internalIp, port: rule.internalPort };
      }
      return { ip, port };
    },
    [missionRouterMachine, iptablesRules],
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
