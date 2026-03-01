export type MissionListing = {
  readonly id: string;
  readonly client: string;
  readonly clientEmail: string;
  readonly target: string;
  readonly objective: string;
  readonly difficulty: string;
  readonly seed: string;
};

export const MISSION_BOARD: readonly MissionListing[] = [
  {
    id: '001',
    client: 'xR0gu3x',
    clientEmail: 'xR0gu3x@darkmail.onion',
    target: 'MedTech Solutions — hospital records system',
    objective: 'Exfiltrate patient discharge records',
    difficulty: '* (Easy)',
    seed: 'MEDTECH-ssh-easy-forwarded-exfiltrate',
  },
  {
    id: '002',
    client: 'gh0st_',
    clientEmail: 'gh0st_@darkmail.onion',
    target: 'Eastwood University — registrar database',
    objective: 'Tamper student grade records',
    difficulty: '* (Easy)',
    seed: 'EASTWOOD-ftp-easy-forwarded-tamper',
  },
  {
    id: '003',
    client: 'cyph3rpunk',
    clientEmail: 'cyph3rpunk@darkmail.onion',
    target: 'Nexus Corp — employee workstations',
    objective: 'Steal admin credentials',
    difficulty: '* (Easy)',
    seed: 'NEXUS-http-easy-forwarded-credential-theft',
  },
  {
    id: '004',
    client: 'n3twr4ith',
    clientEmail: 'n3twr4ith@darkmail.onion',
    target: 'Vanguard Finance — trading platform',
    objective: 'Exfiltrate transaction logs',
    difficulty: '** (Medium)',
    seed: 'VANGUARD-nc-medium-forwarded-exfiltrate',
  },
  {
    id: '005',
    client: 'zer0day_',
    clientEmail: 'zer0day_@darkmail.onion',
    target: 'Sentinel Defense — weapons research lab',
    objective: 'Tamper access control policy',
    difficulty: '** (Medium)',
    seed: 'SENTINEL-exploit-medium-router-first-tamper',
  },
  {
    id: '006',
    client: 'bl4ckh4t',
    clientEmail: 'bl4ckh4t@darkmail.onion',
    target: 'OmniCloud Services — backup systems',
    objective: 'Fix broken backup validation script',
    difficulty: '** (Medium)',
    seed: 'OMNICLOUD-ssh-medium-forwarded-script-fix-domain',
  },
  {
    id: '007',
    client: 'darkfl0w',
    clientEmail: 'darkfl0w@darkmail.onion',
    target: 'Iron Gate Security — vault server',
    objective: 'Exfiltrate encrypted vault keys',
    difficulty: '*** (Hard)',
    seed: 'IRONGATE-exploit-hard-router-first-exfiltrate-decrypt',
  },
  {
    id: '008',
    client: 'v0id_agent',
    clientEmail: 'v0id_agent@darkmail.onion',
    target: 'Cobalt Industries — R&D network',
    objective: 'Steal root credentials',
    difficulty: '*** (Hard)',
    seed: 'COBALT-nc-hard-router-first-credential-theft',
  },
  {
    id: '009',
    client: 'ph4nt0m',
    clientEmail: 'ph4nt0m@darkmail.onion',
    target: 'Axiom Biotech — gene sequencer cluster',
    objective: 'Fix corrupted analysis script',
    difficulty: '*** (Hard)',
    seed: 'AXIOM-http-hard-router-first-script-fix',
  },
];

export const formatMissionBoard = (listings: readonly MissionListing[]): string => {
  const header = [
    '============================================',
    '  DARKNET CONTRACTS — AVAILABLE JOBS',
    '============================================',
    '',
  ];

  const entries = listings.flatMap((listing) => [
    `[${listing.id}] CLIENT: ${listing.client}`,
    `      TARGET: ${listing.target}`,
    `      OBJECTIVE: ${listing.objective}`,
    `      REPLY TO: ${listing.clientEmail}`,
    `      DIFFICULTY: ${listing.difficulty}`,
    `      SEED: ${listing.seed}`,
    '',
  ]);

  const footer = ['> Type accept("SEED") to start a mission'];

  return [...header, ...entries, ...footer].join('\n');
};
