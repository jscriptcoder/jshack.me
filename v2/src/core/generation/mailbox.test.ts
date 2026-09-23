import { describe, expect, it } from 'vitest';
import { boxMail, networkMail, type MailMessage } from './networkMail';
import { buildRemoteHostFs, npcUsername } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { inhabitant } from './persona';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import { generateApplication } from './generateDatabase';
import { roleOfHostname } from './pools/hostnames';
import { lanZoneName } from '../network/resolveName';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import { WORLD_EPOCH } from '../cve/worldClock';
import { networkArchetype } from './databaseApp';
import { MAIL_SPECS, PERSONAL_THREADS } from './pools/mailThreads';
import { CRON_OUTPUT } from './pools/cronMail';
import { ALL_GENERATED_PASSWORDS } from './passwordPools';
import {
  ALL_ESSIDS,
  deepBoxes,
  lanBoxes,
  softwareVersionsIn,
  type Box,
} from '../../test/worldContent';

const DAY_MS = 86_400_000;

/** The last moment anything in the world is dated. */
const LAST_SECOND = WORLD_EPOCH - 1000;

/** The earliest an application on a network was installed, so mail that predates it
 *  could never have been logged by one. `databaseApp` installs at 400 days ago at the
 *  most recent. */
const EARLIEST_INSTALL = WORLD_EPOCH - 400 * DAY_MS;

/** Who really has an account on a network: the account each of its machines keeps, and
 *  the person behind it. Read straight off the LAN, which is what a message's addresses
 *  have to agree with. Where two machines keep the same login, the network still has one
 *  address and therefore one mailbox, which belongs to the first machine's person. */
const accountsOn = (essid: string) => {
  const byUsername = new Map<string, { username: string; fullName: string; email: string }>();
  for (const host of generateHomeLan(essid).hosts.filter((host) => host.kind === 'machine')) {
    const username = npcUsername(essid, host);
    if (byUsername.has(username)) continue;
    byUsername.set(username, { username, ...inhabitant({ essid, host, username }) });
  }
  return [...byUsername.values()];
};

const everyMessage = (essid: string): readonly MailMessage[] =>
  networkMail(essid).threads.flatMap((thread) => thread.messages);

describe('a network correspondence', () => {
  it('is between people who really have accounts on the network', () => {
    for (const essid of ALL_ESSIDS) {
      const real = new Map(accountsOn(essid).map((person) => [person.username, person]));
      for (const message of everyMessage(essid)) {
        for (const person of [message.from, ...message.to]) {
          expect(real.get(person.username)).toMatchObject({
            fullName: person.fullName,
            email: person.address,
          });
          expect(person.address).toBe(`${person.username}@${lanZoneName(essid)}`);
        }
        expect(message.to).not.toContainEqual(message.from);
      }
    }
  });

  it('answers each message with a reply sent after it', () => {
    for (const essid of ALL_ESSIDS) {
      for (const thread of networkMail(essid).threads) {
        expect(thread.messages.length).toBeGreaterThanOrEqual(1);
        expect(thread.messages.length).toBeLessThanOrEqual(4);
        thread.messages.forEach((message, index) => {
          const previous = thread.messages[index - 1];
          if (previous === undefined) {
            expect(message.inReplyTo).toBeNull();
            return;
          }
          expect(message.inReplyTo).toBe(previous.id);
          expect(message.sentAt).toBeGreaterThan(previous.sentAt);
        });
      }
    }
  });

  it('is finished before the world stopped, and begun after any application was installed', () => {
    for (const essid of ALL_ESSIDS) {
      const messages = everyMessage(essid);
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message.sentAt).toBeLessThanOrEqual(LAST_SECOND);
        expect(message.sentAt).toBeGreaterThan(EARLIEST_INSTALL);
        // The id a transfer agent stamps carries the moment it stamped it, so a message
        // whose id disagrees with its own date is a message that never went anywhere.
        const stamped = new Date(message.sentAt).toISOString().replace(/[-:T]/g, '').slice(0, 14);
        expect(message.id).toMatch(
          new RegExp(`^${stamped}\\.[0-9A-F]{6}@${lanZoneName(essid).replace(/\./g, '\\.')}$`),
        );
      }
    }
  });

  it('writes TO everyone on the network, so no mailbox is left empty', () => {
    for (const essid of ALL_ESSIDS) {
      const mail = networkMail(essid);
      for (const person of accountsOn(essid)) {
        // A mailbox holds what arrived, so a thread only fills one when the person was
        // written to in it — opening a thread nobody answered leaves them nothing.
        const received = mail.threads.filter((thread) =>
          thread.messages.some((message) =>
            message.to.some((member) => member.username === person.username),
          ),
        );
        expect(received.length).toBeGreaterThanOrEqual(3);
        expect(received.length).toBeLessThanOrEqual(6);
      }
    }
  });
});

/** A machine somebody sits at, which is what keeps a mailbox of its own. The personal
 *  devices on the same LAN — a phone, a tablet — belong to somebody too, but nobody
 *  reads their mail over a terminal. */
const DESK_PREFIXES = ['desktop', 'laptop', 'workstation'];
const PERSONAL_PREFIXES = ['android', 'iphone', 'tablet'];

const prefixOf = (hostname: string): string => hostname.slice(0, hostname.lastIndexOf('-'));

const desks = (): readonly Box[] =>
  lanBoxes(ALL_ESSIDS).filter(({ host }) => DESK_PREFIXES.includes(prefixOf(host.hostname)));

/** One message as it sits in an mbox file: the separator line a reader splits on, its
 *  headers (a `Received:` chain may repeat, so those are kept in order), and the body. */
type MboxMessage = {
  readonly separator: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly received: readonly string[];
  readonly body: readonly string[];
};

/** An mbox as a mail reader parses one: messages split on the `From ` line, headers
 *  unfolded at their continuation lines, the body starting after the blank line. */
