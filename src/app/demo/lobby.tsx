"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { BrandLockup } from "@/components/brand-lockup";
import {
  DEMO_ROOM_PAGE_SIZE,
  formatDemoStat,
  partitionDemoRooms,
} from "@/domain/demo-lobby";
import { draftSizeNote } from "@/domain/draft-capacity";
import { paginate } from "@/lib/paginate";

type Scoring = "standard" | "half-ppr" | "ppr";

interface DemoRoom {
  id: string;
  name: string;
  totalSeats: number;
  activeSeats: number;
  openSeats: number;
  openSeatList: number[];
  scoring: Scoring;
  rounds: number;
  picks: number;
  totalPicks: number;
  started: boolean;
  complete: boolean;
  exhausted?: boolean;
}

interface DemoNetworkStats {
  boardsRun: number;
  insightsGiven: number;
  playersHelped: number;
}

interface RoomsResponse {
  rooms: DemoRoom[];
  activePlayers: number;
  openRooms?: number;
  closedRooms?: number;
  stats?: DemoNetworkStats;
}

interface CreatedDraft {
  roomId: string;
  slot: number;
}

const SCORING_LABELS: Record<Scoring, string> = {
  standard: "Standard",
  "half-ppr": "Half PPR",
  ppr: "Full PPR",
};

const EMPTY_STATS: DemoNetworkStats = {
  boardsRun: 0,
  insightsGiven: 0,
  playersHelped: 0,
};

function roomPath(roomId: string) {
  return `/demo?room=${encodeURIComponent(roomId)}`;
}

