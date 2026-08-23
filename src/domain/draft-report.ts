import { analyzeDraftRoster } from "./draft-insights";
import {
  LINEUP_POSITIONS,
  STARTER_NEED,
  STARTER_SPOTS,
  positionCountsFromPicks,
  startersFilled,
} from "./lineup-need";
import { rosterPicks } from "./roster";
import type { DraftState, Pick, Position } from "./types";

const POSITIONS = LINEUP_POSITIONS;

export type LetterGrade =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D+"
  | "D"
  | "F";

/** Missing K/DEF cannot be rescued into A-range by talent or the room curve. */
export const INCOMPLETE_GRADE_CAP: LetterGrade = "B+";
const GRADE_ORDER: readonly LetterGrade[] = [
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "F",
];
const SPECIALIST_HOLES = new Set(["No K", "No DEF"]);

export type ReasonTone = "good" | "bad" | "neutral";

export interface ReportReason {
  readonly tone: ReasonTone;
  readonly text: string;
}

export interface ReportHighlight {
  readonly name: string;
  readonly detail: string;
}

export interface TeamReportCard {
  readonly slot: number;
  readonly rank: number;
  readonly grade: LetterGrade;
  readonly score: number;
  readonly avgChenRank: number | null;
  readonly eliteCount: number;
  readonly startersFilled: number;
  readonly positionCounts: Readonly<Record<Position, number>>;
  readonly holes: readonly string[];
  readonly strengths: readonly string[];
  readonly reasons: readonly ReportReason[];
  readonly steal: ReportHighlight | null;
  readonly reach: ReportHighlight | null;
  readonly byeAlert: string | null;
  readonly summary: string;
  readonly picks: readonly Pick[];
}

export interface DraftBoardReport {
  readonly complete: boolean;
  readonly totalPicks: number;
  readonly teams: readonly TeamReportCard[];
}

/** Incomplete lineups never receive A / A- / A+. */
export function limitIncompleteGrade(
  grade: LetterGrade,
  holeCount: number,
): LetterGrade {
  if (holeCount <= 0) return grade;
  return GRADE_ORDER.indexOf(grade) < GRADE_ORDER.indexOf(INCOMPLETE_GRADE_CAP)
    ? INCOMPLETE_GRADE_CAP
    : grade;
}

function holePenalties(holes: readonly string[]): { raw: number; curve: number } {
  let raw = 0;
  let curve = 0;
  for (const hole of holes) {
    const specialist = SPECIALIST_HOLES.has(hole);
    raw += specialist ? 0.06 : 0.09;
    curve += specialist ? 0.12 : 0.16;
  }
  return { raw, curve };
}

