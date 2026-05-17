import { describe, it, expect } from 'vitest';
import { mergeForeignRouterForwards } from './mergeForeignRouterForwards';
import type { RemoteMachine, Port } from './types';
import type { GeneratedMachine } from '../generation/types';

const mkPort = (overrides: Partial<Port> = {}): Port => ({
  port: 80,
  service: 'http',
  serviceVersion: 'latest',
  open: true,
  ...overrides,
});

const mkRouter = (overrides: Partial<RemoteMachine> = {}): RemoteMachine => ({
  ip: '51.146.70.192',
  hostname: 'router.foreign',
  ports: [],
  users: [],
  ...overrides,
});

const mkInternal = (ip: string, ports: readonly Port[]): GeneratedMachine =>
  ({
    ip,
    hostname: `host-${ip}`,
    remoteMachine: { ip, hostname: `host-${ip}`, ports, users: [] },
  }) as unknown as GeneratedMachine;

const RULES_V4_HEADER = '# Port Forwarding Rules\n# forward <public_port> to <internal_ip>:<port>';

describe('mergeForeignRouterForwards', () => {
  describe('no forwards', () => {
    it('returns the router unchanged when rules.v4 has only header comments', () => {
      const router = mkRouter({
        ports: [mkPort({ port: 22, service: 'ssh', open: true })],
      });
      const merged = mergeForeignRouterForwards(router, [], RULES_V4_HEADER);
      expect(merged).toEqual(router);
    });

    it('returns the router unchanged when rules content is null (no patch yet)', () => {
      // First-touch case: B has subscribed to the foreign router but
      // listPatchesForMachines hasn't landed the iptables row yet, so
      // getNodeFromMachine returns null. Merge must not crash.
      const router = mkRouter({
        ports: [mkPort({ port: 22, service: 'ssh', open: true })],
      });
      const merged = mergeForeignRouterForwards(router, [], null);
      expect(merged).toEqual(router);
    });
  });

  describe('NPC-target forwards (internal machine present in cache)', () => {
    it("uses the internal machine's port details when the rule targets a known NPC", () => {
      // A's home network has an internal NPC at 172.29.209.50 with apache
      // 2.4.49 on port 80. Forward rule maps public 8080 to that port.
      // The merged router should advertise 8080 with the NPC's real
      // service + version, not a synthesized fallback.
      const router = mkRouter();
      const internal = mkInternal('172.29.209.50', [
        mkPort({ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49', open: true }),
      ]);
      const rules = `${RULES_V4_HEADER}\nforward 8080 to 172.29.209.50:80`;
      const merged = mergeForeignRouterForwards(router, [internal], rules);

      const forwarded = merged.ports.find((port) => port.port === 8080);
      expect(forwarded).toBeDefined();
      expect(forwarded?.service).toBe('http');
      expect(forwarded?.serviceVersion).toBe('Apache/2.4.49');
      expect(forwarded?.open).toBe(true);
    });

    it('drops forwards whose internal target port is closed (NPC has port but it is closed)', () => {
      // Defender hides the service by closing the internal port. Real
      // NAT forward would still show the public port responding briefly
      // until connection refused — game leans toward the more useful
      // "don't show dead forwards" UX. Mirrors buildMergedRouterView.
      const router = mkRouter();
      const internal = mkInternal('172.29.209.50', [
        mkPort({ port: 80, service: 'http', open: false }),
      ]);
      const rules = `${RULES_V4_HEADER}\nforward 8080 to 172.29.209.50:80`;
      const merged = mergeForeignRouterForwards(router, [internal], rules);

      expect(merged.ports.find((port) => port.port === 8080)).toBeUndefined();
    });
  });

  describe('occupant-target forwards (internal not in cache — workstation)', () => {
    it('synthesizes the forward as open with the well-known service for the internal port', () => {
      // The user's smoke case: A forwards 8080 → A's workstation port 80.
      // A's workstation is an occupant, not in cache.internalMachines, so
      // the fallback fires: open + service inferred from port 80 → http.
      // Real port scanners do the same (lookup /etc/services).
      const router = mkRouter();
      const rules = `${RULES_V4_HEADER}\nforward 8080 to 172.29.209.187:80`;
      const merged = mergeForeignRouterForwards(router, [], rules);

      const forwarded = merged.ports.find((port) => port.port === 8080);
      expect(forwarded).toBeDefined();
      expect(forwarded?.service).toBe('http');
      expect(forwarded?.open).toBe(true);
      // Version reads 'unknown' when synthesized — caller will see this
      // until foothold lets the real apache2 pid-file overlay apply.
      expect(forwarded?.serviceVersion).toBe('unknown');
    });

    it('synthesizes with service "unknown" when the internal port isn\'t in the well-known map', () => {
      const router = mkRouter();
      const rules = `${RULES_V4_HEADER}\nforward 12345 to 172.29.209.187:55555`;
      const merged = mergeForeignRouterForwards(router, [], rules);

      const forwarded = merged.ports.find((port) => port.port === 12345);
      expect(forwarded).toBeDefined();
      expect(forwarded?.service).toBe('unknown');
      expect(forwarded?.open).toBe(true);
    });
  });

  describe('precedence + dedup', () => {
    it('forwarded ports override router-own ports on collision', () => {
      // Router has its own port 80 (http, version X). Iptables forward
      // 80 → internal 80 (different version). Forwarded wins, matching
      // real NAT — the inbound packet hits PREROUTING before the local
      // listener gets a chance.
      const router = mkRouter({
        ports: [mkPort({ port: 80, service: 'http', serviceVersion: 'router-own', open: true })],
      });
      const internal = mkInternal('172.29.209.50', [
        mkPort({ port: 80, service: 'http', serviceVersion: 'apache-2.4.49', open: true }),
      ]);
      const rules = `${RULES_V4_HEADER}\nforward 80 to 172.29.209.50:80`;
      const merged = mergeForeignRouterForwards(router, [internal], rules);

      const port80 = merged.ports.find((port) => port.port === 80);
      expect(port80?.serviceVersion).toBe('apache-2.4.49');
      // Only one port 80 entry — dedup happened.
      expect(merged.ports.filter((port) => port.port === 80)).toHaveLength(1);
    });

    it('preserves router-own ports that have no colliding forward', () => {
      const router = mkRouter({
        ports: [
          mkPort({ port: 22, service: 'ssh', open: true }),
          mkPort({ port: 53, service: 'dns', open: true }),
        ],
      });
      const rules = `${RULES_V4_HEADER}\nforward 8080 to 172.29.209.187:80`;
      const merged = mergeForeignRouterForwards(router, [], rules);

      expect(merged.ports.find((port) => port.port === 22)).toBeDefined();
      expect(merged.ports.find((port) => port.port === 53)).toBeDefined();
      expect(merged.ports.find((port) => port.port === 8080)).toBeDefined();
    });
  });

  describe('multiple forwards', () => {
    it('processes mixed NPC + occupant forwards in one pass', () => {
      // A has two forwards: one to an internal NPC, one to A's workstation
      // (occupant). Merge should pick up both with their respective
      // resolution paths.
      const router = mkRouter();
      const internalNpc = mkInternal('172.29.209.50', [
        mkPort({ port: 22, service: 'ssh', serviceVersion: 'OpenSSH-8.9', open: true }),
      ]);
      const rules = [
        RULES_V4_HEADER,
        'forward 2222 to 172.29.209.50:22',
        'forward 8080 to 172.29.209.187:80',
      ].join('\n');
      const merged = mergeForeignRouterForwards(router, [internalNpc], rules);

      const port2222 = merged.ports.find((port) => port.port === 2222);
      expect(port2222?.service).toBe('ssh');
      expect(port2222?.serviceVersion).toBe('OpenSSH-8.9');

      const port8080 = merged.ports.find((port) => port.port === 8080);
      expect(port8080?.service).toBe('http');
      expect(port8080?.serviceVersion).toBe('unknown');
    });
  });
});
