import { describe, expect, it } from 'vitest';
import { materializeApGatewayFs } from '../network/materializeRouterFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { resolveHref, resolveWebPath } from '../network/http.js';
import { HACKADEMY_NETWORK } from '../generation/fixedSites.js';
import { buildWorkstationBaseFs } from '../generation/workstationFs.js';
import { commandRegistry } from '../commands/registry.js';
import { tokenize } from '../shell/tokenize.js';
import { parsePipeline } from '../shell/pipeline.js';
import { asAbsPath } from '../types.js';
import type { Directory } from '../filesystem/types.js';

/**
 * hackademy.io is where a new player learns the world, from inside it. Everything here is
 * read off the box the way a visitor's browser gets it: the pages its web server serves.
 */

const SITE = 'http://hackademy.io';

const hackademyBox = (): Directory => materializeApGatewayFs({ essid: HACKADEMY_NETWORK }, []);

/** What the site serves at `url`, or null when nothing is there. */
const served = (url: string): string | null => {
  const path = resolveWebPath(new URL(url).pathname);
  if (path === null) return null;
  const read = createFsView(hackademyBox(), { userType: 'root' }).read(path);
  return read.ok ? read.content : null;
};

const parsed = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

/** Every link on the page at `url`, as the absolute address a browser would follow. */
const linksOn = (url: string): readonly string[] =>
  [...parsed(served(url) ?? '').querySelectorAll('a')].flatMap(
    (anchor) => resolveHref({ base: url, href: anchor.getAttribute('href') ?? '' }) ?? [],
  );

/** Every page of the site a reader can reach from its front page. */
const everyPage = (): readonly string[] => {
  const visit = (seen: readonly string[], url: string): readonly string[] =>
    seen.includes(url)
      ? seen
      : linksOn(url)
          .filter((link) => link.startsWith(`${SITE}/`))
          .reduce(visit, [...seen, url]);
  return visit([], `${SITE}/`);
};

/** The command lines a text shows a reader to type: each line of an example that
 *  starts at a prompt, `$ ` as the player or `# ` as root, without the prompt. */
const promptedLines = (text: string): readonly string[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('$ ') || line.startsWith('# '))
    .map((line) => line.slice(2));

const examplesOn = (html: string): readonly string[] =>
  [...parsed(html).querySelectorAll('pre')].flatMap((pre) => promptedLines(pre.textContent ?? ''));

/** Every program a command line runs, one per stage of its pipeline. */
const programsIn = (line: string): readonly string[] => {
  const tokens = tokenize(line);
  if (!tokens.ok) return [`unparsable: ${line}`];
  const pipeline = parsePipeline(tokens.tokens);
  return pipeline.ok ? pipeline.pipeline.stages.map((stage) => stage.name) : [`unparsable: ${line}`];
};

const README = (): string => {
  const read = createFsView(buildWorkstationBaseFs('1'.repeat(64), {
    machineName: 'workstation',
    username: 'alice',
    rootPassword: 'hunter2',
  }), { userType: 'root' }).read(asAbsPath('/home/alice/README'));
  return read.ok ? read.content : '';
};

/** The chapters, in the order the front page lists them, with the tools each one shows. */
const CHAPTERS = [
  {
    url: `${SITE}/getting-around.html`,
    title: 'Getting around',
    tools: ['ls', 'cd', 'cat', 'whoami', 'su', 'nano', 'apt', 'man'],
  },
  {
    url: `${SITE}/wifi.html`,
    title: 'Wifi',
    tools: ['airmon-ng', 'airodump-ng', 'aircrack-ng', 'nmcli'],
  },
  {
    url: `${SITE}/your-network.html`,
    title: 'Your box and its network',
    tools: ['ifconfig', 'nmcli', 'mkdir', 'nano', 'cat'],
  },
  {
    url: `${SITE}/looking-around.html`,
    title: 'Looking around',
    tools: ['ping', 'nmap', 'dig', 'nslookup', 'whois'],
  },
];

describe('the front page of hackademy.io', () => {
  it('names the site and lists the chapters in order', () => {
    const front = parsed(served(`${SITE}/`) ?? '');
    expect(front.title).toBe('hackademy.io');
    const chapterLinks = linksOn(`${SITE}/`).filter((link) =>
      CHAPTERS.some((chapter) => chapter.url === link),
    );
    expect(chapterLinks).toEqual(CHAPTERS.map((chapter) => chapter.url));
  });

  it('links only to pages the site serves', () => {
    for (const page of everyPage()) {
      for (const link of linksOn(page).filter((url) => url.startsWith(`${SITE}/`))) {
        expect(served(link), `${page} → ${link}`).not.toBeNull();
      }
    }
  });
});

describe.each(CHAPTERS.map((chapter, index) => ({ ...chapter, next: CHAPTERS[index + 1] })))(
  'the chapter $title',
  ({ url, title, tools, next }) => {
    const chapter = (): string => served(url) ?? '';

    it('is titled for what it teaches', () => {
      expect(parsed(chapter()).title).toBe(title);
      expect(parsed(chapter()).querySelector('h1')?.textContent).toBe(title);
    });

    it('shows the reader the tools it is about', () => {
      const programs = examplesOn(chapter()).flatMap(programsIn);
      for (const tool of tools) {
        expect(programs, tool).toContain(tool);
      }
    });

    it('ends in a practice on the reader’s own box', () => {
      const headings = [...parsed(chapter()).querySelectorAll('h2')].map((h2) => h2.textContent);
      expect(headings.at(-1)).toBe('Practice');
    });

    it('leads back to the front page, and on to the next chapter if there is one', () => {
      const chapterLinks = linksOn(url).filter((link) =>
        CHAPTERS.some((other) => other.url === link),
      );
      expect(linksOn(url)).toContain(`${SITE}/`);
      expect(chapterLinks).toEqual(next === undefined ? [] : [next.url]);
    });
  },
);

describe('every page of hackademy.io', () => {
  it('can be reached from the front page, and there is more than one', () => {
    expect(everyPage().length).toBeGreaterThan(1);
  });

  it('never names findit', () => {
    for (const page of everyPage()) {
      expect(served(page)?.toLowerCase(), page).not.toContain('findit');
    }
  });

  it("points every example at the reader's own box, never at somebody else's", () => {
    const elsewhere = /\b\d{1,3}(\.\d{1,3}){3}\b|\b[a-z0-9-]+\.(io|com|gov|edu|org|net)\b/;
    for (const page of everyPage()) {
      for (const line of examplesOn(served(page) ?? '')) {
        const named = line.replaceAll('hackademy.io', '').match(elsewhere);
        expect(named?.[0], `${page}: ${line}`).toBeUndefined();
      }
    }
  });
});

describe('the command examples a new player is shown', () => {
  it('are there to check, on the site and in the README', () => {
    expect(promptedLines(README()).length).toBeGreaterThan(0);
    expect(everyPage().flatMap((page) => examplesOn(served(page) ?? '')).length).toBeGreaterThan(0);
  });

  it('run only programs the shell knows', () => {
    const lines = [
      ...promptedLines(README()),
      ...everyPage().flatMap((page) => examplesOn(served(page) ?? '')),
    ];
    const unknown = lines.flatMap((line) =>
      programsIn(line)
        .filter((program) => !commandRegistry.has(program))
        .map((program) => `${program} (in: ${line})`),
    );
    expect(unknown).toEqual([]);
  });
});
