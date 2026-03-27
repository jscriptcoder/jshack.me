import type { MachineRole, ScriptAutoFlavor } from '../types';

export type ScriptAutoTemplate = {
  readonly location: 'cron.d' | 'init.d' | 'if-up.d';
  readonly scriptName: string;
  readonly flavor: ScriptAutoFlavor;
  readonly instructions: string;
  readonly dataFileName: string;
  readonly dataContent: string;
  readonly extractField: string;
  readonly expectedChecksum: string;
};

// --- fileserver templates ---

const fileserverTemplates: readonly ScriptAutoTemplate[] = [
  {
    location: 'cron.d',
    scriptName: 'backup-verify.js',
    flavor: 'local',
    instructions: [
      '// Cron job: backup verification',
      '// Runs every 6 hours to verify backup integrity.',
      '//',
      '// 1. Read /var/lib/backup/status.json',
      '// 2. Parse the JSON',
      '// 3. Extract the "checksum" field',
      '// 4. Report: echo(_decode(checksum))',
    ].join('\n'),
    dataFileName: '/var/lib/backup/status.json',
    dataContent: JSON.stringify({
      lastRun: '2026-03-27T04:00:00Z',
      totalFiles: 2847,
      checksum: 'f7a3c9b1e2d4',
      status: 'complete',
    }),
    extractField: 'checksum',
    expectedChecksum: 'f7a3c9b1e2d4',
  },
  {
    location: 'if-up.d',
    scriptName: 'nfs-health.js',
    flavor: 'remote',
    instructions: [
      '// Network-up hook: NFS health check',
      '// Verifies NFS share availability when network starts.',
      '//',
      '// 1. POST to http://{{apiIp}}/api/nfs-status',
      '// 2. Parse the JSON response',
      '// 3. Extract the "share_token" field',
      '// 4. Report: echo(_decode(share_token))',
    ].join('\n'),
    dataFileName: 'nfs-status',
    dataContent: JSON.stringify({
      shares: ['/srv/data', '/srv/archive'],
      mounted: true,
      share_token: 'nfs-8e4f2a1b7c',
      latency_ms: 12,
    }),
    extractField: 'share_token',
    expectedChecksum: 'nfs-8e4f2a1b7c',
  },
];

// --- database templates ---

const databaseTemplates: readonly ScriptAutoTemplate[] = [
  {
    location: 'cron.d',
    scriptName: 'db-health.js',
    flavor: 'remote',
    instructions: [
      '// Cron job: database health monitor',
      '// Checks replication lag every 15 minutes.',
      '//',
      '// 1. POST to http://{{apiIp}}/api/replication',
      '// 2. Parse the JSON response',
      '// 3. Extract the "sync_key" field',
      '// 4. Report: echo(_decode(sync_key))',
    ].join('\n'),
    dataFileName: 'replication',
    dataContent: JSON.stringify({
      primary: 'db-master',
      replica: 'db-replica-01',
      lag_seconds: 0.3,
      sync_key: 'rep-4d8f1a2e9b',
      status: 'in_sync',
    }),
    extractField: 'sync_key',
    expectedChecksum: 'rep-4d8f1a2e9b',
  },
  {
    location: 'init.d',
    scriptName: 'db-config-check.js',
    flavor: 'local',
    instructions: [
      '// Init script: database config validator',
      '// Validates database config on boot.',
      '//',
      '// 1. Read /etc/db/cluster.json',
      '// 2. Parse the JSON',
      '// 3. Extract the "auth_token" field',
      '// 4. Report: echo(_decode(auth_token))',
    ].join('\n'),
    dataFileName: '/etc/db/cluster.json',
    dataContent: JSON.stringify({
      cluster_name: 'prod-east-1',
      nodes: 3,
      auth_token: 'clu-7b2e9f3a4d',
      encryption: 'aes-256',
    }),
    extractField: 'auth_token',
    expectedChecksum: 'clu-7b2e9f3a4d',
  },
];

// --- webserver templates ---

const webserverTemplates: readonly ScriptAutoTemplate[] = [
  {
    location: 'cron.d',
    scriptName: 'ssl-monitor.js',
    flavor: 'local',
    instructions: [
      '// Cron job: SSL certificate monitor',
      '// Checks certificate expiry daily.',
      '//',
      '// 1. Read /etc/ssl/cert-status.json',
      '// 2. Parse the JSON',
      '// 3. Extract the "fingerprint" field',
      '// 4. Report: echo(_decode(fingerprint))',
    ].join('\n'),
    dataFileName: '/etc/ssl/cert-status.json',
    dataContent: JSON.stringify({
      domain: 'portal.corp.local',
      expires: '2027-01-15',
      fingerprint: 'ssl-a9c3f2b7e1',
      issuer: 'internal-ca',
    }),
    extractField: 'fingerprint',
    expectedChecksum: 'ssl-a9c3f2b7e1',
  },
  {
    location: 'if-up.d',
    scriptName: 'cdn-ping.js',
    flavor: 'remote',
    instructions: [
      '// Network-up hook: CDN availability check',
      '// Verifies CDN origin is reachable when network starts.',
      '//',
      '// 1. POST to http://{{apiIp}}/api/cdn-health',
      '// 2. Parse the JSON response',
      '// 3. Extract the "origin_key" field',
      '// 4. Report: echo(_decode(origin_key))',
    ].join('\n'),
    dataFileName: 'cdn-health',
    dataContent: JSON.stringify({
      cdn_node: 'edge-us-01',
      origin: 'origin.internal',
      origin_key: 'cdn-5e8b1f3a7d',
      cache_hit_rate: 0.94,
    }),
    extractField: 'origin_key',
    expectedChecksum: 'cdn-5e8b1f3a7d',
  },
];

