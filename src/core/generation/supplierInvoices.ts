/**
 * A supplier's invoice, kept by its customer.
 *
 * An unlisted business is on no search and in no directory, but the businesses it
 * supplies keep its invoices, and an invoice names who sent it: its name and its domain.
 * The customer's office files it on its working share with the rest of its paperwork,
 * so it arrives there like any other file, over ftp from somebody's desk.
 *
 * Its number, date and total are drawn on a stream of the file server's own, so no draw
 * the share already made moves.
 */

import { WORLD_EPOCH } from '../cve/worldClock.js';
import type { Directory } from '../filesystem/types.js';
import { dir, file, SHARE_DIR, SHARE_FILE } from './baseFs.js';
import type { LanHost } from './generateHomeLan.js';
import type { MailPerson } from './networkMail.js';
import { createPrng, type Prng } from './prng.js';
import { relationsFrom, type Supply } from './relations.js';
import { buildShare, type Share, type ShareUpload } from './share.js';
import { declaredNetwork } from './world.js';

const DAY_SECONDS = 86_400;
const EPOCH_DAY = Math.floor(WORLD_EPOCH / 1000 / DAY_SECONDS);

/** Where on the share an office files the invoices it is sent. */
const INVOICE_FOLDER = 'invoices';
/** How many days before the world stopped an invoice was filed. */
const INVOICE_AGE_DAYS = { min: 1, max: 60 };
/** The office hours it was filed in, in seconds into the day. */
const OFFICE_HOURS = { first: 9 * 3600, last: 17 * 3600 };
const INVOICE_NUMBER = { min: 1000, max: 9999 };
const INVOICE_TOTAL = { min: 40, max: 2400 };
const PAYMENT_DAYS = 30;

type Invoice = { readonly name: string; readonly content: string; readonly upload: ShareUpload };

const dateOf = (second: number): string => new Date(second * 1000).toISOString().slice(0, 10);

/** The invoice `supply`'s supplier sent `customer`, as the office filed it. */
const invoiceFor = ({
  supply,
  customer,
  author,
  account,
  prng,
}: {
  readonly supply: Supply;
  readonly customer: string;
  readonly author: MailPerson;
  readonly account: string;
  readonly prng: Prng;
}): Invoice => {
  const supplier = declaredNetwork(supply.target);
  const site = supplier?.site;
  if (supplier === undefined || site === undefined) {
    throw new Error(`${supply.target} publishes no site to send an invoice from`);
  }
  const number = prng.nextInt(INVOICE_NUMBER.min, INVOICE_NUMBER.max);
  const day = EPOCH_DAY - prng.nextInt(INVOICE_AGE_DAYS.min, INVOICE_AGE_DAYS.max);
  const filedAt = day * DAY_SECONDS + prng.nextInt(OFFICE_HOURS.first, OFFICE_HOURS.last);
  const total = `${prng.nextInt(INVOICE_TOTAL.min, INVOICE_TOTAL.max)} €`;
  const name = `${supplier.essid.toLowerCase()}-${number}.txt`;
  const content = [
    `INVOICE ${number}`,
    '',
    `From: ${site.name}`,
    `      ${site.domain}`,
    `To:   ${customer}`,
    '',
    `Date: ${dateOf(filedAt)}`,
    `Payment due within ${PAYMENT_DAYS} days.`,
    '',
    `Goods supplied, as ordered    ${total}`,
    `TOTAL DUE                     ${total}`,
    '',
  ].join('\n');
  return {
    name,
    content,
    upload: {
      at: filedAt * 1000,
      from: author.host,
      user: account,
      path: `/srv/share/${INVOICE_FOLDER}/${name}`,
      bytes: content.length,
    },
  };
};

/**
 * The `/srv` of a file server, with every invoice its office was sent by a supplier no
 * search lists filed on its working share, and the uploads that put each there after the
 * share's own.
 */
export const buildServerShare = (options: {
  readonly essid: string;
  readonly host: LanHost;
  readonly account: string;
  readonly people: readonly MailPerson[];
}): Share => {
  const share = buildShare(options);
  const { essid, host, account, people } = options;
  const supplies = relationsFrom(essid).filter(
    (relation): relation is Supply =>
      relation.kind === 'supplier' && relation.sourceHost.ip === host.ip,
  );
  if (supplies.length === 0) return share;

  const prng = createPrng(`relation-invoice-${essid}-${host.ip}`);
  const customer = declaredNetwork(essid)?.site?.name ?? essid;
  const invoices = supplies.map((supply) =>
    invoiceFor({ supply, customer, author: prng.pick(people), account, prng }),
  );

  const working = share.tree.entries.get('share');
  if (working?.kind !== 'directory') throw new Error(`${host.hostname} keeps no working share`);
  // A share whose office already keeps an invoices department files these beside the rest.
  const existing = working.entries.get(INVOICE_FOLDER);
  const folder = existing?.kind === 'directory' ? existing : dir({}, SHARE_DIR, account);
  const filed: Directory = {
    ...folder,
    entries: new Map([
      ...folder.entries,
      ...invoices.map(({ name, content }) => [name, file(content, SHARE_FILE, account)] as const),
    ]),
  };
  return {
    tree: {
      ...share.tree,
      entries: new Map([
        ...share.tree.entries,
        ['share', { ...working, entries: new Map([...working.entries, [INVOICE_FOLDER, filed]]) }],
      ]),
    },
    uploads: [...share.uploads, ...invoices.map((invoice) => invoice.upload)],
  };
};
