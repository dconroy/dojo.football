import { NextResponse } from "next/server";
import { AuthError, requireActiveUser } from "@/auth/current-user";
import { boardIdForUser } from "@/auth/board-access";
import { getValidYahooAccessToken } from "@/adapters/yahoo/oauth";
import { YahooApi } from "@/adapters/yahoo/yahoo-api";
import type { YahooFreeAgent, YahooRosterPlayer } from "@/adapters/yahoo/parsers";
import {
  fetchSleeperWeekly,
  resolveSleeperLeagueId,
} from "@/adapters/sleeper/weekly";
import {
  weeklyPlatformForUser,
  type WeeklyDataDto,
} from "@/adapters/weekly/types";
import { scoringFromSource, type ChenScoring } from "@/adapters/chen/boris-chen";
import {
  fetchChenImport,
  readCachedChenImport,
} from "@/adapters/chen/server-cache";
import { getOrCreateLeagueDraft, userPrefs } from "@/persistence/league-draft";
import {
  lineupSlotsFromYahoo,
  optimizeLineup,
  rankWaiverTargets,
  resolvePlayerIdentity,
  type LineupPlayer,
  type Player,
  type Position,
  type WaiverCandidate,
} from "@/domain";

export const runtime = "nodejs";

const CHEN_MAX_AGE_MS = 4 * 60 * 60 * 1_000;

async function chenPlayers(scoring: ChenScoring): Promise<{
  players: Player[];
  importedAt: string;
  source: string;
}> {
  let cached = await readCachedChenImport(scoring);
  const stale =
    !cached ||
    Number.isNaN(Date.parse(cached.importedAt)) ||
    Date.now() - Date.parse(cached.importedAt) > CHEN_MAX_AGE_MS;
  if (stale) {
    try {
      cached = await fetchChenImport(scoring);
    } catch {
      // Keep whatever cache we have; weekly view degrades to Yahoo-only data.
    }
  }
  if (!cached) return { players: [], importedAt: "never", source: "unavailable" };
  return {
    players: cached.players.map((player) => ({
      id: player.sourceId,
      name: player.name,
      position: player.position as Position,
      team: player.team ?? "FA",
      chenRank: player.overallRank,
      chenTier: player.tier,
      byeWeek: player.byeWeek,
      adp: player.adp,
    })),
    importedAt: cached.importedAt,
    source: cached.source,
  };
}

function chenMatch(name: string, team: string | undefined, pool: readonly Player[]) {
  const resolution = resolvePlayerIdentity(name, pool, { team });
  if (resolution.status === "resolved") return resolution.player;
  // Names collide across teams (or Yahoo/Chen disagree on team codes);
  // retry without the team hint before giving up.
  const loose = resolvePlayerIdentity(name, pool);
  return loose.status === "resolved" ? loose.player : null;
}

function toLineupPlayer(
  player: YahooRosterPlayer,
  pool: readonly Player[],
): LineupPlayer {
  const chen = chenMatch(player.name, player.team, pool);
  return {
    id: player.playerKey,
    name: player.name,
    position: player.position,
    team: player.team,
    selectedSlot: player.selectedPosition || "BN",
    chenRank: chen?.chenRank,
    chenTier: chen?.chenTier,
    byeWeek: player.byeWeek ?? chen?.byeWeek,
    status: player.status,
  };
}

