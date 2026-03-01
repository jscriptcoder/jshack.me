import { describe, it, expect } from 'vitest';
import { MISSION_BOARD, formatMissionBoard, type MissionListing } from './missionBoard';

describe('missionBoard', () => {
  it('each listing has required fields when populated', () => {
    MISSION_BOARD.forEach((listing) => {
      expect(listing.id).toBeTruthy();
      expect(listing.client).toBeTruthy();
      expect(listing.target).toBeTruthy();
      expect(listing.objective).toBeTruthy();
      expect(listing.difficulty).toBeTruthy();
      expect(listing.seed).toBeTruthy();
    });
  });

  it('each listing has a unique id', () => {
    const ids = MISSION_BOARD.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each listing has a unique seed', () => {
    const seeds = MISSION_BOARD.map((l) => l.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe('formatMissionBoard', () => {
  it('includes header', () => {
    const output = formatMissionBoard(MISSION_BOARD);
    expect(output).toContain('DARKNET CONTRACTS');
  });

  it('includes all listing details', () => {
    const listings: readonly MissionListing[] = [
      {
        id: '001',
        client: 'testclient',
        clientEmail: 'testclient@darkmail.onion',
        target: 'Test Corp',
        objective: 'Test objective',
        difficulty: '* (Easy)',
        seed: 'TEST-SEED',
      },
    ];
    const output = formatMissionBoard(listings);
    expect(output).toContain('testclient');
    expect(output).toContain('TEST-SEED');
  });

  it('includes usage hint', () => {
    const output = formatMissionBoard(MISSION_BOARD);
    expect(output).toContain('accept("SEED")');
  });
});
