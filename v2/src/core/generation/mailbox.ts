/**
 * What a box keeps of its network's mail: the mbox files under `/var/mail`.
 *
 * A desk keeps one, its own user's, and it holds what ARRIVED — an mbox is an inbox, so
 * a person's own side of a thread shows only as the lines the reply quotes back at them.
 * That is what a real `/var/mail/<user>` holds, and it is why two mailboxes can be read
 * against each other: a message written to two people sits in both, word for word.
 *
 * What differs between two copies of one message is the route it took to get there. Each
 * copy carries its own delivery headers, naming the machine that sent it, the network's
 * mail server where the network has one, and the box the file is sitting on — every one
 * of them a machine a player can find with a scan. That is also what keeps the two copies
 * from being the same bytes.
 *
 * The box's own draws — the ids its transfer agent stamped — come from its own stream, so
 * a box can be given a mailbox without moving any value drawn for any other part of it.
 */

import { createPrng, type Prng } from './prng';
import { lanZoneName } from '../network/resolveName';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import { roleOfHostname } from './pools/hostnames';
import {
  mailMessageId,
  mailMoment,
  networkMail,
  transferId,
  type MailMessage,
  type MailPerson,
  type NetworkMail,
} from './networkMail';
import { generateApplication } from './generateDatabase';
import {
  dir,
  file,
  MAIL_FILE,
  MAIL_SPOOL_DIR,
  MAIL_SPOOL_FILE,
  TRAVERSABLE_DIR,
} from './baseFs';
import type { Directory } from '../filesystem/types';

/** The machines somebody sits at. A phone and a tablet on the same LAN belong to somebody
 *  too, but nobody reads their mail over a terminal, so they keep none. */
const DESK_PREFIXES: readonly string[] = ['desktop', 'laptop', 'workstation'];

const isDesk = (hostname: string): boolean =>
  DESK_PREFIXES.includes(hostname.slice(0, hostname.lastIndexOf('-')));

/** The machine that carries the network's mail, where the network has one. Mail on a
 *  network without one goes straight from desk to desk, which is what a small LAN with no
 *  mail server really does. */
const relayOf = (essid: string): LanHost | undefined =>
  generateHomeLan(essid).hosts.find(
    (host) => host.kind === 'machine' && roleOfHostname(host.hostname) === 'mailserver',
  );

/** A date as a mail header writes it: `Thu, 18 Jun 2026 09:12:04 +0000`. */
const rfcDate = (sentAt: number): string => new Date(sentAt).toUTCString().replace('GMT', '+0000');

/** A date as the mbox separator line writes it: `Thu Jun 18 09:12:04 2026`. */
const asctime = (sentAt: number): string => {
  const [day = '', date = '', month = '', year = '', time = ''] = new Date(sentAt)
    .toUTCString()
    .split(' ');
  return `${day.replace(',', '')} ${month} ${date} ${time} ${year}`;
};

/** How a header names somebody. A role mailbox is an address with nobody behind it, so
 *  it is written as an address alone. */
const addressed = (person: MailPerson): string =>
  person.fullName === '' ? `<${person.address}>` : `${person.fullName} <${person.address}>`;

/** One hop, folded the way a mail header folds: the machine it came from, the machine
 *  that took it, and who it was for. */
const receivedLine = (hop: {
  readonly from: LanHost;
  readonly by: LanHost;
  readonly id: string;
  readonly recipient: string;
  readonly sentAt: number;
  readonly zone: string;
}): string =>
  [
    `Received: from ${hop.from.hostname}.${hop.zone} (${hop.from.ip})`,
    `\tby ${hop.by.hostname}.${hop.zone} with ESMTP id ${hop.id}`,
    `\tfor <${hop.recipient}>; ${rfcDate(hop.sentAt)}`,
  ].join('\n');

/**
 * One message as it sits in `recipient`'s mailbox on `box`, newest hop first.
 *
 * The route is the truth about this copy: the sender's machine handed it to the network's
 * mail server, and the mail server handed it to the box the file is on. Where the box IS
 * the mail server, or the network has none, there was only ever one hop.
 */
