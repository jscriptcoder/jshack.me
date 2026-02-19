export type MissionListing = {
  readonly id: string;
  readonly client: string;
  readonly target: string;
  readonly objective: string;
  readonly difficulty: string;
  readonly seed: string;
};

export const MISSION_BOARD: readonly MissionListing[] = [
  {
    id: '001',
    client: 'xR0gu3x',
    target: 'MedTech Solutions — hospital records system',
    objective: 'Exfiltrate patient discharge records',
    difficulty: '* (Easy)',
    seed: 'MEDTECH-4A7F-easy',
  },
  {
    id: '002',
    client: 'null_entity',
    target: 'Westfield University — student portal',
    objective: 'Find the hidden admin flag on the database server',
    difficulty: '** (Medium)',
    seed: 'WFIELD-9C2E',
  },
  {
    id: '003',
    client: 'd4rk_m4tter',
    target: 'Harbor City PD — criminal records database',
    objective: 'Locate and extract case evidence files',
    difficulty: '*** (Hard)',
    seed: 'HCPD-3B1D-hard',
  },
  {
    id: '004',
    client: 'z3r0_c00l',
    target: 'NovaCorp — R&D file server',
    objective: 'Steal the classified research prototype',
    difficulty: '* (Easy)',
    seed: 'NOVA-7E2A-easy',
  },
  {
    id: '005',
    client: 'gh0st_pr0t0c0l',
    target: 'Blackridge Financial — trading platform',
    objective: 'Find the admin credentials and capture the flag',
    difficulty: '*** (Hard)',
    seed: 'BKRDG-5F9D-hard',
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
    `      DIFFICULTY: ${listing.difficulty}`,
    `      SEED: ${listing.seed}`,
    '',
  ]);

  const footer = ['> Type accept("SEED") to start a mission'];

  return [...header, ...entries, ...footer].join('\n');
};
