/**
 * Shared reading tools for tests of generated world content: the boxes a network holds,
 * a directory as a flat map of files, a tree as comparable data, and the oracle that says
 * whether a shell-history line would really work if a player typed it on the box.
 */

import { hostServices, npcUsername } from '../core/generation/remoteHostFs';
import { crackableEssidPool } from '../core/generation/generateWifi';
import { generateHomeLan, type LanHost } from '../core/generation/generateHomeLan';
import { generateDeepLayer } from '../core/generation/generateDeepLayer';
import { chainLinks, machineIdForLanHost } from '../core/generation/lanTopology';
import { buildApGatewayBaseFs } from '../core/generation/routerFs';
import { chainGatewayBaseFsForMachineId } from '../core/generation/lanHostIdentity';
import { createFsView } from '../core/filesystem/fsView';
import { resolveLanName } from '../core/network/resolveName';
import { asAbsPath } from '../core/types';
import type { Directory, FileNode } from '../core/filesystem/types';

export type Box = { readonly essid: string; readonly host: LanHost };

/** Networks outside the catalog: another player's, or a router's factory name. */
export const UNCATALOGUED_ESSIDS = [
  'Linksys-Kitchen',
  'TP-LINK_5G_4A2F',
  'HOME-WIFI-2.4G',
  'xfinitywifi',
];
export const ALL_ESSIDS = [...crackableEssidPool, ...UNCATALOGUED_ESSIDS];

/** Every generated machine on these networks' home LANs. */
export const lanBoxes = (essids: readonly string[]): readonly Box[] =>
  essids.flatMap((essid) =>
    generateHomeLan(essid)
      .hosts.filter((host) => host.kind === 'machine')
      .map((host) => ({ essid, host })),
  );

/** Every deep-layer NPC on these networks, with the gateway it hangs off. */
export const deepBoxes = (essids: readonly string[]) =>
  essids.flatMap((essid) =>
    chainLinks(essid).map((link) => {
      const gateway = { machineId: link.machineId, kind: link.host.kind };
      return { essid, gateway, host: generateDeepLayer(essid, gateway).host };
    }),
  );

/** A gateway as the world places it: where it stands, and the tree it is built with. */
export type Gateway = {
  readonly name: string;
  readonly essid: string;
  readonly machineId: string;
  readonly host: LanHost;
  /** Whether it stands on the home LAN (the access point and the Layer-1 gateways)
   *  rather than on a layer below it. */
  readonly onLan: boolean;
  readonly tree: Directory;
};

/** Every gateway on these networks: the access point and each gateway down its chain.
 *  Built on each call, so a test that asks for them also exercises their builders. */
export const gatewaysOn = (essids: readonly string[]): readonly Gateway[] =>
  essids.flatMap((essid) => {
    const accessPoint = generateHomeLan(essid).hosts.find((host) => host.ip.endsWith('.1'));
    if (accessPoint === undefined) throw new Error(`${essid} has no access point`);
    const chain = chainLinks(essid).map((link): Gateway => {
      const tree = chainGatewayBaseFsForMachineId(essid, link.machineId);
      if (tree === null) throw new Error(`no tree for ${link.machineId}`);
      return {
        name: `${essid} ${link.host.ip}`,
        essid,
        machineId: link.machineId,
        host: link.host,
        onLan: link.parentMachineId === null,
        tree,
      };
    });
    return [
      {
        name: `${essid} ${accessPoint.ip}`,
        essid,
        machineId: machineIdForLanHost(accessPoint, essid),
        host: accessPoint,
        onLan: true,
        tree: buildApGatewayBaseFs(essid),
      },
      ...chain,
    ];
  });

/** Every file under a directory, keyed by its path relative to it. */
export const filesUnder = (directory: Directory, prefix = ''): ReadonlyMap<string, string> =>
  new Map(
    [...directory.entries].flatMap(([name, node]): (readonly [string, string])[] =>
      node.kind === 'file'
        ? [[`${prefix}${name}`, node.content]]
        : [...filesUnder(node, `${prefix}${name}/`)],
    ),
  );