function toWaiverCandidate(
  agent: YahooFreeAgent,
  pool: readonly Player[],
): WaiverCandidate {
  const chen = chenMatch(agent.name, agent.team, pool);
  return {
    id: agent.playerKey,
    name: agent.name,
    position: agent.position,
    team: agent.team,
    status: agent.status,
    byeWeek: agent.byeWeek,
    percentOwned: agent.percentOwned,
    chenRank: chen?.chenRank,
    chenTier: chen?.chenTier,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    const shared = await getOrCreateLeagueDraft(boardIdForUser(user));
    if (weeklyPlatformForUser(user) === "sleeper") {
      const userId = user.yahooGuid.startsWith("sleeper:")
        ? user.yahooGuid.slice("sleeper:".length)
        : null;
      if (!userId) {
        return NextResponse.json(
          {
            error: "no-league",
            message: "Reconnect your Sleeper account to load Weekly HQ.",
            platform: "sleeper",
          },
          { status: 409 },
        );
      }
      const leagueId = await resolveSleeperLeagueId({
        storedLeagueId: user.sleeperLeagueId,
        draftId: user.sleeperDraftId,
        userId,
      });
      if (!leagueId) {
        return NextResponse.json(
          {
            error: "no-league",
            message: "No Sleeper league is connected to this draft.",
            platform: "sleeper",
          },
          { status: 409 },
        );
      }
      const chen = await chenPlayers(scoringFromSource(shared.source));
      const sleeper = await fetchSleeperWeekly({
        leagueId,
        userId,
        chenPlayers: chen.players,
      });
      const lineup = optimizeLineup({
        players: sleeper.roster,
        slots: sleeper.slots,
        currentWeek: sleeper.league.currentWeek,
      });
      const waivers = rankWaiverTargets({
        freeAgents: sleeper.freeAgents,
        roster: sleeper.roster,
        slots: sleeper.slots,
        currentWeek: sleeper.league.currentWeek,
        hotAddNames: sleeper.hotAddNames,
        watchlist: userPrefs(user).waiverWatch,
        topCount: 50,
      });
      const data: WeeklyDataDto = {
        platform: "sleeper",
        league: sleeper.league,
        team: sleeper.team,
        roster: sleeper.roster,
        lineup,
        matchup: sleeper.matchup,
        standings: sleeper.standings,
        transactions: sleeper.transactions,
        waivers,
        hotAdds: sleeper.hotAdds,
        chen: { importedAt: chen.importedAt, source: chen.source },
        syncedAt: new Date().toISOString(),
      };
      return NextResponse.json(data);
    }

    const requested = new URL(request.url).searchParams.get("leagueKey");
    const stored =
      shared.leagueKey && !shared.leagueKey.startsWith("mock.")
        ? shared.leagueKey
        : null;
    const leagueKey = requested ?? stored ?? process.env.YAHOO_LEAGUE_KEY ?? null;
    if (!leagueKey || leagueKey.startsWith("mock.")) {
      return NextResponse.json(
        { error: "no-league", message: "No Yahoo league connected yet." },
        { status: 409 },
      );
    }

    const api = new YahooApi(await getValidYahooAccessToken(user));
    const [teams, meta, chen] = await Promise.all([
      api.getTeams(leagueKey),
      api.getLeagueMeta(leagueKey),
      chenPlayers(scoringFromSource(shared.source)),
    ]);
    const myTeam = teams.find((team) => team.isMine);
    if (!myTeam) {
      return NextResponse.json(
        {
          error: "no-team",
          message: `Your Yahoo account doesn't manage a team in ${meta.name || leagueKey}.`,
        },
        { status: 409 },
      );
    }

    const [roster, standings, scoreboard, transactions, freeAgents] =
      await Promise.all([
        api.getRoster(myTeam.teamKey),
        api.getStandings(leagueKey).catch(() => []),
        api.getScoreboard(leagueKey).catch(() => []),
        api.getTransactions(leagueKey, 25).catch(() => []),
        api.getFreeAgents(leagueKey, { count: 50 }).catch(() => []),
      ]);

    const lineupPlayers = roster.map((player) =>
      toLineupPlayer(player, chen.players),
    );
    const slots = lineupSlotsFromYahoo(meta.rosterSlots);
    const lineup = optimizeLineup({
      players: lineupPlayers,
      slots,
      currentWeek: meta.currentWeek,
    });

    // Players being added across the league right now — the competition.
    const addedPlayers = transactions.flatMap((transaction) =>
      transaction.players.filter((player) => player.moveType === "add"),
    );
    const hotAddNames = addedPlayers.map((player) => player.name);
    const hotAdds: Array<{
      name: string;
      position?: string;
      team?: string;
      destinationTeamName?: string;
    }> = [];
    const seenHotAdds = new Set<string>();
    for (const player of addedPlayers) {
      if (seenHotAdds.has(player.name)) continue;
      seenHotAdds.add(player.name);
      hotAdds.push({
        name: player.name,
        position: player.position,
        team: player.team,
        destinationTeamName: player.destinationTeamName,
      });
      if (hotAdds.length >= 8) break;
    }

    const waiverTargets = rankWaiverTargets({
      freeAgents: freeAgents.map((agent) =>
        toWaiverCandidate(agent, chen.players),
      ),
      roster: lineupPlayers,
      slots,
      currentWeek: meta.currentWeek,
      hotAddNames,
      watchlist: userPrefs(user).waiverWatch,
    });

    const matchup =
      scoreboard.find((entry) =>
        entry.teams.some((team) => team.teamKey === myTeam.teamKey),
      ) ?? null;

    const data: WeeklyDataDto = {
      platform: "yahoo",
      league: { leagueKey, name: meta.name, currentWeek: meta.currentWeek },
      team: { teamKey: myTeam.teamKey, name: myTeam.name },
      roster: lineupPlayers,
      lineup,
      matchup,
      standings,
      transactions,
      waivers: waiverTargets,
      hotAdds,
      chen: { importedAt: chen.importedAt, source: chen.source },
      syncedAt: new Date().toISOString(),
    };
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Weekly sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
