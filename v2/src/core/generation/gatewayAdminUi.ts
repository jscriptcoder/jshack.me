/**
 * A gateway's admin UI, on disk: the vendor's pages in its web root, and the web
 * server's config that keeps them on the loopback.
 *
 * The pages state what the gateway serves — a router's leases and reservations, a
 * switch's ports — and, on some, its ACL and its system, so a player who is on the box
 * reads the same network the files beside them describe. The server binds `127.0.0.1`
 * alone and runs as no daemon of its own, so nothing new answers on the network and no
 * forward is ever shadowed. The web root is never `/var/www`, which a reader off the box
 * may fetch: these pages are the admin's, and reading them costs a session.
 *
 * The access point, whose tree every occupant carries, keeps two pages; every other
 * gateway keeps two to four. Everything draws from the gateway's own `gw-history-ui-`
 * stream, keyed by its machine id.
 */

import type { FileEntry } from '../filesystem/types';
import type { FirmwareVendor } from '../packages/packageVersions';
import { file, SERVICE_CONFIG_FILE, WEB_PAGE_FILE } from './baseFs';
import { createPrng } from './prng';
import { gatewaySite } from './gatewayHistory';
import { lanHostOctet } from './lanTopology';
import type { DhcpGrant, DhcpService, SwitchPort } from './gatewayNetwork';

const LOOPBACK = '127.0.0.1';

/** What each vendor calls its admin UI, and where its firmware keeps the pages. */
const VENDOR_UIS: Readonly<Record<FirmwareVendor, { readonly product: string; readonly root: string }>> =
  {
    cisco: { product: 'Cisco Device Manager', root: '/usr/share/cisco/www' },
    mikrotik: { product: 'WebFig', root: '/usr/share/mikrotik/www' },
    openwrt: { product: 'LuCI', root: '/www' },
    ddwrt: { product: 'DD-WRT Control Panel', root: '/www' },
    pfsense: { product: 'pfSense webConfigurator', root: '/usr/local/www' },
    ubiquiti: { product: 'EdgeOS', root: '/usr/share/ubiquiti/www' },
  };

/** The web server's config for each vendor, and where it keeps it. */
const serverConfig = (vendor: FirmwareVendor, root: string): readonly [string, string] => {
  if (vendor === 'openwrt') {
    return [
      '/etc/config/uhttpd',
      [
        "config uhttpd 'main'",
        `\tlist listen_http '${LOOPBACK}:80'`,
        `\toption home '${root}'`,
        "\toption index_page 'index.html'",
        '',
      ].join('\n'),
    ];
  }
  if (vendor === 'pfsense') {
    return [
      '/var/etc/nginx-webConfigurator.conf',
      [
        'server {',
        `\tlisten ${LOOPBACK}:80;`,
        `\troot "${root}";`,
        '\tindex index.html;',
        '}',
        '',
      ].join('\n'),
    ];
  }
  return [
    '/etc/lighttpd/lighttpd.conf',
    [
      `server.document-root = "${root}"`,
      `server.bind = "${LOOPBACK}"`,
      'server.port = 80',
      'index-file.names = ( "index.html" )',
      '',
    ].join('\n'),
  ];
};

type Page = { readonly name: string; readonly title: string; readonly body: readonly string[] };

