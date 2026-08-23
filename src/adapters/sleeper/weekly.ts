import { getSleeperRecords, type SleeperRecord } from "@/adapters/sleeper/players";
import { byeWeekForTeam } from "@/config/nfl-byes";
import type { LineupPlayer, LineupSlots } from "@/domain/lineup";
import type { WaiverCandidate } from "@/domain/waivers";
import { resolvePlayerIdentity, type Player } from "@/domain";
import type {
  WeeklyHotAddDto,
  WeeklyMatchupDto,
  WeeklyStandingDto,
  WeeklyTransactionDto,
} from "@/adapters/weekly/types";

const ROOT = "https://api.sleeper.app/v1";
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

interface SleeperLeague {
  league_id: string;
  name?: string;
  season?: string;
  status?: string;
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
  settings?: Record<string, number>;
}

interface SleeperNflState {
  week?: number;
}

interface SleeperUser {
  user_id: string;
  username?: string;
  display_name?: string;
  metadata?: { team_name?: string };
}

interface SleeperRoster {
  roster_id: number;
  owner_id?: string | null;
  players?: string[] | null;
  starters?: string[] | null;
  reserve?: string[] | null;
  settings?: Record<string, number>;
}

interface SleeperMatchup {
  roster_id: number;
  matchup_id?: number | null;
  points?: number;
  custom_points?: number | null;
}

interface SleeperTransaction {
  transaction_id: string;
  type?: string;
  status?: string;
  created?: number;
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
}

interface SleeperTrendingPlayer {
  player_id: string;
  count?: number;
}

export interface SleeperWeeklySnapshot {
  readonly league: {
    readonly leagueKey: string;
    readonly name: string;
    readonly currentWeek: number;
    readonly scoring: "standard" | "half-ppr" | "ppr";
  };
  readonly team: { readonly teamKey: string; readonly name: string };
  readonly roster: readonly LineupPlayer[];
  readonly slots: LineupSlots;
  readonly matchup: WeeklyMatchupDto | null;
  readonly standings: readonly WeeklyStandingDto[];
  readonly transactions: readonly WeeklyTransactionDto[];
  readonly freeAgents: readonly WaiverCandidate[];
  readonly hotAdds: readonly WeeklyHotAddDto[];
  readonly hotAddNames: readonly string[];
}

async function requiredJson<T>(path: string, message: string): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(message);
  return (await response.json()) as T;
}

async function optionalJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return await requiredJson<T>(path, "");
  } catch {
    return fallback;
  }
}

export function sleeperScoring(
  settings: Readonly<Record<string, number>> | undefined,
): "standard" | "half-ppr" | "ppr" {
  const reception = Number(settings?.rec ?? 0);
  if (reception >= 0.75) return "ppr";
  if (reception >= 0.25) return "half-ppr";
  return "standard";
}

function normalizeSlot(slot: string): string {
  switch (slot.toUpperCase()) {
    case "FLEX":
    case "WRRB_FLEX":
    case "REC_FLEX":
    case "SUPER_FLEX":
      return "FLEX";
    case "BN":
    case "BENCH":
    case "TAXI":
      return "BN";
    default:
      return slot.toUpperCase();
  }
}

export function lineupSlotsFromSleeper(
  rosterPositions: readonly string[] | undefined,
): LineupSlots {
  const counts: {
    -readonly [Key in keyof LineupSlots]: number;
  } = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
  for (const raw of rosterPositions ?? []) {
    const slot = normalizeSlot(raw);
    if (slot in counts) counts[slot as keyof LineupSlots] += 1;
  }
  return counts;
}

export function normalizeSleeperInjury(status?: string): string | undefined {
  const value = status?.trim().toUpperCase().replaceAll("_", " ");
  if (!value || value === "ACTIVE" || value === "HEALTHY") return undefined;
  if (value === "QUESTIONABLE") return "Q";
  if (value === "DOUBTFUL") return "D";
  if (value === "OUT") return "O";
  if (value.includes("INJURED RESERVE") || value === "IR") return "IR";
  if (value.includes("PUP")) return "PUP";
  if (value.includes("SUSP")) return "SUSP";
  if (value === "NA" || value.includes("INACTIVE")) return "NA";
  return status?.toUpperCase();
}

function rosterName(
  roster: SleeperRoster,
  usersById: ReadonlyMap<string, SleeperUser>,
): string {
  const user = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
  return (
    user?.metadata?.team_name?.trim() ||
    user?.display_name?.trim() ||
    user?.username?.trim() ||
    `Team ${roster.roster_id}`
  );
}

