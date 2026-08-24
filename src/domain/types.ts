export const PLAYER_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

export type Position = (typeof PLAYER_POSITIONS)[number];
export type FlexPosition = Extract<Position, "RB" | "WR" | "TE">;
export type StarterRosterSlot = "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";
export type RosterSlot = StarterRosterSlot | "BENCH" | "IR";

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  readonly team: string;
  readonly byeWeek?: number;
  /** Lower is better. */
  readonly chenRank?: number;
  /** Lower is better. */
  readonly chenTier?: number;
  readonly adp?: number;
  readonly projectedPoints?: number;
  readonly aliases?: readonly string[];
  readonly injuryStatus?: "HEALTHY" | "QUESTIONABLE" | "DOUBTFUL" | "OUT" | "IR";
  /** Yahoo headshot URL, when enriched. */
  readonly imageUrl?: string;
  /** Full NFL team name (e.g. "Cincinnati Bengals"), when enriched. */
  readonly teamName?: string;
  /** Percent of Yahoo leagues that have this player rostered (0–100). */
  readonly percentOwned?: number;
  /** Yahoo player key, when enriched (used to fetch on-demand detail). */
  readonly playerKey?: string;
  /** Optional externally-modelled probability, from 0 to 1, that the player lasts to the user's next turn. */
  readonly estimatedReturnProbability?: number;
}

export interface Pick {
  readonly overall: number;
  readonly round: number;
  readonly slot: number;
  readonly player: Player;
  readonly rosterSlot: RosterSlot;
  readonly madeAt?: string;
}

export interface DraftState {
  readonly teamCount: number;
  readonly rounds: number;
  readonly userSlot: number;
  readonly picks: readonly Pick[];
}

export interface RosterSlotLimits {
  readonly QB: number;
  readonly RB: number;
  readonly WR: number;
  readonly TE: number;
  readonly FLEX: number;
  readonly K: number;
  readonly DEF: number;
  readonly BENCH: number;
  readonly IR: number;
}

export type RecommendationFactor =
  | "chenRank"
  | "chenTier"
  | "tierCliff"
  | "positionalScarcity"
  | "positionalNeed"
  | "flexValue"
  | "rosterBalance"
  | "turnUrgency"
  | "adpValue"
  | "byeConcentration"
  | "teamConcentration"
  | "earlySpecialist"
  | "backupPenalty"
  | "lineupCompleteness";

export type StrategyWeights = Readonly<Record<RecommendationFactor, number>>;

export interface FactorBreakdown {
  readonly factor: RecommendationFactor;
  /** A normalized signal; positive helps and negative hurts. */
  readonly value: number;
  readonly weight: number;
  readonly contribution: number;
  readonly explanation: string;
}

export interface PlayerRecommendation {
  readonly player: Player;
  readonly score: number;
  readonly suggestedRosterSlot: RosterSlot;
  readonly factors: readonly FactorBreakdown[];
  readonly explanations: readonly string[];
}

export interface RecommendationResult {
  readonly recommendations: readonly PlayerRecommendation[];
  readonly evaluatedCount: number;
  readonly currentOverall: number;
  readonly currentRound: number;
  readonly picksUntilNextSelection: number | null;
  readonly picksUntilFollowingSelection: number | null;
}

export type WaiverFactor =
  | "chenValue"
  | "starterUpgrade"
  | "positionalNeed"
  | "hiddenGem"
  | "contested"
  | "trending"
  | "watchlisted";

export interface WaiverFactorBreakdown {
  readonly factor: WaiverFactor;
  /** A normalized signal; positive helps and negative hurts. */
  readonly value: number;
  readonly weight: number;
  readonly contribution: number;
  readonly explanation: string;
}

/** A lightweight reference to a rostered player (upgrade-over / drop target). */
export interface WaiverPlayerRef {
  readonly id: string;
  readonly name: string;
  readonly position: string;
  readonly team: string;
  readonly chenRank?: number;
  readonly chenTier?: number;
}

export interface WaiverTarget {
  readonly player: {
    readonly id: string;
    readonly name: string;
    readonly position: string;
    readonly team: string;
    readonly status?: string;
    readonly byeWeek?: number;
    readonly percentOwned?: number;
    readonly chenRank?: number;
    readonly chenTier?: number;
  };
  readonly score: number;
  readonly factors: readonly WaiverFactorBreakdown[];
  readonly reasons: readonly string[];
  /** The current starter this pickup would beat out, if any. */
  readonly upgradeOver: WaiverPlayerRef | null;
  /** The most expendable roster player to drop to make room, if a move is worth it. */
  readonly suggestedDrop: WaiverPlayerRef | null;
  readonly fillsNeed: boolean;
  readonly isContested: boolean;
  readonly isTrending: boolean;
  readonly isWatched: boolean;
}
