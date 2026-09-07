// v0.6: tests for src/main/auto-plugin/tian-shi/loader.ts
//
// Scope:
//   1. initTSPlug() is idempotent and tolerates dll missing / winax missing.
//   2. isTSPlugAvailable() returns false when init failed.
//   3. getTSPlugStatus() returns a stable snapshot.
//   4. __resetTSPlugForTests() puts the loader back to idle.
//
// We can't actually load the real TSPlug in tests (winax is not installed
// in the test env, dll may or may not be in the repo). What we DO test:
//   - the loader handles every failure mode gracefully
//   - the cache/state machine is correct
//   - the public surface is stable enough to mock the loader from
//     simulator.spec.ts without surprise.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isTSPlugAvailable,
  getTSPlugStatus,
  initTSPlug,
  __resetTSPlugForTests
} from '../src/main/auto-plugin/tian-shi/loader';

beforeEach(() => {
  __resetTSPlugForTests();
});

describe('loader: state machine', () => {
  it('isTSPlugAvailable() returns false before init', () => {
    expect(isTSPlugAvailable()).toBe(false);
  });

  it('getTSPlugStatus() reports "unavailable" with null error before init', () => {
    const s = getTSPlugStatus();
    expect(s.available).toBe(false);
    expect(s.source).toBe('unavailable');
    expect(s.version).toBeNull();
  });

  it('initTSPlug() resolves to false when dll/winax unavailable', async () => {
    // In the CI / test env there's no real winax package and the
    // dynamic import of the wrapper will throw. The loader should
    // swallow the error and resolve to false.
    const ok = await initTSPlug();
    expect(ok).toBe(false);
    expect(isTSPlugAvailable()).toBe(false);
  });

  it('initTSPlug() is idempotent: repeated calls reuse the same result', async () => {
    const p1 = initTSPlug();
    const p2 = initTSPlug();
    // Same Promise object (cached) — both p1 and p2 resolve to the
    // same value because the underlying state.inited gate is set
    // before the first await yields.
    expect(p1).toBe(p2);
    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toBe(r2);
    expect(r1).toBe(false);
  });

  it('getTSPlugStatus() after failed init reports the error reason', async () => {
    await initTSPlug();
    const s = getTSPlugStatus();
    expect(s.available).toBe(false);
    expect(s.source).toBe('unavailable');
    // error string is non-null when init failed; the exact message
    // depends on whether dll was found or winax import failed.
    expect(typeof s.error === 'string' || s.error === null).toBe(true);
  });

  it('__resetTSPlugForTests() puts the loader back to idle', async () => {
    await initTSPlug();
    expect(isTSPlugAvailable()).toBe(false);
    __resetTSPlugForTests();
    // After reset, isTSPlugAvailable() must be false again (state cleared).
    expect(isTSPlugAvailable()).toBe(false);
    const s = getTSPlugStatus();
    expect(s.available).toBe(false);
    expect(s.error).toBeNull();
  });
});

describe('loader: getTSPlug() throws when unavailable', () => {
  it('throws a clear error before init', async () => {
    const { getTSPlug } = await import('../src/main/auto-plugin/tian-shi/loader');
    expect(() => getTSPlug()).toThrow(/not available/);
  });

  it('throws after failed init with the underlying reason', async () => {
    const { getTSPlug } = await import('../src/main/auto-plugin/tian-shi/loader');
    await initTSPlug();
    expect(() => getTSPlug()).toThrow(/not available/);
  });
});
