import {
  BYE_STACK_EXCLUDE,
  BYE_STACK_OK,
  BYE_STACK_PENALIZE,
  DEFAULT_STRATEGY_CONFIG,
  DEFAULT_STRATEGY_WEIGHTS,
  type StrategyConfig,
} from "../config/strategy";
import {
  buildAvailabilityMap,
  type PlayerAvailability,
} from "./pick-availability";
import { formatAdp } from "./adp";
import { assignRosterSlot, openStarterSlots, rosterPicks } from "./roster";
import {
  nextSelectionForSlot,
  picksForSlot,
  picksUntilFollowingSelection,
  picksUntilNextSelection,
} from "./snake";
import type {
  DraftState,
  FactorBreakdown,
  Pick,
  Player,
  PlayerRecommendation,
  Position,
  RecommendationFactor,
  RecommendationResult,
  StrategyWeights,
} from "./types";

const clamp = (value: number, minimum = -1, maximum = 1): number =>
  Math.max(minimum, Math.min(maximum, value));

/** How many already-rostered players share this candidate's bye week. */
export function sharedByeCount(
  player: Player,
  roster: readonly { readonly player: Player }[],
): number {
  if (player.byeWeek === undefined) return 0;
  return roster.filter((pick) => pick.player.byeWeek === player.byeWeek).length;
}

/**
 * 0–2 matching byes stay neutral. Three already on that week is a full
 * penalty; four-plus is an exclusion signal for the Top Five list.
 */
export function byeConcentrationValue(sameBye: number): number {
  return sameBye > BYE_STACK_OK ? -1 : 0;
}

function byeConcentrationExplanation(player: Player, sameBye: number): string {
  if (player.byeWeek === undefined) return "Bye week unavailable";
  if (sameBye >= BYE_STACK_EXCLUDE) {
    return `${sameBye} rostered players already share bye week ${player.byeWeek} — stacked bye`;
  }
  if (sameBye >= BYE_STACK_PENALIZE) {
    return `${sameBye} rostered players already share bye week ${player.byeWeek} — a fourth would punch a lineup hole`;
  }
  return `${sameBye} rostered player(s) already share bye week ${player.byeWeek}`;
}

function byeConcentrationWeight(
  sameBye: number,
  weights: StrategyWeights,
): number | undefined {
  if (byeConcentrationValue(sameBye) >= 0 || weights.byeConcentration <= 0) {
    return undefined;
  }
  return Math.max(
    weights.byeConcentration,
    DEFAULT_STRATEGY_WEIGHTS.byeConcentration,
  );
}

export interface RecommendationOptions {
  readonly topCount?: number;
  readonly weights?: Partial<StrategyWeights>;
  readonly config?: StrategyConfig;
  /** Player ids that must never appear in recommendations (e.g. avoids). */
  readonly excludePlayerIds?: readonly string[];
}

interface FactorInput {
  readonly factor: RecommendationFactor;
  readonly value: number;
  readonly explanation: string;
  readonly weight?: number;
}

function addFactor(
  factors: FactorBreakdown[],
  input: FactorInput,
  weights: StrategyWeights,
): void {
  const value = clamp(input.value);
  const weight = input.weight ?? weights[input.factor];
  factors.push({
    factor: input.factor,
    value,
    weight,
    contribution: value * weight,
    explanation: input.explanation,
  });
}

function countPosition(players: readonly Player[], position: Position): number {
  return players.filter((player) => player.position === position).length;
}

