import type {
  ChenImport,
  ChenPlayerRecord,
  ChenScoring,
} from "@/adapters/chen/boris-chen";
import { CHEN_SCORING } from "@/adapters/chen/boris-chen";
import { fetchChenImport } from "@/adapters/chen/server-cache";
import { playerIdentityKey } from "@/adapters/rankings/extend-board";
import { fetchFantasyProsImport } from "@/adapters/rankings/fantasypros";
import { fetchFfCalculatorImport } from "@/adapters/rankings/ffcalculator";
import { fetchSleeperAdpImport } from "@/adapters/rankings/sleeper-adp";
import { prisma } from "@/persistence/prisma";

export type BlendSourceId = "chen" | "fantasypros" | "sleeper" | "ffcalc";

export const DEFAULT_BLEND_WEIGHTS: Record<BlendSourceId, number> = {
  chen: 0.35,
  fantasypros: 0.35,
  sleeper: 0.2,
  ffcalc: 0.1,
};

/** Added to blended percentile when a player is missing from some present lists. */
export const THIN_CONSENSUS_PENALTY = 0.08;

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const MAX_BLEND_PLAYERS = 300;
const SOURCE_ORDER: readonly BlendSourceId[] = [
  "chen",
  "fantasypros",
  "sleeper",
  "ffcalc",
];
const SOURCE_LABELS: Record<BlendSourceId, string> = {
  chen: "Chen",
  fantasypros: "FantasyPros",
  sleeper: "Sleeper",
  ffcalc: "FFCalc",
};

export function rankToPercentile(rank: number, listLength: number): number {
  if (listLength <= 1) return 0;
  const clamped = Math.min(Math.max(rank, 1), listLength);
  return (clamped - 1) / (listLength - 1);
}

export function renormalizeWeights(
  weights: Partial<Record<BlendSourceId, number>>,
  present: readonly BlendSourceId[],
): Record<BlendSourceId, number> {
  const result: Record<BlendSourceId, number> = {
    chen: 0,
    fantasypros: 0,
    sleeper: 0,
    ffcalc: 0,
  };
  if (present.length === 0) return result;
  const raw = present.map((id) => weights[id] ?? DEFAULT_BLEND_WEIGHTS[id]);
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    const even = 1 / present.length;
    for (const id of present) result[id] = even;
    return result;
  }
  present.forEach((id, index) => {
    result[id] = raw[index] / total;
  });
  return result;
}

export function thinConsensusPenalty(
  listedOn: number,
  availableSources: number,
  penalty = THIN_CONSENSUS_PENALTY,
): number {
  if (availableSources <= 1 || listedOn >= availableSources) return 0;
  if (listedOn <= 0) return penalty;
  return penalty * (1 - listedOn / availableSources);
}

function pickCanonical(
  appearances: Partial<Record<BlendSourceId, ChenPlayerRecord>>,
): ChenPlayerRecord {
  for (const id of SOURCE_ORDER) {
    const player = appearances[id];
    if (player) return player;
  }
  return Object.values(appearances)[0]!;
}

export function blendRankingImports(
  imports: Partial<Record<BlendSourceId, ChenImport | null | undefined>>,
  weights: Partial<Record<BlendSourceId, number>> = DEFAULT_BLEND_WEIGHTS,
): ChenImport | null {
  const present = SOURCE_ORDER.filter(
    (id) => (imports[id]?.players.length ?? 0) > 0,
  );
  if (present.length === 0) return null;

  const availableWeights = renormalizeWeights(weights, present);
  const byKey = new Map<
    string,
    Partial<Record<BlendSourceId, ChenPlayerRecord>>
  >();

  for (const id of present) {
    for (const player of imports[id]!.players) {
      const key = playerIdentityKey(player);
      const bucket = byKey.get(key) ?? {};
      if (!bucket[id]) bucket[id] = player;
      byKey.set(key, bucket);
    }
  }

  const scored = [...byKey.entries()].map(([key, appearances]) => {
    const listed = present.filter((id) => appearances[id]);
    const playerWeights = renormalizeWeights(availableWeights, listed);
    let score = 0;
    for (const id of listed) {
      const player = appearances[id]!;
      score +=
        playerWeights[id] *
        rankToPercentile(player.overallRank, imports[id]!.players.length);
    }
    score += thinConsensusPenalty(listed.length, present.length);
    return { key, appearances, score };
  });

  scored.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));

  const positionCounts = new Map<string, number>();

  const players: ChenPlayerRecord[] = scored
    .slice(0, MAX_BLEND_PLAYERS)
    .map((entry, index) => {
      const canonical = pickCanonical(entry.appearances);
      const positionRank = (positionCounts.get(canonical.position) ?? 0) + 1;
      positionCounts.set(canonical.position, positionRank);

      return {
        sourceId: canonical.sourceId,
        name: canonical.name,
        position: canonical.position,
        team: canonical.team,
        tier: Math.ceil((index + 1) / 12),
        positionRank,
        overallRank: index + 1,
        byeWeek: canonical.byeWeek,
        adp: entry.appearances.sleeper?.adp ?? entry.appearances.ffcalc?.adp,
      };
    });

  const scoring =
    present.map((id) => imports[id]!.scoring).find(Boolean) ?? undefined;
  const scoringLabel = scoring ? CHEN_SCORING[scoring].label : undefined;
  const landed = present.map((id) => SOURCE_LABELS[id]);

  return {
    players,
    importedAt: new Date().toISOString(),
    source: scoringLabel
      ? `Dojo blend · ${landed.join(" + ")} · ${scoringLabel}`
      : `Dojo blend · ${landed.join(" + ")}`,
    warnings: [],
    scoring,
  };
}

export async function fetchBlendImport(
  scoring: ChenScoring,
): Promise<ChenImport | null> {
  const cacheSource = `dojo-blend-v3-${scoring}`;
  const cached = await prisma.dataImport.findFirst({
    where: { source: cacheSource },
    orderBy: { fetchedAt: "desc" },
  });
  if (cached && Date.now() - cached.fetchedAt.getTime() < MAX_AGE_MS) {
    return JSON.parse(cached.payload) as ChenImport;
  }

  const [chen, fantasypros, sleeper, ffcalc] = await Promise.all([
    fetchChenImport(scoring).catch(() => null),
    fetchFantasyProsImport(scoring).catch(() => null),
    fetchSleeperAdpImport(scoring).catch(() => null),
    fetchFfCalculatorImport(scoring).catch(() => null),
  ]);

  const blended = blendRankingImports({
    chen,
    fantasypros,
    sleeper,
    ffcalc,
  });
  if (!blended) {
    return cached ? (JSON.parse(cached.payload) as ChenImport) : null;
  }

  const imported: ChenImport = { ...blended, scoring };
  await prisma.dataImport
    .create({
      data: {
        source: cacheSource,
        playerCount: imported.players.length,
        payload: JSON.stringify(imported),
      },
    })
    .catch(() => undefined);
  return imported;
}
