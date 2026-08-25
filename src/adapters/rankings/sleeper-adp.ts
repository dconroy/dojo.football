import { prisma } from "@/persistence/prisma";
import type {
  ChenImport,
  ChenPlayerRecord,
  ChenScoring,
} from "@/adapters/chen/boris-chen";
import { CHEN_SCORING } from "@/adapters/chen/boris-chen";

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_DRAFTABLE_ADP = 300;
const MAX_DRAFTABLE_PLAYERS = 300;

const ADP_FIELD: Record<ChenScoring, string> = {
  "half-ppr": "adp_half_ppr",
  ppr: "adp_ppr",
  standard: "adp_std",
};

interface SleeperProjection {
  player_id?: string;
  player?: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
  };
  stats?: Record<string, number | undefined>;
}

function tierFor(adp: number, previousAdp: number | null, previousTier: number) {
  if (previousAdp === null) return 1;
  return adp - previousAdp >= 8 ? previousTier + 1 : previousTier;
}

export async function fetchSleeperAdpImport(
  scoring: ChenScoring,
): Promise<ChenImport | null> {
  const cacheSource = `sleeper-adp-v2-${scoring}`;
  const cached = await prisma.dataImport.findFirst({
    where: { source: cacheSource },
    orderBy: { fetchedAt: "desc" },
  });
  if (cached && Date.now() - cached.fetchedAt.getTime() < MAX_AGE_MS) {
    return JSON.parse(cached.payload) as ChenImport;
  }

  try {
    const year = new Date().getUTCFullYear();
    const field = ADP_FIELD[scoring];
    const response = await fetch(
      `https://api.sleeper.app/projections/nfl/${year}?season_type=regular&order_by=${field}`,
      { cache: "no-store", signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) throw new Error(`Sleeper returned ${response.status}`);
    const rows = (await response.json()) as SleeperProjection[];
    const ranked = rows
      .map((row) => {
        const position = row.player?.position?.toUpperCase();
        const adp = row.stats?.[field];
        const name = [row.player?.first_name, row.player?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        return { row, position, adp, name };
      })
      .filter(
        (entry): entry is typeof entry & {
          position: ChenPlayerRecord["position"];
          adp: number;
        } =>
          Boolean(entry.name) &&
          Boolean(entry.row.player?.team) &&
          ["QB", "RB", "WR", "TE", "K", "DEF"].includes(entry.position ?? "") &&
          typeof entry.adp === "number" &&
          Number.isFinite(entry.adp) &&
          entry.adp > 0 &&
          entry.adp <= MAX_DRAFTABLE_ADP,
      )
      .sort((a, b) => a.adp - b.adp)
      .slice(0, MAX_DRAFTABLE_PLAYERS);

    let previousAdp: number | null = null;
    let tier = 1;
    const positionCounts = new Map<string, number>();
    const players: ChenPlayerRecord[] = ranked.map((entry, index) => {
      tier = tierFor(entry.adp, previousAdp, tier);
      previousAdp = entry.adp;
      const positionRank = (positionCounts.get(entry.position) ?? 0) + 1;
      positionCounts.set(entry.position, positionRank);
      return {
        sourceId: `sleeper-adp:${entry.row.player_id ?? entry.position}:${entry.name.toLowerCase()}`,
        name: entry.name,
        position: entry.position,
        team: entry.row.player?.team?.toUpperCase(),
        tier,
        positionRank,
        overallRank: index + 1,
        adp: entry.adp,
      };
    });
    if (players.length === 0) return cached
      ? (JSON.parse(cached.payload) as ChenImport)
      : null;

    const imported: ChenImport = {
      players,
      importedAt: new Date().toISOString(),
      source: `Sleeper ADP · ${CHEN_SCORING[scoring].label}`,
      warnings: [],
      scoring,
    };
    await prisma.dataImport
      .create({
        data: {
          source: cacheSource,
          playerCount: players.length,
          payload: JSON.stringify(imported),
        },
      })
      .catch(() => undefined);
    return imported;
  } catch {
    return cached ? (JSON.parse(cached.payload) as ChenImport) : null;
  }
}
