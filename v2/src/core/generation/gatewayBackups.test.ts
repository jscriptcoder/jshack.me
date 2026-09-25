import { describe, expect, it } from 'vitest';
import { gatewayAdminIp } from './gatewayHistory';
import { md5 } from './md5';
import { ALL_GENERATED_PASSWORDS } from './passwordPools';
import { parseAclDenies } from '../network/switchAcl';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import type { FileNode } from '../filesystem/types';
import { WORLD_EPOCH } from '../cve/worldClock';
import { FIRMWARE_VENDORS, type FirmwareVendor } from '../packages/packageVersions';
import {
  ALL_ESSIDS,
  gatewaysOn,
  softwareVersionsIn,
  type Gateway,
} from '../../test/worldContent';

/**
 * A gateway's configuration backups, read the way a player who has rooted the box reads
 * them — `ls /root/backups`, then `cat` — and checked against the live box beside them.
 */

const BACKUPS = '/root/backups';
const DAY_MS = 86_400_000;
/** The longest a gateway has been in service before the world began. */
const LONGEST_LIFE_DAYS = 4 * 365;
/** The most characters one signed write carries, which is what a fetched copy costs. */
const CARRY_CAP = 8192;

const PASSWORD_WORDS: ReadonlySet<string> = new Set(ALL_GENERATED_PASSWORDS);

const everyGateway = (): readonly Gateway[] => gatewaysOn(ALL_ESSIDS);

const view = (gateway: Gateway) => createFsView(gateway.tree, { userType: 'root' });

const nodeAt = (gateway: Gateway, path: string): FileNode | null =>
  view(gateway).stat(asAbsPath(path));

const contentAt = (gateway: Gateway, path: string): string => {
  const node = nodeAt(gateway, path);
  return node?.kind === 'file' ? node.content : '';
};

const backupsOf = (gateway: Gateway): ReadonlyMap<string, string> => {
  const node = nodeAt(gateway, BACKUPS);
  if (node?.kind !== 'directory') throw new Error(`${gateway.name} keeps no ${BACKUPS}`);
  return new Map(
    [...node.entries].map(([name, entry]) => {
      if (entry.kind !== 'file') throw new Error(`${gateway.name}: ${name} is not a file`);
      return [name, entry.content];
    }),
  );
};

/** The newest backup: the one whose name carries the latest date. */
const newestOf = (gateway: Gateway): string => {
  const [newest] = [...backupsOf(gateway)].sort(([left], [right]) =>
    dayOf(right).localeCompare(dayOf(left)),
  );
  if (newest === undefined) throw new Error(`${gateway.name} keeps no backup`);
  return newest[1];
};

const vendorOf = (gateway: Gateway): FirmwareVendor => {
  const vendor = /^Package: (\w+)-firmware$/m.exec(contentAt(gateway, '/var/lib/dpkg/status'))?.[1];
  const known = FIRMWARE_VENDORS.find((candidate) => candidate === vendor);
  if (known === undefined) throw new Error(`${gateway.name} runs no known firmware`);
  return known;
};

/** A backup's day, as `YYYY-MM-DD`, read off its file name. */
const dayOf = (name: string): string => {
  const match = /(\d{4})-?(\d\d)-?(\d\d)/.exec(name);
  if (match === null) throw new Error(`${name} carries no date`);
  return `${match[1]}-${match[2]}-${match[3]}`;
};

/** What a configuration says about the box, in one shape whatever wrote it. */
type Facts = {
  readonly hostname: string;
  /** The address the box answers on, on the segment it serves. */
  readonly address: string;
  /** The DHCP it serves, with each reservation as `mac ip hostname`, sorted. */
  readonly dhcp: {
    readonly subnet: string;
    readonly leaseHours: number;
    readonly reservations: readonly string[];
  } | null;
  readonly denies: readonly number[];
  readonly snmp: boolean;
};

/** What the backup says beyond the facts: the values standing where a secret would go,
 *  and the day it says it was taken, where its format records one. */
type Reading = Facts & { readonly secrets: readonly string[]; readonly takenOn: string | null };