function pointsFor(settings: Readonly<Record<string, number>> | undefined): number {
  return Number(settings?.fpts ?? 0) + Number(settings?.fpts_decimal ?? 0) / 100;
}

function toPlayer(
  record: SleeperRecord,
  selectedSlot: string,
  chenPlayers: readonly Player[],
): LineupPlayer {
  const resolved = resolvePlayerIdentity(record.name, chenPlayers, {
    team: record.team ?? undefined,
  });
  const chen =
    resolved.status === "resolved"
      ? resolved.player
      : resolvePlayerIdentity(record.name, chenPlayers);
  const ranked = "player" in chen ? chen.player : undefined;
  return {
    id: record.sleeperId,
    name: record.name,
    position: record.position,
    team: record.team ?? "FA",
    selectedSlot,
    status: normalizeSleeperInjury(record.injuryStatus),
    byeWeek: byeWeekForTeam(record.team),
    chenRank: ranked?.chenRank,
    chenTier: ranked?.chenTier,
  };
}

export async function resolveSleeperLeagueId(input: {
  readonly storedLeagueId?: string | null;
  readonly draftId?: string | null;
  readonly userId: string;
}): Promise<string | null> {
  if (input.storedLeagueId) return input.storedLeagueId;
  if (input.draftId) {
    const draft = await optionalJson<{ league_id?: string | null }>(
      `/draft/${encodeURIComponent(input.draftId)}`,
      {},
    );
    if (draft.league_id) return draft.league_id;
  }
  const season = String(new Date().getUTCFullYear());
  const leagues = await optionalJson<SleeperLeague[]>(
    `/user/${encodeURIComponent(input.userId)}/leagues/nfl/${season}`,
    [],
  );
  return leagues.find((league) => league.status !== "complete")?.league_id ??
    leagues[0]?.league_id ??
    null;
}

