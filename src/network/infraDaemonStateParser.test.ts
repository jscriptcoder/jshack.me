import { describe, it, expect } from 'vitest';
import { parseInfraDaemonState } from './infraDaemonStateParser';

describe('parseInfraDaemonState', () => {
  describe('empty / malformed input', () => {
    it('returns [] for undefined content', () => {
      expect(parseInfraDaemonState('nginx.pid', undefined)).toEqual([]);
    });

    it('returns [] for empty string content', () => {
      expect(parseInfraDaemonState('nginx.pid', '')).toEqual([]);
    });

    it('returns [] for whitespace-only content', () => {
      expect(parseInfraDaemonState('nginx.pid', '   \n  \t')).toEqual([]);
    });

    it('returns [] for non-matching content', () => {
      expect(parseInfraDaemonState('nginx.pid', 'garbage')).toEqual([]);
    });

    it('returns [] for unknown pid file name', () => {
      expect(parseInfraDaemonState('unknown.pid', '/usr/sbin/nginx:port=80')).toEqual([]);
    });

    it('returns [] for content with valid format but port out of range (zero)', () => {
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=0')).toEqual([]);
    });

    it('returns [] for content with valid format but port out of range (65536)', () => {
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=65536')).toEqual([]);
    });

    it('returns [] for content with valid format but unknown port for that binary', () => {
      // 9999 isn't a known http/https/http-alt port; nginx.pid emits nothing.
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=9999')).toEqual([]);
    });

    it('returns [] when port maps to a service NOT served by that binary', () => {
      // 3306 maps to mysql, but nginx.pid only serves http-family services.
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=3306')).toEqual([]);
    });

    it('returns [] for line with junk PREFIX before the binary path', () => {
      // The regex must be anchored at line-start (`^`) — otherwise a malicious
      // pid file could embed the canonical binary path as a substring and
      // smuggle in a fake daemon state.
      expect(parseInfraDaemonState('nginx.pid', 'junk/usr/sbin/nginx:port=80')).toEqual([]);
    });

    it('returns [] for line with junk SUFFIX after the port number', () => {
      // The regex must be anchored at line-end (`$`) — otherwise garbage
      // trailing the port number would be silently ignored and the line
      // would still parse as valid daemon state.
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=80garbage')).toEqual([]);
    });
  });

  describe('single-service binaries', () => {
    it('parses mysqld.pid → mysql override', () => {
      expect(parseInfraDaemonState('mysqld.pid', '/usr/sbin/mysqld:port=3306')).toEqual([
        { port: 3306, service: 'mysql', open: true },
      ]);
    });

    it('parses redis.pid → redis override', () => {
      expect(parseInfraDaemonState('redis.pid', '/usr/sbin/redis-server:port=6379')).toEqual([
        { port: 6379, service: 'redis', open: true },
      ]);
    });

    it('parses postgres.pid → postgresql override', () => {
      expect(parseInfraDaemonState('postgres.pid', '/usr/sbin/postgres:port=5432')).toEqual([
        { port: 5432, service: 'postgresql', open: true },
      ]);
    });

    it('parses mongod.pid → mongodb override', () => {
      expect(parseInfraDaemonState('mongod.pid', '/usr/sbin/mongod:port=27017')).toEqual([
        { port: 27017, service: 'mongodb', open: true },
      ]);
    });

    it('parses postfix.pid → smtp override', () => {
      expect(parseInfraDaemonState('postfix.pid', '/usr/sbin/postfix:port=25')).toEqual([
        { port: 25, service: 'smtp', open: true },
      ]);
    });

    it('parses mosquitto.pid → mqtt override', () => {
      expect(parseInfraDaemonState('mosquitto.pid', '/usr/sbin/mosquitto:port=1883')).toEqual([
        { port: 1883, service: 'mqtt', open: true },
      ]);
    });

    it('parses named.pid → dns override', () => {
      expect(parseInfraDaemonState('named.pid', '/usr/sbin/named:port=53')).toEqual([
        { port: 53, service: 'dns', open: true },
      ]);
    });

    it('parses snmpd.pid → snmp override', () => {
      expect(parseInfraDaemonState('snmpd.pid', '/usr/sbin/snmpd:port=161')).toEqual([
        { port: 161, service: 'snmp', open: true },
      ]);
    });

    it('parses smbd.pid → smb override', () => {
      expect(parseInfraDaemonState('smbd.pid', '/usr/sbin/smbd:port=445')).toEqual([
        { port: 445, service: 'smb', open: true },
      ]);
    });

    it('parses openvpn.pid → openvpn override', () => {
      expect(parseInfraDaemonState('openvpn.pid', '/usr/sbin/openvpn:port=1194')).toEqual([
        { port: 1194, service: 'openvpn', open: true },
      ]);
    });

    it('parses vncserver.pid → vnc override', () => {
      expect(parseInfraDaemonState('vncserver.pid', '/usr/sbin/Xvnc:port=5900')).toEqual([
        { port: 5900, service: 'vnc', open: true },
      ]);
    });
  });

  describe('multi-service binaries — port disambiguates the service', () => {
    it('parses nginx.pid port=80 → http', () => {
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=80')).toEqual([
        { port: 80, service: 'http', open: true },
      ]);
    });

    it('parses nginx.pid port=443 → https', () => {
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=443')).toEqual([
        { port: 443, service: 'https', open: true },
      ]);
    });

    it('parses nginx.pid port=8080 → http-alt', () => {
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=8080')).toEqual([
        { port: 8080, service: 'http-alt', open: true },
      ]);
    });

    it('parses nginx.pid port=8443 → https (alt https port)', () => {
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=8443')).toEqual([
        { port: 8443, service: 'https', open: true },
      ]);
    });

    it('parses dovecot.pid port=143 → imap', () => {
      expect(parseInfraDaemonState('dovecot.pid', '/usr/sbin/dovecot:port=143')).toEqual([
        { port: 143, service: 'imap', open: true },
      ]);
    });

    it('parses dovecot.pid port=993 → imaps', () => {
      expect(parseInfraDaemonState('dovecot.pid', '/usr/sbin/dovecot:port=993')).toEqual([
        { port: 993, service: 'imaps', open: true },
      ]);
    });

    it('parses dovecot.pid port=110 → pop3', () => {
      expect(parseInfraDaemonState('dovecot.pid', '/usr/sbin/dovecot:port=110')).toEqual([
        { port: 110, service: 'pop3', open: true },
      ]);
    });
  });

  describe('extended form — optional owner fields', () => {
    // The extended form is what player-run apache2/nginx commands write:
    //   /usr/sbin/nginx:port=80,user=alice,userType=user,home=/home/alice
    // Themed-network short form (no owner) MUST continue to work — both shapes
    // coexist on the same pid file path across different machines.

    it('parses nginx.pid extended form → override with owner', () => {
      expect(
        parseInfraDaemonState(
          'nginx.pid',
          '/usr/sbin/nginx:port=80,user=alice,userType=user,home=/home/alice',
        ),
      ).toEqual([
        {
          port: 80,
          service: 'http',
          open: true,
          owner: { username: 'alice', userType: 'user', homePath: '/home/alice' },
        },
      ]);
    });

    it('parses extended form on root-owned port', () => {
      expect(
        parseInfraDaemonState(
          'nginx.pid',
          '/usr/sbin/nginx:port=443,user=root,userType=root,home=/root',
        ),
      ).toEqual([
        {
          port: 443,
          service: 'https',
          open: true,
          owner: { username: 'root', userType: 'root', homePath: '/root' },
        },
      ]);
    });

    it('parses extended form on a single-service binary (mysqld)', () => {
      expect(
        parseInfraDaemonState(
          'mysqld.pid',
          '/usr/sbin/mysqld:port=3306,user=mysql,userType=user,home=/var/lib/mysql',
        ),
      ).toEqual([
        {
          port: 3306,
          service: 'mysql',
          open: true,
          owner: { username: 'mysql', userType: 'user', homePath: '/var/lib/mysql' },
        },
      ]);
    });

    it('mixed multi-line content: short form on one line, extended on another', () => {
      const content =
        '/usr/sbin/nginx:port=80\n/usr/sbin/nginx:port=443,user=alice,userType=user,home=/home/alice';
      expect(parseInfraDaemonState('nginx.pid', content)).toEqual([
        { port: 80, service: 'http', open: true },
        {
          port: 443,
          service: 'https',
          open: true,
          owner: { username: 'alice', userType: 'user', homePath: '/home/alice' },
        },
      ]);
    });

    it('rejects extended form with invalid userType', () => {
      expect(
        parseInfraDaemonState(
          'nginx.pid',
          '/usr/sbin/nginx:port=80,user=alice,userType=admin,home=/home/alice',
        ),
      ).toEqual([]);
    });

    it('rejects extended form missing the home field', () => {
      // Optional group is all-or-nothing — partial owner fields must fail
      // the match so the override doesn't silently degrade to no-owner.
      expect(
        parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=80,user=alice,userType=user'),
      ).toEqual([]);
    });

    it('rejects extended form with extra trailing fields', () => {
      // `,extra=foo` after home= signals a forged/malformed line; anchor at $.
      expect(
        parseInfraDaemonState(
          'nginx.pid',
          '/usr/sbin/nginx:port=80,user=alice,userType=user,home=/home/alice,extra=foo',
        ),
      ).toEqual([]);
    });
  });

  describe('multi-line content', () => {
    it('emits one override per valid line', () => {
      const content = '/usr/sbin/nginx:port=80\n/usr/sbin/nginx:port=443';
      expect(parseInfraDaemonState('nginx.pid', content)).toEqual([
        { port: 80, service: 'http', open: true },
        { port: 443, service: 'https', open: true },
      ]);
    });

    it('skips malformed lines but keeps valid ones', () => {
      const content = '/usr/sbin/nginx:port=80\ngarbage line\n/usr/sbin/nginx:port=443';
      expect(parseInfraDaemonState('nginx.pid', content)).toEqual([
        { port: 80, service: 'http', open: true },
        { port: 443, service: 'https', open: true },
      ]);
    });

    it('skips lines whose port maps to a service not served by this binary', () => {
      // 3306 (mysql) on nginx.pid is impossible; skip.
      const content = '/usr/sbin/nginx:port=80\n/usr/sbin/nginx:port=3306';
      expect(parseInfraDaemonState('nginx.pid', content)).toEqual([
        { port: 80, service: 'http', open: true },
      ]);
    });

    it('tolerates trailing newline', () => {
      expect(parseInfraDaemonState('nginx.pid', '/usr/sbin/nginx:port=80\n')).toEqual([
        { port: 80, service: 'http', open: true },
      ]);
    });

    it('tolerates surrounding whitespace per line', () => {
      const content = '  /usr/sbin/nginx:port=80  \n\t/usr/sbin/nginx:port=443\t';
      expect(parseInfraDaemonState('nginx.pid', content)).toEqual([
        { port: 80, service: 'http', open: true },
        { port: 443, service: 'https', open: true },
      ]);
    });
  });
});
