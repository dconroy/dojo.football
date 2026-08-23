import type { TeamReportCard } from "./draft-report";

export interface DraftStoryFacts {
  readonly teamName: string;
  readonly slot: number;
  readonly grade: string;
  readonly rank: number;
  readonly field: number;
  readonly summary: string;
  readonly reasons: readonly string[];
  readonly steal: string | null;
  readonly reach: string | null;
  readonly bye: string | null;
  readonly picks: readonly string[];
}

export interface CachedDraftStory {
  readonly picks: number;
  readonly text: string;
  readonly share?: string;
}

export type DraftStoriesMap = Record<string, CachedDraftStory>;

const MAX_REASONS = 6;

/** Compact, already-graded facts so the model only writes prose. */
export function packDraftStoryFacts(
  team: TeamReportCard,
  teamName: string,
  fieldSize: number,
): DraftStoryFacts {
  return {
    teamName: teamName.trim() || `Slot ${team.slot}`,
    slot: team.slot,
    grade: team.grade,
    rank: team.rank,
    field: fieldSize,
    summary: team.summary,
    reasons: team.reasons.slice(0, MAX_REASONS).map((reason) => reason.text),
    steal: team.steal?.detail ?? null,
    reach: team.reach?.detail ?? null,
    bye: team.byeAlert,
    picks: team.picks.map(
      (pick) => `R${pick.round} ${pick.player.name} (${pick.player.position})`,
    ),
  };
}

/** ~15-line prompt body. Numbers come only from the report card. */
export function formatDraftStoryFacts(facts: DraftStoryFacts): string {
  const lines = [
    `Team: ${facts.teamName}`,
    `Slot: ${facts.slot}`,
    `Grade: ${facts.grade}`,
    `Rank: ${facts.rank} of ${facts.field}`,
    `Summary: ${facts.summary}`,
    `Reasons: ${facts.reasons.join(" | ")}`,
    `Steal: ${facts.steal ?? "none"}`,
    `Reach: ${facts.reach ?? "none"}`,
    `Bye: ${facts.bye ?? "none"}`,
    `Picks: ${facts.picks.join(", ")}`,
  ];
  return lines.join("\n");
}

export function parseDraftStories(raw: string | null | undefined): DraftStoriesMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: DraftStoriesMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const row = value as { picks?: unknown; text?: unknown };
      if (typeof row.picks !== "number" || typeof row.text !== "string") continue;
      if (!row.text.trim()) continue;
      const share = typeof row.share === "string" ? row.share.trim() : "";
      next[key] = {
        picks: row.picks,
        text: row.text.trim(),
        ...(share ? { share } : {}),
      };
    }
    return next;
  } catch {
    return {};
  }
}

export function cachedDraftStory(
  stories: DraftStoriesMap,
  slot: number,
  pickCount: number,
): CachedDraftStory | null {
  const row = stories[String(slot)];
  if (!row || row.picks !== pickCount) return null;
  return row;
}

export function withDraftStory(
  stories: DraftStoriesMap,
  slot: number,
  pickCount: number,
  text: string,
  share?: string,
): DraftStoriesMap {
  const trimmedShare = share?.trim();
  return {
    ...stories,
    [String(slot)]: {
      picks: pickCount,
      text: text.trim(),
      ...(trimmedShare ? { share: trimmedShare } : {}),
    },
  };
}

export const INVITE_STORY_KEY = "invite";

export function cachedInviteLine(stories: DraftStoriesMap): string | null {
  const row = stories[INVITE_STORY_KEY];
  return row?.text?.trim() || null;
}

export function fallbackShareLine(facts: DraftStoryFacts): string {
  return `I just drafted a ${facts.grade} roster (${facts.rank} of ${facts.field}) in Draft Dojo.`;
}
