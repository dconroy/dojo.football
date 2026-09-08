"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { BrandLockup } from "@/components/brand-lockup";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import {
  analyzeDraftRoster,
  analyzeRoomTendencies,
  createDraftState,
  draftIsFinished,
  applyScribePaste,
  makeManualPick,
  playersFromChenImport,
  recommendPlayers,
  rosterPicks,
  selectionForOverall,
  suggestPlayers,
  undoLastPick,
  resolveYahooPaste,
  type DraftState,
  type Player,
} from "@/domain";

const USER_SLOT = 6;
const TEAM_COUNT = 12;
const ROUNDS = 15;
const STORAGE_KEY = "dojo-scribe-v1";
const TOTAL_PICKS = TEAM_COUNT * ROUNDS;

function emptyDraft(): DraftState {
  return createDraftState(USER_SLOT, { teamCount: TEAM_COUNT, rounds: ROUNDS });
}

function readStoredDraft(): DraftState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState;
    if (
      parsed.userSlot !== USER_SLOT ||
      parsed.teamCount !== TEAM_COUNT ||
      parsed.rounds !== ROUNDS ||
      !Array.isArray(parsed.picks)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function ScribeBoard() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [source, setSource] = useState("Boris Chen · 0.5 PPR");
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("Loading Chen 0.5 PPR…");
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [recoTab, setRecoTab] = useState<"top" | "insights">("top");
  const [pending, setPending] = useState<ReturnType<typeof resolveYahooPaste>["pending"]>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/chen?scoring=half-ppr")
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? "Unable to load Boris Chen rankings");
        }
        return body;
      })
      .then((imported) => {
        if (cancelled) return;
        const pool = playersFromChenImport(imported);
        if (!pool.length) throw new Error("Chen 0.5 PPR list was empty");
        setPlayers(pool);
        setSource(typeof imported?.source === "string" ? imported.source : "Boris Chen · 0.5 PPR");
        setDraft(readStoredDraft() ?? emptyDraft());
        setNotice("Chen 0.5 PPR loaded. Type the next pick or paste a Yahoo recap.");
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNotice(error instanceof Error ? error.message : "Unable to load Chen rankings");
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft, ready]);

  useEffect(() => {
    if (ready) searchRef.current?.focus();
  }, [ready, draft.picks.length]);

  const current = selectionForOverall(
    Math.min(draft.picks.length + 1, TOTAL_PICKS),
    TEAM_COUNT,
  );
  const boardCapacity = {
    picks: draft.picks.length,
    playerCount: players.length,
    teamCount: TEAM_COUNT,
    rounds: ROUNDS,
  };
  const complete = draftIsFinished(boardCapacity);
  const onClock = !complete && current.slot === USER_SLOT;
  const draftedIds = useMemo(
    () => new Set(draft.picks.map((pick) => pick.player.id)),
    [draft.picks],
  );
  const available = useMemo(
    () => players.filter((player) => !draftedIds.has(player.id)),
    [players, draftedIds],
  );
  const suggestions = useMemo(
    () => (complete ? [] : suggestPlayers(query, available)),
    [query, available, complete],
  );
  const recommendation = useMemo(
    () =>
      recommendPlayers(draft, players, {
        weights: DEFAULT_STRATEGY_WEIGHTS,
      }),
    [draft, players],
  );
  const myRoster = useMemo(
    () => rosterPicks(draft.picks, USER_SLOT),
    [draft.picks],
  );
  const insights = useMemo(
    () =>
      analyzeDraftRoster(myRoster, {
        currentRound: current.round,
        topPick: recommendation.recommendations[0]
          ? {
              name: recommendation.recommendations[0].player.name,
              reason:
                recommendation.recommendations[0].explanations[0] ??
                "Best Chen value available",
            }
          : undefined,
      }),
    [myRoster, current.round, recommendation],
  );
  const roomTendencies = useMemo(() => analyzeRoomTendencies(draft), [draft]);
  const insightFlags =
    insights.alerts.filter((alert) => alert.severity !== "info").length +
    roomTendencies.alerts.filter((alert) => alert.confidence !== "low").length;

  function recordPlayer(player: Player, message?: string) {
    if (complete) {
      setNotice("Draft is complete.");
      return;
    }
    if (draftedIds.has(player.id)) {
      setNotice(`${player.name} is already on the board.`);
      return;
    }
    try {
      setDraft(makeManualPick(draft, player));
      setQuery("");
      setHighlight(0);
      setPending(null);
      setNotice(message ?? `Recorded ${player.name} at ${current.overall} (slot ${current.slot}).`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not record that pick.");
    }
  }

  function applyPaste() {
    const result = resolveYahooPaste(paste, players);
    if (!result.resolved.length && !result.pending) {
      setNotice("No player names found in that paste.");
      return;
    }
    if (result.resolved.length) {
      setDraft(applyScribePaste(draft, result.resolved));
    }
    if (result.pending) {
      setPending(result.pending);
      setPasteOpen(true);
      const label =
        result.pending.resolution.status === "ambiguous"
          ? `Which ${result.pending.parsed.name}?`
          : `Could not match “${result.pending.parsed.name}”. Type them instead.`;
      setNotice(
        result.resolved.length
          ? `Caught up ${result.resolved.length} pick(s). ${label}`
          : label,
      );
      return;
    }
    setPending(null);
    setPaste("");
    setNotice(`Caught up ${result.resolved.length} pick(s) from Yahoo.`);
  }

  function undo() {
    if (!draft.picks.length) return;
    const last = draft.picks[draft.picks.length - 1];
    setDraft(undoLastPick(draft));
    setNotice(last ? `Undid ${last.player.name}.` : "Undid last pick.");
  }

  function resetBoard() {
    if (
      draft.picks.length > 0 &&
      !window.confirm(`Clear all ${draft.picks.length} recorded picks?`)
    ) {
      return;
    }
    setDraft(emptyDraft());
    setQuery("");
    setPaste("");
    setPending(null);
    setNotice("Board cleared. Type or paste from pick 1.");
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => Math.min(index + 1, Math.max(0, suggestions.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Escape") {
      setQuery("");
      setHighlight(0);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const choice = suggestions[highlight] ?? suggestions[0];
    if (choice) recordPlayer(choice);
  }

  if (!ready) return <main className="app dark loading">Loading Chen board…</main>;

  return (
    <main className="app dark scribe">
      <div className="broadcast-bar">
        <span>LOCAL SCRIBE</span>
        <span>BORIS CHEN · 0.5 PPR · SLOT 6</span>
        <span>NO BLEND</span>
      </div>
      <header className="topbar">
        <BrandLockup href="/" kicker="LOCAL CHEN SCRIBE" />
        <p className="scribe-meta">
          Slot 6 · 12 teams · 15 rounds · {source}
        </p>
      </header>

      {onClock ? (
        <div className="preview-banner scribe-clock" role="status">
          <span>You&apos;re on the clock at pick {current.overall}. Chen top five is for you.</span>
        </div>
      ) : null}

      <section className={`control-strip ${onClock ? "on-clock" : ""}`}>
        <label className="scribe-search">
          They drafted
          <input
            ref={searchRef}
            value={query}
            maxLength={64}
            placeholder={complete ? "Draft complete" : "Type a name — Enter records the next pick"}
            disabled={complete || players.length === 0}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={onSearchKey}
          />
          {suggestions.length > 0 ? (
            <ul className="scribe-suggest" role="listbox">
              {suggestions.map((player, index) => (
                <li key={player.id}>
                  <button
                    type="button"
                    className={index === highlight ? "active" : ""}
                    onClick={() => recordPlayer(player)}
                  >
                    <strong>{player.name}</strong>
                    <span>
                      {player.position} {player.team} · Chen {player.chenRank ?? "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </label>
        <div className="turn-indicator">
          <strong>
            {complete
              ? "Draft complete"
              : onClock
                ? "YOU'RE ON THE CLOCK"
                : `Slot ${current.slot} is up`}
          </strong>
          <span>
            Pick {Math.min(draft.picks.length + 1, TOTAL_PICKS)} of {TOTAL_PICKS} · Round{" "}
            {current.round} of {ROUNDS}
            {recommendation.picksUntilNextSelection != null && !onClock
              ? ` · ${recommendation.picksUntilNextSelection} until you`
              : ""}
          </span>
        </div>
        <button type="button" className="secondary" onClick={undo} disabled={!draft.picks.length}>
          Undo
        </button>
        <button type="button" className="secondary" onClick={resetBoard}>
          Reset
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setPasteOpen((open) => !open)}
        >
          {pasteOpen ? "Hide paste" : "Paste Yahoo"}
        </button>
      </section>
      <p className="scribe-notice" role="status">{notice}</p>

      {pasteOpen ? (
        <section className="scribe-paste">
          <textarea
            value={paste}
            rows={6}
            placeholder="Paste a Yahoo recap — numbered lines, WR - CIN, D/ST, tabs. Unmatched names stop so you can pick the right one."
            onChange={(event) => setPaste(event.target.value)}
          />
          <div className="scribe-paste-actions">
            <button type="button" onClick={applyPaste} disabled={!paste.trim()}>
              Apply paste
            </button>
            {pending?.resolution.status === "ambiguous" ? (
              <div className="scribe-pending">
                <span>Which {pending.parsed.name}?</span>
                {pending.resolution.candidates.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    className="secondary"
                    onClick={() => recordPlayer(player, `Recorded ${player.name} (${player.team}).`)}
                  >
                    {player.name} {player.team}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="workspace scribe-workspace">
        <aside className="panel recommendations">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Chen recommendations</p>
              <h2>{recoTab === "insights" ? "Insights" : "Top five"}</h2>
            </div>
            <div className="panel-heading-meta">
              <span>
                {recoTab === "insights"
                  ? insightFlags
                    ? `${insightFlags} alert${insightFlags === 1 ? "" : "s"}`
                    : "no flags"
                  : complete
                    ? "draft complete"
                    : recommendation.picksUntilNextSelection === null
                      ? "last pick"
                      : `${recommendation.picksUntilNextSelection} picks until your next turn`}
              </span>
              <b className="live-pill">CHEN</b>
            </div>
          </div>
          <div className="reco-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={recoTab === "top"}
              className={recoTab === "top" ? "active" : ""}
              onClick={() => setRecoTab("top")}
            >
              Top five
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={recoTab === "insights"}
              className={recoTab === "insights" ? "active" : ""}
              onClick={() => setRecoTab("insights")}
            >
              Insights
              {insightFlags > 0 ? <i>{insightFlags}</i> : null}
            </button>
          </div>
          {recoTab === "insights" ? (
            <div className="insight-body">
              {insights.alerts.length === 0 ? (
                <p className="insight-empty">
                  No notes yet — bye stacks and holes show up after a few of your picks.
                </p>
              ) : (
                insights.alerts.map((alert) => (
                  <article className={`insight-card ${alert.severity}`} key={alert.id}>
                    <h3>{alert.title}</h3>
                    <p>{alert.detail}</p>
                  </article>
                ))
              )}
              <div className="room-read">
                <h3>Room read</h3>
                {roomTendencies.alerts.length === 0 ? (
                  <p className="insight-empty">
                    No confident room tendency yet. This fills in as you record picks.
                  </p>
                ) : (
                  roomTendencies.alerts.map((alert) => (
                    <article
                      className={`insight-card ${alert.confidence === "high" ? "warning" : "info"}`}
                      key={`${alert.kind}-${alert.text}`}
                    >
                      <h3>
                        {alert.kind === "run"
                          ? "Position run"
                          : alert.kind === "demand"
                            ? "Demand before your turn"
                            : "Team tendency"}
                      </h3>
                      <p>{alert.text}</p>
                    </article>
                  ))
                )}
              </div>
              <div className="bye-board">
                <h3>Your bye weeks</h3>
                {insights.byes.length === 0 ? (
                  <p className="insight-empty">No bye weeks on the roster yet.</p>
                ) : (
                  insights.byes.map((group) => (
                    <div
                      className={`bye-row ${group.count >= 3 ? "hot" : ""}`}
                      key={group.week}
                    >
                      <strong>Week {group.week}</strong>
                      <span>
                        {group.count} · {group.names.join(", ")}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <>
              {recommendation.recommendations.length === 0 ? (
                <p className="insight-empty">
                  {complete
                    ? "Board is full."
                    : "No remaining Chen players fit the board."}
                </p>
              ) : null}
              {recommendation.recommendations.map((item, index) => (
                <article
                  key={item.player.id}
                  className={`recommendation scribe-reco ${index === 0 ? "first" : ""}`}
                  onClick={() => {
                    if (!onClock) {
                      setNotice("Top five is your next pick. Record the room’s pick in the box above.");
                      return;
                    }
                    recordPlayer(item.player, `You took ${item.player.name}.`);
                  }}
                >
                  <div className="rank">{index + 1}</div>
                  <div className="recommendation-copy">
                    <div className="player-line">
                      <strong>{item.player.name}</strong>
                      <span className={`position ${item.player.position.toLowerCase()}`}>
                        {item.player.position}
                      </span>
                      <span>{item.player.team}</span>
                      <span>T{item.player.chenTier ?? "—"}</span>
                      <span>Chen {item.player.chenRank ?? "—"}</span>
                    </div>
                    <p>{item.explanations[0] ?? "Best Chen value available"}</p>
                  </div>
                  {index === 0 ? <span className="best-badge">BEST</span> : null}
                </article>
              ))}
            </>
          )}
        </aside>

        <section className="panel board">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Your roster · slot 6</p>
              <h2>{myRoster.length} picks</h2>
            </div>
          </div>
          <div className="scribe-lists">
            {myRoster.length === 0 ? (
              <p className="insight-empty">Your seat is empty until pick 6.</p>
            ) : (
              myRoster.map((pick) => (
                <div className="scribe-row" key={pick.overall}>
                  <b>{pick.round}.{pick.overall}</b>
                  <strong>{pick.player.name}</strong>
                  <span>
                    {pick.player.position} {pick.player.team} · {pick.rosterSlot}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recent picks</p>
              <h2>Room</h2>
            </div>
          </div>
          <div className="scribe-lists">
            {draft.picks.length === 0 ? (
              <p className="insight-empty">Nothing recorded yet.</p>
            ) : (
              draft.picks
                .slice(-10)
                .reverse()
                .map((pick) => (
                  <div
                    className={`scribe-row ${pick.slot === USER_SLOT ? "mine" : ""}`}
                    key={pick.overall}
                  >
                    <b>
                      {pick.overall} · s{pick.slot}
                    </b>
                    <strong>{pick.player.name}</strong>
                    <span>
                      {pick.player.position} {pick.player.team}
                    </span>
                  </div>
                ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
