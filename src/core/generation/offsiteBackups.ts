/**
 * A business's nightly offsite backup, from both ends.
 *
 * A network that keeps a file server copies its share every night to somebody's home,
 * over the ssh that home lets in from outside. The file server's crontab runs the copy,
 * and the box at the other end keeps what it copied, file for file, in the backups of
 * the account the copy logs in as. Both ends read one relation, so the job names the
 * very address, port and account the copy sits behind.
 *
 * The job's time is drawn on a stream of the file server's own, so no draw the box
 * already made moves.
 */

import type { Directory, FileNode } from '../filesystem/types.js';
import type { LanHost } from './generateHomeLan.js';
import { relationsFrom, relationsTo, type Relation } from './relations.js';
import { declaredNetwork } from './world.js';
import { buildShare } from './share.js';
import { npcUsername } from './remoteHostFs.js';
import { peopleKnownOn } from './mailbox.js';
import { HOME_DIR, dir } from './baseFs.js';
import { createPrng } from './prng.js';
import { roleOfHostname } from './pools/hostnames.js';

/** The hours a nightly job is put at: after the shop has shut, before anybody is in. */
const NIGHT_HOURS = { first: 0, last: 5 };

/** The folder a network's copies are kept under, named by the wifi its people know. */
const folderOf = (key: string): string => (declaredNetwork(key)?.essid ?? key).toLowerCase();

const isBackup = (relation: Relation): boolean => relation.kind === 'backup';

/** The copy a backup runs, as the crontab states it. */
const commandOf = ({ source, user, address, port }: Relation): string =>
  `rsync -az /srv/ ${user}@${address}:backups/${folderOf(source)}/ -e 'ssh -p ${port}'`;

/** The lines the offsite backups kept on `host` add to its `/etc/crontab`, each at a
 *  drawn time of night, run as root; empty where it keeps none. */
export const offsiteJobs = (essid: string, host: LanHost): string => {
  // Only a file server keeps a share to copy, so no other box is worth asking.
  if (roleOfHostname(host.hostname) !== 'fileserver') return '';
  const jobs = relationsFrom(essid).filter(
    (relation) => isBackup(relation) && relation.sourceHost.ip === host.ip,
  );
  if (jobs.length === 0) return '';
  const prng = createPrng(`relation-cron-${essid}-${host.ip}`);
  return jobs
    .map((relation) => {
      const minute = prng.nextInt(0, 59);
      const hour = prng.nextInt(NIGHT_HOURS.first, NIGHT_HOURS.last);
      return `${minute} ${hour}\t* * *\troot\t${commandOf(relation)}\n`;
    })
    .join('');
};

/** `node` as the account `owner` wrote it: `rsync -a` keeps every file's permissions
 *  and times, but the copy belongs to whoever it logged in as. */
const ownedBy = (node: FileNode, owner: string): FileNode =>
  node.kind === 'file'
    ? { ...node, owner }
    : {
        ...node,
        owner,
        entries: new Map([...node.entries].map(([name, child]) => [name, ownedBy(child, owner)])),
      };

/** The share `relation`'s file server keeps, as it would build it. */
const shareOf = ({ source, sourceHost }: Relation): Directory => {
  const account = npcUsername(source, sourceHost);
  return buildShare({
    essid: source,
    host: sourceHost,
    account,
    people: peopleKnownOn({ essid: source, host: sourceHost, username: account }),
  }).tree;
};

/** The `backups` directory `username` keeps on `host`, one folder per network that
 *  copies its share there, or null where nothing is copied to it. */
export const offsiteCopies = (essid: string, host: LanHost, username: string): Directory | null => {
  const copies = relationsTo(essid).filter(
    (relation) => isBackup(relation) && relation.targetHost.ip === host.ip,
  );
  if (copies.length === 0) return null;
  return dir(
    Object.fromEntries(
      copies.map((relation) => [folderOf(relation.source), ownedBy(shareOf(relation), username)]),
    ),
    HOME_DIR,
    username,
  );
};