export async function fetchSleeperWeekly(input: {
  readonly leagueId: string;
  readonly userId: string;
  readonly chenPlayers?: readonly Player[];
}): Promise<SleeperWeeklySnapshot> {
  const leagueId = encodeURIComponent(input.leagueId);
  const [league, nflState] = await Promise.all([
    requiredJson<SleeperLeague>(
      `/league/${leagueId}`,
      "Sleeper league not found",
    ),
    optionalJson<SleeperNflState>("/state/nfl", {}),
  ]);
  const currentWeek = Math.max(
    1,
    Number(
      nflState.week ??
        league.settings?.leg ??
        league.settings?.last_scored_leg ??
        1,
    ),
  );
  const [users, rosters, matchups, transactions, trending, records] =
    await Promise.all([
      requiredJson<SleeperUser[]>(
        `/league/${leagueId}/users`,
        "Unable to read Sleeper league users",
      ),
      requiredJson<SleeperRoster[]>(
        `/league/${leagueId}/rosters`,
        "Unable to read Sleeper rosters",
      ),
      optionalJson<SleeperMatchup[]>(
        `/league/${leagueId}/matchups/${currentWeek}`,
        [],
      ),
      optionalJson<SleeperTransaction[]>(
        `/league/${leagueId}/transactions/${currentWeek}`,
        [],
      ),
      optionalJson<SleeperTrendingPlayer[]>(
        "/players/nfl/trending/add?lookback_hours=24&limit=50",
        [],
      ),
      getSleeperRecords(),
    ]);
  if (!records) throw new Error("Sleeper player cache is unavailable");

  const myRoster = rosters.find((roster) => roster.owner_id === input.userId);
  if (!myRoster) {
    throw new Error("Your Sleeper account does not manage a roster in this league");
  }

  const usersById = new Map(users.map((user) => [user.user_id, user]));
  const rostersById = new Map(rosters.map((roster) => [roster.roster_id, roster]));
  const recordsById = new Map(records.map((record) => [record.sleeperId, record]));
  const chenPlayers = input.chenPlayers ?? [];
  const starterSlots = (league.roster_positions ?? [])
    .map(normalizeSlot)
    .filter((slot) => slot !== "BN" && slot !== "IR");
  const starters = myRoster.starters ?? [];
  const reserve = new Set(myRoster.reserve ?? []);
  const roster = (myRoster.players ?? []).flatMap((playerId) => {
    const record = recordsById.get(playerId);
    if (!record || !FANTASY_POSITIONS.has(record.position)) return [];
    const starterIndex = starters.indexOf(playerId);
    const selectedSlot = reserve.has(playerId)
      ? "IR"
      : starterIndex >= 0
        ? starterSlots[starterIndex] ?? record.position
        : "BN";
    return [toPlayer(record, selectedSlot, chenPlayers)];
  });

  const standings = rosters
    .map((entry) => ({
      rank: 0,
      teamKey: `sleeper.r.${entry.roster_id}`,
      name: rosterName(entry, usersById),
      wins: Number(entry.settings?.wins ?? 0),
      losses: Number(entry.settings?.losses ?? 0),
      ties: Number(entry.settings?.ties ?? 0),
      pointsFor: pointsFor(entry.settings),
    }))
    .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const myMatchup = matchups.find(
    (entry) => entry.roster_id === myRoster.roster_id,
  );
  const matchupEntries = myMatchup
    ? matchups.filter((entry) => entry.matchup_id === myMatchup.matchup_id)
    : [];
  const matchup =
    matchupEntries.length > 1
      ? {
          week: currentWeek,
          status: "in_progress",
          teams: matchupEntries.map((entry) => {
            const teamRoster = rostersById.get(entry.roster_id);
            return {
              teamKey: `sleeper.r.${entry.roster_id}`,
              name: teamRoster
                ? rosterName(teamRoster, usersById)
                : `Team ${entry.roster_id}`,
              points: Number(entry.custom_points ?? entry.points ?? 0),
            };
          }),
        }
      : null;

  const teamNameByRosterId = new Map(
    rosters.map((entry) => [entry.roster_id, rosterName(entry, usersById)]),
  );
  const normalizedTransactions: WeeklyTransactionDto[] = transactions
    .filter((transaction) => transaction.status !== "failed")
    .map((transaction) => {
      const players: WeeklyTransactionDto["players"][number][] = [];
      for (const [playerId, rosterId] of Object.entries(transaction.adds ?? {})) {
        const player = recordsById.get(playerId);
        if (!player) continue;
        players.push({
          name: player.name,
          position: player.position,
          moveType: "add",
          destinationTeamName: teamNameByRosterId.get(Number(rosterId)),
        });
      }
      for (const [playerId, rosterId] of Object.entries(transaction.drops ?? {})) {
        const player = recordsById.get(playerId);
        if (!player) continue;
        players.push({
          name: player.name,
          position: player.position,
          moveType: "drop",
          sourceTeamName: teamNameByRosterId.get(Number(rosterId)),
        });
      }
      return {
        key: transaction.transaction_id,
        type: transaction.type ?? "transaction",
        timestamp: transaction.created
          ? Math.floor(transaction.created / 1_000)
          : undefined,
        players,
      };
    })
    .filter((transaction) => transaction.players.length > 0);

  const rosteredIds = new Set(
    rosters.flatMap((entry) => entry.players ?? []),
  );
  const freeAgents = records
    .filter(
      (record) =>
        !rosteredIds.has(record.sleeperId) &&
        record.active !== false &&
        FANTASY_POSITIONS.has(record.position) &&
        (record.position === "DEF" || Boolean(record.team)),
    )
    .map((record) => {
      const resolved = resolvePlayerIdentity(record.name, chenPlayers, {
        team: record.team ?? undefined,
      });
      const chen =
        resolved.status === "resolved"
          ? resolved.player
          : resolvePlayerIdentity(record.name, chenPlayers);
      const ranked = "player" in chen ? chen.player : undefined;
      return {
        id: record.sleeperId,
        name: record.name,
        position: record.position,
        team: record.team ?? "FA",
        status: normalizeSleeperInjury(record.injuryStatus),
        byeWeek: byeWeekForTeam(record.team),
        chenRank: ranked?.chenRank,
        chenTier: ranked?.chenTier,
      };
    });

  const recentAddIds = normalizedTransactions.flatMap((transaction) =>
    transaction.players
      .filter((player) => player.moveType === "add")
      .map((player) => player.name),
  );
  const trendingNames = trending.flatMap((entry) => {
    const player = recordsById.get(entry.player_id);
    return player ? [player.name] : [];
  });
  const hotAddNames = [...new Set([...trendingNames, ...recentAddIds])];
  const hotAdds = hotAddNames.slice(0, 8).map((name) => {
    const player = records.find((record) => record.name === name);
    return {
      name,
      position: player?.position,
      team: player?.team ?? undefined,
    };
  });

  return {
    league: {
      leagueKey: input.leagueId,
      name: league.name ?? input.leagueId,
      currentWeek,
      scoring: sleeperScoring(league.scoring_settings),
    },
    team: {
      teamKey: `sleeper.r.${myRoster.roster_id}`,
      name: rosterName(myRoster, usersById),
    },
    roster,
    slots: lineupSlotsFromSleeper(league.roster_positions),
    matchup,
    standings,
    transactions: normalizedTransactions,
    freeAgents,
    hotAdds,
    hotAddNames,
  };
}
