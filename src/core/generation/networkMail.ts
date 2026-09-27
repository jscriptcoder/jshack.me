/**
 * The correspondence a network's people had with each other.
 *
 * A network is one place, so the mail on it is one body of writing rather than a private
 * pile per box: a thread read on the desk that sent it and a thread read on the mail
 * server that carried it are the SAME thread, message for message. That is only true if
 * both ends derive it from the same draw, so it has its own stream keyed by the network
 * alone — as the network's application archetype does — and every box reads its own slice
 * out of it.
 *
 * Everyone here is real. A correspondent is an account one of the network's machines
 * really keeps, writing as the person `persona` puts behind that account, at an address
 * on the network's own zone. Where two machines keep the same login the network still has
 * one address, so it has one mailbox and one person: the first machine's.
 *
 * Every message is dated inside the last months of the world, which keeps it after the
 * install of any application on the network — the mail directory logs some of these
 * deliveries, and a log line cannot predate the database that holds it.
 */

import { WORLD_EPOCH } from '../cve/worldClock';
import { lanZoneName } from '../network/resolveName';
import { createPrng, type Prng } from './prng';
import { inhabitant, networkPersona, personBehind } from './persona';
import { networkArchetype } from './databaseApp';
import {
  GENERIC_ROLE_MAIL,
  MAIL_SPECS,
  PERSONAL_THREADS,
  ROLE_MAILBOX_MAIL,
  type MailThreadSpec,
} from './pools/mailThreads';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { npcUsername } from './remoteHostFs';

const LAST_SECOND = WORLD_EPOCH / 1000 - 1;

/** How far back the correspondence reaches. Short enough that every message lands well
 *  after the earliest an application could have been installed (400 days), long enough
 *  that a mailbox is not all one week. */
const WINDOW_SECONDS = 120 * 86_400;

/** How many threads a person must be in, so no desk is left with an empty mailbox. */
const MIN_THREADS_PER_MAILBOX = 3;

/** How many people one thread is between: the opener and one or two others. */
const MAX_OTHERS = 2;

/** How often a third person is copied in, rather than two people writing to each other. */
const COPIED_IN_CHANCE = 0.6;

/** How many people one correspondence runs between. A network's own LAN never holds more
 *  accounts than this; a box below it can keep more logins than that, and the ones past
 *  the count simply have a mailbox nothing arrives in — which is what an account nobody
 *  writes to really looks like. */
const MAX_CAST = 8;

/** How many messages a thread runs to. */
const THREAD_LENGTH = { min: 1, max: 4 } as const;

/** How long a reply takes: ten minutes to two days. */
const REPLY_GAP_SECONDS = { min: 600, max: 2 * 86_400 } as const;

export type MailPerson = {
  readonly username: string;
  readonly fullName: string;
  /** Their address on the network's own zone. */
  readonly address: string;
  /** The machine they write from, which is what a delivery header names. */
  readonly host: LanHost;
};

export type MailMessage = {
  /** What a `Message-ID:` holds, without its angle brackets. */
  readonly id: string;
  /** The id the sending machine's transfer agent stamped on it, which its own
   *  `Received:` line carries and its `Message-ID` is built from. */
  readonly transferId: string;
  readonly from: MailPerson;
  readonly to: readonly MailPerson[];
  /** The thread's subject, bare: a reply wears its own `Re:` when it is written out. */
  readonly subject: string;
  readonly sentAt: number;
  readonly body: readonly string[];
  /** The `Message-ID` this answers, or null for the message that opened the thread. */
  readonly inReplyTo: string | null;
};

export type MailThread = {
  readonly subject: string;
  readonly participants: readonly MailPerson[];
  /** Oldest first, each one sent after the message it answers. */
  readonly messages: readonly MailMessage[];
};

export type NetworkMail = {
  /** Every account on the network that has a mailbox. */
  readonly people: readonly MailPerson[];
  readonly threads: readonly MailThread[];
};

/** A run of hex, as a mail transfer agent stamps a delivery. */
export const transferId = (prng: Prng): string =>
  Array.from({ length: 6 }, () => prng.nextInt(0, 15).toString(16).toUpperCase()).join('');

/** The moment part of a `Message-ID`, as a mail transfer agent writes it. */
const stampOf = (sentAt: number): string =>
  new Date(sentAt).toISOString().replace(/[-:T]/g, '').slice(0, 14);

