"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatStamp } from "@/lib/build-info";

interface LineupPlayerDto {
  id: string;
  name: string;
  position: string;
  team: string;
  selectedSlot: string;
  chenRank?: number;
  chenTier?: number;
  byeWeek?: number;
  status?: string;
}

interface WeeklyData {
  platform: "yahoo" | "sleeper";
  league: { leagueKey: string; name: string; currentWeek?: number };
  team: { teamKey: string; name: string };
  roster: LineupPlayerDto[];
  lineup: {
    starters: Array<{ slot: string; player: LineupPlayerDto | null }>;
    bench: LineupPlayerDto[];
    moves: Array<{
      slot: string;
      start: LineupPlayerDto;
      bench?: LineupPlayerDto;
      reason: string;
    }>;
    alerts: Array<{ severity: "critical" | "warning"; message: string }>;
  };
  matchup: {
    week?: number;
    status?: string;
    teams: Array<{
      teamKey: string;
      name: string;
      points?: number;
      projectedPoints?: number;
    }>;
  } | null;
  standings: Array<{
    rank: number;
    teamKey: string;
    name: string;
    wins: number;
    losses: number;
    ties: number;
    pointsFor: number;
  }>;
  transactions: Array<{
    key: string;
    type: string;
    timestamp?: number;
    players: Array<{
      name: string;
      position?: string;
      moveType: string;
      sourceTeamName?: string;
      destinationTeamName?: string;
    }>;
  }>;
  waivers: WaiverTargetDto[];
  hotAdds: Array<{
    name: string;
    position?: string;
    team?: string;
    destinationTeamName?: string;
  }>;
  chen: { importedAt: string; source: string };
  syncedAt: string;
}

interface WaiverPlayerRefDto {
  id: string;
  name: string;
  position: string;
  team: string;
  chenRank?: number;
  chenTier?: number;
}

interface WaiverTargetDto {
  player: {
    id: string;
    name: string;
    position: string;
    team: string;
    status?: string;
    byeWeek?: number;
    percentOwned?: number;
    chenRank?: number;
    chenTier?: number;
  };
  score: number;
  reasons: string[];
  upgradeOver: WaiverPlayerRefDto | null;
  suggestedDrop: WaiverPlayerRefDto | null;
  fillsNeed: boolean;
  isContested: boolean;
  isTrending: boolean;
  isWatched: boolean;
}

interface LeagueOption {
  leagueKey: string;
  name: string;
  season?: number;
  numTeams?: number;
}

function slotLabel(slot: string) {
  if (slot === "W/R/T" || slot === "W/R" || slot === "W/T" || slot === "Q/W/R/T") {
    return "FLEX";
  }
  if (slot === "BN") return "Bench";
  return slot;
}

function playerBadge(player: LineupPlayerDto, currentWeek?: number) {
  if (currentWeek !== undefined && player.byeWeek === currentWeek) return "BYE";
  return player.status?.toUpperCase() ?? null;
}

function badgeClass(badge: string) {
  if (badge === "Q") return "player-badge warn";
  return "player-badge critical";
}

