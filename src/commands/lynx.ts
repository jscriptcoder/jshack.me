import type { Command } from '../components/Terminal/types';
import { parseUrl } from '../network/http';

export type LynxOpenData = {
  readonly __type: 'lynx_open';
  readonly url: string;
};

// Builds a canonical URL string from the parser's output. The overlay
// uses `new URL(href, base).href` to resolve relative links, and that
// constructor requires the base to be fully qualified — so we promote a
// shorthand "host/path" form to "http://host/path" here.
const canonicalise = (parsed: NonNullable<ReturnType<typeof parseUrl>>): string => {
  const showPort =
    (parsed.protocol === 'http' && parsed.port !== 80) ||
    (parsed.protocol === 'https' && parsed.port !== 443);
  const portPart = showPort ? `:${parsed.port}` : '';
  const queryPart = parsed.query ? `?${parsed.query}` : '';
  return `${parsed.protocol}://${parsed.host}${portPart}${parsed.path}${queryPart}`;
};

export const createLynxCommand = (): Command => ({
  name: 'lynx',
  category: 'network',
  description: 'Open a URL in a full-screen text-mode browser',
  manual: {
    synopsis: 'lynx <url>',
    description:
      'Browse a web page in a full-screen text-mode browser. ' +
      'Arrow Up/Down moves between links, Enter (or Right Arrow) follows the selected link, ' +
      'Left Arrow or Backspace goes back, q or Escape quits.',
    arguments: [
      {
        name: 'url',
        description: 'URL to open (e.g. "http://techparts.io/")',
        required: true,
      },
    ],
    examples: [
      { command: 'lynx http://techparts.io/', description: 'Browse a themed-network page' },
      {
        command: 'lynx 192.168.1.1',
        description: 'Shorthand URL — defaults to http and "/"',
      },
      {
        command: 'lynx http://techparts.io/catalog.html',
        description: 'Open a specific page',
      },
    ],
  },
  fn: (...args: unknown[]): LynxOpenData => {
    const urlStr = args.find((a): a is string => typeof a === 'string' && a.length > 0);
    if (!urlStr) {
      throw new Error('lynx: missing URL argument');
    }
    const parsed = parseUrl(urlStr);
    if (!parsed) {
      throw new Error(`lynx: invalid URL: ${urlStr}`);
    }
    return { __type: 'lynx_open', url: canonicalise(parsed) };
  },
});
