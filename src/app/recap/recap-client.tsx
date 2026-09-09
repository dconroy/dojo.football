"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import data from "./recap-data.json";
import styles from "./recap.module.css";

interface StatChip {
  readonly label: string;
  readonly value: string;
}

interface RecapPlayer {
  readonly overall: number;
  readonly round: number;
  readonly slot: number;
  readonly name: string;
  readonly position: string;
  readonly nflTeam: string | null;
  readonly chenRank: number | null;
  readonly chenTier: number | null;
  readonly imageUrl: string | null;
  readonly seasons: readonly { year: number; stats: readonly StatChip[] }[];
}

interface RecapTeam {
  readonly slot: number;
  readonly rank: number;
  readonly grade: string;
  readonly avgChenRank: number | null;
  readonly positionCounts: Record<string, number>;
  readonly reasons: readonly { tone: string; text: string }[];
  readonly teamName: string;
  readonly headline: string;
  readonly story: string;
  readonly house: boolean;
  readonly roster: readonly RecapPlayer[];
}

const teams = data.teams as RecapTeam[];

function gradeClass(grade: string): string {
  const letter = grade[0] ?? "C";
  if (letter === "A") return styles.gradeA;
  if (letter === "B") return styles.gradeB;
  if (letter === "C") return styles.gradeC;
  if (letter === "D") return styles.gradeD;
  return styles.gradeF;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function pickLabel(player: RecapPlayer): string {
  return `${player.round}.${String(player.slot).padStart(2, "0")}`;
}

function parseHash(): { slot: number | null; overall: number | null } {
  if (typeof window === "undefined") return { slot: null, overall: null };
  const match = window.location.hash.match(/^#t(\d+)(?:-p(\d+))?$/);
  if (!match) return { slot: null, overall: null };
  return {
    slot: Number(match[1]),
    overall: match[2] ? Number(match[2]) : null,
  };
}

function Avatar({
  name,
  imageUrl,
  className,
}: {
  name: string;
  imageUrl: string | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!imageUrl || broken) {
    return (
      <span className={`${styles.avatarFallback} ${className ?? ""}`} aria-hidden>
        {initials(name)}
      </span>
    );
  }
  return (
    // Sleeper 403s missing photos; a plain img lets us fall back to initials.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`${styles.avatar} ${className ?? ""}`}
      src={imageUrl}
      alt=""
      onError={() => setBroken(true)}
    />
  );
}

export function RecapClient() {
  const [{ slot, overall }, setView] = useState(parseHash);
  const team = teams.find((entry) => entry.slot === slot) ?? null;
  const player = team?.roster.find((entry) => entry.overall === overall) ?? null;
  const teamIndex = team ? teams.findIndex((entry) => entry.slot === team.slot) : -1;

  useEffect(() => {
    const sync = () => setView(parseHash());
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const current = parseHash();
      if (current.overall && current.slot) {
        window.location.hash = `t${current.slot}`;
        return;
      }
      if (current.slot) {
        history.replaceState(null, "", window.location.pathname);
        setView({ slot: null, overall: null });
      }
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("keydown", onKey);
    window.scrollTo({ top: 0, behavior: "instant" });
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("keydown", onKey);
    };
  }, [slot, overall]);

  function openTeam(nextSlot: number) {
    window.location.hash = `t${nextSlot}`;
  }

  function openPlayer(nextSlot: number, nextOverall: number) {
    window.location.hash = `t${nextSlot}-p${nextOverall}`;
  }

  function closePlayer() {
    if (team) window.location.hash = `t${team.slot}`;
  }

  function closeTeam() {
    history.replaceState(null, "", window.location.pathname);
    setView({ slot: null, overall: null });
  }

  const neighbor = useMemo(() => {
    if (teamIndex < 0) return { prev: null, next: null };
    return {
      prev: teams[teamIndex - 1] ?? null,
      next: teams[teamIndex + 1] ?? null,
    };
  }, [teamIndex]);

  return (
    <div className={styles.recap}>
      <div className={styles.bar}>
        <span>Draft Dojo</span>
        <span>Chen 0.5 PPR · not Yahoo</span>
        <span>Sep 8, 2026</span>
      </div>
      <main className={styles.wrap}>
        {team ? (
          <TeamView
            team={team}
            prev={neighbor.prev}
            next={neighbor.next}
            onBack={closeTeam}
            onOpenPlayer={(pick) => openPlayer(team.slot, pick.overall)}
            onOpenTeam={openTeam}
          />
        ) : (
          <BoardView onOpenTeam={openTeam} />
        )}
        <p className={styles.footer}>
          Graded {data.teamCount} complete rosters against {data.source}.
          Headshots and 2025/2024 lines are from Sleeper. Late specialists
          without a Chen rank do not move the curve.{" "}
          <Link href="/">dojo.football</Link>
        </p>
      </main>
      {player && team ? (
        <PlayerSheet player={player} teamName={team.teamName} onClose={closePlayer} />
      ) : null}
    </div>
  );
}

function BoardView({ onOpenTeam }: { onOpenTeam: (slot: number) => void }) {
  return (
    <>
      <Link className={styles.brand} href="/">
        {/* Local brand mark; next/image is unnecessary for this 42px SVG. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand-icon.svg" alt="" />
        <span>
          <strong>DRAFT DOJO</strong>
          <small>POST-DRAFT REPORT CARD</small>
        </span>
      </Link>
      <section className={styles.hero}>
        <h1>{data.headline}</h1>
        <p className={styles.dek}>{data.dek}</p>
        <ul className={styles.meta}>
          <li>{data.league}</li>
          <li>{data.teamCount} teams · {data.rounds} rounds</li>
          <li>Boris Chen 0.5 PPR</li>
          <li>{data.totalPicks} picks graded</li>
        </ul>
        <p className={styles.note}>
          Tap a team for the story, then tap a player for the headshot and last
          two Sleeper seasons. Yahoo&apos;s own grades are ADP cosplay.
        </p>
      </section>
      <section className={styles.board} aria-label="Team grades">
        {teams.map((team) => (
          <button
            key={team.slot}
            type="button"
            className={`${styles.teamCard} ${gradeClass(team.grade)}${team.house ? ` ${styles.house}` : ""}`}
            onClick={() => onOpenTeam(team.slot)}
          >
            <span className={styles.rank}>{team.rank}</span>
            <span className={styles.grade}>{team.grade}</span>
            <span className={styles.copy}>
              <b>
                {team.teamName}
                {team.house ? <em>house</em> : null}
              </b>
              <small>{team.headline}</small>
            </span>
            <span className={styles.faces} aria-hidden>
              {team.roster.slice(0, 3).map((pick) => (
                <Avatar key={pick.overall} name={pick.name} imageUrl={pick.imageUrl} />
              ))}
            </span>
          </button>
        ))}
      </section>
    </>
  );
}

function TeamView({
  team,
  prev,
  next,
  onBack,
  onOpenPlayer,
  onOpenTeam,
}: {
  team: RecapTeam;
  prev: RecapTeam | null;
  next: RecapTeam | null;
  onBack: () => void;
  onOpenPlayer: (player: RecapPlayer) => void;
  onOpenTeam: (slot: number) => void;
}) {
  return (
    <section className={`${styles.teamView} ${gradeClass(team.grade)}`}>
      <div className={styles.teamBar}>
        <button type="button" className={styles.back} onClick={onBack}>
          All teams
        </button>
        <b>{team.teamName}</b>
        {prev ? (
          <button type="button" className={styles.navBtn} onClick={() => onOpenTeam(prev.slot)}>
            {prev.grade}
          </button>
        ) : (
          <span className={styles.navBtn} aria-hidden />
        )}
        {next ? (
          <button type="button" className={styles.navBtn} onClick={() => onOpenTeam(next.slot)}>
            {next.grade}
          </button>
        ) : null}
      </div>
      <div className={styles.teamCard} style={{ cursor: "default" }}>
        <span className={styles.rank}>{team.rank}</span>
        <span className={styles.grade}>{team.grade}</span>
        <span className={styles.copy}>
          <b>
            {team.teamName}
            {team.house ? <em>house</em> : null}
          </b>
          <small>{team.headline}</small>
        </span>
      </div>
      <p className={styles.story}>{team.story}</p>
      <ul className={styles.reasons}>
        {team.reasons.map((reason) => (
          <li
            key={reason.text}
            className={
              reason.tone === "good"
                ? styles.good
                : reason.tone === "bad"
                  ? styles.bad
                  : styles.neutral
            }
          >
            {reason.text}
          </li>
        ))}
      </ul>
      <div className={styles.players}>
        {team.roster.map((pick) => (
          <button
            key={pick.overall}
            type="button"
            className={styles.playerCard}
            onClick={() => onOpenPlayer(pick)}
          >
            <Avatar name={pick.name} imageUrl={pick.imageUrl} />
            <span>
              <b>{pick.name}</b>
              <small>
                {pick.position}
                {pick.nflTeam ? ` · ${pick.nflTeam}` : ""}
                {pick.chenRank ? ` · Chen ${pick.chenRank}` : " · off Chen board"}
              </small>
            </span>
            <span className={styles.pick}>{pickLabel(pick)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PlayerSheet({
  player,
  teamName,
  onClose,
}: {
  player: RecapPlayer;
  teamName: string;
  onClose: () => void;
}) {
  return (
    <div className={styles.sheet} onClick={onClose} role="presentation">
      <div
        className={styles.sheetInner}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.sheetTop}>
          <Avatar
            name={player.name}
            imageUrl={player.imageUrl}
            className={player.imageUrl ? styles.sheetPhoto : `${styles.sheetPhoto} ${styles.fallback}`}
          />
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>
        <h2 id="player-sheet-title">{player.name}</h2>
        <p className={styles.sheetMeta}>
          {pickLabel(player)} · {player.position}
          {player.nflTeam ? ` · ${player.nflTeam}` : ""}
          {player.chenRank ? ` · Chen ${player.chenRank}` : " · off Chen board"}
          {player.chenTier ? ` · T${player.chenTier}` : ""}
          {" · "}
          {teamName}
        </p>
        {player.seasons.length === 0 ? (
          <p className={styles.empty}>
            No Sleeper regular-season line yet — rookie, specialist, or too new
            for the 2025 dump.
          </p>
        ) : (
          player.seasons.map((season) => (
            <div key={season.year}>
              <p className={styles.seasonTitle}>{season.year} Sleeper</p>
              <div className={styles.chips}>
                {season.stats.map((chip) => (
                  <div className={styles.chip} key={`${season.year}-${chip.label}`}>
                    <small>{chip.label}</small>
                    <b>{chip.value}</b>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
