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
  mailMessageId,
  networkMail,
  subjectOf,
  transferId,
  type MailMessage,
  type MailPerson,
  type NetworkMail,
} from './networkMail';
import { CRON_OUTPUT } from './pools/cronMail';
import { WORLD_EPOCH } from '../cve/worldClock';
import { generateApplication, type Application } from './generateDatabase';
import {
  ALIASES_FILE,
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

const LOOPBACK = '127.0.0.1';
const DAY_MS = 86_400_000;
const GIB = 1_073_741_824;
/** The last day the world has: 2026-07-11, the day logrotate ran. Cron's last run of any
 *  job is on it or, for a weekly job, on the most recent matching day before it. */
const LAST_DAY = WORLD_EPOCH - DAY_MS;

/** One job of the box's own `/etc/crontab`, with the last moment it fired. */
type CronRun = { readonly command: string; readonly ranAt: number };

/**
 * The last time a job fired before the world stopped, read from the schedule the box's
 * own crontab states — so the mail cron left is dated the same instant `syslog.1` records
 * the run at, and a player can put the two beside each other.
 *
 * An hourly job last ran in the final hour of the last day; a daily one at its own hour
 * that day; a weekly one on the most recent day of the week it names, which is that day
 * or one of the six before it.
 */
const lastRun = ({
  minute,
  hour,
  weekday,
}: {
  readonly minute: number;
  readonly hour: number | null;
  readonly weekday: number | null;
}): number => {
  const day = new Date(LAST_DAY);
  const backBy = weekday === null ? 0 : (day.getUTCDay() - weekday + 7) % 7;
  return Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate() - backBy,
    hour ?? 23,
    minute,
  );
};

/** The jobs in the box's own crontab that really print something, each with the last
 *  moment it ran, oldest first. Read from the file as the box keeps it, so the mail and
 *  the crontab can never disagree about what is scheduled. */
const printingRuns = (crontab: string): readonly CronRun[] =>
  crontab
    .split('\n')
    .filter((line) => /^\d/.test(line))
    .flatMap((line) => {
      const [minuteHour = '', days = '', , command = ''] = line.split('\t');
      if ((CRON_OUTPUT[command] ?? []).length === 0) return [];
      const [minute = '0', hour = '*'] = minuteHour.split(' ');
      const weekday = days.split(' ')[2] ?? '*';
      return [
        {
          command,
          ranAt: lastRun({
            minute: Number(minute),
            hour: hour === '*' ? null : Number(hour),
            weekday: weekday === '*' ? null : Number(weekday),
          }),
        },
      ];
    })
    .sort((earlier, later) => earlier.ranAt - later.ranAt);

/** One line of a job's output with its sizes filled in. Each `{size}` is drawn on its
 *  own, so `du -sh` of three places answers with three sizes rather than one repeated. */
const withSizes = (line: string, prng: Prng): string =>
  line
    .replace(/\{size\}/g, () => prng.pick([`${prng.nextInt(4, 980)}K`, `${prng.nextInt(1, 940)}M`]))
    .replace(/\{trimmed\}/g, () => {
      // Never more than the disk the box boots off: `kern.log.1` puts its memory at
      // ~16 GB, and trimming more free space than the machine has would read as a lie
      // to anyone who compared the two.
      const gibibytes = prng.nextInt(2, 14);
      return `${gibibytes} GiB (${gibibytes * GIB} bytes)`;
    });

/**
 * `/var/mail/root` as cron left it: one message per job of the box's own crontab that
 * really prints something, holding what that job printed the last time it ran.
 *
 * This is the one mailbox that is not correspondence — nobody wrote it, the machine did,
 * to itself. It is on every box whose jobs report, mail server or doorbell, because every
 * box here runs the same cron; a box whose jobs are all silent has none, which is what an
 * untouched `/var/mail/root` really looks like.
 *
 * It is root's alone. A job's output names what the box keeps and where, which is recon
 * a player should have had to become root for.
 */
