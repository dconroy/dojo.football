import {
  LINEUP_POSITIONS,
  emptyPositionCounts,
  positionCountsFromPicks,
  positionFillsLineupNeed,
  remainingLineupNeed,
  type PositionCounts,
} from "./lineup-need";
import { rosterPicks } from "./roster";
import {
  followingSelectionForSlot,
  nextSelectionForSlot,
  selectionForOverall,
  type SnakeSelection,
} from "./snake";
import type { DraftState, Position } from "./types";

export type TendencyConfidence = "low" | "medium" | "high";

export interface PositionDemand {
  readonly position: Position;
  /** Expected share of the intervening picks, from 0 to 1. */
  readonly pressure: number;
  readonly teamsNeeding: number;
  readonly picksInWindow: number;
}

export interface PositionRun {
  readonly position: Position;
  readonly picks: number;
  readonly window: number;
  readonly confidence: TendencyConfidence;
}

export interface TeamBias {
  readonly slot: number;
  readonly position: Position;
  readonly count: number;
  readonly total: number;
  readonly confidence: TendencyConfidence;
}

export interface RoomTendencyAlert {
  readonly kind: "demand" | "run" | "bias";
  readonly text: string;
  readonly confidence: TendencyConfidence;
}

export interface RoomTendencies {
  readonly window: readonly SnakeSelection[];
  readonly demand: readonly PositionDemand[];
  readonly run: PositionRun | null;
  readonly biases: readonly TeamBias[];
  readonly alerts: readonly RoomTendencyAlert[];
}

function confidenceForSamples(samples: number): TendencyConfidence {
  if (samples >= 6) return "high";
  if (samples >= 3) return "medium";
  return "low";
}

/** Opposing selections after the user's next pick and before their following pick. */
export function interveningSelections(state: DraftState): readonly SnakeSelection[] {
  const currentOverall = state.picks.length + 1;
  const next = nextSelectionForSlot(
    currentOverall,
    state.userSlot,
    state.rounds,
    state.teamCount,
  );
  const following = followingSelectionForSlot(
    currentOverall,
    state.userSlot,
    state.rounds,
    state.teamCount,
  );
  if (!next || !following) return [];

  return Array.from(
    { length: Math.max(0, following.overall - next.overall - 1) },
    (_, index) => selectionForOverall(next.overall + index + 1, state.teamCount),
  );
}

function demandForPosition(
  state: DraftState,
  window: readonly SnakeSelection[],
  position: Position,
): PositionDemand {
  let weightedNeed = 0;
  let teamsNeeding = 0;
  for (const selection of window) {
    const roster = rosterPicks(state.picks, selection.slot);
    const counts = positionCountsFromPicks(roster);
    if (!positionFillsLineupNeed(counts, position)) continue;
    teamsNeeding += 1;
    const picksRemaining = Math.max(1, state.rounds - roster.length);
    const urgency = Math.min(1, remainingLineupNeed(counts) / picksRemaining);
    weightedNeed += 0.55 + urgency * 0.45;
  }
  return {
    position,
    pressure: window.length === 0 ? 0 : weightedNeed / window.length,
    teamsNeeding,
    picksInWindow: window.length,
  };
}

export function detectPositionRun(
  state: DraftState,
  windowSize = 5,
): PositionRun | null {
  const recent = state.picks.slice(-windowSize);
  if (recent.length < 3) return null;
  const counts = emptyPositionCounts();
  for (const pick of recent) counts[pick.player.position] += 1;
  const [position, picks] = (Object.entries(counts) as Array<[Position, number]>).sort(
    (left, right) => right[1] - left[1],
  )[0];
  const threshold = Math.max(3, Math.ceil(recent.length * 0.6));
  if (picks < threshold) return null;
  return {
    position,
    picks,
    window: recent.length,
    confidence: picks >= 4 ? "high" : "medium",
  };
}

export function observedTeamBiases(state: DraftState): readonly TeamBias[] {
  const biases: TeamBias[] = [];
  for (let slot = 1; slot <= state.teamCount; slot += 1) {
    const roster = rosterPicks(state.picks, slot);
    if (roster.length < 3) continue;
    const counts = positionCountsFromPicks(roster);
    const [position, count] = (Object.entries(counts) as Array<[Position, number]>).sort(
      (left, right) => right[1] - left[1],
    )[0];
    // Three of four or a strict majority after five picks is meaningful; two of
    // three is too common early in a draft to label as a tendency.
    if (count < 3 || count / roster.length < 0.5) continue;
    biases.push({
      slot,
      position,
      count,
      total: roster.length,
      confidence: confidenceForSamples(roster.length),
    });
  }
  return biases.sort(
    (left, right) =>
      right.count / right.total - left.count / left.total || left.slot - right.slot,
  );
}

export function analyzeRoomTendencies(state: DraftState): RoomTendencies {
  const window = interveningSelections(state);
  const demand = LINEUP_POSITIONS.map((position) =>
    demandForPosition(state, window, position),
  ).sort(
    (left, right) =>
      right.pressure - left.pressure ||
      LINEUP_POSITIONS.indexOf(left.position) - LINEUP_POSITIONS.indexOf(right.position),
  );
  const run = detectPositionRun(state);
  const biases = observedTeamBiases(state);
  const alerts: RoomTendencyAlert[] = [];
  const strongest = demand[0];
  if (
    strongest &&
    strongest.picksInWindow >= 2 &&
    strongest.teamsNeeding >= 2 &&
    strongest.pressure >= 0.35
  ) {
    alerts.push({
      kind: "demand",
      confidence: strongest.teamsNeeding >= 4 ? "high" : "medium",
      text: `${strongest.teamsNeeding} of ${strongest.picksInWindow} picks ahead belong to teams that still need ${strongest.position}`,
    });
  }
  if (run) {
    alerts.push({
      kind: "run",
      confidence: run.confidence,
      text: `${run.position} run underway — ${run.picks} of the last ${run.window} picks`,
    });
  }
  const relevantBias = biases.find((bias) =>
    window.some((selection) => selection.slot === bias.slot),
  );
  if (relevantBias) {
    alerts.push({
      kind: "bias",
      confidence: relevantBias.confidence,
      text: `Team ${relevantBias.slot} is ${relevantBias.position}-heavy so far (${relevantBias.count} of ${relevantBias.total})`,
    });
  }
  return { window, demand, run, biases, alerts };
}

export function demandFor(
  tendencies: RoomTendencies,
  position: Position,
): PositionDemand {
  return (
    tendencies.demand.find((item) => item.position === position) ?? {
      position,
      pressure: 0,
      teamsNeeding: 0,
      picksInWindow: tendencies.window.length,
    }
  );
}

export function countsForSlot(state: DraftState, slot: number): PositionCounts {
  return positionCountsFromPicks(rosterPicks(state.picks, slot));
}
