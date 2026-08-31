import { describe, expect, it } from 'vitest';
import {
  assignLiveFamilyColors,
  branchColor,
  branchPaletteColor,
  HISTORICAL_ROUTE_COLOR,
  LIVE_BRANCH_PALETTE,
} from '../../src/utils/color.js';

function hslParts(color: string): { hue: number; saturation: number; lightness: number } {
  const match = color.match(/^hsl\((\d+) (\d+)% (\d+)%\)$/);
  if (!match) throw new Error(`Unexpected HSL color: ${color}`);
  return { hue: Number(match[1]), saturation: Number(match[2]), lightness: Number(match[3]) };
}

describe('live branch colors', () => {
  it('uses only visibly saturated colors for every live palette route variation', () => {
    const colors = LIVE_BRANCH_PALETTE.flatMap((_, paletteIndex) => [0, 1, 2, 3, 4]
      .map((routeIndex) => branchPaletteColor(paletteIndex, routeIndex)));

    expect(colors).toHaveLength(LIVE_BRANCH_PALETTE.length * 5);
    for (const color of colors) {
      const { saturation, lightness } = hslParts(color);
      expect(saturation).toBeGreaterThanOrEqual(62);
      expect(lightness).toBeGreaterThanOrEqual(58);
      expect(lightness).toBeLessThanOrEqual(74);
    }
    expect(LIVE_BRANCH_PALETTE.some((entry) => entry.saturation < 62)).toBe(false);
    expect(HISTORICAL_ROUTE_COLOR).toMatch(/^hsl\(220 8% 62%\)$/);
  });

  it('preserves stable semantic colors for main and feature', () => {
    expect(branchColor('main')).toBe('hsl(188 72% 62%)');
    expect(branchColor('feature')).toBe('hsl(142 68% 60%)');
  });

  it('keeps same-family routes on one base hue with safe variations', () => {
    const colors = [0, 1, 2, 3].map((routeIndex) => branchPaletteColor(1, routeIndex));
    const parts = colors.map(hslParts);

    expect(new Set(parts.map((part) => part.hue)).size).toBe(1);
    expect(new Set(colors).size).toBe(colors.length);
    expect(parts.every((part) => part.saturation >= 62 && part.lightness >= 58)).toBe(true);
  });

  it('prefers different palette colors for overlapping families', () => {
    const assignments = assignLiveFamilyColors([
      { family: 'team-a', intervals: [{ startRow: 0, endRow: 4 }], preferredIndex: 0 },
      { family: 'team-b', intervals: [{ startRow: 2, endRow: 6 }], preferredIndex: 0 },
    ]);

    expect(assignments.get('team-a')?.paletteIndex).toBe(0);
    expect(assignments.get('team-b')?.paletteIndex).not.toBe(0);
  });

  it('allows a palette color to be reused by non-overlapping families', () => {
    const assignments = assignLiveFamilyColors([
      { family: 'upper', intervals: [{ startRow: 0, endRow: 2 }], preferredIndex: 0 },
      { family: 'lower', intervals: [{ startRow: 5, endRow: 7 }], preferredIndex: 0 },
    ]);

    expect(assignments.get('upper')?.paletteIndex).toBe(0);
    expect(assignments.get('lower')?.paletteIndex).toBe(0);
  });

  it('is deterministic for repeated layout calculations', () => {
    const requests = [
      { family: 'main', intervals: [{ startRow: 0, endRow: 8 }] },
      { family: 'feature', intervals: [{ startRow: 2, endRow: 5 }] },
      { family: 'release', intervals: [{ startRow: 11, endRow: 14 }] },
      { family: 'alice/feature', intervals: [{ startRow: 3, endRow: 7 }] },
    ];

    expect(assignLiveFamilyColors(requests)).toEqual(assignLiveFamilyColors(requests));
  });
});
