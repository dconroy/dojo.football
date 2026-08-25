import {
  analyzeRoomTendencies,
  demandFor,
  type RoomTendencies,
} from "./room-tendencies";
import { followingSelectionForSlot } from "./snake";
import type { DraftState, Player } from "./types";

export type AvailabilitySignal = "take_now" | "safe_to_wait" | "neutral" | "unknown";

export interface PlayerAvailability {
  readonly playerId: string;
  readonly probability: number | null;
  readonly signal: AvailabilitySignal;
  readonly targetOverall: number | null;
  readonly reasons: readonly string[];
}

const clampProbability = (value: number): number => Math.max(0.01, Math.min(0.99, value));

/** Existing ADP logistic baseline, extracted so recommendation and UI share one number. */
export function adpSurvivalProbability(
  player: Player,
  targetOverall: number | null,
): number | null {
  if (player.estimatedReturnProbability !== undefined) {
    return Math.max(0, Math.min(1, player.estimatedReturnProbability));
  }
  if (player.adp === undefined || targetOverall === null) return null;
  return 1 / (1 + Math.exp((targetOverall - player.adp) / 6));
}

export function availabilityTargetOverall(state: DraftState): number | null {
  return (
    followingSelectionForSlot(
      state.picks.length + 1,
      state.userSlot,
      state.rounds,
      state.teamCount,
    )?.overall ?? null
  );
}

function tierCliff(player: Player, available: readonly Player[]): number {
  const next = available
    .filter(
      (candidate) =>
        candidate.id !== player.id &&
        candidate.position === player.position &&
        (candidate.chenRank ?? Number.MAX_SAFE_INTEGER) >
          (player.chenRank ?? Number.MAX_SAFE_INTEGER),
    )
    .sort(
      (left, right) =>
        (left.chenRank ?? Number.MAX_SAFE_INTEGER) -
        (right.chenRank ?? Number.MAX_SAFE_INTEGER),
    )[0];
  if (!next) return 0;
  const tierGap =
    player.chenTier === undefined || next.chenTier === undefined
      ? 0
      : next.chenTier - player.chenTier;
  const rankGap =
    player.chenRank === undefined || next.chenRank === undefined
      ? 0
      : next.chenRank - player.chenRank;
  return Math.max(0, Math.min(1, Math.max(tierGap / 2, rankGap / 20)));
}

export function availabilitySignal(
  probability: number | null,
  cliff = 0,
): AvailabilitySignal {
  if (probability === null) return "unknown";
  if (probability < 0.4 || (probability < 0.55 && cliff >= 0.5)) return "take_now";
  if (probability >= 0.72 && cliff < 0.25) return "safe_to_wait";
  return "neutral";
}

/**
 * Adjusts the ADP baseline using only evidence visible in the current room:
 * lineup demand between turns, an active position run, and observed team bias.
 * Externally supplied probabilities remain authoritative.
 */
export function estimatePlayerAvailability(
  player: Player,
  state: DraftState,
  available: readonly Player[],
  tendencies: RoomTendencies = analyzeRoomTendencies(state),
): PlayerAvailability {
  const targetOverall = availabilityTargetOverall(state);
  const baseline = adpSurvivalProbability(player, targetOverall);
  const cliff = tierCliff(player, available);
  if (baseline === null) {
    return {
      playerId: player.id,
      probability: null,
      signal: "unknown",
      targetOverall,
      reasons: ["ADP is unavailable, so return odds are unknown"],
    };
  }

  const demand = demandFor(tendencies, player.position);
  const runPressure = tendencies.run?.position === player.position ? 1 : 0;
  const biasedTeams = tendencies.biases.filter(
    (bias) =>
      bias.position === player.position &&
      tendencies.window.some((selection) => selection.slot === bias.slot),
  ).length;

  let probability = baseline;
  if (player.estimatedReturnProbability === undefined) {
    const bounded = clampProbability(baseline);
    const logit = Math.log(bounded / (1 - bounded));
    // Neutral room pressure is roughly .30. Only meaningful evidence should
    // move an ADP estimate, and the adjustment remains smaller than ADP itself.
    const roomAdjustment =
      Math.max(-0.2, demand.pressure - 0.3) * 1.15 +
      runPressure * 0.45 +
      Math.min(2, biasedTeams) * 0.2;
    probability = clampProbability(1 / (1 + Math.exp(-(logit - roomAdjustment))));
  }

  const rounded = Math.round(probability * 100);
  const reasons = [
    `${rounded}% chance this player is still available at your next turn (pick ${targetOverall ?? "—"})`,
  ];
  if (demand.teamsNeeding >= 2) {
    reasons.push(
      `${demand.teamsNeeding} intervening picks fill a ${player.position} need`,
    );
  }
  if (runPressure) reasons.push(`${player.position} is being drafted in a current run`);
  if (cliff >= 0.5) reasons.push(`A meaningful ${player.position} tier cliff follows`);

  return {
    playerId: player.id,
    probability,
    signal: availabilitySignal(probability, cliff),
    targetOverall,
    reasons,
  };
}

export function buildAvailabilityMap(
  state: DraftState,
  players: readonly Player[],
): ReadonlyMap<string, PlayerAvailability> {
  const drafted = new Set(state.picks.map((pick) => pick.player.id));
  const available = players.filter((player) => !drafted.has(player.id));
  const tendencies = analyzeRoomTendencies(state);
  return new Map(
    available.map((player) => [
      player.id,
      estimatePlayerAvailability(player, state, available, tendencies),
    ]),
  );
}
