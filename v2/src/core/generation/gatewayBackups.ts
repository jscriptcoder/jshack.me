/**
 * A gateway's configuration backups: the exports its admin took over the box's life and
 * kept under `/root/backups`, in the firmware vendor's own format.
 *
 * Every backup states the box as it stands at the epoch — its name, the address it
 * answers on, the DHCP it serves and the addresses it keeps, the ports its ACL denies,
 * and whether its agent runs — so a player can check any of it against the live files.
 * Every secret reads the way that vendor's export shows one it will not print, and
 * MikroTik's leaves them out: nothing here opens anything in the game.
 *
 * The access point, whose tree every occupant carries, keeps one; every other gateway
 * keeps two to four. Root's alone. Everything draws from the gateway's own
 * `gw-history-backups-` stream, keyed by its machine id.
 */

import type { FileNode } from '../filesystem/types';
import { WORLD_EPOCH } from '../cve/worldClock';
import type { FirmwareVendor } from '../packages/packageVersions';
import { dir, file, ROOT_DIR, ROOT_FILE } from './baseFs';
import { createPrng } from './prng';
import { gatewaySite } from './gatewayHistory';
import { lanHostOctet } from './lanTopology';
import type { DhcpService } from './gatewayNetwork';

const DAY_MS = 86_400_000;
/** How long before the epoch a gateway may have gone into service, in days. */
const LIFE_DAYS = { shortest: 180, longest: 4 * 365 } as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The box as a backup states it. */
type Configuration = {
  readonly hostname: string;
  readonly address: string;
  readonly dhcp: DhcpService | null;
  readonly denies: readonly number[];
  readonly snmp: boolean;
  readonly adminIp: string;
  readonly takenAt: Date;
};

const lines = (rows: readonly string[]): string => `${rows.join('\n')}\n`;

const segmentOf = (address: string): string => address.split('.').slice(0, 3).join('.');

const day = (at: Date): string => at.toISOString().slice(0, 10);

const clock = (at: Date): string => at.toISOString().slice(11, 19);

/** `aa:bb:cc:dd:ee:ff` as IOS writes a hardware address, `aabb.ccdd.eeff`. */
const dottedMac = (mac: string): string =>
  (mac.replaceAll(':', '').match(/.{4}/g) ?? []).join('.');

const cisco = (config: Configuration): string => {
  const { hostname, address, dhcp, denies, snmp, takenAt } = config;
  const changed = `${WEEKDAYS[takenAt.getUTCDay()]} ${MONTHS[takenAt.getUTCMonth()]} ${takenAt.getUTCDate()} ${takenAt.getUTCFullYear()}`;
  return lines([
    '!',
    `! Last configuration change at ${clock(takenAt)} UTC ${changed}`,
    '!',
    `hostname ${hostname}`,
    '!',
    'enable secret 5 <removed>',
    '!',
    ...(dhcp === null
      ? []
      : [
          `ip dhcp excluded-address ${dhcp.subnet}.1`,
          '!',
          'ip dhcp pool LAN',
          ` network ${dhcp.subnet}.0 255.255.255.0`,
          ` default-router ${dhcp.subnet}.1`,
          ` lease 0 ${dhcp.leaseHours}`,
          '!',
          ...dhcp.reservations.flatMap(({ mac, ip, hostname: client }) => [
            `ip dhcp pool ${client}`,
            ` host ${ip} 255.255.255.0`,
            ` hardware-address ${dottedMac(mac)}`,
            '!',
          ]),
        ]),
    'interface Vlan1',
    ` ip address ${address} 255.255.255.0`,
    '!',
    ...(denies.length === 0
      ? []
      : [
          'ip access-list extended LAN-IN',
          ...denies.map((port) => ` deny tcp any any eq ${port}`),
          ' permit ip any any',
          '!',
        ]),
    ...(snmp ? ['snmp-server community <removed> RW', '!'] : []),
    'line vty 0 4',
    ' transport input ssh',
    '!',
    'end',
  ]);
};