/** Maps a 0–1 curved score to a letter. Used after the field is ranked. */
export function letterGrade(score: number): LetterGrade {
  if (score >= 0.92) return "A+";
  if (score >= 0.85) return "A";
  if (score >= 0.79) return "A-";
  if (score >= 0.72) return "B+";
  if (score >= 0.65) return "B";
  if (score >= 0.58) return "B-";
  if (score >= 0.5) return "C+";
  if (score >= 0.42) return "C";
  if (score >= 0.34) return "C-";
  if (score >= 0.26) return "D+";
  if (score >= 0.16) return "D";
  return "F";
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** Positive = drafted later than Chen rank (value); negative = a reach. */
function pickValue(pick: Pick): number | null {
  return pick.player.chenRank === undefined
    ? null
    : pick.overall - pick.player.chenRank;
}

interface TeamMetrics {
  readonly slot: number;
  readonly counts: Record<Position, number>;
  readonly avgChenRank: number | null;
  readonly eliteCount: number;
  readonly top60Count: number;
  readonly coreScore: number;
  readonly valueScore: number;
  readonly startersFilled: number;
  readonly holes: string[];
  readonly strengths: string[];
  readonly steal: ReportHighlight | null;
  readonly reach: ReportHighlight | null;
  readonly byeAlert: string | null;
  readonly rawScore: number;
  readonly holeCurvePenalty: number;
  readonly picks: readonly Pick[];
}

function measureTeam(
  roster: readonly Pick[],
  currentRound: number,
  slot: number,
): TeamMetrics {
  const counts = positionCountsFromPicks(roster);
  const holes = POSITIONS.filter(
    (position) => counts[position] < STARTER_NEED[position],
  ).map((position) =>
    STARTER_NEED[position] === 1
      ? `No ${position}`
      : `${counts[position]}/${STARTER_NEED[position]} ${position}`,
  );
  const strengths = (["RB", "WR", "TE", "QB"] as const)
    .filter((position) => counts[position] - STARTER_NEED[position] >= 2)
    .map((position) => `Deep at ${position} (${counts[position]})`);

  const ranked = roster
    .map((pick) => pick.player.chenRank)
    .filter((rank): rank is number => rank !== undefined);
  const avgChenRank = ranked.length
    ? ranked.reduce((sum, rank) => sum + rank, 0) / ranked.length
    : null;
  const eliteCount = ranked.filter((rank) => rank <= 24).length;
  const top60Count = ranked.filter((rank) => rank <= 60).length;

  // Talent = quality of the best eight players (best-ball core), so late
  // bench flyers don't drown out a strong starting lineup.
  const bestEight = [...ranked].sort((a, b) => a - b).slice(0, 8);
  const coreAvg =
    bestEight.length === 0
      ? 150
      : bestEight.reduce((sum, rank) => sum + rank, 0) / bestEight.length;
  const coreScore = clamp(1 - (coreAvg - 1) / 110);

  const values = roster
    .map(pickValue)
    .filter((value): value is number => value !== null);
  const avgValue =
    values.length === 0
      ? 0
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  const valueScore = clamp(0.5 + avgValue / 30);

  const filled = startersFilled(counts);
  const buildScore = clamp(filled / STARTER_SPOTS);
  const holeHit = holePenalties(holes);

  const insights = analyzeDraftRoster(roster, { currentRound });
  const bye = insights.byes.find((group) => group.count >= 3);
  const byePenalty = bye ? (bye.count >= 4 ? 0.12 : 0.06) : 0;

  const steal = highlight(
    roster,
    (left, right) => left - right,
    (value) => value >= 6,
    (name, rank, overall, value) =>
      `${name} — Chen ${rank} at ${overall} (+${Math.round(value)})`,
  );
  const reach = highlight(
    roster,
    (left, right) => right - left,
    (value) => value <= -12,
    (name, rank, overall, value) =>
      `${name} — Chen ${rank} at ${overall} (${Math.round(value)})`,
  );

  const rawScore = clamp(
    coreScore * 0.5 +
      valueScore * 0.22 +
      buildScore * 0.28 -
      byePenalty -
      holeHit.raw,
  );

  return {
    slot,
    counts,
    avgChenRank: avgChenRank === null ? null : Math.round(avgChenRank * 10) / 10,
    eliteCount,
    top60Count,
    coreScore,
    valueScore,
    startersFilled: filled,
    holes,
    strengths,
    steal,
    reach,
    byeAlert: bye
      ? `Bye ${bye.week} logjam · ${bye.count} players`
      : null,
    rawScore,
    holeCurvePenalty: holeHit.curve,
    picks: roster,
  };
}

function highlight(
  roster: readonly Pick[],
  compare: (left: number, right: number) => number,
  qualifies: (value: number) => boolean,
  label: (name: string, rank: number, overall: number, value: number) => string,
): ReportHighlight | null {
  let best: { pick: Pick; value: number } | null = null;
  for (const pick of roster) {
    const value = pickValue(pick);
    if (value === null) continue;
    if (!best || compare(value, best.value) > 0) best = { pick, value };
  }
  if (!best || !qualifies(best.value)) return null;
  return {
    name: best.pick.player.name,
    detail: label(
      best.pick.player.name,
      best.pick.player.chenRank ?? 0,
      best.pick.overall,
      best.value,
    ),
  };
}

function buildReasons(
  metrics: TeamMetrics,
  rank: number,
  teamCount: number,
): ReportReason[] {
  const reasons: ReportReason[] = [];

  if (metrics.eliteCount >= 3) {
    reasons.push({
      tone: "good",
      text: `Loaded core — ${metrics.eliteCount} players inside Chen's top 24.`,
    });
  } else if (metrics.eliteCount >= 1) {
    reasons.push({
      tone: "good",
      text: `${metrics.eliteCount} top-24 anchor${metrics.eliteCount > 1 ? "s" : ""}, ${metrics.top60Count} inside the top 60.`,
    });
  } else {
    reasons.push({
      tone: "bad",
      text: metrics.top60Count
        ? `No top-24 pick — leans on ${metrics.top60Count} top-60 role players.`
        : "No top-60 talent to build around.",
    });
  }

  if (metrics.steal) {
    reasons.push({ tone: "good", text: `Best value: ${metrics.steal.detail}.` });
  }
  if (metrics.reach) {
    reasons.push({ tone: "bad", text: `Reached: ${metrics.reach.detail}.` });
  }

  if (metrics.holes.length > 0) {
    reasons.push({
      tone: "bad",
      text: `Lineup gap — ${metrics.holes.join(", ")}. Incomplete teams cannot grade above ${INCOMPLETE_GRADE_CAP}.`,
    });
  } else {
    reasons.push({ tone: "good", text: "Every starting slot is covered." });
  }

  if (metrics.strengths.length > 0) {
    reasons.push({ tone: "good", text: metrics.strengths.join(" · ") + "." });
  }
  if (metrics.byeAlert) {
    reasons.push({ tone: "bad", text: `${metrics.byeAlert}.` });
  }

  reasons.push({
    tone: "neutral",
    text: `Ranked ${ordinal(rank)} of ${teamCount}${
      metrics.avgChenRank !== null
        ? ` · avg Chen rank ${metrics.avgChenRank}`
        : ""
    }.`,
  });

  return reasons;
}

function summarize(metrics: TeamMetrics): string {
  if (metrics.holes.length > 0) return `Incomplete lineup — ${metrics.holes[0]}`;
  if (metrics.eliteCount >= 3) return "Elite top-heavy roster";
  if (metrics.steal) return `Value board — ${metrics.steal.name} was a steal`;
  if (metrics.strengths.length > 0) return metrics.strengths[0];
  if (metrics.reach) return `Reached early on ${metrics.reach.name}`;
  return "Balanced, by-the-book build";
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function buildDraftReport(state: DraftState): DraftBoardReport {
  const totalPicks = state.teamCount * state.rounds;
  const complete = state.picks.length >= totalPicks;
  const currentRound = Math.min(
    state.rounds,
    Math.max(1, Math.ceil(state.picks.length / state.teamCount) || 1),
  );

  const metrics = Array.from({ length: state.teamCount }, (_, index) =>
    measureTeam(rosterPicks(state.picks, index + 1), currentRound, index + 1),
  );

  // Curve: blend each team's absolute quality with where it lands in the field
  // so a robot draft (nearly identical rosters) still spreads across grades
  // instead of everyone bunching on C.
  const sortedRaw = [...metrics]
    .map((team) => team.rawScore)
    .sort((a, b) => a - b);
  const denominator = Math.max(1, metrics.length - 1);

  const ranked = [...metrics]
    .sort((a, b) => b.rawScore - a.rawScore || a.slot - b.slot)
    .map((team, index) => {
      const percentile =
        metrics.length <= 1
          ? 1
          : sortedRaw.indexOf(team.rawScore) / denominator;
      const curved = clamp(
        team.rawScore * 0.45 + percentile * 0.55 - team.holeCurvePenalty,
      );
      const rank = index + 1;
      return {
        slot: team.slot,
        rank,
        grade: limitIncompleteGrade(letterGrade(curved), team.holes.length),
        score: Math.round(curved * 100) / 100,
        avgChenRank: team.avgChenRank,
        eliteCount: team.eliteCount,
        startersFilled: team.startersFilled,
        positionCounts: team.counts,
        holes: team.holes,
        strengths: team.strengths,
        reasons: buildReasons(team, rank, state.teamCount),
        steal: team.steal,
        reach: team.reach,
        byeAlert: team.byeAlert,
        summary: summarize(team),
        picks: team.picks,
      } satisfies TeamReportCard;
    });

  return { complete, totalPicks, teams: ranked };
}
