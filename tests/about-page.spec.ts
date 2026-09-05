import { describe, it, expect } from 'vitest';
import { DEMO_DIAGNOSTICS, diagnosticsToText } from '../src/renderer/src/pages/AboutPage.helpers';

describe('AboutPage: DEMO_DIAGNOSTICS', () => {
  it('is a non-empty list with at least one DirectX-style hidden-but-sized entry', () => {
    expect(DEMO_DIAGNOSTICS.length).toBeGreaterThanOrEqual(2);
    // The QQ game demo row should be "hidden" by IsWindowVisible but
    // effectively visible because of its size.
    const qq = DEMO_DIAGNOSTICS.find((d) => d.processName === 'QQXXHG.exe');
    expect(qq).toBeDefined();
    expect(qq?.isVisible).toBe(false);
    expect(qq?.isEffectivelyVisible).toBe(true);
    expect(qq?.width).toBeGreaterThan(0);
    expect(qq?.height).toBeGreaterThan(0);
  });

  it('includes a row for a process that is neither visible nor sized (filter case)', () => {
    const dummy = DEMO_DIAGNOSTICS.find((d) => d.processName === 'background_helper.exe');
    expect(dummy).toBeDefined();
    expect(dummy?.isEffectivelyVisible).toBe(false);
  });
});

describe('AboutPage: diagnosticsToText', () => {
  it('produces a header row + tab-separated body rows', () => {
    const text = diagnosticsToText(DEMO_DIAGNOSTICS);
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(DEMO_DIAGNOSTICS.length);
    expect(lines[0]).toContain('PID');
    expect(lines[0]).toContain('进程名');
    expect(lines[0]).toContain('hwnd');
    // Body rows should contain tabs (TSV) and the hex prefix.
    const body = lines.slice(1).join('\n');
    expect(body).toContain('0x');
  });

  it('emits Y / P / N visibility flags for effective / partial / not-visible', () => {
    const text = diagnosticsToText(DEMO_DIAGNOSTICS);
    const lines = text.split('\n').filter((l) => l.length > 0);
    // Index 0 is the header. Body rows match DEMO_DIAGNOSTICS order.
    const byProcess: Record<string, string> = {};
    for (const line of lines.slice(1)) {
      const cols = line.split('\t');
      const proc = cols[1];
      byProcess[proc] = line;
    }
    // Code.exe: fully visible → Y
    expect(byProcess['Code.exe']).toMatch(/\tY\t/);
    // QQ: hidden by IsWindowVisible but effectively visible → P
    expect(byProcess['QQXXHG.exe']).toMatch(/\tP\t/);
    // background_helper: not effectively visible → N
    expect(byProcess['background_helper.exe']).toMatch(/\tN\t/);
  });
});
