import type { FileNode } from '../../filesystem/types';
import type { Port, ServiceOwner } from '../../network/types';
import { mkFile } from './helpers';

// Infrastructure service PID file definitions. Maps service names to their
// daemon binary, PID file name, and run user. SSH/FTP are handled separately
// by their own PID file factories. NC backdoors come in two flavors:
//   - Player-created via `nc -l` (handled at runtime in src/commands/nc.ts).
//   - NPC-baked via the network generator, when an `elite`-service port is
//     created with an `owner` (mission/home networks, closure-mission
//     enrichment). Those need a generation-time pidfile so the server's
//     authCreateSession+pidfile path can read /var/run/nc-<port>.pid and
//     derive the listener's tier from the same canonical content the
//     player would have written. Without this, cross-player nc against an
//     NPC backdoor returns 401 invalid_credentials because the pidfile
//     doesn't exist.
//
// Pid file presence is LOAD-BEARING — applyDynamicOverrides in
// src/network/networkUtils.ts reads every infra pid file and uses
// presence/absence to derive port-state. A generator that opens an
// infra port WITHOUT shipping the matching pid file via
// buildInfrastructurePidFiles will see that port closed at runtime.
type InfraPidConfig = {
  readonly pidFile: string;
  readonly binary: string;
  readonly user: string;
};

export const INFRA_PID_CONFIGS: Readonly<Record<string, InfraPidConfig>> = {
  http: { pidFile: 'nginx.pid', binary: '/usr/sbin/nginx', user: 'www-data' },
  https: { pidFile: 'nginx.pid', binary: '/usr/sbin/nginx', user: 'www-data' },
  'http-alt': { pidFile: 'nginx.pid', binary: '/usr/sbin/nginx', user: 'www-data' },
  mysql: { pidFile: 'mysqld.pid', binary: '/usr/sbin/mysqld', user: 'mysql' },
  postgresql: { pidFile: 'postgres.pid', binary: '/usr/sbin/postgres', user: 'postgres' },
  redis: { pidFile: 'redis.pid', binary: '/usr/sbin/redis-server', user: 'redis' },
  mongodb: { pidFile: 'mongod.pid', binary: '/usr/sbin/mongod', user: 'mongodb' },
  smtp: { pidFile: 'postfix.pid', binary: '/usr/sbin/postfix', user: 'postfix' },
  imap: { pidFile: 'dovecot.pid', binary: '/usr/sbin/dovecot', user: 'dovecot' },
  imaps: { pidFile: 'dovecot.pid', binary: '/usr/sbin/dovecot', user: 'dovecot' },
  pop3: { pidFile: 'dovecot.pid', binary: '/usr/sbin/dovecot', user: 'dovecot' },
  mqtt: { pidFile: 'mosquitto.pid', binary: '/usr/sbin/mosquitto', user: 'mosquitto' },
  dns: { pidFile: 'named.pid', binary: '/usr/sbin/named', user: 'bind' },
  snmp: { pidFile: 'snmpd.pid', binary: '/usr/sbin/snmpd', user: 'snmp' },
  smb: { pidFile: 'smbd.pid', binary: '/usr/sbin/smbd', user: 'root' },
  modbus: { pidFile: 'modbusd.pid', binary: '/usr/sbin/modbusd', user: 'root' },
  openvpn: { pidFile: 'openvpn.pid', binary: '/usr/sbin/openvpn', user: 'root' },
  vnc: { pidFile: 'vncserver.pid', binary: '/usr/sbin/Xvnc', user: 'root' },
  rsync: { pidFile: 'rsyncd.pid', binary: '/usr/sbin/rsyncd', user: 'root' },
};

// Builds PID files for open infrastructure ports. Ports sharing a pid file
// (http/https/http-alt → nginx.pid; imap/imaps/pop3 → dovecot.pid) are
// grouped: one file per binary with multi-line content, one
// `${binary}:port=${port}` line per open port. Port iteration order is
// preserved within each group.
export const buildInfrastructurePidFiles = (
  ports: readonly { readonly port: number; readonly service: string; readonly open: boolean }[],
): Readonly<Record<string, FileNode>> => {
  const groupsByPidFile = new Map<string, { readonly binary: string; readonly ports: number[] }>();
  for (const port of ports) {
    if (!port.open) continue;
    const config = INFRA_PID_CONFIGS[port.service];
    if (!config) continue;
    const existing = groupsByPidFile.get(config.pidFile);
    if (existing) existing.ports.push(port.port);
    else groupsByPidFile.set(config.pidFile, { binary: config.binary, ports: [port.port] });
  }
  return Object.fromEntries(
    [...groupsByPidFile.entries()].map(([pidFile, { binary, ports: groupPorts }]) => {
      const content = groupPorts.map((port) => `${binary}:port=${port}`).join('\n');
      return [pidFile, mkFile(pidFile, content, 'guest')];
    }),
  );
};

// Mirrors createNcPidContent in src/commands/nc.ts so a generated NPC
// backdoor pidfile is byte-equivalent to one a player would have written
// via `nc -l <port>`. parseNcPid (server) and parseNcPidContent (client)
// both consume this single canonical line shape.
const buildNcPidContent = (port: number, owner: ServiceOwner): string =>
  `nc:port=${port},user=${owner.username},userType=${owner.userType},home=${owner.homePath}`;

// Generates `/var/run/nc-<port>.pid` entries for any elite-service port
// with a populated owner. Skipped for ports without an owner (no listener
// metadata to project) and for non-elite ports (they're real services,
// not backdoors). Multiple backdoors on different ports each get their
// own pidfile — the file name encodes the port.
export const buildNcBackdoorPidFiles = (
  ports: readonly Port[],
): Readonly<Record<string, FileNode>> =>
  Object.fromEntries(
    ports
      .filter((p): p is Port & { readonly owner: ServiceOwner } =>
        Boolean(p.open && p.service === 'elite' && p.owner),
      )
      .map((p) => {
        const fileName = `nc-${p.port}.pid`;
        return [fileName, mkFile(fileName, buildNcPidContent(p.port, p.owner), p.owner.userType)];
      }),
  );
