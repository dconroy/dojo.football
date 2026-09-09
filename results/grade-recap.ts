import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  appendChenSpecialists,
  parseChenCsv,
} from "../src/adapters/chen/boris-chen.ts";
import { playersFromChenImport } from "../src/domain/chen-players.ts";
import { createDraftState, makeManualPick } from "../src/domain/draft.ts";
import { buildDraftReport } from "../src/domain/draft-report.ts";
import { packDraftStoryFacts } from "../src/domain/draft-story.ts";
import {
  placeholderYahooPlayer,
  resolveYahooPick,
  type ParsedYahooPick,
} from "../src/domain/yahoo-paste.ts";
import type { Player, Position } from "../src/domain/types.ts";

const ROOT = process.cwd();
const CHEN_ALL =
  "https://s3-us-west-1.amazonaws.com/fftiers/out/weekly-ALL-HALF-PPR.csv";
const CHEN_K = "https://s3-us-west-1.amazonaws.com/fftiers/out/weekly-K.csv";

function decode(value: string): string {
  return value
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/‘|’/g, "'")
    .replace(/“|”/g, '"')
    .trim();
}

interface YahooRow {
  readonly overall: number;
  readonly round: number;
  readonly pickInRound: number;
  readonly name: string;
  readonly team: string;
  readonly position: Position;
  readonly fantasyTeam: string;
}

function parseYahooResults(html: string): YahooRow[] {
  const tables = html.split(/<th colspan="3" class="Fw-b">Round /i);
  const rows: YahooRow[] = [];
  let overall = 0;

  for (const table of tables.slice(1)) {
    const roundMatch = table.match(/^(\d+)/);
    if (!roundMatch) continue;
    const round = Number(roundMatch[1]);
    const pickRe =
      /<td class="first">(\d+)\.<\/td>\s*<td class="player[^"]*">[\s\S]*?class="name">([^<]+)<\/a>\s*<span class="Block">\(([^)]+)\)<\/span>[\s\S]*?<td class="last[^"]*" title="([^"]+)">/g;
    let match: RegExpExecArray | null;
    while ((match = pickRe.exec(table))) {
      const pickInRound = Number(match[1]);
      const name = decode(match[2]);
      const meta = decode(match[3]);
      const fantasyTeam = decode(match[4]);
      const metaParts = meta.split(/\s*-\s*/);
      const team = metaParts[0]?.trim() ?? "";
      const rawPos = metaParts[1]?.trim().toUpperCase() ?? "";
      const position = (
        rawPos === "DEF" || rawPos === "D/ST" || rawPos === "DST"
          ? "DEF"
          : rawPos
      ) as Position;
      overall += 1;
      rows.push({
        overall,
        round,
        pickInRound,
        name,
        team,
        position,
        fantasyTeam,
      });
    }
  }

  return rows;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed ${url}: ${response.status}`);
  return response.text();
}

function parsedPick(row: YahooRow): ParsedYahooPick {
  return {
    raw: `${row.overall}. ${row.name} (${row.team} - ${row.position})`,
    overall: row.overall,
    name: row.name,
    team: row.team,
    position: row.position,
  };
}

function resolveRow(row: YahooRow, pool: readonly Player[]): Player {
  const parsed = parsedPick(row);
  const resolution = resolveYahooPick(parsed, pool);
  if (resolution.status === "resolved") return resolution.player;
  const placeholder = placeholderYahooPlayer(parsed);
  if (placeholder) return placeholder;
  throw new Error(`Could not resolve ${row.name} (${row.position})`);
}

async function main() {
  const html = readFileSync(resolve(ROOT, "results/results.html"), "utf8");
  const yahooRows = parseYahooResults(html);
  if (yahooRows.length === 0) {
    throw new Error("No Yahoo picks parsed");
  }

  const slotOrder: string[] = [];
  for (const row of yahooRows.filter((entry) => entry.round === 1)) {
    if (!slotOrder.includes(row.fantasyTeam)) slotOrder.push(row.fantasyTeam);
  }

  const [allCsv, kCsv] = await Promise.all([
    fetchText(CHEN_ALL),
    fetchText(CHEN_K),
  ]);
  const imported = appendChenSpecialists(
    parseChenCsv(allCsv, "Boris Chen · 0.5 PPR"),
    parseChenCsv(kCsv, "Boris Chen · K"),
  );
  const pool = playersFromChenImport(imported);

  const unmatched: Array<{
    overall: number;
    name: string;
    position: string;
  }> = [];
  const players: Player[] = [];
  for (const row of yahooRows) {
    const player = resolveRow(row, pool);
    if (!player.chenRank) {
      unmatched.push({
        overall: row.overall,
        name: row.name,
        position: row.position,
      });
    }
    players.push(player);
  }

  const teamCount = slotOrder.length;
  const rounds = Math.ceil(yahooRows.length / teamCount);
  let draft = createDraftState(1, { teamCount, rounds });
  for (const player of players) {
    draft = makeManualPick(draft, player);
  }

  const report = buildDraftReport(draft);
  const teams = report.teams.map((team) => {
    const name = slotOrder[team.slot - 1] ?? `Slot ${team.slot}`;
    return {
      ...team,
      teamName: name,
      facts: packDraftStoryFacts(team, name, report.teams.length),
      roster: team.picks.map((pick) => ({
        overall: pick.overall,
        round: pick.round,
        slot: pick.slot,
        name: pick.player.name,
        position: pick.player.position,
        team: pick.player.team,
        chenRank: pick.player.chenRank ?? null,
        chenTier: pick.player.chenTier ?? null,
      })),
    };
  });

  const payload = {
    league: "Full Contact Fantasy Football",
    leagueId: "68609",
    scoring: "0.5 PPR",
    source: imported.source,
    importedAt: imported.importedAt,
    teamCount,
    rounds,
    totalPicks: yahooRows.length,
    complete: report.complete,
    unmatched,
    slotOrder,
    teams,
  };

  writeFileSync(
    resolve(ROOT, "results/graded.json"),
    JSON.stringify(payload, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        picks: yahooRows.length,
        teams: teamCount,
        rounds,
        complete: report.complete,
        unmatched: unmatched.length,
        board: teams.map((team) => ({
          rank: team.rank,
          grade: team.grade,
          slot: team.slot,
          team: team.teamName,
          summary: team.summary,
          avgChen: team.avgChenRank,
          elite: team.eliteCount,
          steal: team.steal?.name ?? null,
          reach: team.reach?.name ?? null,
          holes: team.holes,
        })),
        unmatchedNames: unmatched.slice(0, 40),
      },
      null,
      2,
    ),
  );
}

void main();
