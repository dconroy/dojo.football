import { prisma } from "@/persistence/prisma";
import type { ChenImport, ChenPlayerRecord, ChenScoring } from "@/adapters/chen/boris-chen";
import { CHEN_SCORING } from "@/adapters/chen/boris-chen";

const SCORING: Record<ChenScoring, string> = {
  "half-ppr": "HALF",
  ppr: "PPR",
  standard: "STD",
};

/** Current FantasyPros public API. The legacy `/v2/json` host rejects keys with 403. */
const FP_BASE = "https://api.fantasypros.com/public/v2/json";
const FP_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"] as const;
/** Premium keys are 500 req/day and 1/sec. One refresh is 6 calls. */
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const STALE_OK_MS = 7 * 24 * 60 * 60 * 1000;
const LOCK_MS = 2 * 60 * 1000;
const inflight = new Map<ChenScoring, Promise<ChenImport | null>>();
/** Draft-useful depth. 14×16 is 224 picks; keep a cushion without the full 1000. */
export const FP_POSITION_CAP: Readonly<Record<string, number>> = {
  QB: 40,
  RB: 100,
  WR: 120,
  TE: 40,
  K: 32,
  DST: 32,
  DEF: 32,
};

export interface FpPlayer {
  player_name?: string;
  player_team_id?: string;
  player_position_id?: string;
  rank_ecr?: number;
  pos_rank?: string;
  tier?: number;
}

/** Map per-position ECR onto a single overall board. Public v2 has no `position=ALL`. */
export function estimatedOverall(position: string, ecr: number): number {
  switch (position) {
    case "RB":
      return ecr * 1.55;
    case "WR":
      return ecr * 1.45;
    case "TE":
      return 8 + ecr * 4.2;
    case "QB":
      return 18 + ecr * 9;
    case "DEF":
      return 175 + ecr;
    case "K":
      return 190 + ecr;
    default:
      return 300 + ecr;
  }
}

export function capFantasyProsPage(
  rows: readonly FpPlayer[],
  position: string,
): FpPlayer[] {
  const cap = FP_POSITION_CAP[position] ?? 30;
  return rows.slice(0, cap);
}

export function mergeFantasyProsPlayers(
  rows: readonly FpPlayer[],
): ChenPlayerRecord[] {
  const mapped: ChenPlayerRecord[] = [];
  const positionCounts = new Map<string, number>();
  for (const row of rows) {
    const name = row.player_name?.trim();
    const rawPos = String(row.player_position_id ?? "").toUpperCase();
    const position = rawPos === "DST" || rawPos === "D/ST" ? "DEF" : rawPos;
    if (!name || !["QB", "RB", "WR", "TE", "K", "DEF"].includes(position)) continue;
    const pos = position as ChenPlayerRecord["position"];
    const nextRank = (positionCounts.get(pos) ?? 0) + 1;
    positionCounts.set(pos, nextRank);
    mapped.push({
      sourceId: `fp:${pos}:${name.toLowerCase()}`,
      name,
      position: pos,
      team: row.player_team_id?.toUpperCase(),
      tier: row.tier ?? Math.ceil((mapped.length + 1) / 12),
      positionRank: row.rank_ecr ?? nextRank,
      overallRank: 0,
      adp: row.rank_ecr,
    });
  }
  mapped.sort(
    (left, right) =>
      estimatedOverall(left.position, left.positionRank ?? 99) -
        estimatedOverall(right.position, right.positionRank ?? 99) ||
      left.name.localeCompare(right.name),
  );
  return mapped.map((player, index) => ({
    ...player,
    overallRank: index + 1,
    adp: index + 1,
  }));
}

function cacheSourceFor(scoring: ChenScoring) {
  return `fantasypros-board-${scoring}`;
}

function lockSourceFor(scoring: ChenScoring) {
  return `fantasypros-lock-${scoring}`;
}

async function readCachedImport(
  scoring: ChenScoring,
  maxAgeMs: number,
): Promise<ChenImport | null> {
  const cached = await prisma.dataImport.findFirst({
    where: { source: cacheSourceFor(scoring) },
    orderBy: { fetchedAt: "desc" },
  });
  if (!cached || Date.now() - cached.fetchedAt.getTime() >= maxAgeMs) {
    return null;
  }
  return JSON.parse(cached.payload) as ChenImport;
}

async function refreshFantasyPros(
  scoring: ChenScoring,
  key: string,
  stale: ChenImport | null,
): Promise<ChenImport | null> {
  const lock = await prisma.dataImport.findFirst({
    where: { source: lockSourceFor(scoring) },
    orderBy: { fetchedAt: "desc" },
  });
  if (lock && Date.now() - lock.fetchedAt.getTime() < LOCK_MS) {
    return stale ?? (await readCachedImport(scoring, STALE_OK_MS));
  }
  await prisma.dataImport
    .create({
      data: {
        source: lockSourceFor(scoring),
        playerCount: 0,
        payload: "{}",
      },
    })
    .catch(() => undefined);

  const year = new Date().getUTCFullYear();
  const scoringCode = SCORING[scoring];
  try {
    const pages: FpPlayer[][] = [];
    for (const [index, position] of FP_POSITIONS.entries()) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      const url = `${FP_BASE}/nfl/${year}/consensus-rankings?position=${position}&scoring=${scoringCode}`;
      const response = await fetch(url, {
        cache: "no-store",
        headers: { "x-api-key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "FantasyPros rejected this key. Confirm it is a premium/HOF key and FANTASYPROS_API_KEY is set, then retry",
        );
      }
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          error?.message
            ? `FantasyPros: ${error.message}`
            : `FantasyPros returned ${response.status}`,
        );
      }
      const body = (await response.json()) as { players?: FpPlayer[] };
      pages.push(capFantasyProsPage(body.players ?? [], position));
    }
    const players = mergeFantasyProsPlayers(pages.flat());
    if (players.length === 0) return stale;
    const imported: ChenImport = {
      players,
      importedAt: new Date().toISOString(),
      source: `FantasyPros ECR · ${CHEN_SCORING[scoring].label}`,
      warnings: [],
      scoring,
    };
    await prisma.dataImport
      .create({
        data: {
          source: cacheSourceFor(scoring),
          playerCount: players.length,
          payload: JSON.stringify(imported),
        },
      })
      .catch(() => undefined);
    return imported;
  } catch (error) {
    if (stale) return stale;
    throw error;
  }
}

export async function fetchFantasyProsImport(
  scoring: ChenScoring,
): Promise<ChenImport | null> {
  const key = process.env.FANTASYPROS_API_KEY?.trim();
  if (!key) return null;
  const pending = inflight.get(scoring);
  if (pending) return pending;
  const run = (async () => {
    const fresh = await readCachedImport(scoring, CACHE_MAX_AGE_MS);
    if (fresh) return fresh;
    const stale = await readCachedImport(scoring, STALE_OK_MS);
    return refreshFantasyPros(scoring, key, stale);
  })().finally(() => {
    inflight.delete(scoring);
  });
  inflight.set(scoring, run);
  return run;
}