/** A tree as plain data, so two builds can be compared byte for byte. */
export const serialise = (node: FileNode): unknown =>
  node.kind === 'file'
    ? node
    : { ...node, entries: [...node.entries].map(([name, child]) => [name, serialise(child)]) };

/** Why a history line is false on this box, or null when everything it names is real.
 *  A player replays these lines exactly as written, so each must succeed the way it
 *  did for the person who typed it. `home` is where `~` points for whoever typed it. */
export const falsehoodIn = (options: {
  readonly line: string;
  readonly box: Box;
  readonly tree: Directory;
  readonly home: string;
}): string | null => {
  const { line, box, tree, home } = options;
  const lanHosts = generateHomeLan(box.essid).hosts;
  const neighbourNamed = (target: string): LanHost | null => {
    const byIp = lanHosts.find((candidate) => candidate.ip === target);
    if (byIp !== undefined) return byIp;
    const resolved = resolveLanName(box.essid, target);
    const byName = lanHosts.find((candidate) => candidate.ip === resolved?.ip);
    return byName === undefined || byName.kind !== 'machine' ? null : byName;
  };
  const words = line.split(' ');
  const [command] = words;

  if (command !== 'rm') {
    const missingPath = words
      .filter((word) => word.startsWith('~/') || word.startsWith('/'))
      .map((word) => word.replace(/^~/, home))
      .find((path) => createFsView(tree, { userType: 'root' }).stat(asAbsPath(path)) === null);
    if (missingPath !== undefined) return `names ${missingPath}, which is not on the box`;
  }

  if (command === 'ping' || command === 'nslookup') {
    const target = words[1] ?? '';
    const neighbour = neighbourNamed(target);
    if (neighbour === null || neighbour.ip === box.host.ip) return `${target} is not a neighbour`;
    return null;
  }
  if (command === 'ssh') {
    const port = words[1] === '-p' ? Number(words[2]) : 22;
    const [user, target] = (words.at(-1) ?? '').split('@');
    const neighbour = neighbourNamed(target ?? '');
    if (neighbour === null || neighbour.ip === box.host.ip) return `${target} is not a neighbour`;
    const runsSshThere = hostServices(box.essid, neighbour).some(
      ({ spec, port: open }) => spec.service === 'ssh' && open === port,
    );
    if (!runsSshThere) return `${target} runs no sshd on ${port}`;
    if (user !== npcUsername(box.essid, neighbour)) return `${target} has no account ${user}`;
    return null;
  }
  if (command === 'curl') {
    const url = /^http:\/\/([^/:]+)(?::(\d+))?(\/\S*)$/.exec(words[1] ?? '');
    if (url === null) return 'is not a url curl takes';
    const neighbour = neighbourNamed(url[1] ?? '');
    if (neighbour === null) return `${url[1]} is not a neighbour`;
    const port = url[2] === undefined ? 80 : Number(url[2]);
    const serves = hostServices(box.essid, neighbour).some(
      ({ spec, port: open }) => spec.service === 'http' && open === port,
    );
    if (!serves) return `${url[1]} serves no http on ${port}`;
    return url[3] === '/' ? null : `${url[3]} is not a page it serves`;
  }
  return null;
};

/** Every software version a text carries — a bare `1.2` or `v3.4.5` — outside the IPv4
 *  addresses it names, which look like versions and are not. A version dates a box, and
 *  only the package manifest states one. */
export const softwareVersionsIn = (content: string): readonly string[] => {
  const addresses = content.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
  return (content.match(/\bv?\d+\.\d+(?:\.\d+)?\b/g) ?? [])
    .filter((match) => !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(match))
    .filter((version) => !addresses.some((address) => address.includes(version)));
};
