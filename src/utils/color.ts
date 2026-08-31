import { stableHash } from './hash.js';

/** Resolves a stable, sufficiently separated hue for a branch family. */
export function branchFamilyHue(family: string, usedHues: Set<number> = new Set<number>()): number {
  let hue = stableHash(family) % 360;
  let attempts = 0;
  while (attempts < 24 && [...usedHues].some((usedHue) => Math.abs(usedHue - hue) < 24 || Math.abs(usedHue - hue) > 336)) {
    hue = (hue + 37) % 360;
    attempts += 1;
  }
  usedHues.add(hue);
  return hue;
}

/**
 * Keeps routes in one branch family on the same hue while varying the
 * lightness/saturation enough to distinguish genuinely diverged routes.
 */
export function branchRouteColor(hue: number, routeIndex = 0): string {
  const variants: Array<[number, number]> = [
    [76, 66],
    [68, 58],
    [82, 74],
    [72, 51],
    [78, 81],
  ];
  const [saturation, lightness] = variants[Math.max(0, routeIndex) % variants.length];
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function branchColor(family: string): string {
  return branchRouteColor(stableHash(family) % 360);
}
