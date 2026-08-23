"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

interface SleeperDraft {
  draft_id: string;
  type?: string;
  status?: string;
  season?: string;
  league_id?: string;
}

interface SleeperLeague {
  league_id: string;
  name: string;
}

export default function LoginPage() {
  const [yahooError, setYahooError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [sleeperError, setSleeperError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sleeperUser, setSleeperUser] = useState<{
    userId: string;
    username: string;
    displayName: string;
  } | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [drafts, setDrafts] = useState<SleeperDraft[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("yahoo") === "denied") {
      setYahooError(
        params.get("message")
          ? `Yahoo denied access: ${params.get("message")}`
          : "Yahoo authorization was cancelled.",
      );
    }
    if (params.get("yahoo") === "error") {
      setYahooError(params.get("message") ?? "Yahoo authorization failed.");
    }
  }, []);

  async function lookupSleeper(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setSleeperError(null);
    try {
      const response = await fetch("/api/sleeper/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        user?: { userId: string; username: string; displayName: string };
        leagues?: SleeperLeague[];
        drafts?: SleeperDraft[];
      } | null;
      if (!response.ok || !body?.user) {
        setSleeperError(body?.error ?? "Sleeper user not found.");
        return;
      }
      setSleeperUser(body.user);
      setLeagues(body.leagues ?? []);
      setDrafts(body.drafts ?? []);
    } catch {
      setSleeperError("Could not reach Sleeper. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function chooseDraft(draft: SleeperDraft) {
    if (!sleeperUser) return;
    setLoading(true);
    setSleeperError(null);
    try {
      const response = await fetch("/api/sleeper/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: sleeperUser.userId,
          username: sleeperUser.username,
          displayName: sleeperUser.displayName,
          draftId: draft.draft_id,
          leagueId: draft.league_id,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setSleeperError(body?.error ?? "Could not connect that draft.");
        return;
      }
      window.location.assign("/app");
    } catch {
      setSleeperError("Could not connect that draft. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="security-screen">
      <section className={`security-console ${yahooError ? "denied" : ""}`}>
        <p className="security-kicker">dojo.football</p>
        <h1>Choose how you draft</h1>
        <p className="security-message" role={yahooError ? "alert" : undefined}>
          {yahooError ??
            "Connect your league for a synced board, or jump into a public mock without an account."}
        </p>
        <div className="connect-choices">
          <article className="connect-choice yahoo-choice">
            <p className="security-kicker">Yahoo Fantasy</p>
            <h2>Connect Yahoo</h2>
            <p>Sign in securely and select the league whose draft you want to follow.</p>
            <a className="yahoo-login" href="/api/yahoo/auth">
              Continue with Yahoo
            </a>
          </article>

          <article className="connect-choice sleeper-choice">
            <p className="security-kicker">Sleeper</p>
            <h2>Connect Sleeper</h2>
            <p>Enter your public Sleeper username, then choose one of your drafts.</p>
            <form onSubmit={lookupSleeper}>
              <label htmlFor="sleeper-username">Sleeper username</label>
              <input
                id="sleeper-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="your_sleeper_name"
                autoComplete="username"
              />
              <button disabled={loading || !username.trim()}>
                {loading ? "Looking up…" : "Find my drafts"}
              </button>
            </form>
          </article>

          <article className="connect-choice demo-choice">
            <p className="security-kicker">No account needed</p>
            <h2>Try the demo</h2>
            <p>Create a custom public mock or join an open room and choose your seat.</p>
            <Link className="demo-login" href="/demo">
              Open draft lobby
            </Link>
          </article>
        </div>
        {sleeperError ? (
          <p className="security-message" role="alert">{sleeperError}</p>
        ) : null}
        {drafts.length > 0 ? (
          <div className="sleeper-picks">
            <p className="security-kicker">Your 2026 drafts</p>
            {drafts.map((draft) => (
              <button
                key={draft.draft_id}
                type="button"
                className="secondary"
                onClick={() => void chooseDraft(draft)}
              >
                {leagues.find((league) => league.league_id === draft.league_id)?.name ??
                  draft.draft_id}{" "}
                · {draft.status ?? draft.type ?? "draft"}
              </button>
            ))}
          </div>
        ) : sleeperUser ? (
          <p className="security-message">No 2026 drafts found for that username.</p>
        ) : null}
        <small>You still make the real pick in Sleeper or Yahoo.</small>
      </section>
    </main>
  );
}
