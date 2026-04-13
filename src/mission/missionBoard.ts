export type MissionListing = {
  readonly client: string;
  readonly clientEmail: string;
  readonly target: string;
  readonly objective: string;
  readonly difficulty: string;
  readonly seed: string;
};

export const MISSION_BOARD: readonly MissionListing[] = [
  {
    client: 'gh0st_protocol',
    clientEmail: 'gh0st_protocol@darkmail.onion',
    target: 'NovaCorp Web Portal',
    objective: 'Exfiltrate data from the target server',
    difficulty: '* (Easy)',
    seed: 'NOVA-HEIST-exploit-easy',
  },
  {
    client: 'z3r0_c00l',
    clientEmail: 'z3r0_c00l@darkmail.onion',
    target: 'Meridian FTP Archives',
    objective: 'Retrieve classified files via FTP',
    difficulty: '* (Easy)',
    seed: 'FTP-HEIST-ftp-easy',
  },
  {
    client: 'shadowbroker',
    clientEmail: 'shadowbroker@darkmail.onion',
    target: 'Axiom Mail Infrastructure',
    objective: 'Compromise the mail server cluster',
    difficulty: '** (Medium)',
    seed: 'MAIL-HACK-exploit-medium',
  },
  {
    client: 'dr_chaos',
    clientEmail: 'dr_chaos@darkmail.onion',
    target: 'Pinnacle Database Systems',
    objective: 'Exfiltrate customer records from the database',
    difficulty: '** (Medium)',
    seed: 'DB-CRACK-db-exfiltrate-medium',
  },
  {
    client: 'n1ghtwatch',
    clientEmail: 'n1ghtwatch@proton.onion',
    target: 'ClearView Analytics firmware',
    objective: 'Audit network device firmware for vulnerabilities',
    difficulty: '** (Medium)',
    seed: 'FIRMWARE-HACK-snmp-medium',
  },
  {
    client: 'r00tk1t',
    clientEmail: 'r00tk1t@darkmail.onion',
    target: 'Fortis Global Infrastructure',
    objective: 'Full network compromise across all layers',
    difficulty: '*** (Hard)',
    seed: 'FULL-STACK-ssh-hard',
  },
];


const WHITE_HAT_KEYWORDS = ['script-fix', 'script-auto', 'forensics', 'malware', 'db-fix'] as const;

const isWhiteHat = (seed: string): boolean => {
  const lower = seed.toLowerCase();
  return WHITE_HAT_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const SEPARATOR = '  │  ';

const formatEntry = (listing: MissionListing): readonly string[] => [
  `[${listing.difficulty}]`,
  `  ${listing.target}`,
  `  ${listing.objective}`,
  `  SEED: ${listing.seed}`,
  '',
];

const buildColumn = (title: string, missions: readonly MissionListing[]): readonly string[] => {
  const entries = missions.flatMap(formatEntry);
  const width = Math.max(title.length + 4, ...entries.map((l) => l.length));
  const rule = '='.repeat(width);
  return [rule, `  ${title}`, rule, '', ...entries];
};

const mergeColumns = (
  leftLines: readonly string[],
  rightLines: readonly string[],
): readonly string[] => {
  const leftWidth = Math.max(...leftLines.map((l) => l.length));
  const maxLines = Math.max(leftLines.length, rightLines.length);
  return Array.from({ length: maxLines }, (_, i) => {
    const left = (leftLines[i] ?? '').padEnd(leftWidth);
    const right = rightLines[i] ?? '';
    return right ? `${left}${SEPARATOR}${right}` : (leftLines[i] ?? '');
  });
};

const COMING_SOON_MESSAGE = [
  '============================================',
  '  DARKNET MARKETPLACE',
  '============================================',
  '',
  '  [ UNDER CONSTRUCTION ]',
  '',
  '  The marketplace is being rebuilt with a',
  '  new vulnerability and defense system.',
  '',
  '  New contracts will feature:',
  '  - Typed exploit effects (shells, file',
  '    reads, password resets, backdoors)',
  '  - A defense treadmill with CVEs that',
  '    publish over real game time',
  '  - Router firmware as a target surface',
  '',
  '  Check back soon.',
  '',
].join('\n');

export const formatMissionBoard = (listings: readonly MissionListing[]): string => {
  if (listings.length === 0) return COMING_SOON_MESSAGE;

  const blackHat = listings.filter((l) => !isWhiteHat(l.seed));
  const whiteHat = listings.filter((l) => isWhiteHat(l.seed));

  const leftLines = buildColumn('DARKNET CONTRACTS', blackHat);
  const rightLines = buildColumn('SECURITY CONTRACTS', whiteHat);

  const footer = ['', '> Type accept("SEED") to start a mission'];

  return [...mergeColumns(leftLines, rightLines), ...footer].join('\n');
};
