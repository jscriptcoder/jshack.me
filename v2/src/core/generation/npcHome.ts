/**
 * The home of the person an NPC's personal computer belongs to: their dotfiles, their
 * git identity, a few notes, and a shell history of what they did — including the
 * machines on this network they really talked to.
 *
 * A home is stamped only on a box whose name says somebody sits at it (a desktop, a
 * laptop, a workstation); a phone, a tablet, a server or a gateway keeps the empty home
 * it always had. Everything here is drawn from the box's own `home-content` stream, so
 * two builds of one box are identical and no draw of any other concern moves.
 *
 * A network line names a real neighbour, resolved from the LAN itself, never from a
 * template — so every `ssh`, `curl`, `ping` and `nslookup` a history holds is one a
 * player can replay and reach. A box that is NOT on the home LAN (a deep-layer NPC) has
 * no neighbours it can know about, so its history carries no network line, and its tree
 * is the same whether or not its layer hangs a child.
 */

import type { Directory, FileNode } from '../filesystem/types';
import { dir, file, HOME_DIR, HOME_FILE } from './baseFs';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { hostServices, npcUsername } from './remoteHostFs';
import { inhabitant, networkPersona } from './persona';
import { lanZoneName } from '../network/resolveName';
import { WORLD_EPOCH } from '../cve/worldClock';
import { createPrng, type Prng } from './prng';
import {
  BASHRC_ADDITIONS,
  DEBIAN_BASHRC,
  DEBIAN_BASH_LOGOUT,
  DEBIAN_PROFILE,
  GIT_ALIASES,
  GIT_DEFAULT_BRANCHES,
  GIT_EDITORS,
} from './pools/homeSkeleton';
import { COLLEAGUES, NOTE_TEMPLATES, TIMES, WEEKDAYS } from './pools/homeNotes';
import { PERSONAL_HISTORY, WORK_HISTORY } from './pools/homeHistory';

const DESK_PREFIXES: readonly string[] = ['desktop', 'laptop', 'workstation'];

const isDeskMachine = (host: LanHost): boolean =>
  DESK_PREFIXES.some((prefix) => host.hostname.startsWith(`${prefix}-`));

/** A day some time before the world's epoch, as `YYYY-MM-DD` — always in the past, so
 *  nothing a home says is dated after the day the world stands on. */
const pastDate = (prng: Prng): string => {
  const daysAgo = prng.nextInt(1, 730);
  return new Date(WORLD_EPOCH - daysAgo * 86_400_000).toISOString().slice(0, 10);
};

/** Fill a template's slots, drawing each distinct slot once so a note reads coherently
 *  (one colleague, one day) even where the slot appears twice. */
const fillSlots = (
  template: string,
  values: Readonly<Record<string, string>>,
): string => template.replace(/\{(\w+)\}/g, (whole, slot: string) => values[slot] ?? whole);

/** The values a line or note may reference, drawn fresh so two homes differ. */
const drawSlots = (options: {
  readonly prng: Prng;
  readonly place: string;
  readonly first: string;
  readonly note: string;
}): Readonly<Record<string, string>> => ({
  place: options.place,
  first: options.first,
  note: options.note,
  colleague: options.prng.pick(COLLEAGUES),
  day: options.prng.pick(WEEKDAYS),
  time: options.prng.pick(TIMES),
  count: String(options.prng.nextInt(2, 9)),
  date: pastDate(options.prng),
});

const gitConfig = (options: {
  readonly prng: Prng;
  readonly fullName: string;
  readonly email: string;
}): string => {
  const { prng, fullName, email } = options;
  const aliases = prng.pickN(GIT_ALIASES, prng.nextInt(2, 5));
  const lines = [
    '[user]',
    `\tname = ${fullName}`,
    `\temail = ${email}`,
    '[core]',
    `\teditor = ${prng.pick(GIT_EDITORS)}`,
    '[init]',
    `\tdefaultBranch = ${prng.pick(GIT_DEFAULT_BRANCHES)}`,
    '[pull]',
    `\trebase = ${prng.pick(['true', 'false'])}`,
    '[alias]',
    ...aliases.map(([alias, command]) => `\t${alias} = ${command}`),
  ];
  return `${lines.join('\n')}\n`;
};

const bashrc = (prng: Prng): string => {
  const additions = prng.pickN(BASHRC_ADDITIONS, prng.nextInt(2, 6));
  return `${DEBIAN_BASHRC}\n${additions.join('\n')}\n`;
};

/** The notes this home keeps, as filename → body. A file name is drawn once, so two
 *  notes in one home never collide. */
const buildNotes = (options: {
  readonly prng: Prng;
  readonly category: keyof typeof NOTE_TEMPLATES;
  readonly place: string;
  readonly first: string;
}): ReadonlyMap<string, string> => {
  const { prng, category, place, first } = options;
  const chosen = prng.pickN(NOTE_TEMPLATES[category], prng.nextInt(2, 5));
  return new Map(
    chosen.map((template) => [
      template.file,
      fillSlots(template.body, drawSlots({ prng, place, first, note: template.file })),
    ]),
  );
};

