import { describe, it, expect } from 'vitest';
import { MISSION_BOARD, formatMissionBoard } from './missionBoard';

describe('missionBoard', () => {
  it('each listing has required fields', () => {
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
    const output = formatMissionBoard(MISSION_BOARD);
    MISSION_BOARD.forEach((listing) => {
      expect(output).toContain(listing.client);
      expect(output).toContain(listing.seed);
    });
  });

  it('includes usage hint', () => {
    const output = formatMissionBoard(MISSION_BOARD);
    expect(output).toContain('accept("SEED")');
  });
});
