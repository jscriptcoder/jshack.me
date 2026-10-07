/**
 * whois — who holds this address?
 *
 * The registry answers from the world's declaration alone. Every network's public address
 * is derived from its place in the world, so the organisation, town and region behind an
 * address are known without asking anybody on the network: the answer is the same
 * whether anyone is there or not.
 */

import type { Command, CommandResult } from './types.js';
import {
  declaredNetwork,
  HARROW_VALLEY,
  networkAt,
  PLACELESS_FIRST_OCTET,
} from '../generation/world.js';
import { FINDIT_DOMAIN, FINDIT_NETWORK } from '../generation/finditNetwork.js';
import { siteAddress } from '../generation/publisher.js';
import { vantageOf } from '../network/vantage.js';
import { errorLine, text } from './streaming.js';

/** What the registry knows about the network at an address. */
type RegistryRecord = {
  /** The name a player would recognise it by in a scan: its ESSID. */
  readonly netname: string;
  readonly orgName: string;
  /** The domain its site answers to, for a network that publishes one. */
  readonly domain?: string;
  /** Where it stands, for a network in a town. */
  readonly place?: { readonly town: string; readonly region: string };
};

/** findit broadcasts no wifi, so its netname is its key spelt the way an ESSID is. */
const FINDIT_RECORD: RegistryRecord = {
  netname: FINDIT_NETWORK.toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
  orgName: FINDIT_DOMAIN,
  domain: FINDIT_DOMAIN,
};

/** Whether `address` is in the block of the networks that stand in no town. */
const isPlaceless = (address: string): boolean =>
  Number(address.split('.')[0]) === PLACELESS_FIRST_OCTET;

/** The record for whichever network answers at `address`, or `undefined` where none does. */
const recordAt = (address: string): RegistryRecord | undefined => {
  const key = networkAt(address);
  if (key === FINDIT_NETWORK) return FINDIT_RECORD;
  const network = declaredNetwork(key ?? '');
  if (network === undefined) return undefined;
  const { town, region } = network;
  // A corporation's branch publishes nothing, but the line is its company's.
  const holder = declaredNetwork(network.parent ?? '') ?? network;
  return {
    netname: network.essid,
    // A network that publishes nothing is somebody's line from the town's ISP, which is
    // all a real registry says about a home or a small shop.
    orgName: holder.site?.name ?? `${town} Broadband`,
    ...(network.site === undefined ? {} : { domain: network.site.domain }),
    // The corporations answer in the placeless block, so no town or region stands
    // behind them.
    ...(isPlaceless(address) || town === undefined || region === undefined
      ? {}
      : { place: { town, region } }),
  };
};

/** Width a record's field name is padded to before its value, as a real registry aligns
 *  it. */
const FIELD_COLUMN = 16;

const field = (name: string, value: string): string => `${`${name}:`.padEnd(FIELD_COLUMN)}${value}`;

/** The registry is named for the region the whole world stands in. */
const HEADER = [text(`% ${HARROW_VALLEY} registry`), text('')];

/** A real registry's answer for anything it holds no record of. */
const NO_ENTRIES = '%ERROR:101: no entries found';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

const USAGE = 'whois: usage: whois <ip|domain>';

/** The registry is out on the internet, so asking it takes a network to ask from: the one
 *  the shell's box stands on, which on a hop is the hop's whatever the player's own card is
 *  doing. */
const UNREACHABLE = 'whois: network is unreachable — connect to a network first';

const execute: Command['execute'] = async (env, args): Promise<CommandResult> => {
  const query = args[0];
  if (query === undefined) {
    return error(USAGE);
  }
  if (vantageOf(env.session, env.network) === null) {
    return error(UNREACHABLE);
  }

  // A domain is asked about through the address it resolves to, so both answer one
  // record. Names are case-insensitive, as the resolver treats them.
  const address = siteAddress(query.toLowerCase()) ?? query;
  const record = recordAt(address);
  if (record === undefined) {
    return { kind: 'sync', lines: [...HEADER, text(NO_ENTRIES)], exitCode: 1 };
  }
  return {
    kind: 'sync',
    lines: [
      ...HEADER,
      text(field('inetnum', `${address} - ${address}`)),
      text(field('netname', record.netname)),
      text(field('org-name', record.orgName)),
      ...(record.domain === undefined ? [] : [text(field('domain', record.domain))]),
      ...(record.place === undefined
        ? []
        : [text(field('city', record.place.town)), text(field('region', record.place.region))]),
    ],
    exitCode: 0,
  };
};

export const whois: Command = {
  name: 'whois',
  description: 'Look up who holds an address or a domain',
  category: 'network',
  tier: 'guest',
  // Bought rather than shipped: `apt install whois` puts it in /usr/bin, on the player's
  // box or on any box they have rooted.
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'whois <ip|domain>',
    description:
      "Ask the registry who holds a public address or a domain: the network's name, the organisation behind it, the domain its site answers to, and the town and region it stands in. A network that publishes no site is listed under its town's ISP, or a corporation's branch under its company, and a corporation stands in no town. An address or domain nobody holds has no entry.",
    arguments: [
      {
        name: 'ip|domain',
        description: 'A public address, e.g. from a trace, or a domain such as ridgemont.gov',
        required: true,
      },
    ],
    examples: [
      { command: 'whois ridgemont.gov', description: 'Who is behind a site' },
      { command: 'whois 87.1.13.14', description: 'Who holds an address you saw in a log' },
    ],
  },
  execute,
};