const table = (headings: readonly string[], rows: readonly (readonly (string | number)[])[]): readonly string[] => [
  '<table>',
  `<tr>${headings.map((heading) => `<th>${heading}</th>`).join('')}</tr>`,
  ...rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`),
  '</table>',
];

/** A moment of the epoch as the UI prints it, `YYYY-MM-DD HH:MM:SS`. */
const stamp = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');

const render = (options: {
  readonly product: string;
  readonly hostname: string;
  readonly page: Page;
  readonly links: readonly Page[];
}): string => {
  const { product, hostname, page, links } = options;
  return `${[
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    `<title>${page.title} - ${hostname} - ${product}</title>`,
    '</head>',
    '<body>',
    `<h1>${product}</h1>`,
    `<h2>${page.title}</h2>`,
    ...page.body,
    '<ul>',
    ...links.map((link) => `<li><a href="${link.name}">${link.title}</a></li>`),
    '</ul>',
    '</body>',
    '</html>',
  ].join('\n')}\n`;
};

/** The admin UI's files, by absolute path; none for a gateway the network does not
 *  generate. */
export const gatewayAdminUi = (options: {
  readonly essid: string;
  readonly machineId: string;
  readonly vendor: FirmwareVendor;
  readonly grants: readonly DhcpGrant[];
  readonly dhcp: DhcpService | null;
  readonly ports: readonly SwitchPort[];
  readonly denies: readonly number[];
  readonly snmp: boolean;
}): readonly (readonly [string, FileEntry])[] => {
  const { essid, machineId, vendor, grants, dhcp, ports, denies, snmp } = options;
  const site = gatewaySite(essid, machineId);
  if (site === undefined) return [];
  const prng = createPrng(`gw-history-ui-${machineId}`);
  const { product, root } = VENDOR_UIS[vendor];
  const { hostname } = site.host;
  const address = dhcp === null ? site.host.ip : `${dhcp.subnet}.1`;

  const served: Page =
    dhcp === null
      ? {
          name: 'ports.html',
          title: 'Ports',
          body: table(
            ['Port', 'MAC address', 'VLAN', 'Description'],
            ports.map(({ port, mac, vlan, hostname: client, ip }) => [port, mac, vlan, `${client} (${ip})`]),
          ),
        }
      : {
          name: 'dhcp.html',
          title: 'DHCP leases',
          body: [
            '<h3>Active leases</h3>',
            ...table(
              ['Hostname', 'IP address', 'MAC address', 'Expires'],
              grants.map(({ hostname: client, ip, mac, at }) => [
                client,
                ip,
                mac,
                stamp(at + dhcp.leaseHours * 3600),
              ]),
            ),
            '<h3>Static leases</h3>',
            ...table(
              ['Hostname', 'IP address', 'MAC address'],
              dhcp.reservations.map(({ hostname: client, ip, mac }) => [client, ip, mac]),
            ),
          ],
        };
  const firewall: Page = {
    name: 'firewall.html',
    title: dhcp === null ? 'Access control' : 'Port forwards',
    body:
      dhcp === null
        ? table(
            ['Action', 'Protocol', 'Port'],
            denies.map((port) => ['deny', 'tcp', port]),
          )
        : ['<p>No port forwards are configured.</p>'],
  };
  const system: Page = {
    name: 'system.html',
    title: 'System',
    body: table(
      ['Setting', 'Value'],
      [
        ['Hostname', hostname],
        ['SSH', 'enabled'],
        ['SNMP agent', snmp ? 'enabled' : 'disabled'],
        ['Managed from', site.adminIp],
      ],
    ),
  };
  const isAccessPoint = site.onLan && lanHostOctet(site.host) === 1;
  const extras = prng.pickN([firewall, system], isAccessPoint ? 0 : prng.nextInt(0, 2));
  const others = [served, ...extras];
  const front: Page = {
    name: 'index.html',
    title: 'Status',
    body: table(
      ['Setting', 'Value'],
      [
        ['Hostname', hostname],
        ['LAN address', address],
      ],
    ),
  };

  const [configPath, configContent] = serverConfig(vendor, root);
  return [
    [
      `${root}/${front.name}`,
      file(render({ product, hostname, page: front, links: others }), WEB_PAGE_FILE),
    ],
    ...others.map(
      (page) =>
        [
          `${root}/${page.name}`,
          file(render({ product, hostname, page, links: [front] }), WEB_PAGE_FILE),
        ] as const,
    ),
    [configPath, file(configContent, SERVICE_CONFIG_FILE)],
  ];
};
