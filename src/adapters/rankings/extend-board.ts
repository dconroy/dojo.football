import type {
  ChenImport,
  ChenPlayerRecord,
  ChenScoring,
} from "@/adapters/chen/boris-chen";
import { fetchFantasyProsImport } from "@/adapters/rankings/fantasypros";
import { fetchFfCalculatorImport } from "@/adapters/rankings/ffcalculator";
import { fetchSleeperAdpImport } from "@/adapters/rankings/sleeper-adp";
import { normalizePlayerName } from "@/domain/identity";

export function playerIdentityKey(player: {
  readonly name: string;
  readonly position: string;
}): string {
  return `${player.position}:${normalizePlayerName(player.name)}`;
}

export function mergeExtraRankedPlayers(
  base: readonly ChenPlayerRecord[],
  extras: readonly ChenPlayerRecord[],
): ChenPlayerRecord[] {
  const seen = new Set(base.map(playerIdentityKey));
  const maxRank = base.reduce(
    (max, player) => Math.max(max, player.overallRank),
    0,
  );
  const added: ChenPlayerRecord[] = [];
  for (const player of extras) {
    const key = playerIdentityKey(player);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({
      ...player,
      overallRank: maxRank + added.length + 1,
    });
  }
  return [...base, ...added];
}

export async function extendRankingImport(
  imported: ChenImport,
  scoring: ChenScoring,
  need: number,
): Promise<ChenImport> {
  if (imported.players.length >= need) return imported;
  let players = [...imported.players];
  const sources: string[] = [];
  const fetchers = [
    { label: "Sleeper ADP", fetch: fetchSleeperAdpImport },
    { label: "FantasyPros", fetch: fetchFantasyProsImport },
    { label: "FF Calculator", fetch: fetchFfCalculatorImport },
  ] as const;
  for (const extra of fetchers) {
    if (players.length >= need) break;
    const next = await extra.fetch(scoring).catch(() => null);
    if (!next?.players.length) continue;
    const merged = mergeExtraRankedPlayers(players, next.players);
    if (merged.length <= players.length) continue;
    sources.push(extra.label);
    players = merged;
  }
  if (sources.length === 0) return imported;
  return {
    ...imported,
    players,
    source: `${imported.source} + ${sources.join(" + ")}`,
    warnings: [
      ...imported.warnings,
      `Extended board to ${players.length} players (${sources.join(", ")}) to cover ${need} picks.`,
    ],
  };
}
