"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";

import styles from "./landing.module.css";

interface Room {
  id: string;
  name: string;
  totalSeats: number;
  activeSeats: number;
  openSeats: number;
  scoring: "standard" | "half-ppr" | "ppr";
  rounds: number;
  picks: number;
  totalPicks: number;
  started: boolean;
  complete: boolean;
}

interface RoomsResponse {
  totalRooms: number;
  joinableRooms: number;
  totalOpenSeats: number;
  activePlayers: number;
  rooms: Room[];
}

function roomHref(id: string) {
  return `/demo?room=${encodeURIComponent(id)}`;
}

export function summarizeLiveRooms<T extends Pick<Room, "complete" | "openSeats" | "activeSeats">>(
  rooms: readonly T[],
) {
  const live = rooms.filter((room) => !room.complete);
  const joinable = live.filter((room) => room.openSeats > 0);
  const openSeats = joinable.reduce((sum, room) => sum + room.openSeats, 0);
  const activePlayers = live.reduce((sum, room) => sum + room.activeSeats, 0);
  const headline =
    joinable.length > 0
      ? `${joinable.length} live draft${joinable.length === 1 ? "" : "s"} · ${openSeats} open seat${openSeats === 1 ? "" : "s"}`
      : live.length > 0
        ? `${live.length} live draft${live.length === 1 ? "" : "s"} · rooms full`
        : "No live drafts right now";
  const emptyPrompt =
    joinable.length > 0
      ? null
      : live.length > 0
        ? "Rooms are full — start a fresh one to jump in."
        : "Be the first in the dojo — start a fresh room.";
  return {
    joinable,
    headline,
    emptyPrompt,
    activePlayers,
    cta: joinable.length > 0 ? "Browse live drafts" : "Create a demo draft",
  };
}

export function LiveRooms() {
  const [data, setData] = useState<RoomsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const snapshotRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/demo/rooms", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Room list unavailable");
          return response.json();
        })
        .then((body: RoomsResponse | null) => {
          if (cancelled || !body) return;
          const snapshot = `${body.activePlayers}:${body.rooms
            .map((room) => `${room.id}:${room.picks}:${room.openSeats}:${room.started}`)
            .join("|")}`;
          if (snapshot === snapshotRef.current) {
            setLoadError(false);
            setLoaded(true);
            return;
          }
          snapshotRef.current = snapshot;
          startTransition(() => {
            setData(body);
            setLoadError(false);
            setLoaded(true);
          });
        })
        .catch(() => {
          if (!cancelled) {
            setLoadError(true);
            setLoaded(true);
          }
        });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const summary = summarizeLiveRooms(data?.rooms ?? []);

  return (
    <div className={styles.liveRooms} aria-live="polite">
      <div className={styles.liveRoomsHead}>
        <span className={styles.liveRoomsPulse} aria-hidden="true" />
        <span className={styles.liveRoomsCount}>
          {!loaded
            ? "Checking live drafts…"
            : loadError
              ? "Live drafts are temporarily unavailable"
              : summary.headline}
        </span>
        {loaded && !loadError && summary.activePlayers > 0 && (
          <span className={styles.liveRoomsPlayers}>
            {summary.activePlayers} drafting now
          </span>
        )}
      </div>

      {summary.joinable.length > 0 ? (
        <ul className={styles.liveRoomsList}>
          {summary.joinable.map((room) => (
            <li key={room.id}>
              <Link
                className={styles.liveRoom}
                href={roomHref(room.id)}
                prefetch={false}
              >
                <span className={styles.liveRoomName}>{room.name}</span>
                <span className={styles.liveRoomSeats}>
                        {room.scoring === "half-ppr"
                          ? "Half PPR"
                          : room.scoring === "ppr"
                            ? "Full PPR"
                            : "Standard"}{" "}
                        · {room.totalSeats} teams · {room.openSeats} open
                </span>
                <span className={styles.liveRoomJoin}>
                  {room.started ? "Drafting" : "Waiting"} · Join →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : !loadError && summary.emptyPrompt ? (
        <p className={styles.liveRoomsEmpty}>{summary.emptyPrompt}</p>
      ) : null}

      <Link
        className={styles.liveRoomsCta}
        href={summary.cta === "Create a demo draft" ? "/demo#create" : "/demo"}
      >
        <span>{summary.cta}</span>
        <span aria-hidden="true">JOIN ROOM ↗</span>
      </Link>
    </div>
  );
}