const parseMbox = (text: string): readonly MboxMessage[] => {
  // A mailbox nothing has ever arrived in is an empty file, which is a mailbox with no
  // messages rather than a malformed one.
  if (text === '') return [];
  const messages: MboxMessage[] = [];
  let current: { separator: string; headerLines: string[]; body: string[] } | null = null;
  let inBody = false;
  const close = (): void => {
    if (current === null) return;
    const headers = new Map<string, string>();
    const received: string[] = [];
    for (const line of current.headerLines) {
      const at = line.indexOf(':');
      const name = line.slice(0, at);
      const value = line.slice(at + 1).trim();
      if (name === 'Received') received.push(value);
      else headers.set(name, value);
    }
    messages.push({ separator: current.separator, headers, received, body: current.body });
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('From ') && (current === null || inBody)) {
      close();
      current = { separator: line.slice('From '.length), headerLines: [], body: [] };
      inBody = false;
      continue;
    }
    if (current === null) throw new Error(`an mbox that does not open with a separator: ${line}`);
    if (inBody) {
      // A body line quoted because it begins like a separator comes back as it was
      // written, which is what a mail reader shows.
      current.body.push(line.startsWith('>From ') ? line.slice(1) : line);
      continue;
    }
    if (line === '') {
      inBody = true;
      continue;
    }
    if (/^[ \t]/.test(line)) {
      const folded = current.headerLines.pop() ?? '';
      current.headerLines.push(`${folded} ${line.trim()}`);
      continue;
    }
    current.headerLines.push(line);
  }
  close();
  // The blank line that ends each message belongs to the file, not to the body.
  return messages.map((message) => ({
    ...message,
    body: message.body[message.body.length - 1] === '' ? message.body.slice(0, -1) : message.body,
  }));
};

/** The box as it really is: a box below the LAN is built through the deep builder, which
 *  is the only tree a player ever reaches down there. */
const treeOf = (box: Box) =>
  isOnHomeLan(box.essid, box.host)
    ? buildRemoteHostFs(box.essid, box.host)
    : buildDeepHostFs(box.essid, box.host);

/** Only what people wrote: an mbox file is mostly headers the generator addressed, and a
 *  sweep for authored words has no business reading those. */
const bodiesIn = (mbox: string): readonly string[] =>
  parseMbox(mbox).flatMap((message) => message.body);

const mailboxOn = (box: Box, name: string, as: 'root' | 'user' | 'guest' = 'root') =>
  createFsView(treeOf(box), { userType: as }).read(asAbsPath(`/var/mail/${name}`));

const readMailbox = (box: Box, name: string): string => {
  const result = mailboxOn(box, name);
  if (!result.ok) throw new Error(`/var/mail/${name} on ${box.host.hostname}: ${result.error}`);
  return result.content;
};

/** What the correspondence says landed in one person's mailbox: every message written to
 *  them, oldest first. */
const deliveredTo = (essid: string, username: string): readonly MailMessage[] =>
  [...networkMail(essid).threads]
    .flatMap((thread) => thread.messages)
    .filter((message) => message.to.some((person) => person.username === username))
    .sort((earlier, later) => earlier.sentAt - later.sentAt);

/** A date as a mail header writes it: `Thu, 18 Jun 2026 09:12:04 +0000`. */
const rfcDate = (sentAt: number): string => new Date(sentAt).toUTCString().replace('GMT', '+0000');

/** A date as the mbox separator line writes it: `Thu Jun 18 09:12:04 2026`. */
const asctime = (sentAt: number): string => {
  const parts = new Date(sentAt).toUTCString().split(' ');
  return `${(parts[0] ?? '').replace(',', '')} ${parts[2]} ${parts[1]} ${parts[4]} ${parts[3]}`;
};

describe('a desk mailbox', () => {
  it('holds every message the network wrote to its user, and nothing else', () => {
    for (const box of desks()) {
      const username = npcUsername(box.essid, box.host);
      const messages = parseMbox(readMailbox(box, username));
      const delivered = deliveredTo(box.essid, username);
      expect(messages.map((message) => message.headers.get('Message-ID'))).toEqual(
        delivered.map((message) => `<${message.id}>`),
      );
      for (const message of messages) {
        expect(message.headers.get('To')).toContain(`<${username}@${lanZoneName(box.essid)}>`);
      }
    }
  });

  it('reads as an mbox, each message signed by the person who really sent it', () => {
    for (const box of desks()) {
      const username = npcUsername(box.essid, box.host);
      const messages = parseMbox(readMailbox(box, username));
      const delivered = deliveredTo(box.essid, username);
      expect(messages.length).toBeGreaterThan(0);
      messages.forEach((message, index) => {
        const sent = delivered[index] as MailMessage;
        expect(message.separator).toBe(`${sent.from.address} ${asctime(sent.sentAt)}`);
        expect(message.headers.get('From')).toBe(`${sent.from.fullName} <${sent.from.address}>`);
        expect(message.headers.get('Date')).toBe(rfcDate(sent.sentAt));
        expect(message.headers.get('Message-ID')).toBe(`<${sent.id}>`);
        expect(message.headers.get('Subject')).toBe(
          sent.inReplyTo === null ? sent.subject : `Re: ${sent.subject}`,
        );
        expect(message.headers.get('In-Reply-To')).toBe(
          sent.inReplyTo === null ? undefined : `<${sent.inReplyTo}>`,
        );
        expect(message.body).toEqual(sent.body);
      });
    }
  });

  it('names only machines of its own network in its delivery headers', () => {
    for (const box of desks()) {
      const username = npcUsername(box.essid, box.host);
      const zone = lanZoneName(box.essid);
      const real = new Set(
        generateHomeLan(box.essid).hosts.flatMap((host) => [host.ip, `${host.hostname}.${zone}`]),
      );
      for (const message of parseMbox(readMailbox(box, username))) {
        expect(message.received.length).toBeGreaterThan(0);
        expect(message.headers.get('Delivered-To')).toBe(`<${username}@${zone}>`);
        for (const hop of message.received) {
          const named = [...hop.matchAll(/(?:from|by) (\S+)/g)].map((found) => found[1] ?? '');
          expect(named).toHaveLength(2);
          for (const name of named) expect([...real]).toContain(name);
          const address = hop.match(/\((\d+\.\d+\.\d+\.\d+)\)/)?.[1];
          expect([...real]).toContain(address);
          expect(hop).toContain(`for <${username}@${zone}>;`);
        }
        // Whatever the route, the last machine to handle it was this one.
        expect(message.received[0]).toContain(`by ${box.host.hostname}.${zone} `);
      }
    }
  });

  it('opens for its owner and stays shut to a guest', () => {
    for (const box of desks()) {
      const username = npcUsername(box.essid, box.host);
      expect(mailboxOn(box, username, 'user').ok).toBe(true);
      expect(mailboxOn(box, username, 'guest')).toEqual({ ok: false, error: 'permission_denied' });
    }
  });

  it('is not kept on a phone or a tablet, which nobody here reads mail on', () => {
    const personal = lanBoxes(ALL_ESSIDS).filter(({ host }) =>
      PERSONAL_PREFIXES.includes(prefixOf(host.hostname)),
    );
    expect(personal.length).toBeGreaterThan(0);
    for (const box of personal) {
      const view = createFsView(buildRemoteHostFs(box.essid, box.host), { userType: 'root' });
      const listed = view.list(asAbsPath('/var/mail'));
      // Nothing is addressed to whoever carries the phone. What can be there is cron's
      // own mail to root, which every box in the world gets on the same rule and which
      // nobody reads over a terminal either way.
      expect(listed.ok ? [...listed.entries] : []).toEqual(listed.ok ? ['root'] : []);
    }
  });
});

