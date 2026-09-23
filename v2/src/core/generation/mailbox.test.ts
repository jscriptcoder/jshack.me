import { describe, expect, it } from 'vitest';
import { networkMail, type MailMessage } from './networkMail';
import { buildRemoteHostFs, npcUsername } from './remoteHostFs';
import { inhabitant } from './persona';
import { generateHomeLan } from './generateHomeLan';
import { generateApplication } from './generateDatabase';
import { roleOfHostname } from './pools/hostnames';
import { lanZoneName } from '../network/resolveName';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';
import { WORLD_EPOCH } from '../cve/worldClock';
import { ALL_ESSIDS, lanBoxes, type Box } from '../../test/worldContent';

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
      current.body.push(line);
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

const mailboxOn = (box: Box, name: string, as: 'root' | 'user' | 'guest' = 'root') =>
  createFsView(buildRemoteHostFs(box.essid, box.host), { userType: as }).read(
    asAbsPath(`/var/mail/${name}`),
  );

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
      expect(view.stat(asAbsPath('/var/mail'))).toBeNull();
    }
  });
});

const mailServers = (): readonly Box[] =>
  lanBoxes(ALL_ESSIDS).filter(({ host }) => roleOfHostname(host.hostname) === 'mailserver');

/** The mailboxes a mail server's own application says it keeps: one per login on the
 *  network, plus the shared ones every organisation has. */
const rosterOf = (box: Box): readonly string[] =>
  (
    generateApplication({
      appSeed: `db-app-${box.essid}-${box.host.ip}`,
      essid: box.essid,
      host: box.host,
      account: npcUsername(box.essid, box.host),
      role: roleOfHostname(box.host.hostname),
    }).tables.mailboxes?.rows ?? []
  ).map((row) => String(row.local_part));

const listMail = (box: Box, as: 'root' | 'user' | 'guest' = 'root') =>
  createFsView(buildRemoteHostFs(box.essid, box.host), { userType: as }).list(
    asAbsPath('/var/mail'),
  );

describe('a mail server spool', () => {
  it('keeps a mailbox for every mailbox its own application names', () => {
    const servers = mailServers();
    expect(servers.length).toBeGreaterThan(0);
    for (const box of servers) {
      const listed = listMail(box);
      expect(listed.ok).toBe(true);
      expect(listed.ok && [...listed.entries].sort()).toEqual(
        [...rosterOf(box)].sort(),
      );
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