/** Every truthful command a history could hold against a neighbour MACHINE: a command
 *  for each way the box really answers, crossed with each way its name can be written
 *  (its address, its bare hostname, its fully qualified `.lan` name). `ssh` appears only
 *  when the box runs sshd, and names the box's own account on the port it listens on;
 *  `curl` only when it serves http. Exhaustive and pure, so the truthfulness of the
 *  whole set is a property a test can hold, rather than something the random pick below
 *  covers by luck. */
export const machineCommandOptions = (essid: string, neighbour: LanHost): readonly string[] => {
  const services = hostServices(essid, neighbour);
  const ssh = services.find(({ spec }) => spec.service === 'ssh');
  const http = services.find(({ spec }) => spec.service === 'http');
  const fqdn = `${neighbour.hostname}.${lanZoneName(essid)}`;
  const spellings = [neighbour.ip, neighbour.hostname, fqdn];
  const names = [neighbour.hostname, fqdn];
  return [
    ...spellings.map((target) => `ping ${target}`),
    ...names.map((name) => `nslookup ${name}`),
    ...(ssh === undefined
      ? []
      : spellings.map(
          (target) =>
            `ssh ${ssh.port === 22 ? '' : `-p ${ssh.port} `}${npcUsername(essid, neighbour)}@${target}`,
        )),
    ...(http === undefined
      ? []
      : spellings.map((target) => `curl http://${target}${http.port === 80 ? '' : `:${http.port}`}/`)),
  ];
};

/** The network lines a LAN desktop's history carries: a handful of real neighbours, each
 *  addressed a way that answers. A gateway is named by its address only, since two
 *  routers on one LAN can share a hostname; a machine may be named any of its ways. */
const networkLines = (prng: Prng, essid: string, self: LanHost): readonly string[] => {
  const neighbours = generateHomeLan(essid).hosts.filter((host) => host.ip !== self.ip);
  const machines = neighbours.filter((host) => host.kind === 'machine');
  const gateways = neighbours.filter((host) => host.kind !== 'machine');
  const machineLines = prng
    .pickN(machines, prng.nextInt(1, 4))
    .map((neighbour) => prng.pick(machineCommandOptions(essid, neighbour)));
  const gatewayLines = prng
    .pickN(gateways, prng.nextInt(0, 1))
    .map((gateway) => `ping ${gateway.ip}`);
  const lines = [...machineLines, ...gatewayLines];
  // A LAN desktop always talked to SOMETHING; ping the first neighbour if the draw
  // happened to pick none, so the history is never network-silent on a live LAN.
  const [firstNeighbour] = neighbours;
  return lines.length > 0 || firstNeighbour === undefined ? lines : [`ping ${firstNeighbour.ip}`];
};

const buildHistory = (options: {
  readonly prng: Prng;
  readonly essid: string;
  readonly host: LanHost;
  readonly category: keyof typeof WORK_HISTORY;
  readonly place: string;
  readonly first: string;
  readonly noteFiles: readonly string[];
  readonly onLan: boolean;
}): string => {
  const { prng, essid, host, category, place, first, noteFiles, onLan } = options;
  const personal = prng.pickN(PERSONAL_HISTORY, prng.nextInt(6, 12));
  const work = prng.pickN(WORK_HISTORY[category], prng.nextInt(3, 7));
  const network = onLan ? networkLines(prng, essid, host) : [];
  const noteFile = (): string =>
    noteFiles.length === 0 ? 'todo.txt' : prng.pick(noteFiles);
  const filled = prng
    .shuffle([...personal, ...work, ...network])
    .map((line) => fillSlots(line, drawSlots({ prng, place, first, note: noteFile() })));
  return `${filled.join('\n')}\n`;
};

export const buildNpcHome = (options: {
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
}): Directory => {
  const { essid, host, username } = options;
  if (!isDeskMachine(host)) return dir({}, HOME_DIR, username);

  const persona = networkPersona(essid);
  const person = inhabitant({ essid, host, username });
  const first = person.fullName.split(' ')[0] ?? person.fullName;
  const prng = createPrng(`home-content-${essid}-${host.ip}`);

  const notes = buildNotes({ prng, category: persona.category, place: persona.place, first });
  const onLan = generateHomeLan(essid).hosts.some(
    (candidate) => candidate.ip === host.ip && candidate.hostname === host.hostname,
  );
  const history = buildHistory({
    prng,
    essid,
    host,
    category: persona.category,
    place: persona.place,
    first,
    noteFiles: [...notes.keys()],
    onLan,
  });

  const noteEntries: Record<string, FileNode> = Object.fromEntries(
    [...notes].map(([name, body]) => [name, file(body, HOME_FILE, username)]),
  );

  return dir(
    {
      '.bashrc': file(bashrc(prng), HOME_FILE, username),
      '.profile': file(DEBIAN_PROFILE, HOME_FILE, username),
      '.bash_logout': file(DEBIAN_BASH_LOGOUT, HOME_FILE, username),
      '.bash_history': file(history, HOME_FILE, username),
      '.gitconfig': file(
        gitConfig({ prng, fullName: person.fullName, email: person.email }),
        HOME_FILE,
        username,
      ),
      notes: dir(noteEntries, HOME_DIR, username),
    },
    HOME_DIR,
    username,
  );
};
