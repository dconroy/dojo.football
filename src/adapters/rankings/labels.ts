export type RankingSourceId =
  | "chen"
  | "fantasypros"
  | "sleeper"
  | "ffcalc"
  | "blend";

export function parseRankingSource(value?: string | null): RankingSourceId {
  if (
    value === "fantasypros" ||
    value === "sleeper" ||
    value === "ffcalc" ||
    value === "blend" ||
    value === "chen"
  ) return value;
  return "chen";
}

export function sourceFromBoard(
  source?: string | null,
): RankingSourceId {
  const text = source ?? "";
  if (/dojo blend|\bblend ·/i.test(text)) return "blend";
  if (/fantasypros|ecr/i.test(text)) return "fantasypros";
  if (/sleeper/i.test(text)) return "sleeper";
  if (/calculator|ffcalc|adp/i.test(text)) return "ffcalc";
  return "chen";
}

/** Auto-refresh is Chen-only. Other experts stay until the user switches. */
export function shouldAutoRefreshChen(
  source?: string | null,
  pickCount = 0,
): boolean {
  if (pickCount > 0) return false;
  if (!source || source === "Built-in mock data") return true;
  return sourceFromBoard(source) === "chen";
}