/** What a `Message-ID:` holds: when the transfer agent stamped it, what it stamped, and
 *  the network it stamped it on. Written here so every message in the world — a thread's,
 *  or one a machine sent on its own — carries the same shape. */
export const mailMessageId = (options: {
  readonly sentAt: number;
  readonly transferId: string;
  readonly zone: string;
}): string => `${stampOf(options.sentAt)}.${options.transferId}@${options.zone}`;

/** A moment inside the window the correspondence lives in: late enough in the world that
 *  no application on the network was installed after it, and before the world stopped. */
export const mailMoment = (prng: Prng): number =>
  prng.nextInt(LAST_SECOND - WINDOW_SECONDS, LAST_SECOND) * 1000;

/** The subject the message really went out with: a reply wears `Re:`. Written here
 *  rather than at the mbox, because the directory's delivery log records the same
 *  string and the two have to match. */
export const subjectOf = (message: MailMessage): string =>
  message.inReplyTo === null ? message.subject : `Re: ${message.subject}`;

/** Every account on the network that has a mailbox, in address order along the LAN. */
export const peopleOn = (essid: string): readonly MailPerson[] => {
  const zone = lanZoneName(essid);
  const byUsername = new Map<string, MailPerson>();
  for (const host of generateHomeLan(essid).hosts) {
    if (host.kind !== 'machine') continue;
    const username = npcUsername(essid, host);
    if (byUsername.has(username)) continue;
    byUsername.set(username, {
      username,
      fullName: inhabitant({ essid, host, username }).fullName,
      address: `${username}@${zone}`,
      host,
    });
  }
  return [...byUsername.values()];
};

/** The moments a thread's messages were sent: ascending, the whole run finishing before
 *  the world stopped. The gaps are drawn first so the thread can be placed as a whole. */
const momentsOf = (prng: Prng, count: number): readonly number[] => {
  const gaps = Array.from({ length: count - 1 }, () =>
    prng.nextInt(REPLY_GAP_SECONDS.min, REPLY_GAP_SECONDS.max),
  );
  const span = gaps.reduce((total, gap) => total + gap, 0);
  const opened = prng.nextInt(LAST_SECOND - WINDOW_SECONDS, LAST_SECOND - span);
  return gaps.reduce<readonly number[]>(
    (moments, gap) => [...moments, (moments[moments.length - 1] ?? opened) + gap],
    [opened],
  );
};

const threadFrom = ({
  prng,
  template,
  participants,
  zone,
}: {
  readonly prng: Prng;
  readonly template: MailThreadSpec;
  readonly participants: readonly MailPerson[];
  readonly zone: string;
}): MailThread => {
  const count = Math.min(
    prng.nextInt(THREAD_LENGTH.min, THREAD_LENGTH.max),
    template.replies.length + 1,
  );
  const moments = momentsOf(prng, count);
  // In the order they were written: the first reply answers the opener and the second
  // answers that, so a thread that stops early still reads as a finished exchange.
  const replies = template.replies.slice(0, count - 1);

  const messages = moments.reduce<readonly MailMessage[]>((sent, second, index) => {
    const previous = sent[index - 1];
    // Each message answers the one above it, so the thread passes between its people in
    // turn. The index is taken modulo the cast, which always holds somebody.
    const from = participants[index % participants.length] as MailPerson;
    const reply = replies[index - 1];
    // A reply quotes what it answers, as a mail reader quotes it: the first line of the
    // message above, marked, then the answer under it.
    const body =
      previous === undefined || reply === undefined
        ? template.opener
        : [`> ${previous.body[0] ?? ''}`, '', ...reply];
    const sentAt = second * 1000;
    const stamped = transferId(prng);
    return [
      ...sent,
      {
        id: mailMessageId({ sentAt, transferId: stamped, zone }),
        transferId: stamped,
        from,
        to: participants.filter((person) => person.username !== from.username),
        subject: template.subject,
        sentAt,
        body,
        inReplyTo: previous?.id ?? null,
      },
    ];
  }, []);

  return { subject: template.subject, participants, messages };
};

/**
 * The threads a cast wrote to each other, drawn on `prng`.
 *
 * Threads go to whoever has been written to the least, until everybody has enough to fill
 * a mailbox — a correspondence is not a correspondence if half the cast is outside it.
 * It is being WRITTEN TO that counts, because a mailbox holds what arrived: opening a
 * thread nobody answered leaves its opener with nothing to read.
 */
