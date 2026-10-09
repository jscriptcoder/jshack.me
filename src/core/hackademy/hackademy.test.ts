import { describe, expect, it } from 'vitest';
import { materializeApGatewayFs } from '../network/materializeRouterFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { resolveHref, resolveWebPath } from '../network/http.js';
import { HACKADEMY_NETWORK } from '../generation/fixedSites.js';
import { buildWorkstationBaseFs } from '../generation/workstationFs.js';
import { commandRegistry } from '../commands/registry.js';
import { tokenize } from '../shell/tokenize.js';
import { parsePipeline } from '../shell/pipeline.js';
import type { Pipeline } from '../shell/pipeline.js';
import { runCommandLine } from '../shell/runLine.js';
import { withFiles } from '../generation/baseFs.js';
import { createBinaryEntries } from '../generation/binaries.js';
import { formatSshdAuthLine } from '../logging/authLog.js';
import { HACKADEMY_PAGES } from './pages.js';
import { binaryExists, isAlwaysAvailable } from '../commands/availability.js';
import { packageForBinary } from '../packages/aptPackages.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { buildFile } from '../../test/factories/filesystem.js';
import { asAbsPath, asGameTime } from '../types.js';
import type { CommandResult, TerminalLine } from '../commands/types.js';
import type { Directory, FileEntry } from '../filesystem/types.js';

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

/** A command line as the shell reads it, or null when it would not parse. */
const pipelineOf = (line: string): Pipeline | null => {
  const tokens = tokenize(line);
  if (!tokens.ok) return null;
  const pipeline = parsePipeline(tokens.tokens);
  return pipeline.ok ? pipeline.pipeline : null;
};

/** Every program a command line runs, one per stage of its pipeline. */
const programsIn = (line: string): readonly string[] =>
  pipelineOf(line)?.stages.map((stage) => stage.name) ?? [`unparsable: ${line}`];

/** Every address on the site a command line names. */
const siteAddressesIn = (line: string): readonly string[] =>
  line.match(/http:\/\/hackademy\.io\S*/g) ?? [];

/** A new player's own box, as it is first generated. */
const aliceBox = (): Directory =>
  buildWorkstationBaseFs('1'.repeat(64), {
    machineName: 'workstation',
    username: 'alice',
    rootPassword: 'hunter2',
  });

const README = (): string => {
  const read = createFsView(aliceBox(), { userType: 'root' }).read(asAbsPath('/home/alice/README'));
  return read.ok ? read.content : '';
};

/** Failed logins on alice's box: three from one address, one from another. */
const KNOCKS = [
  { fromIp: '10.0.0.5', times: 3 },
  { fromIp: '10.0.0.9', times: 1 },
];

const failedLogin = (fromIp: string): string =>
  formatSshdAuthLine({
    outcome: 'failure',
    user: 'root',
    fromIp,
    hostname: 'workstation',
    time: asGameTime(0),
    pid: 4242,
  });

/** What the site serves as the script `name`, saved into alice's home on a box that has
 *  installed node and has been knocked on — the state a reader of the scripting chapter
 *  runs it in. */
