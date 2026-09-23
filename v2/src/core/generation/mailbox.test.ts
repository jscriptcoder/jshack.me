import { describe, expect, it } from 'vitest';
import { networkMail, type MailMessage } from './networkMail';
import { npcUsername } from './remoteHostFs';
import { inhabitant } from './persona';
import { generateHomeLan } from './generateHomeLan';
import { lanZoneName } from '../network/resolveName';
import { WORLD_EPOCH } from '../cve/worldClock';
import { ALL_ESSIDS } from '../../test/worldContent';

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

  it('reaches everyone on the network, so no desk is left with an empty mailbox', () => {
    for (const essid of ALL_ESSIDS) {
      const mail = networkMail(essid);
      for (const person of accountsOn(essid)) {
        const theirs = mail.threads.filter((thread) =>
          thread.participants.some((member) => member.username === person.username),
        );
        expect(theirs.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
