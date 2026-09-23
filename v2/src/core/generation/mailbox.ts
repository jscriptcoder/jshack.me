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
import { networkMail, type MailMessage, type MailPerson } from './networkMail';
import { dir, file, MAIL_FILE, TRAVERSABLE_DIR } from './baseFs';
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

const addressed = (person: MailPerson): string => `${person.fullName} <${person.address}>`;

/** A run of hex, as a transfer agent stamps the delivery it just made. */
const transferId = (prng: Prng): string =>
  Array.from({ length: 6 }, () => prng.nextInt(0, 15).toString(16).toUpperCase()).join('');

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
  essid,
  box,
  recipient,
  prng,
}: {
  readonly essid: string;
  readonly box: LanHost;
  readonly recipient: MailPerson;
  readonly prng: Prng;
}): string | null => {
  const zone = lanZoneName(essid);
  const relay = relayOf(essid);
  const delivered = networkMail(essid)
    .threads.flatMap((thread) => thread.messages)
    .filter((message) => message.to.some((person) => person.username === recipient.username))
    .sort((earlier, later) => earlier.sentAt - later.sentAt);
  if (delivered.length === 0) return null;
  return delivered
    .map((message) =>
      formatMessage({ message, recipient, box, relay, stamp: transferId(prng), zone }),
    )
    .join('');
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
  if (!isDesk(host.hostname) || !isOnHomeLan(essid, host)) return {};
  const recipient = networkMail(essid).people.find((person) => person.username === username);
  if (recipient === undefined) return {};
  const mbox = mboxFor({
    essid,
    box: host,
    recipient,
    prng: createPrng(`mail-box-${essid}-${host.ip}`),
  });
  return mbox === null ? {} : { mail: dir({ [username]: file(mbox, MAIL_FILE) }, TRAVERSABLE_DIR) };
};