// --- mailserver templates ---

const mailserverTemplates: readonly ScriptAutoTemplate[] = [
  {
    location: 'cron.d',
    scriptName: 'queue-check.js',
    flavor: 'remote',
    instructions: [
      '// Cron job: mail queue monitor',
      '// Checks mail queue depth every 10 minutes.',
      '//',
      '// 1. POST to http://{{apiIp}}/api/mail-queue',
      '// 2. Parse the JSON response',
      '// 3. Extract the "queue_token" field',
      '// 4. Report: echo(_decode(queue_token))',
    ].join('\n'),
    dataFileName: 'mail-queue',
    dataContent: JSON.stringify({
      queued: 42,
      deferred: 3,
      queue_token: 'mq-2c9a4f7b1e',
      relay: 'smtp.internal',
    }),
    extractField: 'queue_token',
    expectedChecksum: 'mq-2c9a4f7b1e',
  },
  {
    location: 'init.d',
    scriptName: 'spam-filter-init.js',
    flavor: 'local',
    instructions: [
      '// Init script: spam filter initialization',
      '// Loads spam filter rules on boot.',
      '//',
      '// 1. Read /etc/mail/filter-config.json',
      '// 2. Parse the JSON',
      '// 3. Extract the "ruleset_hash" field',
      '// 4. Report: echo(_decode(ruleset_hash))',
    ].join('\n'),
    dataFileName: '/etc/mail/filter-config.json',
    dataContent: JSON.stringify({
      version: '3.2.1',
      rules: 1847,
      ruleset_hash: 'spf-6d1b8e3a9c',
      updated: '2026-03-26',
    }),
    extractField: 'ruleset_hash',
    expectedChecksum: 'spf-6d1b8e3a9c',
  },
];

// --- iot templates ---

const iotTemplates: readonly ScriptAutoTemplate[] = [
  {
    location: 'cron.d',
    scriptName: 'sensor-poll.js',
    flavor: 'local',
    instructions: [
      '// Cron job: sensor data collector',
      '// Polls sensor readings every 5 minutes.',
      '//',
      '// 1. Read /var/lib/sensor/latest.json',
      '// 2. Parse the JSON',
      '// 3. Extract the "device_key" field',
      '// 4. Report: echo(_decode(device_key))',
    ].join('\n'),
    dataFileName: '/var/lib/sensor/latest.json',
    dataContent: JSON.stringify({
      temperature: 22.4,
      humidity: 45,
      device_key: 'iot-3f7a2c9b1e',
      timestamp: '2026-03-27T10:30:00Z',
    }),
    extractField: 'device_key',
    expectedChecksum: 'iot-3f7a2c9b1e',
  },
  {
    location: 'if-up.d',
    scriptName: 'gateway-register.js',
    flavor: 'remote',
    instructions: [
      '// Network-up hook: IoT gateway registration',
      '// Registers with central hub when network starts.',
      '//',
      '// 1. POST to http://{{apiIp}}/api/gateway-register',
      '// 2. Parse the JSON response',
      '// 3. Extract the "registration_id" field',
      '// 4. Report: echo(_decode(registration_id))',
    ].join('\n'),
    dataFileName: 'gateway-register',
    dataContent: JSON.stringify({
      hub: 'iot-hub-01',
      protocol: 'mqtt',
      registration_id: 'gw-8b4e1f2a7c',
      firmware: '2.1.4',
    }),
    extractField: 'registration_id',
    expectedChecksum: 'gw-8b4e1f2a7c',
  },
];

// --- workstation templates ---