const mikrotik = (config: Configuration): string => {
  const { hostname, address, dhcp, denies, snmp, takenAt } = config;
  return lines([
    `# ${day(takenAt)} ${clock(takenAt)} by RouterOS`,
    '/interface bridge',
    'add name=bridge-lan',
    ...(dhcp === null
      ? []
      : [
          '/ip pool',
          `add name=dhcp-lan ranges=${dhcp.subnet}.2-${dhcp.subnet}.254`,
          '/ip dhcp-server',
          `add address-pool=dhcp-lan interface=bridge-lan lease-time=${dhcp.leaseHours}h name=dhcp-lan`,
        ]),
    '/ip address',
    `add address=${address}/24 interface=bridge-lan network=${segmentOf(address)}.0`,
    ...(dhcp === null || dhcp.reservations.length === 0
      ? []
      : [
          '/ip dhcp-server lease',
          ...dhcp.reservations.map(
            ({ mac, ip, hostname: client }) =>
              `add address=${ip} comment=${client} mac-address=${mac.toUpperCase()}`,
          ),
        ]),
    ...(denies.length === 0
      ? []
      : [
          '/ip firewall filter',
          ...denies.map((port) => `add action=drop chain=forward dst-port=${port} protocol=tcp`),
        ]),
    '/snmp',
    `set enabled=${snmp ? 'yes' : 'no'}`,
    '/system identity',
    `set name=${hostname}`,
  ]);
};

const openwrt = (config: Configuration): string => {
  // The agent answers the admin's own machine, which is who polls it.
  const { hostname, address, dhcp, denies, snmp, adminIp } = config;
  const sections: readonly (readonly string[])[] = [
    ['package system', '', 'config system', `\toption hostname '${hostname}'`, "\toption timezone 'UTC'"],
    [
      'package network',
      '',
      "config interface 'lan'",
      "\toption proto 'static'",
      `\toption ipaddr '${address}'`,
      "\toption netmask '255.255.255.0'",
    ],
    ...(dhcp === null
      ? []
      : [
          [
            'package dhcp',
            '',
            "config dhcp 'lan'",
            "\toption interface 'lan'",
            "\toption start '2'",
            "\toption limit '253'",
            `\toption leasetime '${dhcp.leaseHours}h'`,
            ...dhcp.reservations.flatMap(({ mac, ip, hostname: client }) => [
              '',
              'config host',
              `\toption name '${client}'`,
              `\toption mac '${mac}'`,
              `\toption ip '${ip}'`,
            ]),
          ],
        ]),
    ...(denies.length === 0
      ? []
      : [
          [
            'package firewall',
            ...denies.flatMap((port) => [
              '',
              'config rule',
              `\toption name 'deny-${port}'`,
              "\toption proto 'tcp'",
              `\toption dest_port '${port}'`,
              "\toption target 'REJECT'",
            ]),
          ],
        ]),
    [
      'package snmpd',
      '',
      'config agent',
      `\toption enabled '${snmp ? 1 : 0}'`,
      ...(snmp
        ? [
            '',
            "config com2sec 'private'",
            "\toption secname 'rw'",
            `\toption source '${adminIp}'`,
            "\toption community '********'",
          ]
        : []),
    ],
  ];
  return lines(sections.map((section) => section.join('\n')).join('\n\n').split('\n'));
};

const ddwrt = (config: Configuration): string => {
  const { hostname, address, dhcp, denies, snmp } = config;
  const values: Readonly<Record<string, string>> = {
    ...(dhcp === null
      ? {}
      : {
          dhcp_lease: String(dhcp.leaseHours * 60),
          dhcp_num: '253',
          dhcp_start: '2',
          static_leasenum: String(dhcp.reservations.length),
          static_leases: dhcp.reservations
            .map(({ mac, ip, hostname: client }) => `${mac}=${client}=${ip}=`)
            .join(' '),
        }),
    ...Object.fromEntries(
      denies.map((port, index) => [`filter_port_grp${index + 1}`, `${port}-${port}`]),
    ),
    http_passwd: '********',
    lan_ipaddr: address,
    lan_netmask: '255.255.255.0',
    lan_proto: dhcp === null ? 'static' : 'dhcp',
    router_name: hostname,
    snmpd_enable: snmp ? '1' : '0',
    ...(snmp ? { snmpd_rwcommunity: '********' } : {}),
    sshd_enable: '1',
  };
  // `nvram show`, sorted the way an admin pipes it through `sort` before saving it.
  return lines(
    Object.keys(values)
      .sort()
      .map((key) => `${key}=${values[key]}`),
  );
};