const mailServers = (): readonly Box[] =>
  lanBoxes(ALL_ESSIDS).filter(({ host }) => roleOfHostname(host.hostname) === 'mailserver');

/** What the box's own application holds, whether or not mysqld serves it. */
const applicationOf = (box: Box) =>
  generateApplication({
    appSeed: `db-app-${box.essid}-${box.host.ip}`,
    essid: box.essid,
    host: box.host,
    account: npcUsername(box.essid, box.host),
    role: roleOfHostname(box.host.hostname),
  });

/** The mailboxes a mail server's own application says it keeps: one per login on the
 *  network, plus the shared ones every organisation has. */
const rosterOf = (box: Box): readonly string[] =>
  (applicationOf(box).tables.mailboxes?.rows ?? []).map((row) => String(row.local_part));

const listMail = (box: Box, as: 'root' | 'user' | 'guest' = 'root') =>
  createFsView(treeOf(box), { userType: as }).list(asAbsPath('/var/mail'));

/** The mailboxes a spool keeps for the people its directory names - everything but
 *  root's, which cron writes on every box in the world whether or not mail is carried
 *  there. */
const spoolRoster = (entries: readonly string[]): readonly string[] =>
  [...entries].filter((name) => name !== 'root').sort();

describe('a mail server spool', () => {
  it('keeps a mailbox for every mailbox its own application names', () => {
    const servers = mailServers();
    expect(servers.length).toBeGreaterThan(0);
    for (const box of servers) {
      const listed = listMail(box);
      expect(listed.ok).toBe(true);
      // `root` is cron's own mailbox rather than one the directory names, so it is left
      // out here and held to the box's crontab by `the mail cron left for root`.
      expect(listed.ok && spoolRoster(listed.entries)).toEqual([...rosterOf(box)].sort());
    }
  });

  it("is root-only, because it holds everybody's mail and not just one person's", () => {
    for (const box of mailServers()) {
      const roster = rosterOf(box);
      expect(listMail(box, 'user')).toEqual({ ok: false, error: 'permission_denied' });
      expect(listMail(box, 'guest')).toEqual({ ok: false, error: 'permission_denied' });
      for (const local of roster) {
        expect(mailboxOn(box, local, 'user')).toEqual({ ok: false, error: 'permission_denied' });
        expect(mailboxOn(box, local, 'root').ok).toBe(true);
      }
    }
  });

  it('holds the same thread the desk at the other end holds', () => {
    let compared = 0;
    for (const box of mailServers()) {
      const desksHere = desks().filter((desk) => desk.essid === box.essid);
      for (const desk of desksHere) {
        const username = npcUsername(desk.essid, desk.host);
        const onServer = parseMbox(readMailbox(box, username));
        const onDesk = parseMbox(readMailbox(desk, username));
        expect(onServer.map((message) => message.headers.get('Message-ID'))).toEqual(
          onDesk.map((message) => message.headers.get('Message-ID')),
        );
        expect(onServer.map((message) => message.body)).toEqual(
          onDesk.map((message) => message.body),
        );
        expect(onServer.map((message) => message.headers.get('Subject'))).toEqual(
          onDesk.map((message) => message.headers.get('Subject')),
        );
        // The same message, read where it was carried rather than where it landed: one
        // hop, stamped by this machine, so the two copies are never the same bytes.
        const zone = lanZoneName(box.essid);
        for (const message of onServer) {
          expect(message.received).toHaveLength(1);
          expect(message.received[0]).toContain(`by ${box.host.hostname}.${zone} `);
        }
        expect(readMailbox(box, username)).not.toBe(readMailbox(desk, username));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('holds mail for the shared mailboxes, written by people who really work there', () => {
    let read = 0;
    for (const box of mailServers()) {
      const logins = new Set(networkMail(box.essid).people.map((person) => person.username));
      const shared = rosterOf(box).filter((local) => !logins.has(local));
      expect(shared.length).toBeGreaterThanOrEqual(2);
      const zone = lanZoneName(box.essid);
      for (const local of shared) {
        const messages = parseMbox(readMailbox(box, local));
        expect(messages.length).toBeGreaterThan(0);
        for (const message of messages) {
          expect(message.headers.get('To')).toBe(`<${local}@${zone}>`);
          expect(message.headers.get('Delivered-To')).toBe(`<${local}@${zone}>`);
          const sender = message.separator.split(' ')[0] ?? '';
          expect([...logins]).toContain(sender.slice(0, sender.indexOf('@')));
          expect(sender.slice(sender.indexOf('@') + 1)).toBe(zone);
        }
        read += 1;
      }
    }
    expect(read).toBeGreaterThan(0);
  });
});

/** Every box on a layer below the LAN, which cannot see what else is down there. */
const deepDesks = (): readonly Box[] =>
  deepBoxes(ALL_ESSIDS).filter(({ host }) => DESK_PREFIXES.includes(prefixOf(host.hostname)));

const deepMailServers = (): readonly Box[] =>
  deepBoxes(ALL_ESSIDS).filter(({ host }) => roleOfHostname(host.hostname) === 'mailserver');

/** The logins the box's own application keeps — on a deep box these are the only people
 *  there are, because it has no neighbours it is allowed to read. */
const loginsOf = (box: Box): readonly string[] =>
  (
    generateApplication({
      appSeed: `db-app-${box.essid}-${box.host.ip}`,
      essid: box.essid,
      host: box.host,
      account: npcUsername(box.essid, box.host),
      role: roleOfHostname(box.host.hostname),
    }).tables.users?.rows ?? []
  ).map((row) => String(row.username));

describe('a deep box mailbox', () => {
  it('is kept by a desk down there, and by a mail server for its whole roster', () => {
    expect(deepDesks().length).toBeGreaterThan(0);
    for (const box of deepDesks()) {
      const username = npcUsername(box.essid, box.host);
      const messages = parseMbox(readMailbox(box, username));
      const subjects = new Set(
        messages.map((message) => message.headers.get('Subject')?.replace(/^Re: /, '')),
      );
      expect(subjects.size).toBeGreaterThanOrEqual(3);
      expect(subjects.size).toBeLessThanOrEqual(6);
      expect(messages.length).toBeGreaterThanOrEqual(subjects.size);
    }
    expect(deepMailServers().length).toBeGreaterThan(0);
    for (const box of deepMailServers()) {
      const listed = listMail(box);
      expect(listed.ok && spoolRoster(listed.entries)).toEqual([...rosterOf(box)].sort());
    }
  });

  it('is written by the people its own application knows, on the network zone', () => {
    for (const box of [...deepDesks(), ...deepMailServers()]) {
      const logins = loginsOf(box);
      const zone = lanZoneName(box.essid);
      const username = npcUsername(box.essid, box.host);
      const local = DESK_PREFIXES.includes(prefixOf(box.host.hostname)) ? username : (rosterOf(box)[0] as string);
      for (const message of parseMbox(readMailbox(box, local))) {
        const sender = message.separator.split(' ')[0] ?? '';
        expect(sender.slice(sender.indexOf('@') + 1)).toBe(zone);
        expect([...logins]).toContain(sender.slice(0, sender.indexOf('@')));
      }
    }
  });

  it('names no machine but its own, because it cannot see what shares its layer', () => {
    for (const box of [...deepDesks(), ...deepMailServers()]) {
      const zone = lanZoneName(box.essid);
      const username = npcUsername(box.essid, box.host);
      const local = DESK_PREFIXES.includes(prefixOf(box.host.hostname)) ? username : (rosterOf(box)[0] as string);
      const mbox = readMailbox(box, local);
      for (const message of parseMbox(mbox)) {
        for (const hop of message.received) {
          const named = [...hop.matchAll(/(?:from|by) (\S+)/g)].map((found) => found[1] ?? '');
          expect(named).toEqual([`${box.host.hostname}.${zone}`, `${box.host.hostname}.${zone}`]);
          expect(hop).toContain(`(${box.host.ip})`);
        }
      }
      // Nothing up on the LAN is nameable from down here.
      for (const lanHost of generateHomeLan(box.essid).hosts) {
        expect(mbox).not.toContain(lanHost.hostname);
        expect(mbox).not.toContain(lanHost.ip);
      }
    }
  });

  it('is the same bytes however often it is built, with nothing below it to read', () => {
    for (const box of [...deepDesks(), ...deepMailServers()].slice(0, 12)) {
      const username = npcUsername(box.essid, box.host);
      const local = DESK_PREFIXES.includes(prefixOf(box.host.hostname)) ? username : (rosterOf(box)[0] as string);
      expect(readMailbox(box, local)).toBe(readMailbox(box, local));
    }
  });
});

/** A mail server that also serves its directory through mysqld. The world has none —
 *  the role takes the flat placement rate and never draws the database — so the only way
 *  to read the two against each other is to stand one up, as the database tests do. */
const servedMailDirectories = (): readonly Box[] =>
  ALL_ESSIDS.slice(0, 8).map((essid) => ({
    essid,
    host: { ip: '10.40.0.9', hostname: 'mail-9', kind: 'machine' as const },
  }));

const instantOf = (datetime: string): number => Date.parse(`${datetime.replace(' ', 'T')}Z`);

describe('a mail directory and the spool beside it', () => {
  it('logs deliveries that really sit in the mailbox the log names', () => {
    let checked = 0;
    for (const box of [...mailServers(), ...deepMailServers(), ...servedMailDirectories()]) {
      const application = applicationOf(box);
      const mailboxes = new Map(
        (application.tables.mailboxes?.rows ?? []).map((row) => [row.id, String(row.local_part)]),
      );
      const log = application.tables.delivery_log?.rows ?? [];
      expect(log.length).toBeGreaterThanOrEqual(5);
      expect(log.length).toBeLessThanOrEqual(40);

      for (const row of log) {
        const local = mailboxes.get(row.mailbox_id);
        expect(local).toBeDefined();
        const delivered = parseMbox(readMailbox(box, local as string)).find(
          (message) => Date.parse(message.headers.get('Date') ?? '') === instantOf(String(row.delivered_at)),
        );
        expect(delivered?.headers.get('From')).toBe(
          `${String(row.sender_name)} <${delivered?.separator.split(' ')[0]}>`,
        );
        expect(delivered?.headers.get('Subject')).toBe(String(row.subject));
        expect(delivered?.headers.get('Delivered-To')).toBe(
          `<${local}@${lanZoneName(box.essid)}>`,
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('names the same mailboxes the spool keeps', () => {
    for (const box of servedMailDirectories()) {
      const roster = (applicationOf(box).tables.mailboxes?.rows ?? []).map((row) =>
        String(row.local_part),
      );
      const listed = listMail(box);
      expect(listed.ok && spoolRoster(listed.entries)).toEqual([...roster].sort());
    }
  });

  it('keeps no delivery whose subject was never written by anybody', () => {
    const retired = ['Invoice attached', 'Meeting tomorrow', 'Re: quote', 'Delivery update', 'Your order', 'Minutes'];
    for (const box of [...mailServers(), ...servedMailDirectories()]) {
      const log = applicationOf(box).tables.delivery_log?.rows ?? [];
      const subjects = log.map((row) => String(row.subject));
      expect(subjects.filter((subject) => retired.includes(subject))).toEqual([]);
    }
  });
});

/** Every mailbox the world holds, as its own file: each desk's, and every mailbox in
 *  every spool, above the LAN and below it. Built inside the test rather than cached, so
 *  a mutation run credits the test that actually reads the generator. */
const everyMailbox = (): readonly { readonly box: Box; readonly local: string; readonly content: string }[] =>
  [...lanBoxes(ALL_ESSIDS), ...deepBoxes(ALL_ESSIDS)].flatMap((box) => {
    const view = createFsView(treeOf(box), { userType: 'root' });
    const listed = view.list(asAbsPath('/var/mail'));
    if (!listed.ok) return [];
    return listed.entries.flatMap((local) => {
      const read = view.read(asAbsPath(`/var/mail/${local}`));
      return read.ok ? [{ box, local, content: read.content }] : [];
    });
  });

const everySubject = (): readonly string[] => [
  ...Object.values(MAIL_SPECS).flatMap((threads) => threads.map((thread) => thread.subject)),
  ...Object.values(PERSONAL_THREADS).flatMap((threads) => threads.map((thread) => thread.subject)),
];

describe('what the mail is about', () => {
  it('speaks the business the network runs', () => {
    for (const essid of ALL_ESSIDS) {
      const theirs = new Set(
        MAIL_SPECS[networkArchetype(essid)].map((thread) => thread.subject),
      );
      const spoken = networkMail(essid).threads.map((thread) => thread.subject);
      expect(spoken.some((subject) => theirs.has(subject))).toBe(true);
    }
  });

  it('leaves no thread it was given unwritten anywhere in the world', () => {
    const spoken = new Set([
      ...ALL_ESSIDS.flatMap((essid) => networkMail(essid).threads.map((thread) => thread.subject)),
      ...deepBoxes(ALL_ESSIDS).flatMap((box) =>
        boxMail({
          essid: box.essid,
          host: box.host,
          account: npcUsername(box.essid, box.host),
          people: loginsOf(box),
        }).threads.map((thread) => thread.subject),
      ),
    ]);
    expect(everySubject().filter((subject) => !spoken.has(subject))).toEqual([]);
  });

  it('puts some of every set where a player can read it', () => {
    // Not every thread lands somewhere readable: a network of phones with no mail server
    // writes mail that only its own people could have opened, and a phone keeps no
    // mailbox. What must never happen is a whole set of writing nobody can reach.
    const read = new Set(
      everyMailbox()
        .flatMap(({ content }) => parseMbox(content))
        .map((message) => (message.headers.get('Subject') ?? '').replace(/^Re: /, '')),
    );
    const unreadable = [
      ...Object.entries(MAIL_SPECS),
      ...Object.entries(PERSONAL_THREADS),
    ].filter(([, threads]) => !threads.some((thread) => read.has(thread.subject)));
    expect(unreadable.map(([name]) => name)).toEqual([]);
  });

  it('carries no word a player could try as a password', () => {
    const pool = ALL_GENERATED_PASSWORDS.map((password) => password.toLowerCase());
    for (const { box, local, content } of everyMailbox()) {
      // What people wrote, not what the generator addressed: a network can be called
      // OSCORP-GUEST, and every address on it then carries a pool word that is its own
      // public name rather than anybody's secret.
      const written = bodiesIn(content).join(' ').toLowerCase();
      const words = new Set(written.match(/[a-z0-9]+/g) ?? []);
      const leaked = pool.filter((password) => words.has(password));
      expect(`${box.host.hostname}/${local}: ${leaked.join(',')}`).toBe(
        `${box.host.hostname}/${local}: `,
      );
    }
  });

  it('states no version and leaves no slot unfilled', () => {
    for (const { box, local, content } of everyMailbox()) {
      const wrong = [
        // A `Message-ID` is a moment and a stamp rather than a version, so the version
        // sweep reads the writing; the slot sweep reads the whole file, headers included.
        ...softwareVersionsIn(bodiesIn(content).join(' ')),
        ...(content.match(/\{\{|\}\}|undefined|NaN|\[object|Mailer/g) ?? []),
      ];
      expect(`${box.host.hostname}/${local}: ${wrong.join(',')}`).toBe(
        `${box.host.hostname}/${local}: `,
      );
    }
  });

  it('writes to nobody outside the network zone', () => {
    for (const { box, local, content } of everyMailbox()) {
      const zone = lanZoneName(box.essid);
      const offZone = (content.match(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g) ?? []).filter(
        (address) => !address.endsWith(`@${zone}`),
      );
      expect(`${box.host.hostname}/${local}: ${offZone.join(',')}`).toBe(
        `${box.host.hostname}/${local}: `,
      );
    }
  });

  it('reads differently on every machine that keeps one', () => {
    // A mailbox nothing arrived in is empty, and every empty file reads the same. It is
    // the ones with mail in them that must not repeat.
    const mailboxes = everyMailbox().filter(({ content }) => content !== '');
    const byNetwork = new Map<string, string[]>();
    for (const { box, content } of mailboxes) {
      byNetwork.set(box.essid, [...(byNetwork.get(box.essid) ?? []), content]);
    }
    for (const [essid, contents] of byNetwork) {
      expect(`${essid}: ${contents.length - new Set(contents).size}`).toBe(`${essid}: 0`);
    }
    const distinct = new Set(mailboxes.map(({ content }) => content)).size;
    expect(distinct / mailboxes.length).toBeGreaterThan(0.9);
  });
});

/** The machine that carries a network's mail, where the network runs one. */
const relayFor = (essid: string): LanHost | undefined =>
  generateHomeLan(essid).hosts.find(
    (host) => host.kind === 'machine' && roleOfHostname(host.hostname) === 'mailserver',
  );

describe('the route a message took to get here', () => {
  it('shows two hops on a desk whose network carries its own mail', () => {
    const served = desks().filter((desk) => relayFor(desk.essid) !== undefined);
    expect(served.length).toBeGreaterThan(0);
    for (const box of served) {
      const relay = relayFor(box.essid) as LanHost;
      const zone = lanZoneName(box.essid);
      const username = npcUsername(box.essid, box.host);
      for (const message of parseMbox(readMailbox(box, username))) {
        // The sender's machine handed it to the mail server, and the mail server handed
        // it to this desk. Both machines are real hosts a player can find with a scan.
        expect(message.received.length).toBe(2);
        const [delivered = '', collected = ''] = message.received;
        expect(delivered).toContain(`from ${relay.hostname}.${zone} (${relay.ip})`);
        expect(delivered).toContain(`by ${box.host.hostname}.${zone}`);
        expect(collected).toContain(`by ${relay.hostname}.${zone}`);
      }
    }
  });

  it('shows one hop where the network has no mail server to route through', () => {
    const direct = desks().filter((desk) => relayFor(desk.essid) === undefined);
    expect(direct.length).toBeGreaterThan(0);
    for (const box of direct) {
      const zone = lanZoneName(box.essid);
      const username = npcUsername(box.essid, box.host);
      for (const message of parseMbox(readMailbox(box, username))) {
        // Desk to desk, because there is no machine in between to stamp a second id.
        expect(message.received.length).toBe(1);
        expect(message.received[0]).toContain(`by ${box.host.hostname}.${zone}`);
      }
    }
  });

  it('shows one hop in the spool, because that is the machine that made the delivery', () => {
    const servers = mailServers();
    expect(servers.length).toBeGreaterThan(0);
    for (const box of servers) {
      const zone = lanZoneName(box.essid);
      for (const local of rosterOf(box)) {
        for (const message of parseMbox(readMailbox(box, local))) {
          expect(message.received.length).toBe(1);
          expect(message.received[0]).toContain(`by ${box.host.hostname}.${zone}`);
        }
      }
    }
  });

  it('names every recipient separately in the header a reader shows', () => {
    const several = desks().flatMap((box) => {
      const username = npcUsername(box.essid, box.host);
      return parseMbox(readMailbox(box, username))
        .filter((message) => (message.headers.get('To') ?? '').split(', ').length > 1)
        .map((message) => ({ box, message }));
    });
    // A thread that copies somebody in is the whole point of two mailboxes agreeing, so
    // the world has to contain some.
    expect(several.length).toBeGreaterThan(0);
    for (const { box, message } of several) {
      const zone = lanZoneName(box.essid);
      for (const recipient of (message.headers.get('To') ?? '').split(', ')) {
        expect(recipient).toMatch(new RegExp(`<[a-z0-9._-]+@${zone.replace(/\./g, '[.]')}>$`));
      }
    }
  });

  it('marks a reply as answering the message above it, and an opener as answering nothing', () => {
    let answered = 0;
    for (const box of desks()) {
      const username = npcUsername(box.essid, box.host);
      const messages = parseMbox(readMailbox(box, username));
      for (const message of messages) {
        const answers = message.headers.get('In-Reply-To');
        if (answers === undefined) continue;
        // Whatever it answers is a real message id, stamped the way every other id in
        // the world is stamped.
        expect(answers).toMatch(/^<[0-9]{14}[.][0-9A-F]{6}@[a-z0-9.-]+>$/);
        expect(answers).not.toBe(message.headers.get('Message-ID'));
        answered += 1;
      }
      // An opener answers nothing at all, so the header is absent rather than empty.
      expect(messages.some((message) => !message.headers.has('In-Reply-To'))).toBe(true);
    }
    expect(answered).toBeGreaterThan(0);
  });
});

describe('how a reply reads', () => {
  it('quotes the line it is answering above its own words', () => {
    let quoted = 0;
    for (const essid of ALL_ESSIDS) {
      for (const thread of networkMail(essid).threads) {
        thread.messages.forEach((message, index) => {
          const previous = thread.messages[index - 1];
          if (previous === undefined) return;
          // What a mail reader does when you hit reply: the line above, marked, then a
          // blank line, then the answer. It is also the only place the owner's own side
          // of a thread appears in their own mailbox.
          expect(message.body[0]).toBe(`> ${previous.body[0] ?? ''}`);
          expect(message.body[1]).toBe('');
          expect(message.body.length).toBeGreaterThan(2);
          quoted += 1;
        });
      }
    }
    expect(quoted).toBeGreaterThan(0);
  });
});

describe('a mailbox with nothing in it', () => {
  it('is an empty file in the spool, because the roster names it either way', () => {
    const empty = [...mailServers(), ...deepMailServers()].flatMap((box) =>
      rosterOf(box)
        .filter((local) => readMailbox(box, local) === '')
        .map((local) => `${box.host.hostname}/${local}`),
    );
    // A mail server's directory names every mailbox it keeps whether or not anything has
    // arrived in one. An account beyond the cast the correspondence draws on is a file
    // with nothing in it, which is what an unused account on a real spool looks like.
    expect(empty.length).toBeGreaterThan(0);
  });

  it('is never what a desk keeps, because the network writes to whoever sits there', () => {
    const boxes = deepDesks();
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      const account = npcUsername(box.essid, box.host);
      const written = boxMail({
        essid: box.essid,
        host: box.host,
        account,
        people: loginsOf(box),
      }).threads.some((thread) =>
        thread.messages.some((message) =>
          message.to.some((person) => person.username === account),
        ),
      );
      // The account a desk belongs to is always in the cast its own box draws on, so a
      // desk always has a mailbox and it always holds something.
      expect(`${box.host.hostname}: ${written} ${mailboxOn(box, account).ok}`).toBe(
        `${box.host.hostname}: true true`,
      );
    }
  });
});

describe('mail sent to a role mailbox', () => {
  it('is dated in the same window as everything else the world holds', () => {
    const servers = mailServers();
    expect(servers.length).toBeGreaterThan(0);
    let notes = 0;
    for (const box of servers) {
      const logins = new Set(loginsOf(box));
      for (const local of rosterOf(box).filter((name) => !logins.has(name))) {
        for (const message of parseMbox(readMailbox(box, local))) {
          const sentAt = Date.parse(message.headers.get('Date') ?? '');
          expect(sentAt).toBeLessThanOrEqual(LAST_SECOND);
          expect(sentAt).toBeGreaterThan(EARLIEST_INSTALL);
          notes += 1;
        }
      }
    }
    expect(notes).toBeGreaterThan(0);
  });
});

describe('the order a mailbox opens in', () => {
  it('leads with the work the network is there to do, then lets a personal thread in', () => {
    const personal = new Set(
      Object.values(PERSONAL_THREADS).flatMap((threads) =>
        threads.map((thread) => thread.subject),
      ),
    );
    let checked = 0;
    for (const essid of ALL_ESSIDS) {
      const business = new Set(
        MAIL_SPECS[networkArchetype(essid)].map((thread) => thread.subject),
      );
      const subjects = networkMail(essid).threads.map((thread) => thread.subject);
      // Two of the network's own business, then one of its people's, and round again —
      // so whatever a player reads first is the thing the place is actually for.
      expect(business.has(subjects[0] ?? '')).toBe(true);
      expect(business.has(subjects[1] ?? '')).toBe(true);
      if (subjects.length > 2) {
        expect(business.has(subjects[2] ?? '')).toBe(false);
        expect(personal.has(subjects[2] ?? '')).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('the headers as a terminal shows them', () => {
  it('folds each delivery line under its own tab, the way a mail header folds', () => {
    let folded = 0;
    for (const box of desks()) {
      const raw = readMailbox(box, npcUsername(box.essid, box.host));
      for (const line of raw.split('\n').filter((text) => text.startsWith('Received: '))) {
        expect(line).not.toContain(' by ');
      }
      // A header longer than a line continues on the next one, indented. Written flat it
      // would still parse, but it would not look like mail in a pager.
      expect(raw).toContain('\n\tby ');
      expect(raw).toContain('\n\tfor <');
      folded += 1;
    }
    expect(folded).toBeGreaterThan(0);
  });

  it('gives each machine that handled a message its own transfer id', () => {
    const served = desks().filter((desk) => relayFor(desk.essid) !== undefined);
    expect(served.length).toBeGreaterThan(0);
    for (const box of served) {
      for (const message of parseMbox(readMailbox(box, npcUsername(box.essid, box.host)))) {
        const ids = message.received.map(
          (hop) => hop.match(/with ESMTP id ([0-9A-F]+)/)?.[1] ?? '',
        );
        expect(ids.every((id) => /^[0-9A-F]{6}$/.test(id))).toBe(true);
        // The desk stamped its own delivery; the mail server stamped the one before it.
        // Two machines, two ids, and neither is the other's.
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('writes a role mailbox as an address with nobody behind it', () => {
    let addressed = 0;
    for (const box of [...mailServers(), ...deepMailServers()]) {
      const logins = new Set(loginsOf(box));
      const zone = lanZoneName(box.essid);
      for (const local of rosterOf(box).filter((name) => !logins.has(name))) {
        for (const message of parseMbox(readMailbox(box, local))) {
          // Nobody is called postmaster, so the header carries the address alone rather
          // than inventing a person to stand behind it.
          expect(message.headers.get('To')).toBe(`<${local}@${zone}>`);
          addressed += 1;
        }
      }
    }
    expect(addressed).toBeGreaterThan(0);
  });
});

/** `/var/log/mail.log.1` as the box keeps it, read as root — the file is the spool's own
 *  record of the same people, so it sits at the spool's tier. */
const readMailLog = (box: Box): string => {
  const result = createFsView(treeOf(box), { userType: 'root' }).read(
    asAbsPath('/var/log/mail.log.1'),
  );
  if (!result.ok) throw new Error(`/var/log/mail.log.1 on ${box.host.hostname}: ${result.error}`);
  return result.content;
};

/** One delivery as the log records it, read the way a player pairs the log against the
 *  spool: the queue id the message's own `Received:` line carries, the address it went
 *  to, and the moment it went. */
type LoggedDelivery = { readonly queueId: string; readonly to: string; readonly at: string };

const DELIVERED =
  /^(\w{3} [ \d]\d \d\d:\d\d:\d\d) \S+ postfix\/local\[\d+\]: ([0-9A-F]{6}): to=<([^>]+)>/;

const deliveriesIn = (log: string): readonly LoggedDelivery[] =>
  log.split('\n').flatMap((line) => {
    const match = DELIVERED.exec(line);
    return match === null
      ? []
      : [{ at: match[1] ?? '', queueId: match[2] ?? '', to: match[3] ?? '' }];
  });

/** A `Date:` header as the log's own stamp writes the same moment: `Jun 18 09:12:04`. */
const syslogStamp = (rfc: string): string => {
  const [, date = '', month = '', , time = ''] = rfc.split(' ');
  return `${month} ${String(Number(date)).padStart(2, ' ')} ${time}`;
};

/** When a log line was written, from the stamp it opens with. Every message in the world
 *  is dated in 2026, which is the year syslog's own stamp leaves out. */
const momentOf = (line: string): number => {
  const [month = '', date = '', time = ''] = line.slice(0, 15).split(/\s+/);
  return Date.parse(`${month} ${date} 2026 ${time} GMT`);
};

/** The id the box's transfer agent stamped on the copy it delivered, which is what its
 *  queue called the message. */
const stampedId = (received: readonly string[]): string =>
  /with ESMTP id ([0-9A-F]{6})/.exec(received[received.length - 1] ?? '')?.[1] ?? '';

const asText = (delivery: LoggedDelivery): string =>
  `${delivery.at} ${delivery.queueId} ${delivery.to}`;

/** Every box that carries a network's mail, on the LAN and below it. */
const mailCarriers = (): readonly Box[] => [...mailServers(), ...deepMailServers()];

describe('what a mail server logged itself doing', () => {
  it('records one delivery for every message its spool holds, and none it does not', () => {
    const carriers = mailCarriers();
    expect(carriers.length).toBeGreaterThan(0);
    for (const box of carriers) {
      const held = rosterOf(box).flatMap((local) =>
        parseMbox(readMailbox(box, local)).map((message) => ({
          queueId: stampedId(message.received),
          to: (message.headers.get('Delivered-To') ?? '').replace(/[<>]/g, ''),
          at: syslogStamp(message.headers.get('Date') ?? ''),
        })),
      );
      expect(held.length).toBeGreaterThan(0);
      expect(deliveriesIn(readMailLog(box)).map(asText).sort()).toEqual(held.map(asText).sort());
    }
  });

  it('names the machine each message came from, and the loopback for one written on it', () => {
    for (const box of mailCarriers()) {
      const zone = lanZoneName(box.essid);
      const queued = new Set(
        rosterOf(box).flatMap((local) =>
          parseMbox(readMailbox(box, local)).map((message) => stampedId(message.received)),
        ),
      );
      const clients = [...readMailLog(box).matchAll(/([0-9A-F]{6}): client=(\S+)\[([\d.]+)\]$/gm)];
      expect(clients.map(([, queueId]) => queueId).sort()).toEqual([...queued].sort());
      for (const [, , named = '', ip = ''] of clients) {
        // A message written on the mail server itself came in over the loopback, which is
        // what postfix names it; every other one came from a machine really on the LAN.
        if (ip === '127.0.0.1') {
          expect(named).toBe('localhost');
          continue;
        }
        const sender = generateHomeLan(box.essid).hosts.find((host) => host.ip === ip);
        expect(sender).toBeDefined();
        expect(named).toBe(`${sender?.hostname}.${zone}`);
      }
    }
  });

  it('carries each message’s own id, so the log and the mailbox name the same message', () => {
    for (const box of mailCarriers()) {
      const held = new Set(
        rosterOf(box).flatMap((local) =>
          parseMbox(readMailbox(box, local)).map((message) =>
            (message.headers.get('Message-ID') ?? '').replace(/[<>]/g, ''),
          ),
        ),
      );
      const logged = [...readMailLog(box).matchAll(/message-id=<([^>]+)>$/gm)].map(
        ([, id]) => id ?? '',
      );
      expect(new Set(logged)).toEqual(held);
    }
  });

  it('takes each message in and lets it go again, in the order the deliveries happened', () => {
    for (const box of mailCarriers()) {
      const lines = readMailLog(box)
        .split('\n')
        .filter((line) => line !== '');
      const queued = lines.flatMap((line) => /: ([0-9A-F]{6}): from=</.exec(line)?.[1] ?? []);
      const removed = lines.flatMap((line) => /: ([0-9A-F]{6}): removed$/.exec(line)?.[1] ?? []);
      expect(removed).toEqual(queued);
      const moments = lines.map(momentOf);
      moments.forEach((moment) => expect(Number.isNaN(moment)).toBe(false));
      expect(moments).toEqual([...moments].sort((earlier, later) => earlier - later));
      expect(Math.max(...moments)).toBeLessThan(WORLD_EPOCH);
    }
  });

  it('leaves the live mail log empty, for the deliveries a player’s own world makes', () => {
    for (const box of mailCarriers()) {
      const live = createFsView(treeOf(box), { userType: 'root' }).read(
        asAbsPath('/var/log/mail.log'),
      );
      expect(live.ok && live.content).toBe('');
    }
  });
});

/** The jobs a box's own `/etc/crontab` schedules, read back from the file a player can
 *  `cat`, with what each one prints when it runs. */
const cronJobsOn = (box: Box): readonly { readonly command: string; readonly prints: boolean }[] => {
  const read = createFsView(treeOf(box), { userType: 'guest' }).read(asAbsPath('/etc/crontab'));
  if (!read.ok) throw new Error(`/etc/crontab on ${box.host.hostname}: ${read.error}`);
  return read.content
    .split('\n')
    .filter((line) => /^\d/.test(line))
    .map((line) => {
      const command = line.split('\t')[3] ?? '';
      return { command, prints: (CRON_OUTPUT[command]?.length ?? 0) > 0 };
    });
};

const rootMailOn = (box: Box, as: 'root' | 'user' | 'guest' = 'root') =>
  createFsView(treeOf(box), { userType: as }).read(asAbsPath('/var/mail/root'));

/** Every path a line of cron output names, which the box has to really have. */
const pathsIn = (body: readonly string[]): readonly string[] =>
  body.flatMap((line) =>
    line
      .split(/[\s()]+/)
      .filter((word) => word.startsWith('/'))
      // `fstrim` reports the root filesystem as `/:`, where the colon is punctuation.
      .map((word) => word.replace(/:$/, '')),
  );

describe('the mail cron left for root', () => {
  it('is there exactly where a job in the box’s own crontab really prints', () => {
    let kept = 0;
    let empty = 0;
    for (const box of [...lanBoxes(ALL_ESSIDS), ...deepBoxes(ALL_ESSIDS)]) {
      const prints = cronJobsOn(box).some((job) => job.prints);
      expect(rootMailOn(box).ok, `${box.host.hostname}`).toBe(prints);
      if (prints) kept += 1;
      else empty += 1;
    }
    // Both sides really happen, so neither branch is a claim nothing exercises.
    expect(kept).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(0);
  });

  it('is root’s alone, wherever the box keeps it', () => {
    let checked = 0;
    for (const box of [...lanBoxes(ALL_ESSIDS), ...deepBoxes(ALL_ESSIDS)]) {
      if (!rootMailOn(box).ok) continue;
      expect(rootMailOn(box, 'user')).toEqual({ ok: false, error: 'permission_denied' });
      expect(rootMailOn(box, 'guest')).toEqual({ ok: false, error: 'permission_denied' });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('names the job each message is the output of, and holds nothing for a silent one', () => {
    let read = 0;
    for (const box of [...lanBoxes(ALL_ESSIDS), ...deepBoxes(ALL_ESSIDS)]) {
      const mail = rootMailOn(box);
      if (!mail.ok) continue;
      const jobs = cronJobsOn(box);
      const printing = jobs.filter((job) => job.prints).map((job) => job.command);
      const messages = parseMbox(mail.content);
      const zone = lanZoneName(box.essid);
      expect(messages.map((message) => message.headers.get('Subject') ?? '').sort()).toEqual(
        printing.map((command) => `Cron <root@${zone}> ${command}`).sort(),
      );
      for (const message of messages) {
        expect(message.body.length).toBeGreaterThan(0);
        expect(message.headers.get('Delivered-To')).toBe(`<root@${zone}>`);
        for (const path of pathsIn(message.body)) {
          expect(
            createFsView(treeOf(box), { userType: 'root' }).stat(asAbsPath(path)),
            `${box.host.hostname}: ${path}`,
          ).not.toBeNull();
        }
      }
      read += messages.length;
    }
    expect(read).toBeGreaterThan(0);
  });

  it('answers is-active with active, and du -sh with a size for each place it asked about', () => {
    const answered = new Set<string>();
    for (const box of [...lanBoxes(ALL_ESSIDS), ...deepBoxes(ALL_ESSIDS)]) {
      const mail = rootMailOn(box);
      if (!mail.ok) continue;
      for (const message of parseMbox(mail.content)) {
        const subject = message.headers.get('Subject') ?? '';
        const command = subject.slice(subject.indexOf('> ') + 2);
        if (command.startsWith('systemctl is-active')) {
          expect(message.body).toEqual(['active']);
          answered.add('is-active');
        }
        if (command.startsWith('du -sh')) {
          const places = command.split(' ').slice(2);
          expect(message.body.map((line) => line.split('\t')[1])).toEqual(places);
          message.body.forEach((line) => expect(line.split('\t')[0]).toMatch(/^\d+[KMG]$/));
          answered.add('du');
        }
      }
    }
    expect([...answered].sort()).toEqual(['du', 'is-active']);
  });

  it('is dated when the job last ran before the world stopped, never after', () => {
    let dated = 0;
    for (const box of [...lanBoxes(ALL_ESSIDS), ...deepBoxes(ALL_ESSIDS)]) {
      const mail = rootMailOn(box);
      if (!mail.ok) continue;
      for (const message of parseMbox(mail.content)) {
        const sentAt = Date.parse(message.headers.get('Date') ?? '');
        expect(Number.isNaN(sentAt)).toBe(false);
        expect(sentAt).toBeLessThan(WORLD_EPOCH);
        // Cron fires on the minute, and the world keeps no finer time than a second.
        expect(new Date(sentAt).getUTCSeconds()).toBe(0);
        dated += 1;
      }
    }
    expect(dated).toBeGreaterThan(0);
  });

  it('runs the job at the minute its own crontab schedules it for', () => {
    let checked = 0;
    for (const box of [...lanBoxes(ALL_ESSIDS), ...deepBoxes(ALL_ESSIDS)]) {
      const mail = rootMailOn(box);
      if (!mail.ok) continue;
      const read = createFsView(treeOf(box), { userType: 'guest' }).read(
        asAbsPath('/etc/crontab'),
      );
      const scheduled = new Map(
        (read.ok ? read.content : '')
          .split('\n')
          .filter((line) => /^\d/.test(line))
          .map((line) => {
            const [minuteHour = '', days = '', , command = ''] = line.split('\t');
            const [minute = '0', hour = '*'] = minuteHour.split(' ');
            return [command, { minute: Number(minute), hour, weekday: days.split(' ')[2] ?? '*' }];
          }),
      );
      for (const message of parseMbox(mail.content)) {
        const subject = message.headers.get('Subject') ?? '';
        const when = scheduled.get(subject.slice(subject.indexOf('> ') + 2));
        const ran = new Date(Date.parse(message.headers.get('Date') ?? ''));
        expect(ran.getUTCMinutes()).toBe(when?.minute);
        if (when?.hour !== '*') expect(ran.getUTCHours()).toBe(Number(when?.hour));
        if (when?.weekday !== '*') expect(ran.getUTCDay()).toBe(Number(when?.weekday));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