const workstationTemplates: readonly ScriptAutoTemplate[] = [
  {
    location: 'cron.d',
    scriptName: 'ldap-sync.js',
    flavor: 'remote',
    instructions: [
      '// Cron job: LDAP directory sync',
      '// Syncs user directory every 30 minutes.',
      '//',
      '// 1. POST to http://{{apiIp}}/api/ldap-sync',
      '// 2. Parse the JSON response',
      '// 3. Extract the "sync_token" field',
      '// 4. Report: echo(_decode(sync_token))',
    ].join('\n'),
    dataFileName: 'ldap-sync',
    dataContent: JSON.stringify({
      users_synced: 234,
      groups_synced: 18,
      sync_token: 'ldap-1a9c4f7b2e',
      server: 'dc01.corp.local',
    }),
    extractField: 'sync_token',
    expectedChecksum: 'ldap-1a9c4f7b2e',
  },
  {
    location: 'init.d',
    scriptName: 'vpn-config-load.js',
    flavor: 'local',
    instructions: [
      '// Init script: VPN config loader',
      '// Loads VPN tunnel configuration on boot.',
      '//',
      '// 1. Read /etc/vpn/tunnel.json',
      '// 2. Parse the JSON',
      '// 3. Extract the "psk_hash" field',
      '// 4. Report: echo(_decode(psk_hash))',
    ].join('\n'),
    dataFileName: '/etc/vpn/tunnel.json',
    dataContent: JSON.stringify({
      endpoint: 'vpn.corp.local',
      port: 1194,
      psk_hash: 'vpn-5c2e8a1f9b',
      cipher: 'aes-256-gcm',
    }),
    extractField: 'psk_hash',
    expectedChecksum: 'vpn-5c2e8a1f9b',
  },
];

// --- router templates ---

const routerTemplates: readonly ScriptAutoTemplate[] = [
  {
    location: 'cron.d',
    scriptName: 'route-monitor.js',
    flavor: 'local',
    instructions: [
      '// Cron job: routing table monitor',
      '// Checks for route anomalies every 10 minutes.',
      '//',
      '// 1. Read /var/lib/routing/state.json',
      '// 2. Parse the JSON',
      '// 3. Extract the "route_hash" field',
      '// 4. Report: echo(_decode(route_hash))',
    ].join('\n'),
    dataFileName: '/var/lib/routing/state.json',
    dataContent: JSON.stringify({
      active_routes: 24,
      bgp_peers: 3,
      route_hash: 'rt-7f3a1c9b2e',
      uptime_hours: 720,
    }),
    extractField: 'route_hash',
    expectedChecksum: 'rt-7f3a1c9b2e',
  },
  {
    location: 'if-up.d',
    scriptName: 'upstream-check.js',
    flavor: 'remote',
    instructions: [
      '// Network-up hook: upstream connectivity check',
      '// Verifies upstream router is reachable.',
      '//',
      '// 1. POST to http://{{apiIp}}/api/upstream-status',
      '// 2. Parse the JSON response',
      '// 3. Extract the "peer_key" field',
      '// 4. Report: echo(_decode(peer_key))',
    ].join('\n'),
    dataFileName: 'upstream-status',
    dataContent: JSON.stringify({
      peer: 'core-rtr-01',
      latency_ms: 2,
      peer_key: 'bgp-4e8b2f1a7c',
      sessions: 3,
    }),
    extractField: 'peer_key',
    expectedChecksum: 'bgp-4e8b2f1a7c',
  },
];

// --- switch templates ---

const switchTemplates: readonly ScriptAutoTemplate[] = [
  {
    location: 'cron.d',
    scriptName: 'port-stats.js',
    flavor: 'local',
    instructions: [
      '// Cron job: switch port statistics collector',
      '// Collects port utilization stats every 5 minutes.',
      '//',
      '// 1. Read /var/lib/switch/port-stats.json',
      '// 2. Parse the JSON',
      '// 3. Extract the "stats_hash" field',
      '// 4. Report: echo(_decode(stats_hash))',
    ].join('\n'),
    dataFileName: '/var/lib/switch/port-stats.json',
    dataContent: JSON.stringify({
      active_ports: 24,
      total_ports: 48,
      stats_hash: 'sw-9a1c3f7b2e',
      errors: 0,
    }),
    extractField: 'stats_hash',
    expectedChecksum: 'sw-9a1c3f7b2e',
  },
  {
    location: 'if-up.d',
    scriptName: 'vlan-sync.js',
    flavor: 'remote',
    instructions: [
      '// Network-up hook: VLAN database sync',
      '// Syncs VLAN config with management server.',
      '//',
      '// 1. POST to http://{{apiIp}}/api/vlan-db',
      '// 2. Parse the JSON response',
      '// 3. Extract the "vlan_token" field',
      '// 4. Report: echo(_decode(vlan_token))',
    ].join('\n'),
    dataFileName: 'vlan-db',
    dataContent: JSON.stringify({
      vlans: [10, 20, 30, 100],
      trunk_ports: 4,
      vlan_token: 'vlan-2e7c4a9f1b',
      revision: 17,
    }),
    extractField: 'vlan_token',
    expectedChecksum: 'vlan-2e7c4a9f1b',
  },
];

export const scriptAutoTemplatesByRole: Readonly<
  Record<MachineRole, readonly ScriptAutoTemplate[]>
> = {
  fileserver: fileserverTemplates,
  database: databaseTemplates,
  webserver: webserverTemplates,
  mailserver: mailserverTemplates,
  iot: iotTemplates,
  workstation: workstationTemplates,
  router: routerTemplates,
  switch: switchTemplates,
};