const formatMessage = ({
  message,
  recipient,
  box,
  relay,
  stamp,
  zone,
}: {
  readonly message: MailMessage;
  readonly recipient: MailPerson;
  readonly box: LanHost;
  readonly relay: LanHost | undefined;
  /** The id this box's own transfer agent stamped on the delivery it made. */
  readonly stamp: string;
  readonly zone: string;
}): string => {
  const carried = relay !== undefined && relay.ip !== box.ip;
  const hops = [
    ...(carried
      ? [
          receivedLine({
            from: relay,
            by: box,
            id: stamp,
            recipient: recipient.address,
            sentAt: message.sentAt,
            zone,
          }),
        ]
      : []),
    receivedLine({
      from: message.from.host,
      by: carried ? relay : box,
      id: message.transferId,
      recipient: recipient.address,
      sentAt: message.sentAt,
      zone,
    }),
  ];
  return [
    `From ${message.from.address} ${asctime(message.sentAt)}`,
    ...hops,
    `Message-ID: <${message.id}>`,
    `Date: ${rfcDate(message.sentAt)}`,
    `From: ${addressed(message.from)}`,
    `To: ${message.to.map(addressed).join(', ')}`,
    `Subject: ${message.inReplyTo === null ? message.subject : `Re: ${message.subject}`}`,
    ...(message.inReplyTo === null ? [] : [`In-Reply-To: <${message.inReplyTo}>`]),
    `Delivered-To: <${recipient.address}>`,
    'Status: RO',
    '',
    ...message.body,
    '',
  ].join('\n');
};

/** `recipient`'s mailbox as it sits on `box`: everything the network wrote to them,
 *  oldest first, or null when nothing ever did. */
const mboxFor = ({
  zone,
  box,
  relay,
  recipient,
  messages,
  prng,
}: {
  readonly zone: string;
  readonly box: LanHost;
  readonly relay: LanHost | undefined;
  readonly recipient: MailPerson;
  readonly messages: readonly MailMessage[];
  readonly prng: Prng;
}): string | null => {
  if (messages.length === 0) return null;
  // A stamp is drawn only where this box really made a delivery of its own — on the mail
  // server itself the message arrived in one hop, and there is no second id to invent.
  return messages
    .map((message) =>
      formatMessage({
        message,
        recipient,
        box,
        relay,
        stamp: relay !== undefined && relay.ip !== box.ip ? transferId(prng) : '',
        zone,
      }),
    )
    .join('');
};

/** Everything a correspondence wrote to one account, oldest first. */
const deliveredTo = (mail: NetworkMail, username: string): readonly MailMessage[] =>
  mail.threads
    .flatMap((thread) => thread.messages)
    .filter((message) => message.to.some((person) => person.username === username))
    .sort((earlier, later) => earlier.sentAt - later.sentAt);

/**
 * What arrives at a mailbox nobody in particular owns. A role mailbox is the address an
 * organisation publishes, so what lands in it is somebody there writing to the role
 * rather than to a person — which is why these are single messages and not threads.
 */
const SHARED_MAIL: Readonly<
  Record<string, readonly { readonly subject: string; readonly body: readonly string[] }[]>
> = {
  info: [
    { subject: 'Opening hours', body: ['Somebody asked what time we open on Saturdays.', 'I have told them ten.'] },
    { subject: 'Website contact form', body: ['Three enquiries came through the form this week.', 'All answered.'] },
  ],
  sales: [
    { subject: 'Quote for the Harper job', body: ['They want the quote broken down by week.', 'I said I would send it Monday.'] },
    { subject: 'Renewal list', body: ['Six renewals due next month.', 'Two of them have not answered the first letter.'] },
  ],
  support: [
    { subject: 'Ticket backlog', body: ['We are down to eleven open tickets.', 'The oldest is from a fortnight ago.'] },
    { subject: 'Call handover', body: ['Nothing outstanding from this morning.', 'The one about the printer can wait.'] },
  ],
  billing: [
    { subject: 'Unpaid from March', body: ['Two invoices from March are still unpaid.', 'Chased both today.'] },
    { subject: 'New bank details', body: ['The bank details on the invoice template are out of date.', 'Please use the ones on the letterhead.'] },
  ],
  postmaster: [
    { subject: 'Queue was backed up', body: ['Mail sat in the queue for an hour this morning.', 'It cleared on its own once the disk was tidied.'] },
    { subject: 'Alias for the new starter', body: ['Can somebody add the new starter to the everyone alias.'] },
  ],
  office: [
    { subject: 'Stationery order', body: ['Putting an order in on Friday.', 'Tell me before then if you need anything.'] },
    { subject: 'Cleaner comes Tuesday', body: ['Please clear the desks before you leave on Monday.'] },
  ],
  accounts: [
    { subject: 'Expenses cut-off', body: ['Expenses for the quarter have to be in by the end of the month.'] },
    { subject: 'Filing', body: ['The paperwork for last year is boxed and in the cupboard.'] },
  ],
};