/** The facts the live box states in its own files. */
const factsOfBox = (gateway: Gateway): Facts => {
  const config = contentAt(gateway, '/etc/dnsmasq.conf');
  const range = /^dhcp-range=(\S+)\.2,\S+,(\d+)h$/m.exec(config);
  const dhcp =
    range === null
      ? null
      : {
          subnet: range[1] ?? '',
          leaseHours: Number(range[2]),
          reservations: [...config.matchAll(/^dhcp-host=([^,]+),([^,]+),(\S+)$/gm)]
            .map(([, mac, ip, hostname]) => `${mac} ${ip} ${hostname}`)
            .sort(),
        };
  return {
    hostname: gateway.host.hostname,
    address: dhcp === null ? gateway.host.ip : `${dhcp.subnet}.1`,
    dhcp,
    denies: parseAclDenies(contentAt(gateway, '/etc/switch/acl.conf')),
    snmp: nodeAt(gateway, '/var/run/snmpd.pid') !== null,
  };
};

const captured = (pattern: RegExp, text: string): string => {
  const match = pattern.exec(text);
  if (match?.[1] === undefined) throw new Error(`no ${pattern} in:\n${text}`);
  return match[1];
};

const all = (pattern: RegExp, text: string): readonly string[] =>
  [...text.matchAll(pattern)].map((match) => match[1] ?? '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A dotted `aabb.ccdd.eeff` hardware address in the colon form every other table uses. */
const colonMac = (dotted: string): string =>
  (dotted.replaceAll('.', '').match(/../g) ?? []).join(':');

/** Each vendor's backup read back into facts, by that vendor's own syntax. */
const READERS: Readonly<Record<FirmwareVendor, (text: string) => Reading>> = {
  cisco: (text) => {
    const pools = text
      .split(/^ip dhcp pool /m)
      .slice(1)
      .map((block) => block.split('\n!')[0] ?? '');
    const lan = pools.find((block) => /^ network /m.test(block));
    const changed = /^! Last configuration change at [\d:]+ UTC \w+ (\w+) (\d+) (\d{4})$/m.exec(text);
    return {
      hostname: captured(/^hostname (\S+)$/m, text),
      address: captured(/^ ip address (\S+) 255\.255\.255\.0$/m, text),
      dhcp:
        lan === undefined
          ? null
          : {
              subnet: captured(/^ network (\S+)\.0 255\.255\.255\.0$/m, lan),
              leaseHours: Number(captured(/^ lease 0 (\d+)$/m, lan)),
              reservations: pools
                .filter((block) => /^ host /m.test(block))
                .map(
                  (block) =>
                    `${colonMac(captured(/^ hardware-address (\S+)$/m, block))} ${captured(/^ host (\S+) /m, block)} ${block.split('\n')[0]}`,
                )
                .sort(),
            },
      denies: all(/^ deny tcp any any eq (\d+)$/gm, text).map(Number),
      snmp: /^snmp-server community /m.test(text),
      secrets: all(/(?:secret 5|community) (\S+)/g, text),
      takenOn:
        changed === null
          ? null
          : `${changed[3]}-${String(MONTHS.indexOf(changed[1] ?? '') + 1).padStart(2, '0')}-${(changed[2] ?? '').padStart(2, '0')}`,
    };
  },
  mikrotik: (text) => {
    const pool = /^add name=dhcp-lan ranges=(\S+)\.2-\S+$/m.exec(text);
    return {
      hostname: captured(/^\/system identity\nset name=(\S+)$/m, text),
      address: captured(/^add address=(\S+)\/24 interface=bridge-lan/m, text),
      dhcp:
        pool === null
          ? null
          : {
              subnet: pool[1] ?? '',
              leaseHours: Number(captured(/ lease-time=(\d+)h /, text)),
              reservations: [
                ...text.matchAll(/^add address=(\S+) comment=(\S+) mac-address=(\S+)$/gm),
              ]
                .map(([, ip, hostname, mac]) => `${(mac ?? '').toLowerCase()} ${ip} ${hostname}`)
                .sort(),
            },
      denies: all(/^add action=drop chain=forward dst-port=(\d+) protocol=tcp$/gm, text).map(Number),
      snmp: captured(/^\/snmp\nset enabled=(\w+)$/m, text) === 'yes',
      secrets: [],
      takenOn: /^# (\d{4}-\d\d-\d\d) [\d:]+ by RouterOS$/m.exec(text)?.[1] ?? null,
    };
  },
  openwrt: (text) => {
    const address = captured(/^\toption ipaddr '(\S+)'$/m, text);
    const serves = /^package dhcp$/m.test(text);
    return {
      hostname: captured(/^\toption hostname '(\S+)'$/m, text),
      address,
      dhcp: serves
        ? {
            subnet: address.split('.').slice(0, 3).join('.'),
            leaseHours: Number(captured(/^\toption leasetime '(\d+)h'$/m, text)),
            reservations: [
              ...text.matchAll(
                /^config host\n\toption name '(\S+)'\n\toption mac '(\S+)'\n\toption ip '(\S+)'$/gm,
              ),
            ]
              .map(([, hostname, mac, ip]) => `${mac} ${ip} ${hostname}`)
              .sort(),
          }
        : null,
      denies: all(/^\toption dest_port '(\d+)'$/gm, text).map(Number),
      snmp: captured(/^config agent\n\toption enabled '(\d)'$/m, text) === '1',
      secrets: all(/^\toption community '(\S+)'$/gm, text),
      takenOn: null,
    };
  },
  ddwrt: (text) => {
    const value = (key: string): string | undefined =>
      new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1];
    const address = value('lan_ipaddr') ?? '';
    return {
      hostname: value('router_name') ?? '',
      address,
      dhcp:
        value('lan_proto') === 'dhcp'
          ? {
              subnet: address.split('.').slice(0, 3).join('.'),
              leaseHours: Number(value('dhcp_lease')) / 60,
              reservations: (value('static_leases') ?? '')
                .split(' ')
                .filter((entry) => entry !== '')
                .map((entry) => {
                  const [mac, hostname, ip] = entry.split('=');
                  return `${mac} ${ip} ${hostname}`;
                })
                .sort(),
            }
          : null,
      denies: all(/^filter_port_grp\d+=(\d+)-\d+$/gm, text).map(Number),
      snmp: value('snmpd_enable') === '1',
      secrets: all(/^(?:http_passwd|snmpd_rwcommunity)=(.*)$/gm, text),
      takenOn: null,
    };
  },
  pfsense: (text) => {
    const dhcp = /<dhcpd>([\s\S]*?)<\/dhcpd>/.exec(text)?.[1];
    const snmp = /<snmpd>([\s\S]*?)<\/snmpd>/.exec(text)?.[1] ?? '';
    const revised = Number(captured(/<revision>\s*<time>(\d+)<\/time>/, text));
    return {
      hostname: captured(/<hostname>(\S+)<\/hostname>/, text),
      address: captured(/<lan>\s*<enable><\/enable>\s*<if>\w+<\/if>\s*<ipaddr>(\S+)<\/ipaddr>/, text),
      dhcp:
        dhcp === undefined
          ? null
          : {
              subnet: captured(/<from>(\S+)\.2<\/from>/, dhcp),
              leaseHours: Number(captured(/<defaultleasetime>(\d+)<\/defaultleasetime>/, dhcp)) / 3600,
              reservations: [
                ...dhcp.matchAll(
                  /<staticmap>\s*<mac>(\S+)<\/mac>\s*<ipaddr>(\S+)<\/ipaddr>\s*<hostname>(\S+)<\/hostname>/g,
                ),
              ]
                .map(([, mac, ip, hostname]) => `${mac} ${ip} ${hostname}`)
                .sort(),
            },
      denies: all(/<type>block<\/type>[\s\S]*?<port>(\d+)<\/port>/g, text).map(Number),
      snmp: snmp.includes('<enable></enable>'),
      secrets: all(/<(?:bcrypt-hash|rocommunity)>(.*?)<\//g, text),
      takenOn: new Date(revised * 1000).toISOString().slice(0, 10),
    };
  },
  ubiquiti: (text) => {
    const subnet = /^ {12}subnet (\S+)\.0\/24 \{$/m.exec(text)?.[1];
    return {
      hostname: captured(/^ {4}host-name (\S+)$/m, text),
      address: captured(/^ {8}address (\S+)\/24$/m, text),
      dhcp:
        subnet === undefined
          ? null
          : {
              subnet,
              leaseHours: Number(captured(/^ {16}lease (\d+)$/m, text)) / 3600,
              reservations: [
                ...text.matchAll(
                  /^ {16}static-mapping (\S+) \{\n {20}ip-address (\S+)\n {20}mac-address (\S+)$/gm,
                ),
              ]
                .map(([, hostname, ip, mac]) => `${mac} ${ip} ${hostname}`)
                .sort(),
            },
      denies: all(/^ {12}destination \{\n {16}port (\d+)$/gm, text).map(Number),
      snmp: /^ {4}snmp \{$/m.test(text),
      secrets: all(/(?:community|encrypted-password) (\S+)/g, text),
      takenOn: null,
    };
  },
};

/** How each vendor's own export shows a secret it will not print. MikroTik's export
 *  leaves sensitive values out altogether, so it shows none. */
const MASKS: Readonly<Record<FirmwareVendor, string | null>> = {
  cisco: '<removed>',
  mikrotik: null,
  openwrt: '********',
  ddwrt: '********',
  pfsense: 'xxxxx',
  ubiquiti: '****************',
};

/** Where every vendor's export starts, so a player knows the format at a glance. */
const OPENINGS: Readonly<Record<FirmwareVendor, RegExp>> = {
  cisco: /^!\n! Last configuration change at /,
  mikrotik: /^# \d{4}-\d\d-\d\d [\d:]+ by RouterOS\n/,
  openwrt: /^package system\n/,
  ddwrt: /^dhcp_|^filter_|^http_passwd=/,
  pfsense: /^<\?xml version="1\.0"\?>\n<pfsense>\n/,
  ubiquiti: /^firewall \{\n|^interfaces \{\n/,
};

const EXTENSIONS: Readonly<Record<FirmwareVendor, RegExp>> = {
  cisco: /\.cfg$/,
  mikrotik: /\.rsc$/,
  openwrt: /\.uci$/,
  ddwrt: /\.nvram$/,
  pfsense: /^config-[\w-]+-\d{14}\.xml$/,
  ubiquiti: /\.config\.boot$/,
};

describe("a gateway's configuration backups", () => {
  it('keeps them in /root/backups, which only root can read', () => {
    for (const gateway of everyGateway()) {
      expect(nodeAt(gateway, BACKUPS)?.perms.read, gateway.name).toEqual(['root']);
      for (const name of backupsOf(gateway).keys()) {
        const node = nodeAt(gateway, `${BACKUPS}/${name}`);
        expect(node?.perms.read, `${gateway.name} ${name}`).toEqual(['root']);
        expect(node?.perms.write, `${gateway.name} ${name}`).toEqual(['root']);
      }
    }
  });

  it('keeps one on the access point, which every occupant carries, and two to four elsewhere', () => {
    for (const gateway of everyGateway()) {
      const count = backupsOf(gateway).size;
      if (gateway.host.ip.endsWith('.1') && gateway.onLan) {
        expect(count, gateway.name).toBe(1);
      } else {
        expect(count, gateway.name).toBeGreaterThanOrEqual(2);
        expect(count, gateway.name).toBeLessThanOrEqual(4);
      }
    }
  });

  it('dates each one by the day it was taken, a different day each, within the box’s life', () => {
    const epochDay = new Date(WORLD_EPOCH).toISOString().slice(0, 10);
    const earliest = new Date(WORLD_EPOCH - LONGEST_LIFE_DAYS * DAY_MS).toISOString().slice(0, 10);
    for (const gateway of everyGateway()) {
      const days = [...backupsOf(gateway).keys()].map(dayOf);
      expect(new Set(days).size, gateway.name).toBe(days.length);
      expect(days, `${gateway.name} lists them oldest first`).toEqual([...days].sort());
      for (const day of days) {
        expect(day < epochDay, `${gateway.name} ${day}`).toBe(true);
        expect(day >= earliest, `${gateway.name} ${day}`).toBe(true);
      }
    }
  });

  it('says inside the same day its name carries, where the format records one', () => {
    for (const gateway of everyGateway()) {
      const read = READERS[vendorOf(gateway)];
      for (const [name, content] of backupsOf(gateway)) {
        const { takenOn } = read(content);
        if (takenOn !== null) expect(takenOn, `${gateway.name} ${name}`).toBe(dayOf(name));
      }
    }
  });

  it('exports in the firmware vendor’s own format, named the way that vendor names it', () => {
    for (const gateway of everyGateway()) {
      const vendor = vendorOf(gateway);
      for (const [name, content] of backupsOf(gateway)) {
        expect(name, `${gateway.name} (${vendor})`).toMatch(EXTENSIONS[vendor]);
        expect(content, `${gateway.name} ${name}`).toMatch(OPENINGS[vendor]);
      }
    }
  });

  it('agrees in every backup with the box as it stands: name, address, DHCP, ACL and agent', () => {
    for (const gateway of everyGateway()) {
      const expected = factsOfBox(gateway);
      const read = READERS[vendorOf(gateway)];
      for (const [name, content] of backupsOf(gateway)) {
        const { secrets: _secrets, takenOn: _takenOn, ...stated } = read(content);
        expect(stated, `${gateway.name} ${name}`).toEqual(expected);
      }
    }
  });

  it('shows every secret the way the vendor’s export masks it', () => {
    for (const gateway of everyGateway()) {
      const vendor = vendorOf(gateway);
      const secrets = READERS[vendor](newestOf(gateway)).secrets;
      const mask = MASKS[vendor];
      if (mask === null) {
        expect(secrets, gateway.name).toEqual([]);
        continue;
      }
      for (const secret of secrets) expect(secret, gateway.name).toBe(mask);
      // An OpenWrt export keeps no password at all; the agent's community is the one
      // secret it would print, and where the agent runs it stands masked.
      if (vendor !== 'openwrt' || factsOfBox(gateway).snmp) {
        expect(secrets.length, gateway.name).toBeGreaterThan(0);
      }
    }
  });

  it('holds no password or community the box accepts, in the clear or hashed', () => {
    for (const gateway of everyGateway()) {
      const rootHash = captured(/^root:([^:]+):/m, contentAt(gateway, '/etc/passwd'));
      const communityHash = /^rwcommunity\s+(\S+)/m.exec(contentAt(gateway, '/var/lib/snmp/snmpd.conf'))?.[1];
      const secrets = [rootHash, ...(communityHash === undefined ? [] : [communityHash])];
      for (const [name, content] of backupsOf(gateway)) {
        for (const secret of secrets) expect(content, `${gateway.name} ${name}`).not.toContain(secret);
        for (const word of content.split(/[\s'"<>=,{}/]+/)) {
          expect(secrets, `${gateway.name} ${name}: ${word}`).not.toContain(md5(word));
          // Nor any word the game draws a password or a community from, so a backup
          // can never be read as a hint to another box's lock either.
          expect(PASSWORD_WORDS.has(word), `${gateway.name} ${name}: ${word}`).toBe(false);
        }
      }
    }
  });

  it('names no host but the box’s own segment and its admin', () => {
    for (const gateway of everyGateway()) {
      const { address, dhcp } = factsOfBox(gateway);
      const segment = address.split('.').slice(0, 3).join('.');
      const known = new Set([
        address,
        // The segment itself, its netmask and the bounds of the range it hands out.
        `${segment}.0`,
        `${segment}.2`,
        `${segment}.254`,
        '255.255.255.0',
        gatewayAdminIp(gateway.essid, gateway.machineId),
        ...(dhcp?.reservations.map((reservation) => reservation.split(' ')[1]) ?? []),
      ]);
      for (const [name, content] of backupsOf(gateway)) {
        for (const candidate of content.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) {
          expect(known.has(candidate), `${gateway.name} ${name} names ${candidate}`).toBe(true);
        }
      }
    }
  });

  it('names no software version', () => {
    for (const gateway of everyGateway()) {
      for (const [name, content] of backupsOf(gateway)) {
        // The XML declaration's version is the markup's, and a dotted hardware address
        // only looks like one; neither dates the box.
        const prose = content
          .replace(/^<\?xml version="1\.0"\?>/, '')
          .replace(/\b[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\b/g, '');
        expect(softwareVersionsIn(prose), `${gateway.name} ${name}`).toEqual([]);
      }
    }
  });

  it('fits each one in the single write that saves a fetched copy', () => {
    for (const gateway of everyGateway()) {
      for (const [name, content] of backupsOf(gateway)) {
        expect(JSON.stringify(content).length, `${gateway.name} ${name}`).toBeLessThanOrEqual(CARRY_CAP);
      }
    }
  });

  it('meets every vendor on routers and on switches somewhere in the world', () => {
    const met = new Set(everyGateway().map((gateway) => `${vendorOf(gateway)} ${gateway.host.kind}`));
    for (const vendor of FIRMWARE_VENDORS) {
      expect(met.has(`${vendor} router`), vendor).toBe(true);
      expect(met.has(`${vendor} switch`), vendor).toBe(true);
    }
  });

  it('never repeats one gateway’s backup on another', () => {
    const newest = everyGateway().map(newestOf);
    expect(new Set(newest).size).toBe(newest.length);
  });
});