export function WeeklyHq() {
  const [data, setData] = useState<WeeklyData | null>(null);
  const [error, setError] = useState<{
    code: string;
    message: string;
    platform?: "yahoo" | "sleeper";
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [leagues, setLeagues] = useState<LeagueOption[] | null>(null);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [posFilter, setPosFilter] = useState<string>("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/weekly", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setData(null);
        setError({
          code: typeof body?.error === "string" ? body.error : "failed",
          message: body?.message ?? body?.error ?? `HTTP ${response.status}`,
          platform:
            body?.platform === "sleeper" || body?.platform === "yahoo"
              ? body.platform
              : undefined,
        });
      } else {
        setData(body as WeeklyData);
      }
    } catch (fetchError) {
      setData(null);
      setError({
        code: "network",
        message: fetchError instanceof Error ? fetchError.message : "Network error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          me: { darkMode?: boolean; role?: string; waiverWatch?: string[] } | null,
        ) => {
          if (me) {
            setIsAdmin(me.role === "admin");
            if (Array.isArray(me.waiverWatch)) setWatch(me.waiverWatch);
          }
        },
      )
      .catch(() => undefined);
  }, [load]);

  const toggleWatch = useCallback(
    async (playerId: string) => {
      const next = watch.includes(playerId)
        ? watch.filter((id) => id !== playerId)
        : [...watch, playerId];
      setWatch(next);
      await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waiverWatch: next }),
      }).catch(() => undefined);
      // Re-rank so watched players pin to the top with a fresh watchlist boost.
      void load();
    },
    [watch, load],
  );

  useEffect(() => {
    if (
      error?.code !== "no-league" ||
      error.platform === "sleeper" ||
      leagues !== null
    ) {
      return;
    }
    fetch("/api/yahoo/leagues")
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Unable to list leagues");
        setLeagues((body?.leagues ?? []) as LeagueOption[]);
      })
      .catch((listError: Error) => setLeaguesError(listError.message));
  }, [error, leagues]);

  async function connectLeague(leagueKey: string) {
    await fetch("/api/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "leagueKey", leagueKey }),
    });
    await load();
  }

  const week = data?.league.currentWeek;
  const currentStarters = data?.roster.filter(
    (player) => player.selectedSlot !== "BN" && player.selectedSlot !== "IR",
  );
  const benchPlayers = data?.roster.filter(
    (player) => player.selectedSlot === "BN" || player.selectedSlot === "IR",
  );
  const myMatchupTeam = data?.matchup?.teams.find(
    (team) => team.teamKey === data.team.teamKey,
  );
  const opponent = data?.matchup?.teams.find(
    (team) => team.teamKey !== data.team.teamKey,
  );
  const filteredWaivers = (data?.waivers ?? []).filter(
    (target) => posFilter === "ALL" || target.player.position === posFilter,
  );
  const platformName = data?.platform === "sleeper" ? "Sleeper" : "Yahoo";

  return (
    <main className="app dark">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-copy">
            <p className="eyebrow">
              {data ? `${data.league.name} · Week ${week ?? "—"}` : "Draft Dojo · 2026"}
            </p>
            <h1>Weekly HQ</h1>
            <p className="brand-tagline">
              Start smart. Stream smarter. All moves stay manual in{" "}
              {data ? platformName : "your league app"}.
            </p>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Weekly HQ">
          <Link href="/">Draft board</Link>
          <button
            type="button"
            className="topbar-link"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </nav>
      </header>

      {loading && !data && <div className="notice">Loading weekly league data…</div>}

      {error && error.code === "no-league" && (
        <section className="panel weekly-setup">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">One-time setup</p>
              <h2>
                {error.platform === "sleeper"
                  ? "Connect your Sleeper league"
                  : "Connect your Yahoo league"}
              </h2>
            </div>
          </div>
          <div className="weekly-setup-body">
            {error.platform === "sleeper" ? (
              <p>
                {error.message}{" "}
                <Link href="/login">Choose a Sleeper league and draft</Link> to
                reconnect.
              </p>
            ) : isAdmin ? (
              <>
                <p>
                  Pick your league below. This is saved for the whole draft room, so
                  everyone gets their own roster and matchup automatically.
                </p>
                {leaguesError && <p className="weekly-error">{leaguesError}</p>}
                {leagues === null && !leaguesError && <p>Loading your Yahoo leagues…</p>}
                {leagues?.map((league) => (
                  <button
                    key={league.leagueKey}
                    className="secondary"
                    onClick={() => void connectLeague(league.leagueKey)}
                  >
                    {league.name}
                    {league.season ? ` · ${league.season}` : ""}
                    {league.numTeams ? ` · ${league.numTeams} teams` : ""}
                  </button>
                ))}
                {leagues?.length === 0 && (
                  <p>Yahoo returned no NFL leagues for your account.</p>
                )}
              </>
            ) : (
              <p>No Yahoo league is connected yet — ask your admin to set it up.</p>
            )}
          </div>
        </section>
      )}

      {error && error.code !== "no-league" && (
        <section className="panel weekly-setup">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                {error.platform === "sleeper" ? "Sleeper" : "League"} sync issue
              </p>
              <h2>Couldn&apos;t load weekly data</h2>
            </div>
          </div>
          <div className="weekly-setup-body">
            <p className="weekly-error">{error.message}</p>
            <button className="secondary" onClick={() => void load()}>Try again</button>
          </div>
        </section>
      )}

      {data && (
        <>
          {data.lineup.alerts.length > 0 && (
            <div className="alert-stack">
              {data.lineup.alerts.map((alert) => (
                <div className={`lineup-alert ${alert.severity}`} key={alert.message}>
                  {alert.severity === "critical" ? "⛔" : "⚠️"} {alert.message}
                </div>
              ))}
            </div>
          )}

          <section className="workspace weekly-grid">
            <aside className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Chen-ranked · advisory only</p>
                  <h2>Optimal lineup</h2>
                </div>
                <span>Week {week ?? "—"}</span>
              </div>
              {data.lineup.starters.map((entry, index) => (
                <div className="weekly-slot" key={`${entry.slot}-${index}`}>
                  <span className="weekly-slot-label">{entry.slot}</span>
                  {entry.player ? (
                    <div className="weekly-slot-player">
                      <strong>{entry.player.name}</strong>
                      <small>
                        {entry.player.position} · {entry.player.team}
                        {entry.player.chenTier ? ` · T${entry.player.chenTier}` : ""}
                      </small>
                    </div>
                  ) : (
                    <em>No one available</em>
                  )}
                  {entry.player &&
                    (entry.player.selectedSlot === "BN" ? (
                      <span className="swap-badge">SWAP IN</span>
                    ) : null)}
                </div>
              ))}
              {data.lineup.moves.length > 0 ? (
                <div className="weekly-moves">
                  <p className="admin-label">Suggested moves</p>
                  {data.lineup.moves.map((move) => (
                    <p key={`${move.slot}-${move.start.id}`}>
                      <strong>
                        Start {move.start.name}
                        {move.bench ? ` over ${move.bench.name}` : ""}
                      </strong>{" "}
                      at {move.slot} — {move.reason}.
                    </p>
                  ))}
                  <p className="weekly-footnote">
                    Make these changes in the {platformName} app — this tool never
                    edits your lineup.
                  </p>
                </div>
              ) : (
                <p className="weekly-moves weekly-all-set">
                  Your current lineup already matches the optimal one.
                </p>
              )}
            </aside>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{data.team.name}</p>
                  <h2>My roster</h2>
                </div>
                <span>{data.roster.length} players</span>
              </div>
              <div className="weekly-roster">
                {[...(currentStarters ?? []), ...(benchPlayers ?? [])].map((player) => {
                  const badge = playerBadge(player, week);
                  return (
                    <div className="weekly-roster-row" key={player.id}>
                      <span className="weekly-slot-label">
                        {slotLabel(player.selectedSlot)}
                      </span>
                      <span className="weekly-roster-name">
                        <strong>{player.name}</strong>
                        <small>
                          {player.position} · {player.team} · Bye {player.byeWeek ?? "—"}
                        </small>
                      </span>
                      <span>
                        {player.chenTier ? (
                          <i className={`tier tier-${Math.min(player.chenTier, 8)}`}>
                            T{player.chenTier}
                          </i>
                        ) : (
                          "—"
                        )}
                      </span>
                      <span>{badge && <b className={badgeClass(badge)}>{badge}</b>}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <aside className="right-column">
              {data.matchup && myMatchupTeam && opponent && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Matchup</h2>
                    <span>Week {data.matchup.week ?? week ?? "—"}</span>
                  </div>
                  <div className="weekly-matchup">
                    <div>
                      <strong>{myMatchupTeam.name}</strong>
                      <b>{myMatchupTeam.points ?? 0}</b>
                      <small>proj {myMatchupTeam.projectedPoints ?? "—"}</small>
                    </div>
                    <span>vs</span>
                    <div>
                      <strong>{opponent.name}</strong>
                      <b>{opponent.points ?? 0}</b>
                      <small>proj {opponent.projectedPoints ?? "—"}</small>
                    </div>
                  </div>
                </section>
              )}

              {data.standings.length > 0 && (
                <section className="panel">
                  <div className="panel-heading"><h2>Standings</h2></div>
                  <div className="weekly-standings">
                    {data.standings.map((row) => (
                      <div
                        className={`weekly-standings-row ${row.teamKey === data.team.teamKey ? "mine" : ""}`}
                        key={row.teamKey}
                      >
                        <span>{row.rank}</span>
                        <strong>{row.name}</strong>
                        <span>
                          {row.wins}-{row.losses}
                          {row.ties ? `-${row.ties}` : ""}
                        </span>
                        <span>{row.pointsFor.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </section>

          <section className="workspace weekly-grid-lower">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Ranked for your roster · advisory only</p>
                  <h2>Waiver Wire Sniper</h2>
                </div>
                <span>{filteredWaivers.length} targets</span>
              </div>

              {data.hotAdds.length > 0 && (
                <div className="sniper-hotadds">
                  <span className="sniper-hotadds-label">🔥 Hot adds</span>
                  {data.hotAdds.map((add) => (
                    <span className="sniper-hotadd" key={add.name}>
                      {add.name}
                      {add.position ? ` (${add.position})` : ""}
                    </span>
                  ))}
                </div>
              )}

              <div className="sniper-filters">
                {["ALL", "QB", "RB", "WR", "TE", "K", "DEF"].map((pos) => (
                  <button
                    key={pos}
                    className={`sniper-filter ${posFilter === pos ? "active" : ""}`}
                    onClick={() => setPosFilter(pos)}
                  >
                    {pos === "ALL" ? "All" : pos}
                  </button>
                ))}
              </div>

              <div className="weekly-waivers">
                {filteredWaivers.map((target) => (
                  <div
                    className={`sniper-target ${target.isWatched ? "watched" : ""}`}
                    key={target.player.id}
                  >
                    <button
                      className={`sniper-star ${target.isWatched ? "on" : ""}`}
                      onClick={() => void toggleWatch(target.player.id)}
                      title={
                        target.isWatched
                          ? "Remove from watchlist"
                          : "Add to watchlist"
                      }
                      aria-label="Toggle watchlist"
                    >
                      {target.isWatched ? "★" : "☆"}
                    </button>
                    <div className="sniper-main">
                      <div className="sniper-headline">
                        <strong>{target.player.name}</strong>
                        <small>
                          {target.player.position} · {target.player.team}
                          {target.player.byeWeek
                            ? ` · Bye ${target.player.byeWeek}`
                            : ""}
                          {target.player.percentOwned !== undefined
                            ? ` · ${target.player.percentOwned}% owned`
                            : ""}
                        </small>
                      </div>
                      <div className="sniper-badges">
                        {target.player.chenTier ? (
                          <i
                            className={`tier tier-${Math.min(target.player.chenTier, 8)}`}
                          >
                            T{target.player.chenTier}
                          </i>
                        ) : null}
                        {target.fillsNeed && (
                          <b className="sniper-badge need">NEED</b>
                        )}
                        {target.isTrending && (
                          <b className="sniper-badge trending">TRENDING</b>
                        )}
                        {target.isContested && (
                          <b className="sniper-badge contested">CONTESTED</b>
                        )}
                        {target.player.status && (
                          <b className={badgeClass(target.player.status)}>
                            {target.player.status}
                          </b>
                        )}
                      </div>
                      {target.reasons.length > 0 && (
                        <p className="sniper-reason">{target.reasons[0]}</p>
                      )}
                      {(target.upgradeOver || target.suggestedDrop) && (
                        <p className="sniper-move">
                          {target.upgradeOver ? (
                            <>
                              Beats <strong>{target.upgradeOver.name}</strong>
                            </>
                          ) : null}
                          {target.upgradeOver && target.suggestedDrop ? " · " : null}
                          {target.suggestedDrop ? (
                            <>
                              Drop <strong>{target.suggestedDrop.name}</strong>
                            </>
                          ) : null}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {filteredWaivers.length === 0 && (
                  <p className="weekly-footnote">No free agent data available.</p>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Adds, drops, and trades</p>
                  <h2>League activity</h2>
                </div>
              </div>
              <div className="weekly-activity">
                {data.transactions.map((transaction) => (
                  <div className="weekly-activity-row" key={transaction.key}>
                    <small>
                      {transaction.timestamp
                        ? new Date(transaction.timestamp * 1000).toLocaleDateString()
                        : ""}
                      {" · "}
                      {transaction.type}
                    </small>
                    {transaction.players.map((player, index) => (
                      <p key={`${transaction.key}-${index}`}>
                        {player.moveType === "add" ? "➕" : player.moveType === "drop" ? "➖" : "🔁"}{" "}
                        <strong>{player.name}</strong>
                        {player.position ? ` (${player.position})` : ""}
                        {player.moveType === "add" && player.destinationTeamName
                          ? ` → ${player.destinationTeamName}`
                          : ""}
                        {player.moveType === "drop" && player.sourceTeamName
                          ? ` ← ${player.sourceTeamName}`
                          : ""}
                      </p>
                    ))}
                  </div>
                ))}
                {data.transactions.length === 0 && (
                  <p className="weekly-footnote">No transactions yet.</p>
                )}
              </div>
            </section>
          </section>

          <p className="weekly-meta">
            {platformName} synced {new Date(data.syncedAt).toLocaleTimeString()} ·
            Chen data{" "}
            {formatStamp(data.chen.importedAt)} (auto-refreshes every 3 days)
          </p>
        </>
      )}
    </main>
  );
}
