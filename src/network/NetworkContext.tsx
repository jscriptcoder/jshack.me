import { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import type {
  NetworkConfig,
  MachineNetworkConfig,
  NetworkInterface,
  RemoteMachine,
  RemoteUser,
  DnsRecord,
  EffectTier,
  Port,
  VulnerabilityEffect,
} from './types';
import type {
  GeneratedMachine,
  MissionNetwork,
  NatForwardingRule,
  SubnetLayer,
} from '../generation/types';
import type { RequestHandler } from '../themedNetworks/types';
import { localhostDisconnectedInterfaces, localhostWlan0Down } from './initialNetwork';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import type { OccupantSummary } from '../homeNetworks/types';
import { useSession } from '../session/SessionContext';
import { useFileSystem } from '../filesystem';
import {
  buildGatewayCanonicalIpMap,
  isOnLayer0,
  isOwnWorkstation,
  occupantAwareReadNode,
} from '../homeNetworks/homeNetworkHelpers';
import { findGatewayChainFor } from './gatewayChain';
import { parseIptablesRules } from './iptablesParser';
import { parseSnmpFirewallConfig } from './snmpFirewallParser';
import type { SnmpFirewallOverride } from './snmpFirewallParser';
import { parseAclRules } from './aclParser';
import type { AclRule } from './aclParser';
import { parseSnmpAclConfig } from './snmpAclParser';
import type { SnmpAclOverride } from './snmpAclParser';
import {
  collectGatewayIps,
  collectWorldGatewayIps,
  buildGatewayAliasMap,
  buildRouterRemoteView,
  buildWorldExternalDnsRecords,
  buildWorldRouterRemoteViews,
  findMachineInWorldNetworks,
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
  readonly findMachineByIp: (ip: string) => RemoteMachine | undefined;
  readonly getPublicIP: () => string | null;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly getGatewayChainFor: (machineIp: string) => readonly GeneratedMachine[];
  // Returns the themed-network request handler for a target machine,
  // or undefined when no handler is registered. Curl uses this to
  // dispatch dynamic HTTP behavior (e.g., findit.io search) before
  // falling back to /var/www/html static files.
  readonly getHandler: (machineIp: string) => RequestHandler | undefined;
};

const NetworkContext = createContext<NetworkContextType | null>(null);

const defaultMachineConfig: MachineNetworkConfig = {
  interfaces: [],
  machines: [],
  dnsRecords: [],
};

// Dev-only debug toggle for cross-player CVE testing. When BOTH
// VITE_DEBUG_VULN_EFFECT and VITE_DEBUG_VULN_TIER are set at build
// time, every LAN occupant renders with a synthetic vulnerable port
// (8080/http) whose `forcedEffect` matches the toggle. This lets one
// player msfconsole another player's workstation against a forced
// effect without needing a real CVE-vulnerable port on the target —
// the workstation otherwise carries no open ports.
//
// Env vars (both required):
//   VITE_DEBUG_VULN_EFFECT — 'file_read' | 'dir_list' | 'shell_full' |
//                            'shell_limited' | 'file_write' |
//                            'password_reset' | 'backdoor_port_open' |
//                            'script_exec'
//   VITE_DEBUG_VULN_TIER   — 'guest' | 'user' | 'root'
//
// Gated by `import.meta.env.DEV` at the call site so Vite folds the
// branch out of production builds entirely — the prod bundle does not
// contain the synthetic-port factory or any reference to it.
//
// Not a security boundary: any client with DevTools can monkey-patch
// arbitrary code, and the threat model already accepts that a forge
// can mint an `effect_one_shot` session at any userType via
// createSession (CVE kinds don't validate against /etc/passwd). This
// toggle is a testing aid for the in-game UI flow, not a defense
// surface. See project_cross_player_base_fs_gap memory for the
// broader threat model.
const VALID_VULN_EFFECT_KINDS = [
  'shell_limited',
  'shell_full',
  'file_read',
  'dir_list',
  'file_write',
  'password_reset',
  'backdoor_port_open',
  'script_exec',
] as const satisfies readonly VulnerabilityEffect['kind'][];

const VALID_VULN_TIERS = ['guest', 'user', 'root'] as const satisfies readonly EffectTier[];

const buildDebugVulnPort = (): Port | null => {
  const effectKind = import.meta.env.VITE_DEBUG_VULN_EFFECT as string | undefined;
  const tierStr = import.meta.env.VITE_DEBUG_VULN_TIER as string | undefined;
  if (!effectKind || !tierStr) return null;

  if (!VALID_VULN_EFFECT_KINDS.includes(effectKind as VulnerabilityEffect['kind'])) {
    console.warn(
      `[debug-vuln-port] unknown VITE_DEBUG_VULN_EFFECT=${effectKind}; valid: ${VALID_VULN_EFFECT_KINDS.join(', ')}`,
    );
    return null;
  }
  if (!VALID_VULN_TIERS.includes(tierStr as EffectTier)) {
    console.warn(
      `[debug-vuln-port] unknown VITE_DEBUG_VULN_TIER=${tierStr}; valid: ${VALID_VULN_TIERS.join(', ')}`,
    );
    return null;
  }

  const tier = tierStr as EffectTier;
  const effect: VulnerabilityEffect =
    effectKind === 'backdoor_port_open'
      ? { kind: 'backdoor_port_open', port: 7777, tier }
      : {
          kind: effectKind as Exclude<VulnerabilityEffect['kind'], 'backdoor_port_open'>,
          tier,
        };

  // owner is required — msfconsole gates exploitable-service check on it
  // (`if (!targetPort.owner) throw 'service not exploitable'`). The
  // username here is purely cosmetic for the synthetic port; the real
  // tier semantics come from `forcedEffect.tier` and the server-side
  // session row.
  return {
    port: 8080,
    service: 'http',
    serviceVersion: 'nginx 1.18.0',
    open: true,
    owner: { username: 'www-data', userType: 'root', homePath: '/var/www' },
    forcedEffect: effect,
  };
};

type NetworkProviderProps = {
  readonly children: ReactNode;
  readonly missionNetworkConfig?: NetworkConfig;
  readonly missionMachines?: readonly GeneratedMachine[];
  readonly missionRouterMachine?: GeneratedMachine;
  readonly missionLayers?: readonly SubnetLayer[];
  readonly homeNetwork?: HomeNetwork | null;
  // World networks: persistent shared content visible to every player.
  // Their routers + inner gateways are appended to the localhost-visible
  // machine list so commands like nmap/ssh/curl can reach them.
  readonly worldNetworks?: ReadonlyArray<MissionNetwork>;
  // Public-IP → request-handler map for themed world networks (search
  // engine, etc.). Built upstream by useWorldNetworks from each row's
  // theme; consumed here to expose getHandler on context for curl
  // dispatch.
  readonly worldHandlers?: ReadonlyMap<string, RequestHandler>;
  // Other players on the active home LAN (excluding self). Each occupant
  // appears as an alive host (closed services — no open ports, no remote
  // login) at `${layer0_subnet}${occupant.lan_ip}` with hostname
  // `occupant.hostname`. Sourced from HomeNetworksProvider's polling.
  readonly lanOccupants?: readonly OccupantSummary[];
};

export const NetworkProvider = ({
  children,
  missionNetworkConfig,
  missionMachines,
  missionRouterMachine,
  missionLayers,
  homeNetwork,
  worldNetworks,
  worldHandlers,
  lanOccupants,
}: NetworkProviderProps) => {
  const { session, wifiConnected, hostname } = useSession();
  const { getNodeFromMachine } = useFileSystem();

  // True when the player is sitting on their own workstation with no
  // active WiFi link — used to render the "no internet" interface set
  // and skip world-router exposure.
  const isOnOwnWorkstation = isOwnWorkstation(session.machine, hostname);
  const isLocalhostDisconnected = isOnOwnWorkstation && !wifiConnected;

  const gatewayIps = useMemo(
    () => [
      ...collectGatewayIps(missionRouterMachine, missionLayers, homeNetwork),
      ...collectWorldGatewayIps(worldNetworks ?? []),
    ],
    [missionRouterMachine, missionLayers, homeNetwork, worldNetworks],
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

  // Backward-compatible: border router iptables rules used in baseConfig.
  // Memoized so the `?? []` fallback doesn't create a fresh reference every render.
  const iptablesRules = useMemo(
    () => allIptablesRules.get(missionRouterMachine?.ip ?? '') ?? [],
    [allIptablesRules, missionRouterMachine],
  );

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

  // Backward-compatible: border router SNMP overrides used in baseConfig.
  // Memoized so the `?? []` fallback doesn't create a fresh reference every render.
  const snmpFirewallOverrides = useMemo(
    () => allSnmpOverrides.get(missionRouterMachine?.ip ?? '') ?? [],
    [allSnmpOverrides, missionRouterMachine],
  );

  // Dynamic ACL rules: read and parse /etc/switch/acl.conf from switch gateways.
  // When the player edits acl.conf with nano, ports on downstream machines open/close.
  const allAclRules = useMemo((): ReadonlyMap<string, readonly AclRule[]> => {
    const map = new Map<string, readonly AclRule[]>();
    gatewayIps.forEach((ip) => {
      const node = getNodeFromMachine(ip, '/etc/switch/acl.conf', '/');
      if (node?.type === 'file' && node.content) {
        const rules = parseAclRules(node.content);
        if (rules.length > 0) map.set(ip, rules);
      }
    });
    return map;
  }, [gatewayIps, getNodeFromMachine]);

  // Dynamic SNMP ACL overrides: read and parse ACL OIDs from switch snmpd.conf.
  // When snmpset changes aclSSH to "allow", the ACL deny for port 22 is overridden.
  const allSnmpAclOverrides = useMemo((): ReadonlyMap<string, readonly SnmpAclOverride[]> => {
    const map = new Map<string, readonly SnmpAclOverride[]>();
    gatewayIps.forEach((ip) => {
      const node = getNodeFromMachine(ip, '/etc/snmp/snmpd.conf', '/');
      if (node?.type === 'file' && node.content) {
        const overrides = parseSnmpAclConfig(node.content);
        if (overrides.length > 0) map.set(ip, overrides);
      }
    });
    return map;
  }, [gatewayIps, getNodeFromMachine]);

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

  // World network routers, NAT/SNMP overlays applied. Computed once and
  // appended to the localhost-visible machine list when the player has
  // any kind of internet reach (with-home or with-mission). Not shown
  // in localhost-disconnected — consistent with "no internet =
  // unreachable public IPs."
  const worldRouterViews = useMemo(
    () => buildWorldRouterRemoteViews(worldNetworks ?? [], allIptablesRules, allSnmpOverrides),
    [worldNetworks, allIptablesRules, allSnmpOverrides],
  );

  // External DNS records for world networks: one A record per network,
  // routerMachine.hostname → routerMachine.ip. Merged into localhost's
  // dnsRecords on every internet-connected branch so `dig findit.io`
  // and `curl http://findit.io` resolve. Skipped on localhost-
  // disconnected for the same "no internet" reason as worldRouterViews.
  const worldExternalDns = useMemo(
    () => buildWorldExternalDnsRecords(worldNetworks ?? []),
    [worldNetworks],
  );

  // LAN-occupant placeholders — one RemoteMachine per player on the
  // active layer-0 subnet, INCLUDING self. HomeNetworksContext filters
  // self out of `lanOccupants` (for other consumers), so we add it back
  // explicitly here. This matches real-Linux behavior — `nmap` of your
  // own LAN subnet sees your own IP alongside everything else — and
  // eliminates a timing race where a refetch before `ownHostname`
  // resolved would intermittently let self through the filter.
  //
  // Built once at the top level so it feeds BOTH the localhost-visible
  // machine list (own-workstation branch in baseConfig below) AND the
  // overlaidOccupants computation that powers home-router NAT forwarding
  // to workstations. Empty when no home network or no layer-0 subnet —
  // harmless overlay miss in branches that don't render occupants.
  const occupantMachines = useMemo((): readonly RemoteMachine[] => {
    const subnet = homeNetwork?.layers[0]?.subnet ?? '';
    if (!subnet) return [];
    const debugVulnPort: Port | null = import.meta.env.DEV ? buildDebugVulnPort() : null;
    const others = (lanOccupants ?? []).map((occupant) => ({
      ip: `${subnet}${occupant.lan_ip}`,
      hostname: occupant.hostname,
      ports: debugVulnPort ? [debugVulnPort] : [],
      users: [],
    }));
    if (!homeNetwork?.localhostIp) return others;
    const selfOccupant: RemoteMachine = {
      ip: homeNetwork.localhostIp,
      hostname,
      ports: debugVulnPort ? [debugVulnPort] : [],
      users: [],
    };
    return [...others, selfOccupant];
  }, [homeNetwork, lanOccupants, hostname]);

  // DNS records for LAN occupants — hostname → LAN IP. Shared by the
  // own-workstation branch and the homeConfig branch (when SSH'd into a
  // layer-0 machine); both need to be able to resolve occupant hostnames.
  const occupantDnsRecords = useMemo(
    (): readonly DnsRecord[] =>
      occupantMachines.map((m) => ({
        domain: m.hostname,
        ip: m.ip,
        type: 'A' as const,
      })),
    [occupantMachines],
  );

  // Multi-tier network config resolution for the current machine:
  // 1. Mission config (if on a mission-generated machine)
  // 2. Home network config (if on a home network machine)
  // 3. Localhost with home network → home network machines + optional mission router + world routers
  // 4. Localhost with mission no home → mission router + world routers
  // 5. Localhost disconnected → disconnected interfaces, no machines (no world routers — no internet)
  const baseConfig = useMemo((): MachineNetworkConfig => {
    const missionConfig = missionNetworkConfig?.machineConfigs[session.machine];
    if (missionConfig) return missionConfig;

    // Home network machine (SSH'd into a generated machine). When on a
    // layer-0 machine — the home router (via internal alias or public
    // IP), any NPC layer-0 box, or an inner gateway's layer-0-facing
    // interface — the LAN's broadcast scope includes player workstations,
    // so we merge them in alongside the static NPC topology.
    // Inner-layer machines (behind a switch/router on a different subnet)
    // skip the merge and see only the static config.
    const homeConfig = homeNetwork?.networkConfig.machineConfigs[session.machine];
    if (homeConfig) {
      const onLayer0 = isOnLayer0(
        session.machine,
        homeNetwork?.layers[0]?.subnet ?? null,
        homeNetwork?.router.publicIp ?? null,
      );
      if (onLayer0) {
        return {
          ...homeConfig,
          machines: [...homeConfig.machines, ...occupantMachines],
          dnsRecords: [...homeConfig.dnsRecords, ...occupantDnsRecords],
        };
      }
      return homeConfig;
    }

    if (isLocalhostDisconnected) {
      return {
        interfaces: localhostDisconnectedInterfaces,
        machines: [],
        dnsRecords: [],
      };
    }

    // Player workstation with home network connected — show layer 0
    // machines only. Deeper layers are reached by pivoting through
    // gateways.
    if (isOnOwnWorkstation && homeNetwork && localhostHomeInterfaces) {
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

      // Other LAN occupants — alive hosts with no statically-stamped open
      // ports (closed-laptop default). Dynamic ports surface via
      // applyDynamicOverrides reading their pid files. occupantMachines
      // and occupantDnsRecords are lifted to the top of the component so
      // the same data feeds the NAT overlay pipeline AND the homeConfig
      // branch's layer-0 visibility merge.
      const homeBase: MachineNetworkConfig = {
        interfaces: localhostHomeInterfaces,
        machines: [...visibleMachines, ...occupantMachines, ...worldRouterViews],
        dnsRecords: [
          ...(sampleConfig?.dnsRecords ?? []),
          ...occupantDnsRecords,
          ...worldExternalDns,
        ],
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
          dnsRecords: [...externalDns, ...homeBase.dnsRecords],
        };
      }

      return homeBase;
    }

    // Player workstation with mission but no WiFi — mission router +
    // world routers visible.
    if (isOnOwnWorkstation && missionNetworkConfig && missionRouterMachine) {
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
        machines: [routerRemote, ...worldRouterViews],
        dnsRecords: [...externalDns, ...worldExternalDns],
      };
    }

    return defaultMachineConfig;
  }, [
    session.machine,
    isOnOwnWorkstation,
    isLocalhostDisconnected,
    missionNetworkConfig,
    missionMachines,
    iptablesRules,
    snmpFirewallOverrides,
    missionRouterMachine,
    homeNetwork,
    localhostHomeInterfaces,
    worldRouterViews,
    worldExternalDns,
    occupantMachines,
    occupantDnsRecords,
  ]);

  // Read-node wrapper that translates LAN-occupant IPs to their
  // canonical workstation_id before reading. Without this, daemon
  // pid-file lookups (sshd, ftpd, nc) on an occupant's LAN IP miss the
  // patches that other players wrote — those patches are stored under
  // the occupant's hostname, not their LAN IP. Symmetric with the
  // logFs translation in useNetworkCommands on the write path.
  // Non-occupant IPs (gateways, mission, world, off-LAN) pass through
  // unchanged.
  const readNodeForOverrides = useMemo(
    () =>
      occupantAwareReadNode(
        getNodeFromMachine,
        lanOccupants ?? [],
        homeNetwork?.layers[0]?.subnet ?? null,
        homeNetwork?.localhostIp ?? null,
        hostname,
        // Gateway-alias canonicalization on the read path. When
        // applyDynamicOverrides renders the .1 view of the home router
        // and calls ctx.readNode('10.0.0.1', '/var/run/sshd.pid', '/'),
        // the lookup must hit the canonical primary IP storage key
        // (where the write path now lands patches). Without this map,
        // reads via .1 see base FS only — patches written by the
        // canonicalized write path are invisible.
        buildGatewayCanonicalIpMap(homeNetwork),
      ),
    [getNodeFromMachine, lanOccupants, homeNetwork, hostname],
  );

  // Base override context — everything except `overlaidOccupants`. Used to
  // overlay occupants themselves (their gateway-NAT branch is a no-op since
  // workstations aren't gateways; the daemon-state branch reads their pid
  // files). Lifting this out lets us compute overlaidOccupants in a
  // separate memo and then feed them into the final overrideCtx without a
  // chicken-and-egg cycle.
  const baseOverrideCtx = useMemo(
    (): DynamicOverrideContext => ({
      allIptablesRules,
      allSnmpOverrides,
      allAclRules,
      allSnmpAclOverrides,
      missionMachines,
      missionLayers,
      homeMachines: homeNetwork?.machines,
      homeLayers: homeNetwork?.layers,
      worldNetworks: worldNetworks?.map((wn) => ({
        machines: wn.machines,
        layers: wn.layers,
      })),
      homeGatewayByAliasIp,
      readNode: readNodeForOverrides,
    }),
    [
      allIptablesRules,
      allSnmpOverrides,
      allAclRules,
      allSnmpAclOverrides,
      missionMachines,
      missionLayers,
      homeNetwork,
      worldNetworks,
      homeGatewayByAliasIp,
      readNodeForOverrides,
    ],
  );

  // Overlay each occupant's pid-file-driven port state. Feeds the
  // home-gateway NAT merge so player-edited iptables forward rules
  // targeting a workstation resolve to the workstation's actual open
  // ports. applyDynamicOverrides is idempotent for non-gateway machines,
  // so the same occupant overlayed twice (here + in currentConfig below)
  // produces the same result.
  const overlaidOccupants = useMemo(
    (): readonly RemoteMachine[] =>
      occupantMachines.map((m) => applyDynamicOverrides(m, baseOverrideCtx)),
    [occupantMachines, baseOverrideCtx],
  );

  // Dynamic overrides: for each visible machine, apply gateway enhancements
  // (NAT merged view, SNMP firewall) and daemon state (sshd, ftpd, nc).
  // The home-gateway branch uses `overlaidOccupants` to resolve forward
  // rules pointing at workstation occupants.
  const overrideCtx = useMemo(
    (): DynamicOverrideContext => ({
      ...baseOverrideCtx,
      overlaidOccupants,
    }),
    [baseOverrideCtx, overlaidOccupants],
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

      // Search world networks. Without this, SSH/SCP/FTP/MySQL auth on
      // a world machine bails early — validateAgainstEtcPasswd looks up
      // the user via findMachineUsers, returns [] for unknown IPs,
      // fails the lookup, and rejects the password before even reading
      // /etc/passwd. Mirrors the world-network branch in findMachineByIp.
      const worldMatch = findMachineInWorldNetworks(ip, worldNetworks ?? []);
      if (worldMatch) return worldMatch.users;

      return [];
    },
    [homeNetwork, missionNetworkConfig, missionRouterMachine, worldNetworks],
  );

  // Searches for a machine by IP across all network configs (home +
  // mission + world). Unlike getMachine which only returns machines
  // visible from the current position, this searches globally — needed
  // for NAT-forwarded SSH where the resolved target is behind a gateway
  // and not directly visible.
  const findMachineByIp = useCallback(
    (ip: string): RemoteMachine | undefined => {
      const searchConfigs = (networkConfig: NetworkConfig): RemoteMachine | undefined =>
        Object.values(networkConfig.machineConfigs)
          .flatMap((mc) => mc.machines)
          .find((m) => m.ip === ip);

      if (homeNetwork) {
        const found = searchConfigs(homeNetwork.networkConfig);
        if (found) return found;
      }

      if (missionNetworkConfig) {
        const found = searchConfigs(missionNetworkConfig);
        if (found) return found;
      }

      if (missionRouterMachine && missionRouterMachine.ip === ip) {
        return missionRouterMachine.remoteMachine;
      }

      if (homeNetwork?.routerMachine && homeNetwork.routerMachine.ip === ip) {
        return homeNetwork.routerMachine.remoteMachine;
      }

      const worldMatch = findMachineInWorldNetworks(ip, worldNetworks ?? []);
      if (worldMatch) return worldMatch;

      return undefined;
    },
    [homeNetwork, missionNetworkConfig, missionRouterMachine, worldNetworks],
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

  const getGatewayChainFor = useCallback(
    (machineIp: string): readonly GeneratedMachine[] =>
      findGatewayChainFor(machineIp, missionLayers),
    [missionLayers],
  );

  const getHandler = useCallback(
    (machineIp: string): RequestHandler | undefined => worldHandlers?.get(machineIp),
    [worldHandlers],
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
        findMachineByIp,
        resolveNat,
        getGatewayChainFor,
        getHandler,
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
