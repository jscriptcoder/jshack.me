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
  arrivedIn,
  boxMail,
  networkMail,
  subjectOf,
  transferId,
  type MailMessage,
  type MailPerson,
  type NetworkMail,
} from './networkMail';
import { generateApplication, type Application } from './generateDatabase';
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
    `Subject: ${subjectOf(message)}`,
    ...(message.inReplyTo === null ? [] : [`In-Reply-To: <${message.inReplyTo}>`]),
    `Delivered-To: <${recipient.address}>`,
    'Status: RO',
    '',
    // A body line that begins like a separator is quoted, as every mail store that keeps
    // mbox has to: unquoted, one sentence of ordinary prose would split the file in two
    // and the rest of the mailbox would read as a message with no headers.
    ...message.body.map((line) => (line.startsWith('From ') ? `>${line}` : line)),
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

/** What the box's own application holds, whether or not mysqld is serving it — the
 *  roster of a mail server's spool, and the only people a box below the LAN knows. */
const applicationOn = ({
  essid,
  host,
  username,
}: {
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
}): Application =>
  generateApplication({
    appSeed: `db-app-${essid}-${host.ip}`,
    essid,
    host,
    account: username,
    role: roleOfHostname(host.hostname),
  });

const loginsIn = (application: Application): readonly string[] =>
  (application.tables.users?.rows ?? []).map((row) => String(row.username));

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
  application,
  mail,
  zone,
  prng,
}: {
  readonly essid: string;
  readonly host: LanHost;
  readonly application: Application;
  readonly mail: NetworkMail;
  readonly zone: string;
  readonly prng: Prng;
}): Readonly<Record<string, ReturnType<typeof file>>> => {
  const roster = (application.tables.mailboxes?.rows ?? []).map((row) => String(row.local_part));

  return Object.fromEntries(
    roster.map((local) => {
      const { recipient, messages } = arrivedIn({ essid, host, local, mail });
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
 * A desk keeps its own user's; the machine that carries the mail keeps the roster's. A
 * box nobody sits at and nothing is addressed through keeps none.
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
  if (!carriesMail && !isDesk(host.hostname)) return {};

  // The correspondence is derived ONCE for the box. It is the same value for every
  // mailbox on it, and deriving it per mailbox doubled the world's build time.
  const onLan = isOnHomeLan(essid, host);
  // The box's own application is read only where it is needed: to name a mail server's
  // roster, and to name the only people a box below the LAN is allowed to know.
  const application =
    carriesMail || !onLan ? applicationOn({ essid, host, username }) : undefined;
  const mail =
    application === undefined || onLan
      ? networkMail(essid)
      : boxMail({ essid, host, account: username, people: loginsIn(application) });
  const zone = lanZoneName(essid);
  const prng = createPrng(`mail-box-${essid}-${host.ip}`);
  // Where the mail came through: the network's mail server for a box on the LAN, and the
  // box itself for one below it, where these accounts are the only accounts there are.
  const relay = onLan ? relayOf(essid) : host;
  if (application !== undefined && carriesMail) {
    return {
      mail: dir(spoolEntries({ essid, host, application, mail, zone, prng }), MAIL_SPOOL_DIR),
    };
  }

  const { recipient, messages } = arrivedIn({ essid, host, local: username, mail });
  const mbox = mboxFor({ zone, box: host, relay, recipient, messages, prng });
  return mbox === null ? {} : { mail: dir({ [username]: file(mbox, MAIL_FILE) }, TRAVERSABLE_DIR) };
};