function evaluatePlayer(
  player: Player,
  available: readonly Player[],
  state: DraftState,
  config: StrategyConfig,
  weights: StrategyWeights,
  ownRoster: readonly Pick[],
  availability: PlayerAvailability | undefined,
): PlayerRecommendation | null {
  const currentOverall = state.picks.length + 1;
  const upcoming = nextSelectionForSlot(
    currentOverall,
    state.userSlot,
    state.rounds,
    state.teamCount,
  );
  const next = upcoming ?? {
    overall: currentOverall,
    round:
      Math.floor((Math.max(1, currentOverall) - 1) / state.teamCount) + 1,
    slot: state.userSlot,
  };
  const remainingPicks = picksForSlot(
    state.userSlot,
    state.rounds,
    state.teamCount,
  ).filter((selection) => selection.overall >= currentOverall).length;
  const suggestedRosterSlot = assignRosterSlot(player, ownRoster, {
    limits: config.rosterLimits,
    overflowBench: true,
  });
  if (!suggestedRosterSlot) return null;

  const factors: FactorBreakdown[] = [];
  const openSlots = openStarterSlots(ownRoster, config.rosterLimits);
  const positionRosterCount = ownRoster.filter(
    (pick) => pick.player.position === player.position,
  ).length;
  const samePosition = available
    .filter((candidate) => candidate.position === player.position)
    .sort(
      (left, right) =>
        (left.chenRank ?? Number.MAX_SAFE_INTEGER) -
        (right.chenRank ?? Number.MAX_SAFE_INTEGER),
    );
  const nextAtPosition = samePosition.find(
    (candidate) =>
      candidate.id !== player.id &&
      (candidate.chenRank ?? Number.MAX_SAFE_INTEGER) >
        (player.chenRank ?? Number.MAX_SAFE_INTEGER),
  );

  const chenRankSignal =
    player.chenRank === undefined ? 0 : clamp(1 - (player.chenRank - 1) / 199, 0, 1);
  addFactor(
    factors,
    {
      factor: "chenRank",
      value: chenRankSignal,
      explanation:
        player.chenRank === undefined
          ? "No Chen rank supplied"
          : `Rank ${player.chenRank} rewards proven draft value`,
    },
    weights,
  );

  const tierSignal =
    player.chenTier === undefined ? 0 : clamp(1 - (player.chenTier - 1) / 11, 0, 1);
  addFactor(
    factors,
    {
      factor: "chenTier",
      value: tierSignal,
      explanation:
        player.chenTier === undefined
          ? "No Chen tier supplied"
          : `Tier ${player.chenTier} receives a ${tierSignal.toFixed(2)} tier signal`,
    },
    weights,
  );

  const tierGap =
    player.chenTier !== undefined && nextAtPosition?.chenTier !== undefined
      ? nextAtPosition.chenTier - player.chenTier
      : 0;
  const rankGap =
    player.chenRank !== undefined && nextAtPosition?.chenRank !== undefined
      ? nextAtPosition.chenRank - player.chenRank
      : 0;
  const cliffSignal = clamp(Math.max(tierGap / 2, rankGap / 20), 0, 1);
  addFactor(
    factors,
    {
      factor: "tierCliff",
      value: cliffSignal,
      explanation:
        cliffSignal > 0
          ? `The next ${player.position} is ${tierGap} tier(s) and ${rankGap} rank spot(s) lower`
          : `No meaningful ${player.position} tier cliff detected`,
    },
    weights,
  );

  const picksAway =
    picksUntilFollowingSelection(
      currentOverall,
      state.userSlot,
      state.rounds,
      state.teamCount,
    ) ?? 0;
  const remainingAtPosition = countPosition(available, player.position);
  const scarcitySignal =
    picksAway === 0
      ? 0
      : clamp(1 - (remainingAtPosition - 1) / Math.max(1, picksAway), 0, 1);
  addFactor(
    factors,
    {
      factor: "positionalScarcity",
      value: scarcitySignal,
      explanation: `${remainingAtPosition} ${player.position} options remain with ${picksAway} opposing picks between turns`,
    },
    weights,
  );

  const directNeed = openSlots.includes(player.position);
  const flexNeed =
    ["RB", "WR", "TE"].includes(player.position) && openSlots.includes("FLEX");
  const needSignal = directNeed ? 1 : flexNeed ? 0.55 : 0;
  addFactor(
    factors,
    {
      factor: "positionalNeed",
      value: needSignal,
      explanation: directNeed
        ? `${player.position} fills an open starting slot`
        : flexNeed
          ? `${player.position} can fill the open FLEX slot`
          : `${player.position} is currently a depth pick`,
    },
    weights,
  );

  const flexSignal = ["RB", "WR", "TE"].includes(player.position)
    ? openSlots.includes("FLEX")
      ? 1
      : 0.25
    : 0;
  addFactor(
    factors,
    {
      factor: "flexValue",
      value: flexSignal,
      explanation:
        flexSignal > 0
          ? `${player.position} preserves RB/WR/TE FLEX flexibility`
          : `${player.position} is not FLEX eligible`,
    },
    weights,
  );

  const balanceSignal =
    player.position === "RB" || player.position === "WR"
      ? clamp((3 - positionRosterCount) / 3, 0, 1)
      : positionRosterCount === 0
        ? 0.35
        : 0;
  addFactor(
    factors,
    {
      factor: "rosterBalance",
      value: balanceSignal,
      explanation: `Roster currently has ${positionRosterCount} ${player.position}`,
    },
    weights,
  );

  const probability = availability?.probability ?? null;
  const urgencySignal = probability === null ? 0 : 1 - probability;
  addFactor(
    factors,
    {
      factor: "turnUrgency",
      value: urgencySignal,
      explanation:
        probability === null
          ? "Return probability unavailable"
          : `${Math.round(probability * 100)}% estimated chance to survive to the following turn`,
    },
    weights,
  );

  const adpSignal =
    player.adp === undefined ? 0 : clamp((next.overall - player.adp) / 24);
  addFactor(
    factors,
    {
      factor: "adpValue",
      value: adpSignal,
      explanation:
        player.adp === undefined
          ? "ADP unavailable"
          : `ADP ${formatAdp(player.adp)} versus pick ${next.overall}`,
    },
    weights,
  );

  const sameBye = sharedByeCount(player, ownRoster);
  addFactor(
    factors,
    {
      factor: "byeConcentration",
      value: byeConcentrationValue(sameBye),
      weight: byeConcentrationWeight(sameBye, weights),
      explanation: byeConcentrationExplanation(player, sameBye),
    },
    weights,
  );

  const sameTeam = ownRoster.filter((pick) => pick.player.team === player.team).length;
  addFactor(
    factors,
    {
      factor: "teamConcentration",
      value: sameTeam >= 2 ? -clamp((sameTeam - 1) / 4, 0, 1) : 0,
      explanation: `${sameTeam} rostered player(s) are already on ${player.team}`,
    },
    weights,
  );

  const specialistRound =
    player.position === "K" || player.position === "DEF"
      ? config.specialistRound[player.position]
      : null;
  const earlySpecialist =
    specialistRound !== null && next.round < specialistRound ? -1 : 0;
  addFactor(
    factors,
    {
      factor: "earlySpecialist",
      value: earlySpecialist,
      explanation:
        specialistRound === null
          ? "Not a kicker or defense"
          : earlySpecialist < 0
            ? `${player.position} is restricted before round ${specialistRound}`
            : `${player.position} is allowed from round ${specialistRound}`,
    },
    weights,
  );

  const backupPenalty =
    (player.position === "QB" || player.position === "TE") && positionRosterCount > 0
      ? -1
      : 0;
  addFactor(
    factors,
    {
      factor: "backupPenalty",
      value: backupPenalty,
      explanation:
        backupPenalty < 0
          ? `A starting ${player.position} is already rostered`
          : `No backup QB/TE penalty`,
    },
    weights,
  );

  const dedicatedHoles = openSlots.filter((slot) => slot !== "FLEX");
  const lastChance =
    remainingPicks > 0 &&
    (remainingPicks === 1 || remainingPicks <= dedicatedHoles.length);
  const completenessSignal = !lastChance
    ? 0
    : directNeed
      ? 1
      : remainingPicks === 1 && flexNeed
        ? 0.55
        : 0;
  addFactor(
    factors,
    {
      factor: "lineupCompleteness",
      value: completenessSignal,
      explanation: lastChance
        ? completenessSignal > 0
          ? remainingPicks === 1
            ? `Last pick — fill the open ${directNeed ? player.position : "FLEX"} slot`
            : `Only ${remainingPicks} picks left to fill ${dedicatedHoles.join(" / ")}`
          : `Last chance — ${player.position} does not complete an open starter`
        : "Lineup completeness applies on the last pick",
    },
    weights,
  );

  const score = factors.reduce((total, factor) => total + factor.contribution, 0);
  const explanations = [...factors]
    .filter((factor) => factor.value !== 0)
    .sort(
      (left, right) =>
        Math.abs(right.contribution) - Math.abs(left.contribution),
    )
    .slice(0, 5)
    .map((factor) => factor.explanation);

  return {
    player,
    score: Number(score.toFixed(3)),
    suggestedRosterSlot,
    factors,
    explanations,
  };
}

