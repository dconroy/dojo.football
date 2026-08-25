import https from "node:https";
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
/** Premium keys are 500 req/day and 1/sec. Overall is 1 call; position fallback is 6. */
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const STALE_OK_MS = 7 * 24 * 60 * 60 * 1000;
const LOCK_MS = 2 * 60 * 1000;
const inflight = new Map<ChenScoring, Promise<ChenImport | null>>();
/** Draft-useful depth. 14×16 is 224 picks; keep a cushion without the full 1000. */
export const FP_OVERALL_CAP = 300;
export const FP_POSITION_CAP: Readonly<Record<string, number>> = {
  QB: 40,
  RB: 100,
  WR: 120,
  TE: 40,
  K: 32,
  DST: 32,
  DEF: 32,
};
/** HOF overall lists are hundreds deep; MVP/free keys return ~10. */
export const FP_MIN_OVERALL_PLAYERS = 40;

export interface FpPlayer {
  player_name?: string;
  player_team_id?: string;
  player_position_id?: string;
  player_bye_week?: string | number;
  rank_ecr?: number | string;
  pos_rank?: string;
  tier?: number;
}

export function mapFpPosition(raw: string): ChenPlayerRecord["position"] | null {
  const position = raw.toUpperCase();
  if (position === "DST" || position === "D/ST") return "DEF";
  if (position === "QB" || position === "RB" || position === "WR" || position === "TE") {
    return position;
  }
  if (position === "K" || position === "DEF") return position;
  return null;
}