const pfsense = (config: Configuration): string => {
  const { hostname, address, dhcp, denies, snmp, adminIp, takenAt } = config;
  const who = `root@${adminIp} (Local Database)`;
  return lines([
    '<?xml version="1.0"?>',
    '<pfsense>',
    '\t<system>',
    `\t\t<hostname>${hostname}</hostname>`,
    '\t\t<domain>home.arpa</domain>',
    '\t\t<user>',
    '\t\t\t<name>root</name>',
    '\t\t\t<bcrypt-hash>xxxxx</bcrypt-hash>',
    '\t\t</user>',
    '\t\t<ssh>',
    '\t\t\t<enable>enabled</enable>',
    '\t\t</ssh>',
    '\t</system>',
    '\t<interfaces>',
    '\t\t<lan>',
    '\t\t\t<enable></enable>',
    '\t\t\t<if>em1</if>',
    `\t\t\t<ipaddr>${address}</ipaddr>`,
    '\t\t\t<subnet>24</subnet>',
    '\t\t</lan>',
    '\t</interfaces>',
    ...(dhcp === null
      ? []
      : [
          '\t<dhcpd>',
          '\t\t<lan>',
          '\t\t\t<enable></enable>',
          '\t\t\t<range>',
          `\t\t\t\t<from>${dhcp.subnet}.2</from>`,
          `\t\t\t\t<to>${dhcp.subnet}.254</to>`,
          '\t\t\t</range>',
          `\t\t\t<defaultleasetime>${dhcp.leaseHours * 3600}</defaultleasetime>`,
          ...dhcp.reservations.flatMap(({ mac, ip, hostname: client }) => [
            '\t\t\t<staticmap>',
            `\t\t\t\t<mac>${mac}</mac>`,
            `\t\t\t\t<ipaddr>${ip}</ipaddr>`,
            `\t\t\t\t<hostname>${client}</hostname>`,
            '\t\t\t</staticmap>',
          ]),
          '\t\t</lan>',
          '\t</dhcpd>',
        ]),
    ...(denies.length === 0
      ? []
      : [
          '\t<filter>',
          ...denies.flatMap((port) => [
            '\t\t<rule>',
            '\t\t\t<type>block</type>',
            '\t\t\t<interface>lan</interface>',
            '\t\t\t<protocol>tcp</protocol>',
            '\t\t\t<destination>',
            '\t\t\t\t<any></any>',
            `\t\t\t\t<port>${port}</port>`,
            '\t\t\t</destination>',
            `\t\t\t<descr>deny ${port}</descr>`,
            '\t\t</rule>',
          ]),
          '\t</filter>',
        ]),
    '\t<snmpd>',
    ...(snmp ? ['\t\t<enable></enable>', '\t\t<rocommunity>xxxxx</rocommunity>'] : []),
    '\t</snmpd>',
    '\t<revision>',
    `\t\t<time>${Math.floor(takenAt.getTime() / 1000)}</time>`,
    `\t\t<description>${who}: Saved configuration</description>`,
    `\t\t<username>${who}</username>`,
    '\t</revision>',
    '</pfsense>',
  ]);
};

