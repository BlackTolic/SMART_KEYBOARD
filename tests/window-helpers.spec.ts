import { describe, it, expect } from 'vitest';
import {
  basenameFromPath,
  dedupeWindowsByProcess,
  isEffectivelyVisible,
  resolveProcessName,
  type RawWindow
} from '../src/main/window.helpers';

describe('window.helpers: isEffectivelyVisible', () => {
  it('returns true for IsWindowVisible=true regardless of size', () => {
    expect(isEffectivelyVisible(true, 0, 0)).toBe(true);
    expect(isEffectivelyVisible(true, 100, 100)).toBe(true);
  });

  it('returns true for IsWindowVisible=false when size is non-zero', () => {
    // DirectX 9 fullscreen game case.
    expect(isEffectivelyVisible(false, 1920, 1080)).toBe(true);
  });

  it('returns false for IsWindowVisible=false AND size=0', () => {
    expect(isEffectivelyVisible(false, 0, 0)).toBe(false);
    // Degenerate: width but no height still counts as zero-area.
    expect(isEffectivelyVisible(false, 100, 0)).toBe(false);
    expect(isEffectivelyVisible(false, 0, 100)).toBe(false);
  });
});

describe('window.helpers: dedupeWindowsByProcess', () => {
  function rw(over: Partial<RawWindow>): RawWindow {
    return {
      hwnd: 0,
      pid: 0,
      title: '',
      processName: '',
      isVisible: true,
      width: 100,
      height: 100,
      className: '',
      ...over
    };
  }

  it('returns the input unchanged when all PIDs are distinct', () => {
    const list = [
      rw({ hwnd: 1, pid: 100, title: 'A' }),
      rw({ hwnd: 2, pid: 200, title: 'B' }),
      rw({ hwnd: 3, pid: 300, title: 'C' })
    ];
    const out = dedupeWindowsByProcess(list);
    expect(out.map((w) => w.hwnd).sort()).toEqual([1, 2, 3]);
  });

  it('keeps the visible+largest window per PID', () => {
    const list = [
      rw({ hwnd: 10, pid: 555, title: 'popup', isVisible: false, width: 200, height: 100 }),
      rw({ hwnd: 11, pid: 555, title: 'main', isVisible: true, width: 1280, height: 800 })
    ];
    const out = dedupeWindowsByProcess(list);
    expect(out.length).toBe(1);
    expect(out[0].hwnd).toBe(11);
  });

  it('falls back to the largest hidden window when no visible candidate exists', () => {
    // Two DirectX 9 game windows of different sizes; IsWindowVisible
    // returns false for both. We want the larger one (the actual
    // game window, not the launcher).
    const list = [
      rw({ hwnd: 20, pid: 777, title: 'launcher', isVisible: false, width: 320, height: 240 }),
      rw({ hwnd: 21, pid: 777, title: 'Game', isVisible: false, width: 1920, height: 1080 })
    ];
    const out = dedupeWindowsByProcess(list);
    expect(out.length).toBe(1);
    expect(out[0].hwnd).toBe(21);
  });

  it('skips windows with pid=0 or pid<0 (no usable identity)', () => {
    const list = [
      rw({ hwnd: 30, pid: 0, title: 'orphan' }),
      rw({ hwnd: 31, pid: 100, title: 'real' }),
      rw({ hwnd: 32, pid: -1, title: 'invalid' })
    ];
    const out = dedupeWindowsByProcess(list);
    expect(out.length).toBe(1);
    expect(out[0].hwnd).toBe(31);
  });
});

describe('window.helpers: basenameFromPath', () => {
  it('strips a Windows-style path', () => {
    expect(basenameFromPath('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')).toBe('msedge.exe');
  });

  it('strips a forward-slash path', () => {
    expect(basenameFromPath('/usr/bin/Code')).toBe('Code');
  });

  it('returns the input unchanged when there is no separator', () => {
    expect(basenameFromPath('msedge.exe')).toBe('msedge.exe');
  });

  it('returns an empty string for empty input', () => {
    expect(basenameFromPath('')).toBe('');
  });
});

describe('window.helpers: resolveProcessName', () => {
  it('returns the basename when it is non-empty', () => {
    expect(resolveProcessName(1234, 'msedge.exe')).toBe('msedge.exe');
  });

  it('returns "pid-{pid}" when the basename is empty', () => {
    expect(resolveProcessName(1234, '')).toBe('pid-1234');
  });

  it('returns an empty string when pid is invalid AND basename is empty', () => {
    expect(resolveProcessName(0, '')).toBe('');
    expect(resolveProcessName(-1, '')).toBe('');
  });

  it('prefers the basename even when pid looks placeholder-ish', () => {
    // The placeholder is only used when basename is empty.
    expect(resolveProcessName(9999, 'QQXXHG.exe')).toBe('QQXXHG.exe');
  });
});