/** For a role mailbox nothing above names — the roster is drawn from a pool this one
 *  tracks, so it is a fallback rather than a common case. */
const GENERIC_SHARED_MAIL: readonly { readonly subject: string; readonly body: readonly string[] }[] =
  [
    { subject: 'Nothing outstanding', body: ['Nothing outstanding on this address today.'] },
    { subject: 'Passing this on', body: ['Passing this on to whoever picks the address up.'] },
  ];

/** How much mail a role mailbox is holding when the world stops. */
const SHARED_MESSAGE_COUNT = { min: 1, max: 3 } as const;

/** The mail a role mailbox is holding: written by people who really work on the network,
 *  to the address rather than to each other. */
const sharedMail = ({
  prng,
  local,
  people,
  host,
  zone,
}: {
  readonly prng: Prng;
  readonly local: string;
  readonly people: readonly MailPerson[];
  readonly host: LanHost;
  readonly zone: string;
}): { readonly recipient: MailPerson; readonly messages: readonly MailMessage[] } => {
  // A role mailbox is an address, not a person, so it has no name to sign with — and it
  // lives on the machine that carries the mail.
  const recipient: MailPerson = { username: local, fullName: '', address: `${local}@${zone}`, host };
  const notes = prng.pickN(
    SHARED_MAIL[local] ?? GENERIC_SHARED_MAIL,
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
 * Every mailbox the machine that carries the network's mail keeps: one for each login on
 * the network and one for each role address, exactly as its own directory says.
 *
 * A person's mailbox here holds the same messages their desk holds — it is one
 * correspondence — but each copy carries the route it really took, and this one arrived
 * in a single hop because this is the machine that made it.
 */
const spoolEntries = ({
  essid,
  host,
  username,
  mail,
  zone,
  prng,
}: {
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
  readonly mail: NetworkMail;
  readonly zone: string;
  readonly prng: Prng;
}): Readonly<Record<string, ReturnType<typeof file>>> => {
  const roster = (
    generateApplication({
      appSeed: `db-app-${essid}-${host.ip}`,
      essid,
      host,
      account: username,
      role: roleOfHostname(host.hostname),
    }).tables.mailboxes?.rows ?? []
  ).map((row) => String(row.local_part));

  return Object.fromEntries(
    roster.map((local) => {
      const person = mail.people.find((candidate) => candidate.username === local);
      const { recipient, messages } =
        person === undefined
          ? sharedMail({ prng, local, people: mail.people, host, zone })
          : { recipient: person, messages: deliveredTo(mail, local) };
      // This IS the machine that carries the mail, so nothing relayed it here.
      return [
        local,
        file(
          mboxFor({ zone, box: host, relay: host, recipient, messages, prng }) ?? '',
          MAIL_SPOOL_FILE,
        ),
      ];
    }),
  );
};

/**
 * The `/var/mail` a box keeps, ready to spread into its `/var`, or nothing for a box
 * nobody reads mail on.
 *
 * Only a desk on the network's own LAN has one today: a deep box cannot read the layer it
 * stands on, so its mail is drawn differently, and a box nobody sits at has no inbox to
 * keep.
 */
export const mailEntries = ({
  essid,
  host,
  username,
}: {
  readonly essid: string;
  readonly host: LanHost;
  /** The account this box belongs to, whose mailbox it keeps. */
  readonly username: string;
}): Readonly<Record<string, Directory>> => {
  const carriesMail = roleOfHostname(host.hostname) === 'mailserver';
  if ((!carriesMail && !isDesk(host.hostname)) || !isOnHomeLan(essid, host)) return {};

  // The network's correspondence is derived ONCE for the box. It is the same value for
  // every mailbox on it, and deriving it per mailbox doubled the world's build time.
  const mail = networkMail(essid);
  const zone = lanZoneName(essid);
  const prng = createPrng(`mail-box-${essid}-${host.ip}`);
  if (carriesMail) {
    return { mail: dir(spoolEntries({ essid, host, username, mail, zone, prng }), MAIL_SPOOL_DIR) };
  }

  const recipient = mail.people.find((person) => person.username === username);
  if (recipient === undefined) return {};
  const mbox = mboxFor({
    zone,
    box: host,
    relay: relayOf(essid),
    recipient,
    messages: deliveredTo(mail, username),
    prng,
  });
  return mbox === null ? {} : { mail: dir({ [username]: file(mbox, MAIL_FILE) }, TRAVERSABLE_DIR) };
};
