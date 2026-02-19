import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMissionState } from './useMissionState';

vi.mock('../utils/storageCache', () => ({
  getCachedMissionSeed: vi.fn(() => null),
  getDatabase: vi.fn(() => null),
}));

vi.mock('../utils/storage', () => ({
  saveMissionSeed: vi.fn(),
}));

import { getCachedMissionSeed, getDatabase } from '../utils/storageCache';
import { saveMissionSeed } from '../utils/storage';

const mockGetCachedMissionSeed = vi.mocked(getCachedMissionSeed);
const mockGetDatabase = vi.mocked(getDatabase);
const mockSaveMissionSeed = vi.mocked(saveMissionSeed);

const fakeDb = {} as IDBDatabase;

describe('useMissionState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedMissionSeed.mockReturnValue(null);
    mockGetDatabase.mockReturnValue(null);
  });

  it('starts with null mission when no cached seed', () => {
    const { result } = renderHook(() => useMissionState());
    expect(result.current.activeMission).toBeNull();
  });

  it('restores mission from cached seed on init', () => {
    mockGetCachedMissionSeed.mockReturnValue('MEDTECH-4A7F-easy');

    const { result } = renderHook(() => useMissionState());

    expect(result.current.activeMission).not.toBeNull();
    expect(result.current.activeMission?.seed).toBe('MEDTECH-4A7F-easy');
  });

  it('startMission generates network and persists seed', () => {
    mockGetDatabase.mockReturnValue(fakeDb);
    const { result } = renderHook(() => useMissionState());

    act(() => {
      result.current.startMission('TEST-SEED');
    });

    expect(result.current.activeMission).not.toBeNull();
    expect(result.current.activeMission?.seed).toBe('TEST-SEED');
    expect(mockSaveMissionSeed).toHaveBeenCalledWith(fakeDb, 'TEST-SEED');
  });

  it('abortMission clears state and persists null', () => {
    mockGetDatabase.mockReturnValue(fakeDb);
    const { result } = renderHook(() => useMissionState());

    act(() => {
      result.current.startMission('TEST-SEED');
    });
    expect(result.current.activeMission).not.toBeNull();

    act(() => {
      result.current.abortMission();
    });

    expect(result.current.activeMission).toBeNull();
    expect(mockSaveMissionSeed).toHaveBeenCalledWith(fakeDb, null);
  });

  it('completeMission clears state and persists null', () => {
    mockGetDatabase.mockReturnValue(fakeDb);
    const { result } = renderHook(() => useMissionState());

    act(() => {
      result.current.startMission('TEST-SEED');
    });

    act(() => {
      result.current.completeMission();
    });

    expect(result.current.activeMission).toBeNull();
    expect(mockSaveMissionSeed).toHaveBeenCalledWith(fakeDb, null);
  });

  it('skips persistence when database is unavailable', () => {
    mockGetDatabase.mockReturnValue(null);
    const { result } = renderHook(() => useMissionState());

    act(() => {
      result.current.startMission('TEST-SEED');
    });

    expect(result.current.activeMission).not.toBeNull();
    expect(mockSaveMissionSeed).not.toHaveBeenCalled();
  });

  it('generates deterministic network from same seed', () => {
    const { result } = renderHook(() => useMissionState());

    act(() => {
      result.current.startMission('DETERMINISM-TEST');
    });
    const first = result.current.activeMission;

    act(() => {
      result.current.abortMission();
    });

    act(() => {
      result.current.startMission('DETERMINISM-TEST');
    });
    const second = result.current.activeMission;

    expect(first?.machines).toEqual(second?.machines);
    expect(first?.attackChain).toEqual(second?.attackChain);
    expect(first?.objective).toEqual(second?.objective);
  });
});
