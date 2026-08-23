import type { Pick, Position } from "./types";

export const LINEUP_POSITIONS: readonly Position[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
];

export type PositionCounts = Record<Position, number>;

/** Minimum dedicated starters; a complete lineup also needs one RB/WR/TE FLEX. */
export const STARTER_NEED: Readonly<PositionCounts> = Object.freeze({
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  DEF: 1,
});

export const STARTER_SPOTS = 8;
const FLEX_POSITIONS: readonly Position[] = ["RB", "WR", "TE"];

export function emptyPositionCounts(): PositionCounts {
  return { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
}

export function positionCountsFromPicks(picks: readonly Pick[]): PositionCounts {
  const counts = emptyPositionCounts();
  for (const pick of picks) counts[pick.player.position] += 1;
  return counts;
}

export function remainingLineupNeed(counts: Readonly<PositionCounts>): number {
  let need = 0;
  for (const position of LINEUP_POSITIONS) {
    need += Math.max(0, STARTER_NEED[position] - counts[position]);
  }
  const flexSpare = FLEX_POSITIONS.reduce(
    (total, position) => total + Math.max(0, counts[position] - STARTER_NEED[position]),
    0,
  );
  return need + (flexSpare > 0 ? 0 : 1);
}

export function positionFillsLineupNeed(
  counts: Readonly<PositionCounts>,
  position: Position,
): boolean {
  const after: PositionCounts = {
    ...counts,
    [position]: counts[position] + 1,
  };
  return remainingLineupNeed(after) < remainingLineupNeed(counts);
}

export function startersFilled(counts: Readonly<PositionCounts>): number {
  let filled = 0;
  for (const position of LINEUP_POSITIONS) {
    filled += Math.min(counts[position], STARTER_NEED[position]);
  }
  const flexSurplus = FLEX_POSITIONS.reduce(
    (total, position) => total + Math.max(0, counts[position] - STARTER_NEED[position]),
    0,
  );
  return Math.min(STARTER_SPOTS, filled + Math.min(1, flexSurplus));
}
