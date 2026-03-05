import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { DnsRecord } from '../network/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type NslookupContext = {
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly getGateway: () => string;
};

const DNS_LOOKUP_DELAY_MS = 600;

export const createNslookupCommand = (context: NslookupContext): Command => ({
  name: 'nslookup',
  description: 'Query DNS for domain name resolution',
  manual: {
    synopsis: 'nslookup(domain)',
    description:
      'Query the DNS server to resolve a domain name to its IP address. Returns the IP address associated with the given domain name if found.',
    arguments: [{ name: 'domain', description: 'The domain name to look up', required: true }],
    examples: [
      { command: 'nslookup("gateway.local")', description: 'Resolve a local domain' },
      { command: 'nslookup("target.local")', description: 'Resolve a mission domain' },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { resolveDomain, getGateway } = context;

    const domain = args[0] as string | undefined;

    if (!domain) {
      throw new Error('nslookup: missing domain argument');
    }

    if (typeof domain !== 'string') {
      throw new Error('nslookup: domain must be a string');
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        const dnsServer = getGateway();

        onLine(`Server:  ${dnsServer}`);
        onLine(`Address: ${dnsServer}#53`);
        onLine('');

        token.schedule(() => {
          if (token.isCancelled()) return;

          const record = resolveDomain(domain);

          if (!record) {
            onLine(`** server can't find ${domain}: NXDOMAIN`);
          } else {
            onLine('Non-authoritative answer:');
            onLine(`Name:    ${record.domain}`);
            onLine(`Address: ${record.ip}`);
          }

          onComplete();
        }, jitter(DNS_LOOKUP_DELAY_MS));
      },
      cancel: token.cancel,
    };
  },
});