const cronMailbox = ({
  essid,
  host,
  crontab,
}: {
  readonly essid: string;
  readonly host: LanHost;
  readonly crontab: string;
}): string | null => {
  const runs = printingRuns(crontab);
  if (runs.length === 0) return null;
  const zone = lanZoneName(essid);
  const address = `root@${zone}`;
  const prng = createPrng(`mail-cron-${essid}-${host.ip}`);
  return runs
    .map(({ command, ranAt }) => {
      const stamped = transferId(prng);
      return [
        `From ${address} ${asctime(ranAt)}`,
        // Cron hands its mail to the box's own transfer agent over the loopback: the
        // message never crossed the network, and there is no other machine to name.
        `Received: from localhost (${LOOPBACK})`,
        `\tby ${host.hostname}.${zone} with local id ${stamped}`,
        `\tfor <${address}>; ${rfcDate(ranAt)}`,
        `Message-ID: <${mailMessageId({ sentAt: ranAt, transferId: stamped, zone })}>`,
        `Date: ${rfcDate(ranAt)}`,
        `From: ${address} (Cron Daemon)`,
        `To: ${address}`,
        `Subject: Cron <${address}> ${command}`,
        `Delivered-To: <${address}>`,
        'Status: RO',
        '',
        ...(CRON_OUTPUT[command] ?? []).map((line) => withSizes(line, prng)),
        '',
      ].join('\n');
    })
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

/** One message the machine that carries the mail took in and delivered, as its own log
 *  records it. The queue id is the id its transfer agent stamped, which is also what the
 *  delivered copy carries in its `Received:` line — so the log and the mailbox name the
 *  same message and neither can drift from the other. */
export type MailDelivery = {
  readonly queueId: string;
  /** The `Message-ID:` the copy carries, without its angle brackets. */
  readonly messageId: string;
  readonly from: string;
  /** The machine it was written on, which the server names as the client it took it
   *  from. Where that is the server itself, the message came in over the loopback. */
  readonly fromHost: LanHost;
  /** Every mailbox on this box the message was dropped into. One message written to two
   *  people is one delivery with two recipients, which is what a queue really does. */
  readonly recipients: readonly string[];
  readonly sentAt: number;
  /** The size of the copy the box wrote, which is what its queue recorded. */
  readonly size: number;
};

/**
 * Every mailbox the machine that carries the network's mail keeps: one for each login on
 * the network and one for each role address, exactly as its own directory says — and the
 * deliveries that put them there.
 *
 * A person's mailbox here holds the same messages their desk holds — it is one
 * correspondence — but each copy carries the route it really took, and this one arrived
 * in a single hop because this is the machine that made it.
 *
 * The files and the deliveries are built together rather than derived twice: the log is
 * the record OF these writes, and a second derivation could only ever disagree with them.
 */
const spoolOf = ({
  essid,
  host,
  application,
  mail,
  zone,
}: {
  readonly essid: string;
  readonly host: LanHost;
  readonly application: Application;
  readonly mail: NetworkMail;
  readonly zone: string;
}): {
  readonly entries: Readonly<Record<string, ReturnType<typeof file>>>;
  readonly deliveries: readonly MailDelivery[];
} => {
  const roster = (application.tables.mailboxes?.rows ?? []).map((row) => String(row.local_part));
  const deliveries = new Map<string, MailDelivery>();

  const entries = Object.fromEntries(
    roster.map((local) => {
      const { recipient, messages } = arrivedIn({ essid, host, local, mail });
      const written = messages.map((message) =>
        // This IS the machine that carries the mail, so nothing relayed it here and there
        // is no second transfer id to stamp.
        formatMessage({ message, recipient, box: host, relay: host, stamp: '', zone }),
      );
      messages.forEach((message, index) => {
        const already = deliveries.get(message.transferId);
        deliveries.set(
          message.transferId,
          already === undefined
            ? {
                queueId: message.transferId,
                messageId: message.id,
                from: message.from.address,
                fromHost: message.from.host,
                recipients: [recipient.address],
                sentAt: message.sentAt,
                size: (written[index] ?? '').length,
              }
            : { ...already, recipients: [...already.recipients, recipient.address] },
        );
      });
      return [local, file(written.join(''), MAIL_SPOOL_FILE)];
    }),
  );

  return { entries, deliveries: [...deliveries.values()] };
};

const ALIASES_HEADER = [
  '# /etc/aliases - the addresses this machine answers for that are not mailboxes.',
  '# See man 5 aliases. Run newaliases after editing.',
  '',
].join('\n');

/**
 * `/etc/aliases` as the machine that carries the mail keeps it: every address its own
 * directory says it answers for, pointed at the mailbox that really holds that mail.
 *
 * Built here rather than with the rest of `/etc` because it is the spool written out in
 * another place — an alias naming a mailbox `/var/mail` does not keep would be the box
 * promising to deliver somewhere it cannot, which is the one thing this file can get
 * wrong. Deriving both from the same directory is what makes that impossible.
 *
 * `root:` opens it, as it opens a real one: root reads no mail on a box nobody sits at,
 * so what arrives for it goes on to whoever runs the machine.
 */
const aliasFile = ({
  application,
  account,
}: {
  readonly application: Application;
  readonly account: string;
}): string => {
  const mailboxes = new Map(
    (application.tables.mailboxes?.rows ?? []).map((row) => [
      Number(row.id),
      String(row.local_part),
    ]),
  );
  const answered = (application.tables.aliases?.rows ?? []).flatMap((row) => {
    const mailbox = mailboxes.get(Number(row.mailbox_id));
    return mailbox === undefined ? [] : [`${String(row.alias)}: ${mailbox}`];
  });
  return `${ALIASES_HEADER}\nroot: ${account}\n${answered.map((line) => `${line}\n`).join('')}`;
};

/** What a box keeps of its network's mail: the `/var/mail` to spread into its `/var`,
 *  the `/etc/aliases` that has to agree with it, and — on the machine that carries the
 *  mail — the deliveries its own log records. */
export type BoxMailbox = {
  readonly entries: Readonly<Record<string, Directory>>;
  readonly deliveries: readonly MailDelivery[];
  /** The box's `/etc/aliases`, or null where it carries no mail to answer for. */
  readonly aliases: ReturnType<typeof file> | null;
};

/**
 * The `/var/mail` a box keeps, ready to spread into its `/var`, or nothing for a box
 * nobody reads mail on.
 *
 * A desk keeps its own user's; the machine that carries the mail keeps the roster's. A
 * box nobody sits at and nothing is addressed through keeps none. Only the machine that
 * carries the mail ever made a delivery, so only it has any to report.
 */
export const mailEntries = ({
  essid,
  host,
  username,
  crontab,
}: {
  readonly essid: string;
  readonly host: LanHost;
  /** The account this box belongs to, whose mailbox it keeps. */
  readonly username: string;
  /** `/etc/crontab` as the box keeps it, which decides whether cron left root any mail. */
  readonly crontab: string;
}): BoxMailbox => {
  const carriesMail = roleOfHostname(host.hostname) === 'mailserver';
  // Cron writes to root on any box it has something to report on, whether or not anybody
  // reads mail there: a doorbell runs the same crontab a mail server does.
  const fromCron = cronMailbox({ essid, host, crontab });
  const rootMail = fromCron === null ? {} : { root: file(fromCron, MAIL_SPOOL_FILE) };
  if (!carriesMail && !isDesk(host.hostname)) {
    return {
      entries: fromCron === null ? {} : { mail: dir(rootMail, TRAVERSABLE_DIR) },
      deliveries: [],
      aliases: null,
    };
  }

  // The correspondence is derived ONCE for the box. It is the same value for every
  // mailbox on it, and deriving it per mailbox doubled the world's build time.
  const onLan = isOnHomeLan(essid, host);
  // The box's own application is read only where it is needed: to name a mail server's
  // roster, and to name the only people a box below the LAN is allowed to know.
  const application = carriesMail || !onLan ? applicationOn({ essid, host, username }) : undefined;
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
    const spool = spoolOf({ essid, host, application, mail, zone });
    return {
      entries: { mail: dir({ ...spool.entries, ...rootMail }, MAIL_SPOOL_DIR) },
      deliveries: spool.deliveries,
      aliases: file(aliasFile({ application, account: username }), ALIASES_FILE),
    };
  }

  const { recipient, messages } = arrivedIn({ essid, host, local: username, mail });
  const mbox = mboxFor({ zone, box: host, relay, recipient, messages, prng });
  const kept = {
    ...(mbox === null ? {} : { [username]: file(mbox, MAIL_FILE) }),
    ...rootMail,
  };
  return {
    entries: Object.keys(kept).length === 0 ? {} : { mail: dir(kept, TRAVERSABLE_DIR) },
    deliveries: [],
    aliases: null,
  };
};
