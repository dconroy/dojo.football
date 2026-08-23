import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import type { RecommendationFactor, StrategyWeights } from "@/domain/types";
import type { RankingSourceId } from "./sources";

export type ExpertSliderKey = RecommendationFactor;

export function expertSliderKeys(
  source: RankingSourceId,
): readonly ExpertSliderKey[] {
  if (source === "sleeper" || source === "ffcalc") {
    return ["adpValue", "chenRank", "positionalNeed", "turnUrgency"];
  }
  return ["chenRank", "tierCliff", "positionalNeed", "turnUrgency"];
}

export function expertSliderLabel(
  key: ExpertSliderKey,
  source: RankingSourceId,
): string {
  if (key === "chenRank") {
    if (source === "fantasypros") return "ECR rank";
    if (source === "sleeper" || source === "ffcalc") return "Board rank";
    return "Chen rank";
  }
  if (key === "tierCliff") {
    return source === "chen" || source === "fantasypros" ? "Tier cliff" : "ADP drop";
  }
  if (key === "adpValue") return "ADP value";
  return key.replace(/([A-Z])/g, " $1");
}

export function expertWeightPreset(
  source: RankingSourceId,
): Pick<StrategyWeights, "chenRank" | "tierCliff" | "adpValue"> {
  if (source === "fantasypros") {
    return { chenRank: 30, tierCliff: 14, adpValue: 14 };
  }
  if (source === "sleeper" || source === "ffcalc") {
    return { chenRank: 16, tierCliff: 8, adpValue: 28 };
  }
  return {
    chenRank: DEFAULT_STRATEGY_WEIGHTS.chenRank,
    tierCliff: DEFAULT_STRATEGY_WEIGHTS.tierCliff,
    adpValue: DEFAULT_STRATEGY_WEIGHTS.adpValue,
  };
}

/** Retarget rank / tier / ADP knobs for a new expert. Leaves need and urgency. */
export function withExpertWeights(
  weights: StrategyWeights,
  source: RankingSourceId,
): StrategyWeights {
  return { ...weights, ...expertWeightPreset(source) };
}

export function defaultWeightsForExpert(source: RankingSourceId): StrategyWeights {
  return withExpertWeights(DEFAULT_STRATEGY_WEIGHTS, source);
}