export function recommendPlayers(
  state: DraftState,
  players: readonly Player[],
  options: RecommendationOptions = {},
): RecommendationResult {
  const baseConfig = options.config ?? DEFAULT_STRATEGY_CONFIG;
  const specialistOpenRound = Math.max(1, state.rounds - 1);
  const config: StrategyConfig = {
    ...baseConfig,
    specialistRound: {
      K: Math.min(baseConfig.specialistRound.K, specialistOpenRound),
      DEF: Math.min(baseConfig.specialistRound.DEF, specialistOpenRound),
    },
  };
  const weights: StrategyWeights = { ...config.weights, ...options.weights };
  const drafted = new Set(state.picks.map((pick) => pick.player.id));
  const excluded = new Set(options.excludePlayerIds ?? []);
  const available = players.filter(
    (player) => !drafted.has(player.id) && !excluded.has(player.id),
  );
  const currentOverall = state.picks.length + 1;
  const next = nextSelectionForSlot(
    currentOverall,
    state.userSlot,
    state.rounds,
    state.teamCount,
  );
  const eligibleAvailable = available.filter(
    (player) =>
      !next ||
      (player.position !== "K" && player.position !== "DEF") ||
      next.round >= config.specialistRound[player.position],
  );
  const ownRoster = rosterPicks(state.picks, state.userSlot);
  const availability = buildAvailabilityMap(state, players);
  const topCount = options.topCount ?? config.topCount;
  const ranked = eligibleAvailable
    .map((player) =>
      evaluatePlayer(
        player,
        available,
        state,
        config,
        weights,
        ownRoster,
        availability.get(player.id),
      ),
    )
    .filter(
      (recommendation): recommendation is PlayerRecommendation =>
        recommendation !== null,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.player.chenRank ?? Number.MAX_SAFE_INTEGER) -
          (right.player.chenRank ?? Number.MAX_SAFE_INTEGER) ||
        left.player.name.localeCompare(right.player.name),
    );
  const unstacked = ranked.filter(
    (recommendation) =>
      sharedByeCount(recommendation.player, ownRoster) < BYE_STACK_EXCLUDE,
  );
  // Keep 4+ bye stacks off Top Five whenever any other viable player exists.
  // Best available still lists them — this only filters recommendations.
  const recommendations = (unstacked.length > 0 ? unstacked : ranked).slice(
    0,
    topCount,
  );

  return {
    recommendations,
    evaluatedCount: available.length,
    currentOverall,
    currentRound:
      next?.round ??
      Math.floor((Math.max(1, currentOverall) - 1) / state.teamCount) + 1,
    picksUntilNextSelection: picksUntilNextSelection(
      currentOverall,
      state.userSlot,
      state.rounds,
      state.teamCount,
    ),
    picksUntilFollowingSelection: picksUntilFollowingSelection(
      currentOverall,
      state.userSlot,
      state.rounds,
      state.teamCount,
    ),
  };
}
