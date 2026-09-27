/**
 * What every device kind shares: which kind a box is, what a device adds to its box, the
 * world's clock as a device reads it, and the plain pages a device's UI is made of.
 */

import { dir, file, HOME_DIR, HOME_FILE } from '../baseFs';
import { WORLD_EPOCH } from '../../cve/worldClock';
import type { Directory, FileNode } from '../../filesystem/types';
import type { PrintedJob } from './printer';

export type DeviceKind = 'camera' | 'recorder' | 'printer' | 'climate' | 'media' | 'plug' | 'lock';

/** Prefixes share a kind only where they are one device in another flavour: a doorbell
 *  and a baby monitor are cameras, a thermostat is a sensor that also sets the heat. */
const KIND_BY_PREFIX: ReadonlyMap<string, DeviceKind> = new Map([
  ['cam', 'camera'],
  ['doorbell', 'camera'],
  ['babycam', 'camera'],
  ['nvr', 'recorder'],
  ['printer', 'printer'],
  ['sensor', 'climate'],
  ['thermostat', 'climate'],
  ['tv', 'media'],
  ['speaker', 'media'],
  ['plug', 'plug'],
  ['lock', 'lock'],
]);

/** The device a box calling itself `hostname` is, or undefined for any other box. */
export const deviceKindOf = (hostname: string): DeviceKind | undefined => {
  const separator = hostname.lastIndexOf('-');
  if (separator < 0) return undefined;
  return KIND_BY_PREFIX.get(hostname.slice(0, separator));
};

/** What a device adds to its box: entries for `/etc` and `/var`, and the configs among
 *  them that root's history may name. */
export type DeviceFiles = {
  readonly etc: Readonly<Record<string, FileNode>>;
  readonly var: Readonly<Record<string, FileNode>>;
  /** Entries for `/var/lib`, where a device keeps its own state beside any daemon's. */
  readonly lib: Readonly<Record<string, FileNode>>;
  /** Entries for `/var/log`, where a device's daemon logs beside the box's own. */
  readonly log: Readonly<Record<string, FileNode>>;
  /** The pages the device's own UI serves where the box runs a web server, by file name
   *  beneath the web root, `index.html` first. */
  readonly pages: ReadonlyMap<string, string>;
  readonly configPaths: readonly string[];
  /** Every job a printer printed, oldest first, for its page log; empty on any other
   *  device. Derived once with the spool, so the log cannot disagree with it. */
  readonly printed: readonly PrintedJob[];
};

export const DAY_SECONDS = 86_400;
export const LAST_SECOND = WORLD_EPOCH / 1000 - 1;

/** One page of a device's UI: its title, its heading, what it says, and a link to every
 *  other page of the UI, so none is a dead end and no link leads anywhere else. */
export const uiPage = ({
  title,
  body,
  nav,
}: {
  readonly title: string;
  readonly body: readonly string[];
  readonly nav: readonly (readonly [string, string])[];
}): string =>
  [
    '<html>',
    `<head><title>${title}</title></head>`,
    '<body>',
    `<h1>${title}</h1>`,
    `<p>${nav.map(([href, label]) => `<a href="${href}">${label}</a>`).join(' | ')}</p>`,
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n');

/** A moment in milliseconds as a UI shows it: `YYYY-MM-DD HH:MM:SS`, in UTC. */
export const shownAt = (milliseconds: number): string =>
  new Date(milliseconds).toISOString().slice(0, 19).replace('T', ' ');

export const pad2 = (value: number): string => String(value).padStart(2, '0');

/** A moment in seconds, as `YYYY-MM-DD HH:MM:SS` in UTC. */
export const stamp = (second: number): string => {
  const date = new Date(second * 1000);
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
  );
};

export const prefixOf = (hostname: string): string => hostname.slice(0, hostname.lastIndexOf('-'));

/** A directory holding `files`, each keyed by its path beneath it, every directory and
 *  file the box's own user's. */
export const userTree = (files: ReadonlyMap<string, string>, username: string): Directory => {
  const names = [...new Set([...files.keys()].map((path) => path.split('/')[0] ?? path))];
  return dir(
    Object.fromEntries(
      names.map((name) => {
        const content = files.get(name);
        if (content !== undefined) return [name, file(content, HOME_FILE, username)];
        const prefix = `${name}/`;
        const below = [...files]
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, text]): readonly [string, string] => [path.slice(prefix.length), text]);
        return [name, userTree(new Map(below), username)];
      }),
    ),
    HOME_DIR,
    username,
  );
};
