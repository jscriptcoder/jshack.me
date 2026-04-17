import { describe, it, expect } from 'vitest';
import { MISSION_BOARD, formatMissionBoard, type MissionListing } from './missionBoard';

describe('missionBoard', () => {
  it('each listing has required fields when populated', () => {
    MISSION_BOARD.forEach((listing) => {
      expect(listing.client).toBeTruthy();
      expect(listing.target).toBeTruthy();
      expect(listing.objective).toBeTruthy();
      expect(listing.difficulty).toBeTruthy();
      expect(listing.seed).toBeTruthy();
    });
  });

  it('each listing has a unique seed', () => {
    const seeds = MISSION_BOARD.map((l) => l.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe('formatMissionBoard', () => {
  it('includes header and listing details when populated', () => {
    const listings: readonly MissionListing[] = [
      {
        client: 'testclient',
        clientEmail: 'testclient@darkmail.onion',
        target: 'Test Corp',
        objective: 'Test objective',
        difficulty: '* (Easy)',
        seed: 'TEST-SEED',
      },
    ];
    const output = formatMissionBoard(listings);
    expect(output).toContain('DARKNET CONTRACTS');
    expect(output).toContain('Test Corp');
    expect(output).toContain('Test objective');
    expect(output).toContain('TEST-SEED');
    expect(output).toContain('accept("SEED")');
  });
});
