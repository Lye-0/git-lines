import { stableHash } from './hash.js';

export interface LiveBranchPaletteEntry {
  name: string;
  hue: number;
  saturation: number;
  lightness: number;
}

export interface VisibleYInterval {
  startRow: number;
  endRow: number;
}

export interface LiveFamilyColorRequest {
  family: string;
  intervals: ReadonlyArray<VisibleYInterval>;
  preferredIndex?: number;
  priority?: number;
}

export interface LiveFamilyColorAssignment {
  paletteIndex: number;
  /** Used only when every palette hue conflicts in the same visible range. */
  variationIndex: number;
}

/**
 * Colors reserved for live branch routes. Every entry is deliberately
 * saturated and bright enough for the dark Git Lines surface; gray is not a
 * member of this palette.
 */
export const LIVE_BRANCH_PALETTE: readonly LiveBranchPaletteEntry[] = [
  { name: 'cyan', hue: 188, saturation: 72, lightness: 62 },
  { name: 'green', hue: 142, saturation: 68, lightness: 60 },
  { name: 'purple', hue: 270, saturation: 72, lightness: 68 },
  { name: 'yellow', hue: 48, saturation: 84, lightness: 63 },
  { name: 'orange', hue: 26, saturation: 86, lightness: 63 },
  { name: 'blue', hue: 216, saturation: 80, lightness: 66 },
  { name: 'pink', hue: 330, saturation: 74, lightness: 68 },
  { name: 'lime', hue: 92, saturation: 68, lightness: 61 },
];

/** Historical/PREVIOUS is the only route allowed to use this gray. */
export const HISTORICAL_ROUTE_COLOR = 'hsl(220 8% 62%)';

const LIVE_ROUTE_VARIATIONS: ReadonlyArray<{ saturation: number; lightness: number }> = [
  { saturation: 0, lightness: 0 },
  { saturation: -4, lightness: -4 },
  { saturation: 4, lightness: 4 },
  { saturation: -3, lightness: 5 },
  { saturation: 2, lightness: -2 },
];

const MIN_LIVE_SATURATION = 62;
const MAX_LIVE_SATURATION = 88;
const MIN_LIVE_LIGHTNESS = 58;
const MAX_LIVE_LIGHTNESS = 74;

/** Returns whether a serialized color belongs to the live color contract. */
export function isSafeLiveBranchColor(color: string | undefined): color is string {
  const match = color?.match(/^hsl\(\d+ (\d+)% (\d+)%\)$/);
  if (!match) return false;
  const saturation = Number(match[1]);
  const lightness = Number(match[2]);
  return saturation >= MIN_LIVE_SATURATION
    && saturation <= MAX_LIVE_SATURATION
    && lightness >= MIN_LIVE_LIGHTNESS
    && lightness <= MAX_LIVE_LIGHTNESS;
}

function positiveModulo(value: number, modulus: number): number {
  return ((Math.trunc(value) % modulus) + modulus) % modulus;
}

