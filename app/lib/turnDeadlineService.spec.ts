import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  turnDeadlineService,
  computeTurnDeadline,
  handAdvisoryLockKey,
  TURN_DURATION_MS,
} from './turnDeadlineService.server';

describe('turnDeadlineService.arm', () => {
  beforeEach(() => {
    turnDeadlineService.clearAll();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    turnDeadlineService.clearAll();
  });

  it('fires onFire once the deadline elapses', async () => {
    const onFire = vi.fn();
    const deadline = new Date(Date.now() + 5_000);

    turnDeadlineService.arm('hand-1', deadline, onFire);
    expect(turnDeadlineService.size()).toBe(1);
    expect(onFire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(turnDeadlineService.size()).toBe(0);
  });

  it('cancel() prevents the fire', async () => {
    const onFire = vi.fn();
    turnDeadlineService.arm('hand-1', new Date(Date.now() + 5_000), onFire);

    turnDeadlineService.cancel('hand-1');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onFire).not.toHaveBeenCalled();
    expect(turnDeadlineService.size()).toBe(0);
  });

  it('re-arming the same hand cancels the prior timer', async () => {
    const firstFire = vi.fn();
    const secondFire = vi.fn();

    turnDeadlineService.arm('hand-1', new Date(Date.now() + 5_000), firstFire);
    turnDeadlineService.arm('hand-1', new Date(Date.now() + 10_000), secondFire);
    expect(turnDeadlineService.size()).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(firstFire).not.toHaveBeenCalled();
    expect(secondFire).toHaveBeenCalledTimes(1);
  });

  it('past-due deadlines fire on the next tick', async () => {
    const onFire = vi.fn();
    turnDeadlineService.arm('hand-1', new Date(Date.now() - 10_000), onFire);

    expect(onFire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('swallows errors thrown by onFire so one bad hand cannot kill the scheduler', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFire = vi.fn(() => {
      throw new Error('boom');
    });

    turnDeadlineService.arm('hand-1', new Date(Date.now() + 1_000), onFire);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('computeTurnDeadline', () => {
  it('returns null when nobody is on the clock', () => {
    expect(computeTurnDeadline({ toAct: null, isHuman: () => true })).toBeNull();
  });

  it('returns null when the actor is an AI seat', () => {
    expect(computeTurnDeadline({ toAct: 'seat-a', isHuman: () => false })).toBeNull();
  });

  it('returns an ISO timestamp ~TURN_DURATION_MS in the future for a human seat', () => {
    const before = Date.now();
    const result = computeTurnDeadline({ toAct: 'seat-a', isHuman: () => true });
    const after = Date.now();

    expect(result).not.toBeNull();
    const ts = Date.parse(result!);
    expect(ts).toBeGreaterThanOrEqual(before + TURN_DURATION_MS);
    expect(ts).toBeLessThanOrEqual(after + TURN_DURATION_MS);
  });
});

describe('handAdvisoryLockKey', () => {
  it('produces a stable signed 64-bit bigint for the same UUID', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const a = handAdvisoryLockKey(id);
    const b = handAdvisoryLockKey(id);
    expect(a).toBe(b);
    expect(a >= -(2n ** 63n) && a < 2n ** 63n).toBe(true);
  });

  it('produces different keys for UUIDs that differ in the first 16 hex chars', () => {
    // Only the first 16 hex chars (8 bytes) feed the key; UUIDs that
    // only differ past that hash to the same value (acceptable
    // collision per the comment in handAdvisoryLockKey).
    const a = handAdvisoryLockKey('550e8400-e29b-41d4-a716-446655440000');
    const b = handAdvisoryLockKey('660e8400-e29b-41d4-a716-446655440000');
    expect(a).not.toBe(b);
  });
});