export function parseFpPosRank(posRank: string | undefined, fallback: number): number {
  const match = String(posRank ?? "").match(/(\d+)/);
  if (!match) return fallback;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function parseFpBye(value: string | number | undefined): number | undefined {
  const week = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(week) && week >= 1 && week <= 18 ? week : undefined;
}

export function parseFpEcr(value: number | string | undefined): number | null {
  const ecr = typeof value === "number" ? value : Number(value);
  return Number.isFinite(ecr) && ecr > 0 ? ecr : null;
}

/**
 * Overall `position=ALL` has a single ECR 1. Concatenated position pages have
 * one ECR 1 per position. Public v2 rejects ALL; `/rankings` still exposes it
 * as `rank.ECR.{HALF|PPR|STD}.ALL`.
 */
export function looksLikeOverallBoard(rows: readonly FpPlayer[]): boolean {
  const ones = rows.filter((row) => parseFpEcr(row.rank_ecr) === 1).length;
  return rows.length > 0 && ones <= 1;
}

export interface FpRankingPlayer {
  player_name?: string;
  position_id?: string;
  team_id?: string;
  rank?: {
    ECR?: Record<string, Record<string, number | string>>;
  };
}

export function decodeFpName(value: string): string {
  let next = value;
  for (let pass = 0; pass < 3; pass += 1) {
    next = next
      .replace(/&amp;/g, "&")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
        String.fromCharCode(Number.parseInt(code, 16)),
      );
  }
  return next.replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export function rankingOverall(
  player: FpRankingPlayer,
  scoringCode: string,
): number | null {
  const block = player.rank?.ECR?.[scoringCode];
  return parseFpEcr(block?.ALL);
}

export function rankingPositionRank(
  player: FpRankingPlayer,
  scoringCode: string,
  position: string,
): number | null {
  const block = player.rank?.ECR?.[scoringCode];
  const key = position === "DEF" ? "DST" : position;
  return parseFpEcr(block?.[key]);
}

export function mergeFantasyProsRankings(
  rows: readonly FpRankingPlayer[],
  scoringCode: string,
): ChenPlayerRecord[] {
  const mapped = rows
    .map((row) => {
      const name = decodeFpName(row.player_name?.trim() ?? "");
      const pos = mapFpPosition(String(row.position_id ?? ""));
      const ecr = rankingOverall(row, scoringCode);
      if (!name || !pos || ecr == null) return null;
      return {
        name,
        pos,
        ecr,
        team: row.team_id?.toUpperCase(),
        positionRank: rankingPositionRank(row, scoringCode, pos),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        name: string;
        pos: ChenPlayerRecord["position"];
        ecr: number;
        team: string | undefined;
        positionRank: number | null;
      } => Boolean(entry),
    );
  mapped.sort(
    (left, right) => left.ecr - right.ecr || left.name.localeCompare(right.name),
  );
  const positionCounts = new Map<string, number>();
  return mapped.slice(0, FP_OVERALL_CAP).map((entry, index) => {
    const nextRank = (positionCounts.get(entry.pos) ?? 0) + 1;
    positionCounts.set(entry.pos, nextRank);
    const overallRank = index + 1;
    return {
      sourceId: `fp:${entry.pos}:${entry.name.toLowerCase()}`,
      name: entry.name,
      position: entry.pos,
      team: entry.team,
      tier: Math.ceil(overallRank / 12),
      positionRank: entry.positionRank ?? nextRank,
      overallRank,
    };
  });
}

function usableOverallBoard(players: readonly ChenPlayerRecord[]): boolean {
  if (players.length < FP_MIN_OVERALL_PLAYERS) return false;
  return new Set(players.map((player) => player.position)).size >= 3;
}

/** Fallback only: map per-position ECR onto a single board when ALL is unavailable. */
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
  const cap =
    position === "ALL" ? FP_OVERALL_CAP : (FP_POSITION_CAP[position] ?? 30);
  return rows.slice(0, cap);
}

function toRecord(
  row: FpPlayer,
  positionCounts: Map<string, number>,
): Omit<ChenPlayerRecord, "overallRank"> | null {
  const name = row.player_name?.trim();
  const pos = mapFpPosition(String(row.player_position_id ?? ""));
  if (!name || !pos) return null;
  const nextRank = (positionCounts.get(pos) ?? 0) + 1;
  positionCounts.set(pos, nextRank);
  return {
    sourceId: `fp:${pos}:${name.toLowerCase()}`,
    name,
    position: pos,
    team: row.player_team_id?.toUpperCase(),
    tier: row.tier ?? Math.ceil(nextRank / 12),
    positionRank: parseFpPosRank(row.pos_rank, nextRank),
    byeWeek: parseFpBye(row.player_bye_week),
  };
}

export function mergeFantasyProsOverall(
  rows: readonly FpPlayer[],
): ChenPlayerRecord[] {
  const positionCounts = new Map<string, number>();
  const mapped = rows
    .map((row) => {
      const record = toRecord(row, positionCounts);
      const ecr = parseFpEcr(row.rank_ecr);
      if (!record || ecr == null) return null;
      return { record, ecr };
    })
    .filter((entry): entry is { record: Omit<ChenPlayerRecord, "overallRank">; ecr: number } =>
      Boolean(entry),
    );
  mapped.sort(
    (left, right) => left.ecr - right.ecr || left.record.name.localeCompare(right.record.name),
  );
  return mapped.slice(0, FP_OVERALL_CAP).map((entry, index) => ({
    ...entry.record,
    overallRank: index + 1,
  }));
}

export function mergeFantasyProsPlayers(
  rows: readonly FpPlayer[],
): ChenPlayerRecord[] {
  if (looksLikeOverallBoard(rows)) return mergeFantasyProsOverall(rows);

  const mapped: ChenPlayerRecord[] = [];
  const positionCounts = new Map<string, number>();
  for (const row of rows) {
    const record = toRecord(row, positionCounts);
    if (!record) continue;
    const ecr = parseFpEcr(row.rank_ecr) ?? record.positionRank;
    mapped.push({
      ...record,
      overallRank: 0,
      positionRank: ecr,
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
  }));
}

function cacheSourceFor(scoring: ChenScoring) {
  return `fantasypros-overall-${scoring}`;
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

async function fetchFantasyProsJson(
  url: string,
  key: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        family: 4,
        headers: {
          "x-api-key": key,
          Accept: "application/json",
        },
        timeout: 15000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(chunk as Buffer);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = { message: text.slice(0, 180) };
          }
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("FantasyPros request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

function throwIfFantasyProsFailed(status: number, body: unknown): void {
  if (status === 401 || status === 403) {
    throw new Error(
      "FantasyPros rejected this key. Confirm it is a premium/HOF key and FANTASYPROS_API_KEY is set, then retry",
    );
  }
  if (status >= 400) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message ?? "")
        : "";
    throw new Error(
      message ? `FantasyPros: ${message}` : `FantasyPros returned ${status}`,
    );
  }
}

async function fetchConsensusPage(
  year: number,
  scoringCode: string,
  position: string,
  key: string,
): Promise<FpPlayer[]> {
  const url = `${FP_BASE}/nfl/${year}/consensus-rankings?position=${position}&scoring=${scoringCode}`;
  const { status, body } = await fetchFantasyProsJson(url, key);
  throwIfFantasyProsFailed(status, body);
  const players =
    body && typeof body === "object" && "players" in body
      ? ((body as { players?: FpPlayer[] }).players ?? [])
      : [];
  return capFantasyProsPage(players, position);
}

async function fetchOverallRankings(
  year: number,
  scoringCode: string,
  key: string,
): Promise<ChenPlayerRecord[]> {
  const url = `${FP_BASE}/nfl/${year}/rankings?scoring=${scoringCode}`;
  const { status, body } = await fetchFantasyProsJson(url, key);
  throwIfFantasyProsFailed(status, body);
  const players =
    body && typeof body === "object" && "players" in body
      ? ((body as { players?: FpRankingPlayer[] }).players ?? [])
      : [];
  return mergeFantasyProsRankings(players, scoringCode);
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
    let players: ChenPlayerRecord[] = [];
    let warnings: string[] = [];
    const ranked = await fetchOverallRankings(year, scoringCode, key).catch(
      () => [] as ChenPlayerRecord[],
    );
    if (usableOverallBoard(ranked)) {
      players = ranked;
    } else {
      const pages: FpPlayer[][] = [];
      for (const [index, position] of FP_POSITIONS.entries()) {
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1100));
        }
        pages.push(await fetchConsensusPage(year, scoringCode, position, key));
      }
      players = mergeFantasyProsPlayers(pages.flat());
      warnings = [
        "FantasyPros overall ECR was unavailable; stitched per-position ranks instead.",
      ];
    }
    if (players.length === 0) return stale;
    const imported: ChenImport = {
      players,
      importedAt: new Date().toISOString(),
      source: `FantasyPros ECR · ${CHEN_SCORING[scoring].label}`,
      warnings,
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
