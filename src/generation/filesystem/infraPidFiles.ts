import type { FileNode } from '../../filesystem/types';
import { mkFile } from './helpers';

// Infrastructure service PID file definitions. Maps service names to their
// daemon binary, PID file name, and run user. SSH/FTP are handled separately
// by their own PID file factories; NC backdoors are dynamic (player-created).
type InfraPidConfig = {
  readonly pidFile: string;
  readonly binary: string;
  readonly user: string;
};

const INFRA_PID_CONFIGS: Readonly<Record<string, InfraPidConfig>> = {
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

// Builds PID files for open infrastructure ports. Deduplicates by pidFile name
// (e.g., http/https/http-alt all share nginx.pid; imap/imaps/pop3 share dovecot.pid).
export const buildInfrastructurePidFiles = (
  ports: readonly { readonly port: number; readonly service: string; readonly open: boolean }[],
): Readonly<Record<string, FileNode>> => {
  const seen = new Set<string>();
  return Object.fromEntries(
    ports
      .filter((p) => {
        if (!p.open) return false;
        const config = INFRA_PID_CONFIGS[p.service];
        if (!config || seen.has(config.pidFile)) return false;
        seen.add(config.pidFile);
        return true;
      })
      .map((p) => {
        const config = INFRA_PID_CONFIGS[p.service]!;
        return [config.pidFile, mkFile(config.pidFile, `${config.binary}:port=${p.port}`, 'guest')];
      }),
  );
};