function invitePath(roomId: string) {
  return `${roomPath(roomId)}&join=1`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function roomStatus(room: DemoRoom) {
  if (room.exhausted) return "Board empty";
  if (room.complete) return "Draft complete";
  if (room.started) return "Drafting";
  return "Waiting to start";
}

function roomDetail(room: DemoRoom) {
  if (room.exhausted) return `${room.picks} of ${room.totalPicks} picks · closed`;
  if (room.complete) return `${room.totalPicks} of ${room.totalPicks} picks made`;
  if (room.started) {
    return `${room.activeSeats} seated · ${room.openSeats} open · pick ${Math.min(room.picks + 1, room.totalPicks)}`;
  }
  return `${room.activeSeats} seated · ${room.openSeats} open · waiting to start`;
}

export function DemoLobby() {
  const router = useRouter();
  const [rooms, setRooms] = useState<DemoRoom[]>([]);
  const [stats, setStats] = useState<DemoNetworkStats>(EMPTY_STATS);
  const [activePlayers, setActivePlayers] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [seats, setSeats] = useState<Record<string, number>>({});
  const [scoring, setScoring] = useState<Scoring>("half-ppr");
  const [teamCount, setTeamCount] = useState(12);
  const [rounds, setRounds] = useState(15);
  const [slot, setSlot] = useState(1);
  const [teamName, setTeamName] = useState("");
  const [joinNames, setJoinNames] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<CreatedDraft | null>(null);
  const [copied, setCopied] = useState(false);
  const [openPage, setOpenPage] = useState(1);
  const [closedPage, setClosedPage] = useState(1);
  const teamNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = teamNameRef.current;
    if (!input) return;
    const fromCreateCta = window.location.hash === "#create";
    const focusName = () => {
      input.focus({ preventScroll: !fromCreateCta });
    };
    const frame = window.requestAnimationFrame(focusName);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/demo/rooms", { cache: "no-store" });
        const body = (await response.json()) as RoomsResponse & { error?: string };
        if (!response.ok) {
          if (!cancelled) setNotice(body.error ?? "Could not load public drafts.");
          return;
        }
        if (!cancelled && response.ok) {
          setRooms(body.rooms);
          setStats(body.stats ?? EMPTY_STATS);
          setActivePlayers(body.activePlayers ?? 0);
          setNotice("");
          setSeats((previous) => {
            const next = { ...previous };
            for (const room of body.rooms) {
              if (!room.openSeatList.includes(next[room.id])) {
                next[room.id] = room.openSeatList[0] ?? 1;
              }
            }
            return next;
          });
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!created) return;
    const path = `/api/draft?draftId=${encodeURIComponent(created.roomId)}`;
    const heartbeat = () => {
      void fetch(path, { cache: "no-store" });
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 20_000);
    return () => window.clearInterval(timer);
  }, [created]);

  useEffect(() => {
    if (slot > teamCount) setSlot(teamCount);
  }, [slot, teamCount]);

  const slotOptions = useMemo(
    () => Array.from({ length: teamCount }, (_, index) => index + 1),
    [teamCount],
  );
  const { open, closed } = useMemo(() => partitionDemoRooms(rooms), [rooms]);
  const openPaged = useMemo(
    () => paginate(open, openPage, DEMO_ROOM_PAGE_SIZE),
    [open, openPage],
  );
  const closedPaged = useMemo(
    () => paginate(closed, closedPage, DEMO_ROOM_PAGE_SIZE),
    [closed, closedPage],
  );

  useEffect(() => {
    if (openPage !== openPaged.page) setOpenPage(openPaged.page);
  }, [openPage, openPaged.page]);

  useEffect(() => {
    if (closedPage !== closedPaged.page) setClosedPage(closedPaged.page);
  }, [closedPage, closedPaged.page]);

  async function joinRoom(room: DemoRoom) {
    const requestedSlot = seats[room.id] ?? room.openSeatList[0];
    if (!requestedSlot) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/demo/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          slot: requestedSlot,
          displayName: joinNames[room.id] ?? "",
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        demo?: { roomId: string };
      };
      if (!response.ok || !body.demo?.roomId) {
        setNotice(body.error ?? "That seat is no longer available.");
        return;
      }
      router.push(roomPath(body.demo.roomId));
    } catch {
      setNotice("Could not join that draft. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/demo/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scoring,
          teamCount,
          rounds,
          slot,
          displayName: teamName,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        demo?: { roomId: string; slot: number };
      };
      if (!response.ok || !body.demo?.roomId) {
        setNotice(body.error ?? "Could not create the draft.");
        return;
      }
      setCreated({ roomId: body.demo.roomId, slot: body.demo.slot });
    } catch {
      setNotice("Could not create the draft. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!created) return;
    const url = `${window.location.origin}${invitePath(created.roomId)}`;
    try {
      await copyText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Copy failed — select the link below instead.");
    }
  }

  if (created) {
    const path = roomPath(created.roomId);
    const invite = invitePath(created.roomId);
    const url = typeof window === "undefined" ? invite : `${window.location.origin}${invite}`;
    return (
      <main className="demo-lobby">
        <div className="broadcast-bar">
          <span>PUBLIC DRAFT NETWORK</span>
          <span>LIVE BOARDS · ROSTER-AWARE RANKS · POST-DRAFT GRADES</span>
          <span>INVITE READY</span>
        </div>
        <section className="demo-share-card">
          <p className="eyebrow">Your draft is ready</p>
          <h1>Invite your friends to the mock draft.</h1>
          <p>
            You have slot {created.slot}. The clock stays paused until you start
            it from the board — share this link, wait for friends, then kick it
            off when you&apos;re ready.
          </p>
          <label>
            Invite link
            <input value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
          </label>
          <div className="demo-share-actions">
            <button type="button" onClick={() => void copyInvite()}>
              {copied ? "Copied" : "Copy invite link"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => router.push(path)}
            >
              Enter draft
            </button>
          </div>
          {notice && <p className="demo-lobby-notice">{notice}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="demo-lobby">
      <div className="broadcast-bar">
        <span>PUBLIC DRAFT NETWORK</span>
        <span>LIVE BOARDS · ROSTER-AWARE RANKS · POST-DRAFT GRADES</span>
        <span>OPEN LOBBY</span>
      </div>
      <header className="demo-lobby-header">
        <BrandLockup />
        <nav>
          <Link href="/">Home</Link>
          <Link className="nav-cta" href="/login">
            Sync a league
          </Link>
        </nav>
      </header>

      <section className="demo-lobby-intro">
        <p className="eyebrow">Demo draft lobby</p>
        <h1>Join a live room or build your own.</h1>
        <p>
          Pick an open seat in a public mock, or choose the scoring, roster count,
          rounds, and draft slot for a new one.
        </p>
        <dl className="demo-lobby-stats" aria-label="Dojo totals">
          <div>
            <dt>Boards run</dt>
            <dd>{formatDemoStat(stats.boardsRun)}</dd>
          </div>
          <div>
            <dt>Insights given</dt>
            <dd>{formatDemoStat(stats.insightsGiven)}</dd>
          </div>
          <div>
            <dt>Players helped</dt>
            <dd>{formatDemoStat(stats.playersHelped)}</dd>
          </div>
          <div>
            <dt>Drafting now</dt>
            <dd>{formatDemoStat(activePlayers)}</dd>
          </div>
        </dl>
      </section>

      {notice && <p className="demo-lobby-notice">{notice}</p>}

      <div className="demo-lobby-grid">
        <section className="demo-lobby-panel demo-rooms-panel">
          <RoomSection
            eyebrow="Live now"
            title="Open drafts"
            countLabel={`${openPaged.total} open`}
            loaded={loaded}
            empty="No open drafts yet. Create one and invite the first group."
            paged={openPaged}
            onPageChange={setOpenPage}
          >
            {openPaged.items.map((room) => (
              <li
                className="demo-room-card"
                key={room.id}
              >
                <div className="demo-room-main">
                  <strong>
                    {SCORING_LABELS[room.scoring]}
                    {room.openSeats === 0 ? " · Room full" : ""}
                  </strong>
                  <span>
                    {room.totalSeats} teams · {room.rounds} rounds · {roomStatus(room)}
                  </span>
                  <span>{roomDetail(room)}</span>
                </div>
                <div className="demo-room-actions">
                  <label>
                    Team name
                    <input
                      value={joinNames[room.id] ?? ""}
                      maxLength={32}
                      placeholder="Your team"
                      onChange={(event) =>
                        setJoinNames((previous) => ({
                          ...previous,
                          [room.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Seat
                    <select
                      value={seats[room.id] ?? room.openSeatList[0] ?? ""}
                      onChange={(event) =>
                        setSeats((previous) => ({
                          ...previous,
                          [room.id]: Number(event.target.value),
                        }))
                      }
                    >
                      {room.openSeatList.map((openSlot) => (
                        <option key={openSlot} value={openSlot}>
                          Slot {openSlot}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      (joinNames[room.id] ?? "").trim().length < 2 ||
                      room.openSeatList.length === 0
                    }
                    onClick={() => void joinRoom(room)}
                  >
                    {room.openSeatList.length === 0 ? "Full" : "Join"}
                  </button>
                </div>
              </li>
            ))}
          </RoomSection>

          <RoomSection
            eyebrow="Recent boards"
            title="Closed drafts"
            countLabel={`${closedPaged.total} closed`}
            loaded={loaded}
            empty="Finished mocks land here so you can reopen the board."
            paged={closedPaged}
            onPageChange={setClosedPage}
          >
            {closedPaged.items.map((room) => (
              <li className="demo-room-card complete" key={room.id}>
                <div className="demo-room-main">
                  <strong>
                    {SCORING_LABELS[room.scoring]}
                    {room.exhausted ? " · Board empty" : " · Draft complete"}
                  </strong>
                  <span>
                    {room.totalSeats} teams · {room.rounds} rounds
                  </span>
                  <span>{roomDetail(room)}</span>
                </div>
                <div className="demo-room-actions">
                  <Link className="demo-room-view" href={roomPath(room.id)}>
                    View board
                  </Link>
                </div>
              </li>
            ))}
          </RoomSection>
        </section>

        <section id="create" className="demo-lobby-panel demo-create-panel">
          <p className="eyebrow">New room</p>
          <h2>Set up a draft</h2>
          <form onSubmit={(event) => void createRoom(event)}>
            <label className="demo-create-name">
              Your team name
              <input
                ref={teamNameRef}
                id="create-team-name"
                value={teamName}
                maxLength={32}
                placeholder="e.g. Cobra Kai"
                autoComplete="off"
                onChange={(event) => setTeamName(event.target.value)}
              />
            </label>
            <label>
              Scoring
              <select
                value={scoring}
                onChange={(event) => setScoring(event.target.value as Scoring)}
              >
                <option value="standard">Standard</option>
                <option value="half-ppr">Half PPR</option>
                <option value="ppr">Full PPR</option>
              </select>
            </label>
            <label>
              Rosters
              <select
                value={teamCount}
                onChange={(event) => setTeamCount(Number(event.target.value))}
              >
                {[8, 10, 12, 14].map((count) => (
                  <option key={count} value={count}>
                    {count} teams
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rounds
              <select
                value={rounds}
                onChange={(event) => setRounds(Number(event.target.value))}
              >
                {[10, 12, 14, 15, 16].map((count) => (
                  <option key={count} value={count}>
                    {count} rounds
                  </option>
                ))}
              </select>
            </label>
            <label>
              Your slot
              <select
                value={slot}
                onChange={(event) => setSlot(Number(event.target.value))}
              >
                {slotOptions.map((option) => (
                  <option key={option} value={option}>
                    Slot {option}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy || teamName.trim().length < 2}
            >
              {busy ? "Creating…" : "Create public draft"}
            </button>
          </form>
          <p className="demo-create-note">{draftSizeNote(teamCount, rounds)}</p>
          <p className="demo-create-note">
            You will get a unique invite link. The draft stays paused until you
            start it, so you can wait for friends. Robots fill empty seats after
            you start.
          </p>
        </section>
      </div>
    </main>
  );
}

function RoomSection({
  eyebrow,
  title,
  countLabel,
  loaded,
  empty,
  paged,
  onPageChange,
  children,
}: {
  eyebrow: string;
  title: string;
  countLabel: string;
  loaded: boolean;
  empty: string;
  paged: ReturnType<typeof paginate<DemoRoom>>;
  onPageChange: (page: number) => void;
  children: ReactNode;
}) {
  return (
    <section className="demo-room-section">
      <div className="demo-lobby-panel-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <span>{countLabel}</span>
      </div>
      {!loaded ? (
        <p className="demo-lobby-empty">Checking for drafts…</p>
      ) : paged.total === 0 ? (
        <p className="demo-lobby-empty">{empty}</p>
      ) : (
        <>
          <ul className="demo-room-list">{children}</ul>
          {paged.pageCount > 1 && (
            <div className="demo-room-pager">
              <button
                type="button"
                className="secondary"
                disabled={paged.page <= 1}
                onClick={() => onPageChange(paged.page - 1)}
              >
                Previous
              </button>
              <span>
                {paged.from}–{paged.to} of {paged.total}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={paged.page >= paged.pageCount}
                onClick={() => onPageChange(paged.page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