const ubiquiti = (config: Configuration): string => {
  const { hostname, address, dhcp, denies, snmp } = config;
  return lines([
    ...(denies.length === 0
      ? []
      : [
          'firewall {',
          '    name LAN_IN {',
          '        default-action accept',
          ...denies.flatMap((port, index) => [
            `        rule ${(index + 1) * 10} {`,
            '            action drop',
            '            destination {',
            `                port ${port}`,
            '            }',
            '            protocol tcp',
            '        }',
          ]),
          '    }',
          '}',
        ]),
    'interfaces {',
    '    ethernet eth1 {',
    `        address ${address}/24`,
    '        description LAN',
    '    }',
    '}',
    'service {',
    ...(dhcp === null
      ? []
      : [
          '    dhcp-server {',
          '        shared-network-name LAN {',
          `            subnet ${dhcp.subnet}.0/24 {`,
          `                default-router ${dhcp.subnet}.1`,
          `                lease ${dhcp.leaseHours * 3600}`,
          `                start ${dhcp.subnet}.2 {`,
          `                    stop ${dhcp.subnet}.254`,
          '                }',
          ...dhcp.reservations.flatMap(({ mac, ip, hostname: client }) => [
            `                static-mapping ${client} {`,
            `                    ip-address ${ip}`,
            `                    mac-address ${mac}`,
            '                }',
          ]),
          '            }',
          '        }',
          '    }',
        ]),
    ...(snmp
      ? ['    snmp {', '        community **************** {', '            authorization rw', '        }', '    }']
      : []),
    '    ssh {',
    '        port 22',
    '    }',
    '}',
    'system {',
    `    host-name ${hostname}`,
    '    login {',
    '        user root {',
    '            authentication {',
    '                encrypted-password ****************',
    '            }',
    '        }',
    '    }',
    '}',
  ]);
};

/** Each vendor's export, and the name its admin saved it under. */
const EXPORTS: Readonly<
  Record<
    FirmwareVendor,
    {
      readonly render: (config: Configuration) => string;
      readonly name: (hostname: string, takenAt: Date) => string;
    }
  >
> = {
  cisco: { render: cisco, name: (hostname, at) => `${hostname}-${day(at)}.cfg` },
  mikrotik: { render: mikrotik, name: (hostname, at) => `${hostname}-${day(at)}.rsc` },
  openwrt: { render: openwrt, name: (hostname, at) => `${hostname}-${day(at)}.uci` },
  ddwrt: { render: ddwrt, name: (hostname, at) => `${hostname}-${day(at)}.nvram` },
  pfsense: {
    render: pfsense,
    name: (hostname, at) =>
      `config-${hostname}-${at.toISOString().slice(0, 19).replace(/\D/g, '')}.xml`,
  },
  ubiquiti: { render: ubiquiti, name: (hostname, at) => `${hostname}-${day(at)}.config.boot` },
};

/** `/root/backups` on a gateway, as the entry `/root` holds it; nothing for a gateway the
 *  network does not generate. */
export const gatewayBackups = (options: {
  readonly essid: string;
  readonly machineId: string;
  readonly vendor: FirmwareVendor;
  readonly dhcp: DhcpService | null;
  readonly denies: readonly number[];
  readonly snmp: boolean;
}): Readonly<Record<string, FileNode>> => {
  const { essid, machineId, vendor, dhcp, denies, snmp } = options;
  const site = gatewaySite(essid, machineId);
  if (site === undefined) return {};
  const prng = createPrng(`gw-history-backups-${machineId}`);
  const isAccessPoint = site.onLan && lanHostOctet(site.host) === 1;
  const lifeDays = prng.nextInt(LIFE_DAYS.shortest, LIFE_DAYS.longest);
  const daysAgo = prng.pickN(
    Array.from({ length: lifeDays }, (_, index) => index + 1),
    isAccessPoint ? 1 : prng.nextInt(2, 4),
  );
  const { render, name } = EXPORTS[vendor];
  // Oldest first, the order the admin took them in.
  const files = [...daysAgo].sort((left, right) => right - left).map((ago) => {
    const takenAt = new Date(WORLD_EPOCH - ago * DAY_MS + prng.nextInt(0, DAY_MS / 1000 - 1) * 1000);
    const config: Configuration = {
      hostname: site.host.hostname,
      address: dhcp === null ? site.host.ip : `${dhcp.subnet}.1`,
      dhcp,
      denies,
      snmp,
      adminIp: site.adminIp,
      takenAt,
    };
    return [name(site.host.hostname, takenAt), file(render(config), ROOT_FILE)] as const;
  });
  return { backups: dir(Object.fromEntries(files), ROOT_DIR) };
};