function paletteIndex(index: number): number {
  return positiveModulo(index, LIVE_BRANCH_PALETTE.length);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedInterval(value: VisibleYInterval): VisibleYInterval {
  return value.startRow <= value.endRow
    ? { startRow: value.startRow, endRow: value.endRow }
    : { startRow: value.endRow, endRow: value.startRow };
}

function intervalsOverlap(left: ReadonlyArray<VisibleYInterval>, right: ReadonlyArray<VisibleYInterval>): boolean {
  return left.some((leftInterval) => right.some((rightInterval) => {
    const a = normalizedInterval(leftInterval);
    const b = normalizedInterval(rightInterval);
    return a.startRow <= b.endRow && b.startRow <= a.endRow;
  }));
}

function semanticPriority(family: string): number {
  const normalized = family.trim().toLowerCase();
  if (normalized === 'main' || normalized === 'master') return -100;
  if (normalized === 'feature') return -90;
  return 0;
}

function requestPriority(request: LiveFamilyColorRequest): number {
  return request.priority ?? semanticPriority(request.family);
}

function firstVisibleRow(request: LiveFamilyColorRequest): number {
  return Math.min(...request.intervals.map((value) => normalizedInterval(value).startRow), Number.POSITIVE_INFINITY);
}

function circularDistance(first: number, second: number): number {
  const distance = Math.abs(first - second);
  return Math.min(distance, LIVE_BRANCH_PALETTE.length - distance);
}

function preferredIndexFor(request: LiveFamilyColorRequest): number {
  return paletteIndex(request.preferredIndex ?? preferredBranchPaletteIndex(request.family));
}

/**
 * Returns a stable palette candidate while preserving the familiar cyan main
 * and green feature colors. Other families start from a stable hash candidate;
 * the visible Y intervals are resolved by assignLiveFamilyColors.
 */
export function preferredBranchPaletteIndex(family: string): number {
  const normalized = family.trim().toLowerCase();
  if (normalized === 'main' || normalized === 'master') return 0;
  if (normalized === 'feature') return 1;
  return stableHash(family) % LIVE_BRANCH_PALETTE.length;
}

/**
 * Assigns live family colors using only currently visible Y overlap as a
 * conflict. A color may therefore be reused by families that do not coexist
 * in the same vertical interval. When all fixed hues conflict, a safe
 * saturation/lightness variation is used as the final fallback.
 */
export function assignLiveFamilyColors(requests: ReadonlyArray<LiveFamilyColorRequest>): Map<string, LiveFamilyColorAssignment> {
  const byFamily = new Map<string, LiveFamilyColorRequest>();
  for (const request of requests) {
    if (request.family === 'historical') continue;
    const previous = byFamily.get(request.family);
    if (!previous) {
      byFamily.set(request.family, {
        ...request,
        intervals: request.intervals.map(normalizedInterval),
      });
      continue;
    }
    byFamily.set(request.family, {
      ...previous,
      intervals: [...previous.intervals, ...request.intervals.map(normalizedInterval)],
      priority: Math.min(requestPriority(previous), requestPriority(request)),
    });
  }

  const ordered = [...byFamily.values()].sort((a, b) => requestPriority(a) - requestPriority(b)
    || firstVisibleRow(a) - firstVisibleRow(b)
    || a.family.localeCompare(b.family));
  const assignments = new Map<string, LiveFamilyColorAssignment>();

  const familyConflicts = (request: LiveFamilyColorRequest, otherFamily: string): boolean => {
    const other = byFamily.get(otherFamily);
    return Boolean(other && intervalsOverlap(request.intervals, other.intervals));
  };

  for (const request of ordered) {
    const preferred = preferredIndexFor(request);
    const paletteCandidates = [...LIVE_BRANCH_PALETTE.keys()];
    const available = paletteCandidates.filter((candidate) => [...assignments.entries()]
      .filter(([, assignment]) => assignment.paletteIndex === candidate)
      .every(([family]) => !familyConflicts(request, family)));

    let selectedPalette: number;
    let variationIndex = 0;
    if (available.includes(preferred)) {
      selectedPalette = preferred;
    } else {
      const conflictCount = (candidate: number): number => [...assignments.entries()]
        .filter(([, assignment]) => assignment.paletteIndex === candidate)
        .filter(([family]) => familyConflicts(request, family)).length;
      selectedPalette = paletteCandidates.slice().sort((a, b) => conflictCount(a) - conflictCount(b)
        || circularDistance(a, preferred) - circularDistance(b, preferred)
        || a - b)[0] ?? preferred;
      const safeVariations = LIVE_ROUTE_VARIATIONS.map((_, index) => index).sort((a, b) => {
        const conflictsForA = [...assignments.entries()]
          .filter(([, assignment]) => assignment.paletteIndex === selectedPalette && assignment.variationIndex === a)
          .filter(([family]) => familyConflicts(request, family)).length;
        const conflictsForB = [...assignments.entries()]
          .filter(([, assignment]) => assignment.paletteIndex === selectedPalette && assignment.variationIndex === b)
          .filter(([family]) => familyConflicts(request, family)).length;
        return conflictsForA - conflictsForB || a - b;
      });
      variationIndex = safeVariations[0] ?? 0;
    }
    assignments.set(request.family, { paletteIndex: selectedPalette, variationIndex });
  }
  return assignments;
}

/** Convenience view for callers that only need the fixed palette index. */
export function assignLiveFamilyPalette(requests: ReadonlyArray<LiveFamilyColorRequest>): Map<string, number> {
  return new Map([...assignLiveFamilyColors(requests)].map(([family, assignment]) => [family, assignment.paletteIndex]));
}

/** Resolves a stable, sufficiently separated live hue for legacy callers. */
export function branchFamilyHue(family: string, usedHues: Set<number> = new Set<number>()): number {
  let index = preferredBranchPaletteIndex(family);
  let hue = LIVE_BRANCH_PALETTE[index]?.hue ?? LIVE_BRANCH_PALETTE[0].hue;
  let attempts = 0;
  while (attempts < LIVE_BRANCH_PALETTE.length && [...usedHues].some((usedHue) => Math.abs(usedHue - hue) < 24 || Math.abs(usedHue - hue) > 336)) {
    index = (index + 1) % LIVE_BRANCH_PALETTE.length;
    hue = LIVE_BRANCH_PALETTE[index]?.hue ?? LIVE_BRANCH_PALETTE[0].hue;
    attempts += 1;
  }
  usedHues.add(hue);
  return hue;
}

function routeColor(hue: number, baseSaturation: number, baseLightness: number, routeIndex: number): string {
  const variation = LIVE_ROUTE_VARIATIONS[positiveModulo(routeIndex, LIVE_ROUTE_VARIATIONS.length)] ?? LIVE_ROUTE_VARIATIONS[0];
  const saturation = clamp(baseSaturation + variation.saturation, MIN_LIVE_SATURATION, MAX_LIVE_SATURATION);
  const lightness = clamp(baseLightness + variation.lightness, MIN_LIVE_LIGHTNESS, MAX_LIVE_LIGHTNESS);
  return `hsl(${positiveModulo(hue, 360)} ${saturation}% ${lightness}%)`;
}

/** Keeps every live Route variation inside the safe, visibly saturated range. */
export function branchPaletteColor(palette: number, routeIndex = 0, familyVariation = 0): string {
  const entry = LIVE_BRANCH_PALETTE[paletteIndex(palette)] ?? LIVE_BRANCH_PALETTE[0];
  return routeColor(entry.hue, entry.saturation, entry.lightness, routeIndex + familyVariation);
}

/**
 * Backward-compatible hue-based helper. It now uses the same safe variation
 * limits as the fixed live palette instead of allowing a dark gray-like route.
 */
export function branchRouteColor(hue: number, routeIndex = 0): string {
  return routeColor(hue, 72, 62, routeIndex);
}

export function branchColor(family: string): string {
  return branchPaletteColor(preferredBranchPaletteIndex(family));
}
