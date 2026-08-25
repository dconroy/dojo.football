import { prisma } from "@/persistence/prisma";
import type { ChenImport, ChenPlayerRecord, ChenScoring } from "@/adapters/chen/boris-chen";
import { CHEN_SCORING } from "@/adapters/chen/boris-chen";

const FORMAT: Record<ChenScoring, string> = {
  "half-ppr": "half-ppr",
  ppr: "ppr",
  standard: "standard",
};

interface FfPlayer {
  name?: string;
  position?: string;
  team?: string;
  adp?: number;
  bye?: number;
}

export async function fetchFfCalculatorImport(
  scoring: ChenScoring,
): Promise<ChenImport | null> {
  const format = FORMAT[scoring];
  const cacheSource = `ffcalc-v2-${scoring}`;
  const year = new Date().getUTCFullYear();
  const url =
    `https://fantasyfootballcalculator.com/api/v1/adp/${format}` +
    `?position=all&teams=12&year=${year}`;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "application/json",
        "User-Agent": "Draft Dojo (https://dojo.football)",
      },
    });
    if (!response.ok) throw new Error(`FF Calculator returned ${response.status}`);
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("FF Calculator returned a non-JSON response");
    }
    const body = (await response.json()) as { players?: FfPlayer[] };
    const raw = body.players ?? [];
    const players: ChenPlayerRecord[] = [];
    const positionCounts = new Map<string, number>();
    for (const row of raw) {
      const name = row.name?.trim();
      const position = String(row.position ?? "").toUpperCase();
      if (!name || !["QB", "RB", "WR", "TE", "K", "DEF", "DST"].includes(position)) {
        continue;
      }
      const pos = position === "DST" ? "DEF" : (position as ChenPlayerRecord["position"]);
      const adp = typeof row.adp === "number" ? row.adp : players.length + 1;
      const nextRank = (positionCounts.get(pos) ?? 0) + 1;
      positionCounts.set(pos, nextRank);
      const overallRank = players.length + 1;
      players.push({
        sourceId: `ffcalc:${pos}:${name.toLowerCase()}`,
        name,
        position: pos,
        team: row.team?.toUpperCase(),
        tier: Math.ceil(overallRank / 12),
        positionRank: nextRank,
        overallRank,
        byeWeek: row.bye,
        adp,
      });
    }
    if (players.length === 0) return null;
    const imported: ChenImport = {
      players,
      importedAt: new Date().toISOString(),
      source: `FF Calculator ADP · ${CHEN_SCORING[scoring].label}`,
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
    const cached = await prisma.dataImport.findFirst({
      where: { source: cacheSource },
      orderBy: { fetchedAt: "desc" },
    });
    if (!cached) return null;
    return JSON.parse(cached.payload) as ChenImport;
  }
}