const weave = ({
  people,
  templates: written,
  zone,
  prng,
}: {
  readonly people: readonly MailPerson[];
  /** What this network's people have to write about: the business it is in, and the
   *  ordinary traffic of the kind of place it is. */
  readonly templates: NetworkThreads;
  readonly zone: string;
  readonly prng: Prng;
}): NetworkMail => {
  // One person is nobody to write to. No network this small exists, but a mailbox built
  // on one would be a person talking to themselves.
  const cast = people.slice(0, MAX_CAST);
  if (cast.length < 2) return { people, threads: [] };

  const templates = ordered(prng, written);
  const reached = new Map(cast.map((person) => [person.username, 0]));
  const threads: MailThread[] = [];

  // Every thread in one correspondence is about something different: a place that ran out
  // of things to say would otherwise say one of them twice, word for word.
  while (
    Math.min(...reached.values()) < MIN_THREADS_PER_MAILBOX &&
    threads.length < templates.length
  ) {
    const byNeed = [...cast].sort(
      (left, right) => (reached.get(left.username) ?? 0) - (reached.get(right.username) ?? 0),
    );
    // Whoever has been written to least is written to next: they are a RECIPIENT of the
    // thread's opening message, so this round always leaves them with something. Somebody
    // from the next least written to opens it, and a third may be copied in. The cast
    // holds two people at the very least, which is what lets the head be taken as given.
    const [needy, ...rest] = byNeed as [MailPerson, ...MailPerson[]];
    const [opener = needy, ...spare] = prng.shuffle(rest.slice(0, MAX_OTHERS + 1));
    const copied = spare.slice(0, prng.next() < COPIED_IN_CHANCE ? 1 : 0);
    const thread = threadFrom({
      prng,
      template: templates[threads.length] as MailThreadSpec,
      participants: [opener, needy, ...copied],
      zone,
    });
    threads.push(thread);
    const written = new Set(
      thread.messages.flatMap((message) => message.to.map((person) => person.username)),
    );
    for (const username of written) reached.set(username, (reached.get(username) ?? 0) + 1);
  }

  return { people, threads };
};

/**
 * The mail the people on a network wrote to each other, drawn once for the whole network
 * so both ends of a thread agree about it.
 */
export const networkMail = (essid: string): NetworkMail =>
  weave({
    people: peopleOn(essid),
    templates: threadsFor(essid),
    zone: lanZoneName(essid),
    prng: createPrng(`mail-network-${essid}`),
  });

/** What the people on a network have to write about: the business their organisation is
 *  in, and the ordinary traffic of the kind of place they are in. */
type NetworkThreads = {
  readonly business: readonly MailThreadSpec[];
  readonly personal: readonly MailThreadSpec[];
};

const threadsFor = (essid: string): NetworkThreads => ({
  business: MAIL_SPECS[networkArchetype(essid)],
  personal: PERSONAL_THREADS[networkPersona(essid).category],
});

/** The order a network takes its subjects in: two of its business to one of the ordinary
 *  traffic, each half in its own shuffled order. A place talks about its work more than
 *  it talks about the kettle, and it starts with its work — but the kettle comes up
 *  early enough that a small network is not all invoices. */
const ordered = (prng: Prng, threads: NetworkThreads): readonly MailThreadSpec[] => {
  const business = prng.shuffle(threads.business);
  const personal = prng.shuffle(threads.personal);
  const mixed: MailThreadSpec[] = [];
  let atBusiness = 0;
  let atPersonal = 0;
  while (atBusiness < business.length || atPersonal < personal.length) {
    for (let taken = 0; taken < 2 && atBusiness < business.length; taken++) {
      mixed.push(business[atBusiness++] as MailThreadSpec);
    }
    if (atPersonal < personal.length) mixed.push(personal[atPersonal++] as MailThreadSpec);
  }
  return mixed;
};

/**
 * The mail on a box that is not on the network's own LAN — a machine on a deeper layer,
 * reached through a gateway.
 *
 * Such a box may not read what shares its layer: what hangs below a gateway can change
 * while the box itself does not, so a mailbox built from its neighbours would rewrite
 * itself when something unrelated appeared. Its correspondents are therefore the logins
 * its own application keeps, and the only machine any of them writes from is this one —
 * which is the truth about a box where those accounts are the only accounts there are.
 */