const readerRunning = (name: string) => {
  const nodeBinary = createBinaryEntries(['node']).node as FileEntry;
  const authLog = KNOCKS.flatMap(({ fromIp, times }) =>
    Array.from({ length: times }, () => failedLogin(fromIp)),
  ).join('\n');
  const box = withFiles(aliceBox(), [
    ['/usr/bin/node', nodeBinary],
    [
      '/var/log/auth.log',
      buildFile(`${authLog}\n`, { owner: 'root', perms: { read: ['root', 'user', 'guest'] } }),
    ],
    [`/home/alice/${name}`, buildFile(served(`${SITE}/scripts/${name}`) ?? '', { owner: 'alice' })],
  ]);
  return mockCommandEnv({
    fs: mockFsViewFromTree(box, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    session: mockSession({ username: 'alice', userType: 'user' }),
  });
};

/** Everything a command printed, in order, and the code it ended on. */
const drain = async (
  result: CommandResult,
): Promise<{ readonly lines: readonly TerminalLine[]; readonly exitCode: number }> => {
  if (result.kind === 'mode_change') return { lines: [], exitCode: 0 };
  if (result.kind === 'sync') return { lines: result.lines, exitCode: result.exitCode };
  const collected: TerminalLine[] = [];
  for await (const line of result.lines) collected.push(line);
  return { lines: collected, exitCode: await result.exitCode() };
};

const run = async (name: string, line: string) => {
  const { lines, exitCode } = await drain(
    await runCommandLine(readerRunning(name), line, commandRegistry),
  );
  return {
    printed: lines.filter((printed) => printed.kind === 'text').map((printed) => printed.content),
    exitCode,
  };
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
  {
    url: `${SITE}/getting-in.html`,
    title: 'Getting in',
    tools: ['ssh', 'nc', 'john'],
  },
  {
    url: `${SITE}/services.html`,
    title: 'Services, versions and CVEs',
    tools: ['systemctl', 'ps', 'apt'],
  },
  {
    url: `${SITE}/the-web.html`,
    title: 'The web',
    tools: ['curl', 'lynx', 'gobuster'],
  },
  {
    url: `${SITE}/traces.html`,
    title: 'Traces',
    tools: ['tail', 'grep', 'cat'],
  },
  {
    url: `${SITE}/other-services.html`,
    title: 'Databases and other services',
    tools: ['apt', 'systemctl', 'mysql', 'redis-cli'],
  },
  {
    url: `${SITE}/scripting.html`,
    title: 'Scripting with node',
    tools: ['curl', 'node'],
  },
];

/** The example scripts the site keeps for a reader to download and run. */
const SCRIPTS = ['hello.js', 'failed.js'];

/** The one chapter that is allowed — and required — to name findit: the world's one pointer
 *  to the search site a newcomer would otherwise never hear of. */
const WEB_CHAPTER = `${SITE}/the-web.html`;

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

  it('names findit only in the web chapter', () => {
    for (const page of everyPage()) {
      const names = served(page)?.toLowerCase().includes('findit') ?? false;
      expect(names, page).toBe(page === WEB_CHAPTER);
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

  it('run only programs a fresh box has, or one an earlier example installed', () => {
    const freshBox = mockCommandEnv({ fs: mockFsViewFromTree(aliceBox(), { userType: 'root' }) });
    const texts = [
      { name: 'README', lines: promptedLines(README()) },
      ...everyPage().map((page) => ({ name: page, lines: examplesOn(served(page) ?? '') })),
    ];
    const missing = texts.flatMap(({ name, lines }) => {
      const installed = new Set<string>();
      return lines.flatMap((line) =>
        (pipelineOf(line)?.stages ?? []).flatMap((stage) => {
          const runnable =
            isAlwaysAvailable(stage.name) ||
            binaryExists(freshBox, stage.name) ||
            installed.has(packageForBinary(stage.name) ?? '');
          if (stage.name === 'apt' && stage.args[0] === 'install') {
            stage.args.slice(1).forEach((pkg) => installed.add(pkg));
          }
          return runnable ? [] : [`${name}: ${line}`];
        }),
      );
    });
    expect(missing).toEqual([]);
  });

  it('aim ssh, scp and ftp at localhost in the getting-in chapter: each door reaches your own box', () => {
    const atLocalhost = examplesOn(served(`${SITE}/getting-in.html`) ?? '')
      .flatMap((line) => pipelineOf(line)?.stages ?? [])
      .filter((stage) => stage.args.some((arg) => arg.includes('localhost')))
      .map((stage) => stage.name);
    expect(atLocalhost).toEqual(expect.arrayContaining(['ssh', 'scp', 'ftp']));
  });

  it('show ssh in the getting-in chapter at hackademy.io itself', () => {
    const sshTargets = examplesOn(served(`${SITE}/getting-in.html`) ?? '')
      .flatMap((line) => pipelineOf(line)?.stages ?? [])
      .filter((stage) => stage.name === 'ssh')
      .flatMap((stage) => stage.args);
    expect(sshTargets).toContainEqual(expect.stringMatching(/@hackademy\.io$/));
  });

  it('fetch only addresses the site serves', () => {
    for (const page of everyPage()) {
      for (const address of examplesOn(served(page) ?? '').flatMap(siteAddressesIn)) {
        expect(served(address), `${page}: ${address}`).not.toBeNull();
      }
    }
  });

  it('run a script with node only after an earlier example saved it from the site', () => {
    for (const page of everyPage()) {
      const pipelines = examplesOn(served(page) ?? '').flatMap((line) => pipelineOf(line) ?? []);
      pipelines.forEach((pipeline, index) => {
        const [stage] = pipeline.stages;
        if (stage?.name !== 'node') return;
        const saved = pipelines
          .slice(0, index)
          .filter((earlier) => earlier.stages[0]?.name === 'curl')
          .filter((earlier) =>
            earlier.stages[0]?.args.some((arg) => siteAddressesIn(arg).length > 0),
          )
          .map((earlier) => earlier.redirect?.path);
        expect(saved, `${page}: node ${stage.args.join(' ')}`).toContain(stage.args[0]);
      });
    }
  });
});

describe('the example scripts on hackademy.io', () => {
  it.each(SCRIPTS)('serves /scripts/%s as the site keeps it', (name) => {
    expect(served(`${SITE}/scripts/${name}`)).toBe(HACKADEMY_PAGES[`scripts/${name}`]);
    expect(served(`${SITE}/scripts/${name}`)).not.toBe('');
  });

  it('hello.js runs on the reader’s own box and answers with what it was given', async () => {
    const { printed, exitCode } = await run('hello.js', 'node hello.js stranger');
    expect(exitCode).toBe(0);
    expect(printed.join('\n')).toContain('stranger');
  });

  it('failed.js tallies the failed logins in the reader’s own auth.log by address', async () => {
    const { printed, exitCode } = await run('failed.js', 'node failed.js');
    expect(exitCode).toBe(0);
    for (const { fromIp, times } of KNOCKS) {
      expect(printed, fromIp).toContainEqual(
        expect.stringMatching(new RegExp(`${fromIp}\\D+${times}$`)),
      );
    }
  });
});
