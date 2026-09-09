import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizePlayerName, normalizeTeam } from "../src/domain/identity.ts";

const ROOT = process.cwd();
const PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const STATS_URL = (year: number) =>
  `https://api.sleeper.app/v1/stats/nfl/regular/${year}`;
const YEARS = [2025, 2024] as const;

interface StatChip {
  readonly label: string;
  readonly value: string;
}

interface SeasonRow {
  readonly year: number;
  readonly stats: readonly StatChip[];
}

interface SleeperRecord {
  readonly name: string;
  readonly position: string;
  readonly team: string | null;
  readonly sleeperId: string;
}

type RawStats = Record<string, number | undefined>;

function num(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function chipsForPosition(position: string, raw: RawStats | undefined): StatChip[] {
  if (!raw) return [];
  const gp = num(raw.gp);
  switch (position.toUpperCase()) {
    case "QB":
      return [
        { label: "GP", value: gp },
        { label: "Pass yd", value: num(raw.pass_yd) },
        { label: "Pass TD", value: num(raw.pass_td) },
        { label: "INT", value: num(raw.pass_int ?? raw.int) },
        { label: "Rush yd", value: num(raw.rush_yd) },
        { label: "PPR", value: num(raw.pts_ppr) },
      ];
    case "RB":
      return [
        { label: "GP", value: gp },
        { label: "Rush yd", value: num(raw.rush_yd) },
        { label: "Rush TD", value: num(raw.rush_td) },
        { label: "Rec", value: num(raw.rec) },
        { label: "Rec yd", value: num(raw.rec_yd) },
        { label: "PPR", value: num(raw.pts_ppr) },
      ];
    case "K":
      return [
        { label: "GP", value: gp },
        { label: "FGM", value: num(raw.fgm) },
        { label: "XPM", value: num(raw.xpm) },
        { label: "Pts", value: num(raw.pts_std ?? raw.pts_ppr) },
      ];
    case "DEF":
      return [
        { label: "GP", value: gp },
        { label: "Sacks", value: num(raw.sack) },
        { label: "INT", value: num(raw.int) },
        { label: "FR", value: num(raw.fum_rec) },
        { label: "TD", value: num(raw.td) },
        { label: "Pts", value: num(raw.pts_std ?? raw.pts_ppr) },
      ];
    default:
      return [
        { label: "GP", value: gp },
        { label: "Rec", value: num(raw.rec) },
        { label: "Rec yd", value: num(raw.rec_yd) },
        { label: "Rec TD", value: num(raw.rec_td) },
        { label: "Rush yd", value: num(raw.rush_yd) },
        { label: "PPR", value: num(raw.pts_ppr) },
      ];
  }
}

function headshotUrl(record: SleeperRecord): string {
  if (record.position === "DEF") {
    const abbr = normalizeTeam(record.team ?? record.name) ?? record.team;
    return abbr
      ? `https://sleepercdn.com/images/team_logos/nfl/${abbr.toLowerCase()}.png`
      : "";
  }
  return `https://sleepercdn.com/content/nfl/players/${record.sleeperId}.jpg`;
}

function lastName(name: string): string {
  const tokens = normalizePlayerName(name).split(" ").filter(Boolean);
  return tokens.at(-1) ?? "";
}

function matchRecord(
  name: string,
  position: string,
  records: readonly SleeperRecord[],
): SleeperRecord | null {
  const pos = position.toUpperCase();
  const pool = records.filter((record) => record.position === pos);
  if (pos === "DEF") {
    const abbr = normalizeTeam(name);
    if (abbr) {
      const hit = pool.find(
        (record) =>
          record.team === abbr || normalizeTeam(record.name) === abbr,
      );
      if (hit) return hit;
    }
  }

  const query = normalizePlayerName(name);
  const exact = pool.find((record) => normalizePlayerName(record.name) === query);
  if (exact) return exact;

  const tokens = query.split(" ");
  if (tokens.length > 1 && tokens[0].length === 1) {
    const surname = tokens.slice(1).join(" ");
    const initialHits = pool.filter((record) => {
      const parts = normalizePlayerName(record.name).split(" ");
      return parts[0]?.startsWith(tokens[0]) && parts.at(-1) === surname;
    });
    if (initialHits.length === 1) return initialHits[0];
  }

  const surname = lastName(name);
  if (surname.length >= 4) {
    const surnameHits = pool.filter((record) => lastName(record.name) === surname);
    if (surnameHits.length === 1) return surnameHits[0];
    const anyHits = records.filter((record) => lastName(record.name) === surname);
    if (anyHits.length === 1) return anyHits[0];
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return (await response.json()) as T;
}

async function main() {
  const graded = JSON.parse(
    readFileSync(resolve(ROOT, "results/graded.json"), "utf8"),
  ) as {
    league: string;
    scoring: string;
    source: string;
    teamCount: number;
    rounds: number;
    totalPicks: number;
    teams: Array<{
      slot: number;
      rank: number;
      grade: string;
      score: number;
      avgChenRank: number | null;
      eliteCount: number;
      positionCounts: Record<string, number>;
      reasons: Array<{ tone: string; text: string }>;
      steal: { name: string; detail: string } | null;
      reach: { name: string; detail: string } | null;
      summary: string;
      teamName: string;
      roster: Array<{
        overall: number;
        round: number;
        slot: number;
        name: string;
        position: string;
        team: string;
        chenRank: number | null;
        chenTier: number | null;
      }>;
    }>;
  };
  const copy = JSON.parse(
    readFileSync(resolve(ROOT, "results/recap-copy.json"), "utf8"),
  ) as {
    leagueHeadline: string;
    leagueDek: string;
    teams: Array<{ teamName: string; headline: string; story: string }>;
  };
  const copyByName = new Map(copy.teams.map((row) => [row.teamName, row]));

  const rawPlayers = await fetchJson<Record<string, Record<string, unknown>>>(
    PLAYERS_URL,
  );
  const records: SleeperRecord[] = [];
  for (const [id, player] of Object.entries(rawPlayers)) {
    const position = String(player.position ?? "").toUpperCase();
    if (!["QB", "RB", "WR", "TE", "K", "DEF"].includes(position)) continue;
    const name =
      (player.full_name as string | undefined) ??
      [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
    if (!name) continue;
    records.push({
      name,
      position,
      team: (player.team as string | undefined)?.toUpperCase() ?? null,
      sleeperId: id,
    });
  }

  const seasonMaps = await Promise.all(
    YEARS.map((year) => fetchJson<Record<string, RawStats>>(STATS_URL(year))),
  );

  const unmatched: string[] = [];
  const teams = graded.teams.map((team) => {
    const row = copyByName.get(team.teamName);
    return {
      slot: team.slot,
      rank: team.rank,
      grade: team.grade,
      score: team.score,
      avgChenRank: team.avgChenRank,
      eliteCount: team.eliteCount,
      positionCounts: team.positionCounts,
      reasons: team.reasons,
      steal: team.steal,
      reach: team.reach,
      summary: team.summary,
      teamName: team.teamName,
      headline: row?.headline ?? team.summary,
      story: row?.story ?? "",
      house: team.teamName === "Cobra Kai",
      roster: team.roster.map((pick) => {
        const record = matchRecord(pick.name, pick.position, records);
        if (!record) unmatched.push(`${pick.overall}. ${pick.name} ${pick.position}`);
        const seasons: SeasonRow[] = YEARS.map((year, index) => ({
          year,
          stats: chipsForPosition(
            pick.position,
            record ? seasonMaps[index]?.[record.sleeperId] : undefined,
          ),
        })).filter((season) => season.stats.some((chip) => chip.value !== "—"));
        return {
          ...pick,
          nflTeam: record?.team ?? (pick.team === "FA" ? null : pick.team),
          imageUrl: record ? headshotUrl(record) : null,
          seasons,
        };
      }),
    };
  });

  const payload = {
    league: graded.league,
    scoring: graded.scoring,
    source: graded.source,
    teamCount: graded.teamCount,
    rounds: graded.rounds,
    totalPicks: graded.totalPicks,
    headline: copy.leagueHeadline,
    dek: copy.leagueDek,
    teams,
  };

  writeFileSync(
    resolve(ROOT, "src/app/recap/recap-data.json"),
    JSON.stringify(payload),
  );
  console.log(
    JSON.stringify(
      {
        players: records.length,
        unmatched: unmatched.length,
        unmatchedNames: unmatched,
        out: "src/app/recap/recap-data.json",
      },
      null,
      2,
    ),
  );
}

void main();