export const boxMail = ({
  essid,
  host,
  account,
  people,
}: {
  readonly essid: string;
  readonly host: LanHost;
  /** The box's own account, whose person the rest of the box already names. */
  readonly account: string;
  /** The logins the box's own application keeps. */
  readonly people: readonly string[];
}): NetworkMail =>
  weave({
    people: boxPeople({ essid, host, account, logins: people }),
    templates: threadsFor(essid),
    zone: lanZoneName(essid),
    prng: createPrng(`mail-box-${essid}-${host.ip}`),
  });

/** The people behind the logins a box below the LAN keeps, each writing from the box
 *  itself, which is the only machine any of them has. */
export const boxPeople = ({
  essid,
  host,
  account,
  logins,
}: {
  readonly essid: string;
  readonly host: LanHost;
  /** The box's own account, whose person the rest of the box already names. */
  readonly account: string;
  readonly logins: readonly string[];
}): readonly MailPerson[] => {
  const zone = lanZoneName(essid);
  return logins.map((username) => ({
    username,
    // The box's own user is the person the box already says they are, everywhere else
    // on it. The rest have no machine of their own, so each is drawn under their own
    // name — one seed for all of them would make them all the same person.
    fullName: personBehind({
      seed:
        username === account
          ? `inhabitant-${essid}-${host.ip}`
          : `inhabitant-${essid}-${host.ip}-${username}`,
      username,
    }),
    address: `${username}@${zone}`,
    host,
  }));
};

/** Everything a correspondence wrote to one account, oldest first. */
export const deliveredTo = (mail: NetworkMail, username: string): readonly MailMessage[] =>
  mail.threads
    .flatMap((thread) => thread.messages)
    .filter((message) => message.to.some((person) => person.username === username))
    .sort((earlier, later) => earlier.sentAt - later.sentAt);

/** How much mail a role mailbox is holding when the world stops. */
const SHARED_MESSAGE_COUNT = { min: 1, max: 3 } as const;

/** The mail a role mailbox is holding: written by people who really work on the network,
 *  to the address rather than to each other. */
const sharedMail = ({
  essid,
  host,
  local,
  people,
}: {
  readonly essid: string;
  readonly host: LanHost;
  readonly local: string;
  readonly people: readonly MailPerson[];
}): { readonly recipient: MailPerson; readonly messages: readonly MailMessage[] } => {
  const zone = lanZoneName(essid);
  // Its OWN stream, keyed by the mailbox: what a role address holds must be the same
  // whether the spool file is being written or the directory's log is being read, and
  // neither may depend on the order the other happened to ask in.
  const prng = createPrng(`mail-box-${essid}-${host.ip}-${local}`);
  // A role mailbox is an address, not a person, so it has no name to sign with — and it
  // lives on the machine that carries the mail.
  const recipient: MailPerson = { username: local, fullName: '', address: `${local}@${zone}`, host };
  const notes = prng.pickN(
    ROLE_MAILBOX_MAIL[local] ?? GENERIC_ROLE_MAIL,
    prng.nextInt(SHARED_MESSAGE_COUNT.min, SHARED_MESSAGE_COUNT.max),
  );
  const messages = notes
    .map((note) => {
      const sentAt = mailMoment(prng);
      const stamped = transferId(prng);
      return {
        id: mailMessageId({ sentAt, transferId: stamped, zone }),
        transferId: stamped,
        from: prng.pick(people),
        to: [recipient],
        subject: note.subject,
        sentAt,
        body: note.body,
        inReplyTo: null,
      };
    })
    .sort((earlier, later) => earlier.sentAt - later.sentAt);
  return { recipient, messages };
};

/**
 * What really arrived in one mailbox on `box`, oldest first, with the person or the role
 * address it belongs to.
 *
 * One answer for two readers: the spool file writes these messages out, and the mail
 * directory's own delivery log records the same ones. A log that named a message no
 * mailbox holds would be the box contradicting itself.
 */
export const arrivedIn = ({
  essid,
  host,
  local,
  mail,
}: {
  readonly essid: string;
  readonly host: LanHost;
  /** The local part of the mailbox: an account of the correspondence, or a role address. */
  readonly local: string;
  readonly mail: NetworkMail;
}): { readonly recipient: MailPerson; readonly messages: readonly MailMessage[] } => {
  const person = mail.people.find((candidate) => candidate.username === local);
  return person === undefined
    ? sharedMail({ essid, host, local, people: mail.people })
    : { recipient: person, messages: deliveredTo(mail, local) };
};
