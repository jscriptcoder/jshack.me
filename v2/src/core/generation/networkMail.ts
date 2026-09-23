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
import { inhabitant, personBehind } from './persona';
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
const COPIED_IN_CHANCE = 0.4;

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

/** What people on a network write to each other about. Replaced per archetype when the
 *  thread pools land; until then one generic set, so every network's people have
 *  something to say to each other. */
type ThreadTemplate = {
  readonly subject: string;
  readonly opener: readonly string[];
  readonly replies: readonly (readonly string[])[];
};

const THREAD_TEMPLATES: readonly ThreadTemplate[] = [
  {
    subject: "Friday's deploy",
    opener: ['Are we still pushing the release on Friday?', 'The checklist is done apart from the backups.'],
    replies: [
      ['Not before the backups run. I moved it to Monday.'],
      ['Monday works. I will be around all morning.'],
    ],
  },
  {
    subject: 'Disk on the file share',
    opener: ['The share is filling up again.', 'Most of it is last quarter, which nobody has opened since.'],
    replies: [['I will archive anything older than a year.'], ['Archived. It is down to half.']],
  },
  {
    subject: 'Printer on the landing',
    opener: ['The printer has stopped answering again.', 'It worked on Tuesday.'],
    replies: [['Power cycled it. Try again.'], ['Working, thank you.']],
  },
  {
    subject: 'Meeting moved',
    opener: ['Moving the catch-up to eleven, the room was double booked.'],
    replies: [['Eleven is fine.'], ['I will be five minutes late.']],
  },
  {
    subject: 'Backup report',
    opener: ['Last night finished clean for the first time in a fortnight.'],
    replies: [['Good. Leave the schedule alone then.']],
  },
  {
    subject: 'New starter',
    opener: ['Someone new starts Monday and will need an account.', 'Same setup as the last one.'],
    replies: [['Account is ready.'], ['Thanks, I will show them round.']],
  },
  {
    subject: 'Keys to the cupboard',
    opener: ['Who has the key to the cupboard by the window?'],
    replies: [['It is on the hook in the kitchen.'], ['Found it, thanks.']],
  },
  {
    subject: 'Kettle fund',
    opener: ['The kettle has died. Collecting for a new one.'],
    replies: [['Put me down for a share.'], ['Ordered. It arrives Thursday.']],
  },
  {
    subject: 'Old laptops',
    opener: ['There are four old laptops under the desk. Anyone want them before they go?'],
    replies: [['I will take one for spares.'], ['The rest can go.']],
  },
  {
    subject: 'Notes from the review',
    opener: ['Wrote the review notes up, they are on the share.'],
    replies: [['Read them. Nothing to add.']],
  },
  {
    subject: 'Heating',
    opener: ['It is freezing in here. Is the heating on a timer?'],
    replies: [['It comes on at seven. I put it forward an hour.'], ['Much better.']],
  },
  {
    subject: 'Parcel',
    opener: ['A parcel came for you, it is behind the desk.'],
    replies: [['Got it, thanks.']],
  },
  {
    subject: 'Lunch',
    opener: ['Anyone going out for lunch?'],
    replies: [['Give me ten minutes.'], ['Wait for me.']],
  },
  {
    subject: 'Door code',
    opener: ['The side door sticks when it is cold. Pull it towards you as you push.'],
    replies: [['That worked, thank you.']],
  },
];

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

/** Every account on the network that has a mailbox, in address order along the LAN. */
const peopleOn = (essid: string): readonly MailPerson[] => {
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
  readonly template: ThreadTemplate;
  readonly participants: readonly MailPerson[];
  readonly zone: string;
}): MailThread => {
  const count = Math.min(
    prng.nextInt(THREAD_LENGTH.min, THREAD_LENGTH.max),
    template.replies.length + 1,
  );
  const moments = momentsOf(prng, count);
  const replies = prng.pickN(template.replies, count - 1);

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
  zone,
  prng,
}: {
  readonly people: readonly MailPerson[];
  readonly zone: string;
  readonly prng: Prng;
}): NetworkMail => {
  // One person is nobody to write to. No network this small exists, but a mailbox built
  // on one would be a person talking to themselves.
  if (people.length < 2) return { people, threads: [] };

  const templates = prng.shuffle(THREAD_TEMPLATES);
  const reached = new Map(people.map((person) => [person.username, 0]));
  const threads: MailThread[] = [];

  while (Math.min(...reached.values()) < MIN_THREADS_PER_MAILBOX) {
    const byNeed = [...people].sort(
      (left, right) => (reached.get(left.username) ?? 0) - (reached.get(right.username) ?? 0),
    );
    // Whoever has been written to least is written to next: they are a RECIPIENT of the
    // thread's opening message, so this round always leaves them with something. Somebody
    // from the next least written to opens it, and a third may be copied in. The network
    // holds two people at the very least, which is what lets the head be taken as given.
    const [needy, ...rest] = byNeed as [MailPerson, ...MailPerson[]];
    const [opener = needy, ...spare] = prng.shuffle(rest.slice(0, MAX_OTHERS + 1));
    const copied = spare.slice(0, prng.next() < COPIED_IN_CHANCE ? 1 : 0);
    const thread = threadFrom({
      prng,
      // Subjects run through the shuffled set before any of them comes round again.
      template: templates[threads.length % templates.length] as ThreadTemplate,
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
    zone: lanZoneName(essid),
    prng: createPrng(`mail-network-${essid}`),
  });

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
}): NetworkMail => {
  const zone = lanZoneName(essid);
  return weave({
    people: people.map((username) => ({
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
    })),
    zone,
    prng: createPrng(`mail-box-${essid}-${host.ip}`),
  });
};
