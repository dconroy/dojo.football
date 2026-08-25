"use client";

import Image from "next/image";
import Link from "next/link";
import { Fragment, memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeRoomTendencies,
  analyzeDraftRoster,
  availablePlayers,
  buildAvailabilityMap,
  createDraftState,
  extendDraftWithRemotePlayers,
  formatAdp,
  makeManualPick,
  nextSelectionForSlot,
  recommendPlayers,
  resolveTrackedPlayerIds,
  stableTrackId,
  rosterPicks,
  selectionForOverall,
  type DraftState,
  type Player,
  type Position,
  type StrategyWeights,
  type AvailabilitySignal,
} from "@/domain";
import { BrandLockup } from "@/components/brand-lockup";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the dormant CSV-import fallback (importFile)
import {
  CHEN_SCORING,
  parseChenCsv,
  scoringFromSource,
  type ChenScoring,
} from "@/adapters/chen/boris-chen";
import {
  parseRankingSource,
  sourceFromBoard,
} from "@/adapters/rankings/labels";
import {
  defaultWeightsForExpert,
  expertSliderKeys,
  expertSliderLabel,
  withExpertWeights,
} from "@/adapters/rankings/strategy-presets";
import { MOCK_PLAYERS } from "@/fixtures/mock-players";
import { resolvePlayerIdentity } from "@/domain/identity";
import { formatStamp } from "@/lib/build-info";
import { DraftReportCard } from "@/components/draft-report-card";
import { DemoChatPanel } from "@/components/demo-chat-panel";
import { useDialogAccessibility } from "@/components/use-dialog-accessibility";
import { buildDraftReport } from "@/domain/draft-report";
import {
  humanTeamFallback,
  rpBotTeamName,
} from "@/domain/demo-labels";
import { mergePollPlayers, playerRevision } from "@/lib/board-sync";
import {
  demoFetch as fetch,
  saveDemoTabToken,
} from "@/lib/demo-tab-session";
import {
  draftBoardExhausted,
  draftIsFinished,
  shortBoardMessage,
} from "@/domain/draft-capacity";

interface RemoteDraftPick {
  pick: number;
  round: number;
  teamKey?: string;
  playerKey?: string;
  playerName?: string;
  playerPosition?: string;
  playerTeam?: string;
}

interface SyncSnapshot {
  draftResults: RemoteDraftPick[];
  mockOrder?: Array<{
    id: string;
    name: string;
    position: string;
    team: string;
  }>;
  waitingSlot?: number | null;
  humanSlots?: number[];
  autoPickAt?: string | null;
  syncedAt: string;
}

const STORAGE_KEY = "draft-room-2026-v1";
const TURN_SOUND_STORAGE_KEY = "draft-room-turn-sound";
const POSITIONS: readonly (Position | "ALL")[] = [
  "ALL", "QB", "RB", "WR", "TE", "K", "DEF",
];

function availabilityLabel(signal: AvailabilitySignal): string {
  if (signal === "take_now") return "Draft now";
  if (signal === "safe_to_wait") return "Safe to wait";
  if (signal === "neutral") return "Toss-up";
  return "Odds unknown";
}

function nextTurnAvailabilityPercent(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

function createAudioContext(): AudioContext | null {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : null;
}

function playTurnChime(context: AudioContext) {
  const startAt = context.currentTime + 0.02;
  const master = context.createGain();
  master.gain.setValueAtTime(0.7, startAt);
  master.connect(context.destination);

  for (const note of [
    { frequency: 659.25, start: 0, duration: 0.2 },
    { frequency: 880, start: 0.22, duration: 0.38 },
  ]) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const noteStart = startAt + note.start;
    const noteEnd = noteStart + note.duration;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
    envelope.gain.setValueAtTime(0.0001, noteStart);
    envelope.gain.exponentialRampToValueAtTime(0.16, noteStart + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd);
  }
}

interface MemberSeat {
  id: string;
  displayName: string;
  draftSlot: number | null;
  teamName: string | null;
  role: string;
  status: string;
  lastSeenAt?: string | null;
}

function presenceLabel(lastSeenAt?: string | null): {
  online: boolean;
  label: string;
} {
  if (!lastSeenAt) return { online: false, label: "not seen yet" };
  const ageMs = Date.now() - Date.parse(lastSeenAt);
  if (ageMs < 90_000) return { online: true, label: "here now" };
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return { online: false, label: `${minutes}m ago` };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { online: false, label: `${hours}h ago` };
  return { online: false, label: `${Math.round(hours / 24)}d ago` };
}

interface MeState {
  id: string;
  displayName: string;
  role: "admin" | "member";
  draftSlot: number;
  teamName: string;
  pins: string[];
  avoids: string[];
  weights: StrategyWeights;
  darkMode: boolean;
  canManageBoard?: boolean;
}

interface PersistedUiState {
  mode: "mock" | "live";
  draft: DraftState;
  players: readonly Player[];
  pins: readonly string[];
  avoids: readonly string[];
  importedAt: string;
  source: string;
  weights: StrategyWeights;
  updatedAt?: string;
  leagueKey?: string | null;
}

interface DraftPayload {
  mode?: "mock" | "live";
  draft?: DraftState;
  players?: readonly Player[];
  importedAt?: string;
  source?: string;
  updatedAt: string;
  leagueKey?: string | null;
  members: MemberSeat[];
  me: MeState;
  unchanged?: boolean;
  playersOmitted?: boolean;
  demoToken?: string;
}

interface DemoInfo {
  role: "watch" | "play";
  slot: number | null;
  roomId: string;
  takenSlots?: number[];
  started?: boolean;
}

interface YahooLeagueChoice {
  leagueKey: string;
  name: string;
  season?: number;
  numTeams?: number;
  draftStatus?: string;
}

const initialState: PersistedUiState = {
  mode: "mock",
  draft: createDraftState(1),
  players: MOCK_PLAYERS,
  pins: [],
  avoids: [],
  importedAt: "Synthetic fixture",
  source: "Built-in mock data",
  weights: DEFAULT_STRATEGY_WEIGHTS,
};

function normalizePersisted(state: Partial<PersistedUiState> | null): PersistedUiState {
  if (!state?.draft || !state.players) return initialState;
  return {
    ...initialState,
    ...state,
    mode: state.mode === "live" ? "live" : "mock",
    pins: Array.isArray(state.pins) ? state.pins : [],
    avoids: Array.isArray(state.avoids) ? state.avoids : [],
  };
}

function hydrate(): PersistedUiState {
  if (typeof window === "undefined") return initialState;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved
      ? normalizePersisted(JSON.parse(saved) as Partial<PersistedUiState>)
      : initialState;
  } catch {
    return initialState;
  }
}

function scoreComparison(
  first: ReturnType<typeof recommendPlayers>["recommendations"][number],
  alternative: ReturnType<typeof recommendPlayers>["recommendations"][number],
) {
  const alternativeFactors = new Map(
    alternative.factors.map((factor) => [factor.factor, factor.contribution]),
  );
  const advantage = first.factors
    .map((factor) => ({
      label: factor.explanation,
      delta: factor.contribution - (alternativeFactors.get(factor.factor) ?? 0),
    }))
    .sort((a, b) => b.delta - a.delta)[0];
  return advantage?.delta > 0
    ? `${first.player.name} leads ${alternative.player.name} by ${(first.score - alternative.score).toFixed(1)} points, primarily because ${advantage.label.toLowerCase()}.`
    : `${first.player.name} wins the calculated tie-break on board rank.`;
}

/** Sleeper hosts free, no-auth team logos keyed by lowercase abbreviation. */
function teamLogoUrl(team?: string): string | null {
  if (!team || team === "FA") return null;
  return `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");
}

/**
 * Round headshot with a gray initials fallback when Sleeper has no photo
 * (missing files 403 instead of a default image).
 */
const PlayerAvatar = memo(function PlayerAvatar({
  name,
  imageUrl,
  size = 34,
  className = "avatar",
  alt = "",
}: {
  name: string;
  imageUrl?: string;
  size?: number;
  className?: string;
  alt?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [imageUrl]);

  if (!imageUrl || broken) {
    return (
      <span
        className={`${className} placeholder`}
        style={
          className === "avatar" ? { width: size, height: size } : undefined
        }
        aria-hidden
      >
        {initials(name)}
      </span>
    );
  }
  return (
    <Image
      className={className}
      src={imageUrl}
      alt={alt}
      width={size}
      height={size}
      unoptimized
      onError={() => setBroken(true)}
    />
  );
});

/** Small team logo badge; renders nothing for free agents / unknown teams. */
function TeamLogo({ team, size = 16 }: { team?: string; size?: number }) {
  const url = teamLogoUrl(team);
  if (!url) return null;
  return (
    <Image
      className="team-logo"
      src={url}
      alt={team ?? ""}
      width={size}
      height={size}
      unoptimized
    />
  );
}

export function DraftAssistant({
  variant = "league",
}: {
  variant?: "league" | "demo";
} = {}) {
  const isDemo = variant === "demo";
  const [draftId, setDraftId] = useState<string | null>(null);
  const [demoRole, setDemoRole] = useState<"watch" | "play" | null>(
    isDemo ? "watch" : null,
  );
  const [takenSlots, setTakenSlots] = useState<number[]>([]);
  const [chosenSeat, setChosenSeat] = useState<number | null>(null);
  const [demoStarted, setDemoStarted] = useState(!isDemo);
  const [demoTeamName, setDemoTeamName] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const inviteCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rankingSources, setRankingSources] = useState<
    Array<{ id: string; label: string; available: boolean }>
  >([{ id: "chen", label: "Boris Chen", available: true }]);
  const [state, setState] = useState<PersistedUiState>(initialState);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<Position | "ALL">("ALL");
  const [tier, setTier] = useState("ALL");
  const [listFilter, setListFilter] = useState<"all" | "avoids" | "pins">("all");
  const [recoTab, setRecoTab] = useState<"top" | "insights">("top");
  const [selected, setSelected] = useState<string | null>(null);
  const selectionPickCountRef = useRef(0);
  const [syncPaused, setSyncPaused] = useState(false);
  const [previewMember, setPreviewMember] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundPreferenceReady, setSoundPreferenceReady] = useState(false);
  const [yahooConnected, setYahooConnected] = useState(false);
  const [notice, setNotice] = useState("Simulation ready");
  const [leagueKey, setLeagueKey] = useState("");
  const [syncIntervalSec, setSyncIntervalSec] = useState(3);
  const [syncStatus, setSyncStatus] = useState<string>("idle");
  const [autoPickAt, setAutoPickAt] = useState<string | null>(null);
  const [waitingSlotRemote, setWaitingSlotRemote] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [me, setMe] = useState<MeState | null>(null);
  const [members, setMembers] = useState<MemberSeat[]>([]);
  const [adminUsers, setAdminUsers] = useState<MemberSeat[]>([]);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const reportSeenKey = useRef<string | null>(null);
  const reportAutoOpenReady = useRef(false);
  const [liveKeyDraft, setLiveKeyDraft] = useState("");
  const [yahooLeagues, setYahooLeagues] = useState<YahooLeagueChoice[]>([]);
  const [yahooLeaguesLoading, setYahooLeaguesLoading] = useState(false);
  const [yahooLeaguesError, setYahooLeaguesError] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const launcherDialogRef = useDialogAccessibility<HTMLDivElement>(
    launcherOpen,
    () => setLauncherOpen(false),
  );
  const adminDialogRef = useDialogAccessibility<HTMLDivElement>(
    adminOpen,
    () => setAdminOpen(false),
  );
  const detailDialogRef = useDialogAccessibility<HTMLDivElement>(
    Boolean(detailId),
    () => setDetailId(null),
  );
  const [playerBrief, setPlayerBrief] = useState<{
    seasons: Array<{
      year: number;
      stats: Array<{ label: string; value: string }>;
    }>;
    news: Array<{ title: string; url: string; published?: string }>;
  } | null>(null);
  const [briefStatus, setBriefStatus] = useState<"idle" | "loading" | "ready">(
    "idle",
  );
  const [chenBusy, setChenBusy] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousIsMyTurn = useRef<boolean | null>(null);
  const ensureTurnAudio = useCallback(() => {
    let context = audioContextRef.current;
    if (!context || context.state === "closed") {
      context = createAudioContext();
      audioContextRef.current = context;
    }
    if (context?.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
  }, []);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const membersRef = useRef<MemberSeat[]>(members);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);
  useEffect(
    () => () => {
      if (inviteCopiedTimer.current) clearTimeout(inviteCopiedTimer.current);
    },
    [],
  );
  useEffect(() => {
    setSoundEnabled(
      window.localStorage.getItem(TURN_SOUND_STORAGE_KEY) !== "false",
    );
    setSoundPreferenceReady(true);
  }, []);
  useEffect(() => {
    if (!soundPreferenceReady || !soundEnabled) return;
    const unlock = () => {
      ensureTurnAudio();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [ensureTurnAudio, soundEnabled, soundPreferenceReady]);
  useEffect(
    () => () => {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    },
    [],
  );

  /** Draft slots that pause for a human: every member with an assigned slot. */
  function humanSlotList(): number[] {
    const slots = new Set<number>();
    const mine = stateRef.current.draft.userSlot;
    if (mine) slots.add(mine);
    for (const member of membersRef.current) {
      if (member.draftSlot) slots.add(member.draftSlot);
    }
    return [...slots].sort((a, b) => a - b);
  }

  function draftApi(path: string) {
    if (!draftId || path.includes("?")) return path;
    if (path.startsWith("/api/draft") || path.startsWith("/api/draft/pick")) {
      return `${path}?draftId=${encodeURIComponent(draftId)}`;
    }
    return path;
  }

  function applyPayload(payload: DraftPayload & { demo?: DemoInfo }, message?: string) {
    if (payload.demoToken) saveDemoTabToken(payload.demoToken);
    if (payload.unchanged) {
      setMembers(payload.members);
      if (payload.me) setMe(payload.me);
      if (payload.demo) {
        setDraftId(payload.demo.roomId);
        setDemoRole(payload.demo.role);
        if (payload.demo.role === "play" && payload.me) {
          setDemoTeamName(payload.me.teamName);
        }
        if (payload.demo.takenSlots) setTakenSlots(payload.demo.takenSlots);
        setDemoStarted(payload.demo.started !== false);
      }
      if (payload.updatedAt) {
        setState((prev) =>
          prev.updatedAt === payload.updatedAt
            ? prev
            : { ...prev, updatedAt: payload.updatedAt },
        );
      }
      return;
    }
    if (!payload.draft || !payload.me) return;
    // Spectators (demo "watch") report draftSlot 0 — no seat. Clamp any invalid
    // slot to a real one so snake math (nextSelectionForSlot, recommendations)
    // never throws "slot must be between 1 and N" and crashes the whole page.
    const teamCount = payload.draft.teamCount ?? 12;
    const rawSlot = payload.me.draftSlot;
    const safeUserSlot =
      Number.isInteger(rawSlot) && rawSlot >= 1 && rawSlot <= teamCount
        ? rawSlot
        : 1;
    const next = normalizePersisted({
      mode: payload.mode,
      draft: {
        ...payload.draft,
        userSlot: safeUserSlot,
      },
      players: mergePollPlayers(stateRef.current.players, payload),
      importedAt: payload.importedAt ?? stateRef.current.importedAt,
      source: payload.source ?? stateRef.current.source,
      pins: payload.demo ? stateRef.current.pins : payload.me.pins,
      avoids: payload.demo ? stateRef.current.avoids : payload.me.avoids,
      weights: payload.demo ? stateRef.current.weights : payload.me.weights,
      updatedAt: payload.updatedAt,
      leagueKey: payload.leagueKey,
    });
    setState(next);
    setMe(payload.me);
    setMembers(payload.members);
    if (payload.leagueKey) setLeagueKey(payload.leagueKey);
    if (payload.demo) {
      setDraftId(payload.demo.roomId);
      setDemoRole(payload.demo.role);
      if (payload.demo.role === "play") setDemoTeamName(payload.me.teamName);
      if (payload.demo.takenSlots) setTakenSlots(payload.demo.takenSlots);
      setDemoStarted(payload.demo.started !== false);
    }
    if (message) setNotice(message);
  }

  useEffect(() => {
    let cancelled = false;
    let boot = isDemo ? "/api/demo" : "/api/draft";
    if (isDemo && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const room = params.get("room");
      if (room) {
        boot = `/api/demo?room=${encodeURIComponent(room)}`;
        if (params.get("join") === "1") boot += "&join=1";
      }
    }
    fetch(boot)
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `Unable to load room (${response.status})`);
        }
        return body;
      })
      .then((payload: (DraftPayload & { demo?: DemoInfo }) | null) => {
        if (cancelled) return;
        if (payload?.draft && payload.players?.length && payload.me) {
          if (payload.demo) setDraftId(payload.demo.roomId);
          applyPayload(payload, isDemo ? "Demo room ready" : "Loaded shared draft board");
        } else if (!isDemo) {
          setState(hydrate());
        } else {
          setNotice("That demo room could not be loaded. Return to the lobby and try again.");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (isDemo) {
          setNotice(error instanceof Error ? error.message : "Unable to load the demo room");
        } else {
          setState(hydrate());
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  useEffect(() => {
    fetch("/api/rankings?list=sources")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { sources?: Array<{ id: string; label: string; available: boolean }> } | null) => {
        if (body?.sources?.length) setRankingSources(body.sources);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      const current = stateRef.current;
      const params = new URLSearchParams();
      if (draftId) params.set("draftId", draftId);
      if (current.updatedAt) params.set("since", current.updatedAt);
      if (current.importedAt && current.source) {
        params.set("playersRev", playerRevision(current.importedAt, current.source));
      }
      fetch(`/api/draft?${params}`, { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(body?.error ?? `Board sync failed (${response.status})`);
          }
          return body;
        })
        .then((payload: (DraftPayload & { demo?: DemoInfo }) | null) => {
          if (!payload?.updatedAt && !payload?.unchanged) return;
          applyPayload(payload);
        })
        .catch((error) => {
          setNotice(error instanceof Error ? error.message : "Board sync failed");
        });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [ready, draftId, isDemo]);

  useEffect(() => {
    fetch("/api/yahoo/status")
      .then((response) => response.json())
      .then((status: { connected?: boolean }) =>
        setYahooConnected(status.connected === true),
      )
      .catch(() => setYahooConnected(false));
    const yahooResult = new URLSearchParams(window.location.search).get("yahoo");
    if (yahooResult === "connected") setNotice("Yahoo signed in.");
    if (yahooResult === "denied") setNotice("Yahoo authorization was cancelled.");
    if (yahooResult === "error") setNotice("Yahoo authorization failed.");
  }, []);

  useEffect(() => {
    if (!launcherOpen || !yahooConnected || isDemo) return;
    let cancelled = false;
    setYahooLeaguesLoading(true);
    setYahooLeaguesError("");
    fetch("/api/yahoo/leagues", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          leagues?: YahooLeagueChoice[];
          error?: string;
        } | null;
        if (!response.ok) {
          throw new Error(body?.error ?? "Could not load your Yahoo leagues.");
        }
        return body?.leagues ?? [];
      })
      .then((leagues) => {
        if (cancelled) return;
        setYahooLeagues(leagues);
        if (leagues[0]?.leagueKey) {
          setLiveKeyDraft((current) => current || leagues[0].leagueKey);
        }
        if (leagues.length === 0) {
          setYahooLeaguesError("Yahoo returned no NFL leagues for this account.");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setYahooLeaguesError(
            error instanceof Error ? error.message : "Could not load your Yahoo leagues.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setYahooLeaguesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [launcherOpen, yahooConnected, isDemo]);

  useEffect(() => {
    if (me?.role !== "admin") return;
    fetch("/api/admin/users")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { users?: MemberSeat[] } | null) => {
        if (body?.users) setAdminUsers(body.users);
      })
      .catch(() => undefined);
  }, [me?.role, members]);

  useEffect(() => {
    if (!ready || !me) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const timeout = window.setTimeout(() => {
      if (isDemo) return;
      fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftSlot: state.draft.userSlot,
          pins: state.pins,
          avoids: state.avoids,
          weights: state.weights,
          darkMode: true,
          teamName: me.teamName,
        }),
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [ready, isDemo, state, state.draft.userSlot, state.pins, state.avoids, state.weights, me]);

  const totalPicks = state.draft.teamCount * state.draft.rounds;
  const current = selectionForOverall(
    Math.min(state.draft.picks.length + 1, Math.max(1, totalPicks)),
    state.draft.teamCount,
  );
  const hasDraftSeat = !isDemo || demoRole === "play";
  const nextMine = nextSelectionForSlot(
    current.overall,
    state.draft.userSlot,
    state.draft.rounds,
    state.draft.teamCount,
  );
  const picksUntilMyTurn = nextMine
    ? Math.max(0, nextMine.overall - current.overall)
    : 0;
  const boardCapacity = {
    picks: state.draft.picks.length,
    playerCount: state.players.length,
    teamCount: state.draft.teamCount,
    rounds: state.draft.rounds,
  };
  const boardExhausted = draftBoardExhausted(boardCapacity);
  const draftComplete = draftIsFinished(boardCapacity);
  const finishedSpectator = isDemo && demoRole === "watch" && draftComplete;
  const canChangeRankings =
    !draftComplete &&
    (me?.canManageBoard === true ||
      (isDemo && demoRole === "play" && state.draft.picks.length === 0));
  const isMyTurn =
    !draftComplete &&
    current.slot === state.draft.userSlot &&
    (!isDemo || (demoRole === "play" && demoStarted));
  const draftReport = useMemo(
    () => (draftComplete ? buildDraftReport(state.draft) : null),
    [draftComplete, state.draft],
  );
  useEffect(() => {
    if (selectionPickCountRef.current === state.draft.picks.length) return;
    selectionPickCountRef.current = state.draft.picks.length;
    setSelected(null);
    if (isMyTurn) setDetailId(null);
  }, [isMyTurn, state.draft.picks.length]);
  useEffect(() => {
    if (!ready) return;
    const key = `${state.leagueKey ?? "board"}:${state.draft.picks.length}`;
    if (!reportAutoOpenReady.current) {
      reportAutoOpenReady.current = true;
      reportSeenKey.current = draftComplete ? key : null;
      return;
    }
    if (!draftComplete) return;
    if (reportSeenKey.current === key) return;
    reportSeenKey.current = key;
    setReportOpen(true);
  }, [ready, draftComplete, state.leagueKey, state.draft.picks.length]);

  useEffect(() => {
    if (
      !ready ||
      isDemo ||
      me?.role !== "admin" ||
      previewMember ||
      !draftComplete
    ) return;
    const yahooResult = new URLSearchParams(window.location.search).get("yahoo");
    if (yahooResult === "connected") setLauncherOpen(true);
  }, [ready, isDemo, me?.role, previewMember, draftComplete]);
  useEffect(() => {
    document.title = isMyTurn
      ? "🚨 YOUR PICK — Draft Dojo"
      : "Draft Dojo";
  }, [isMyTurn]);
  useEffect(() => {
    if (!ready) {
      previousIsMyTurn.current = null;
      return;
    }
    const wasMyTurn = previousIsMyTurn.current;
    previousIsMyTurn.current = isMyTurn;
    if (wasMyTurn !== false || !isMyTurn || !soundEnabled) return;

    const context = audioContextRef.current;
    if (!context) return;
    const play = async () => {
      if (context.state === "suspended") {
        await context.resume().catch(() => undefined);
      }
      if (context.state === "running") playTurnChime(context);
    };
    void play();
  }, [isMyTurn, ready, soundEnabled]);
  // Tick once a second only while an auto-draft deadline is pending, so the
  // countdown updates without re-rendering the board the rest of the time.
  useEffect(() => {
    if (!autoPickAt) return;
    setNowTick(Date.now());
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [autoPickAt]);
  const autoPickSeconds = autoPickAt
    ? Math.max(0, Math.ceil((Date.parse(autoPickAt) - nowTick) / 1000))
    : null;
  // Only surface the auto-draft countdown when the board is actually parked on
  // the seat that will be auto-drafted (not while robots ahead of them resolve).
  const showAutoCountdown =
    autoPickSeconds !== null &&
    waitingSlotRemote !== null &&
    waitingSlotRemote === current.slot;
  const autoPickFlushKey = useRef<string | null>(null);
  useEffect(() => {
    if (
      !showAutoCountdown ||
      autoPickSeconds !== 0 ||
      !autoPickAt ||
      !leagueKey.trim()
    ) {
      return;
    }
    if (autoPickFlushKey.current === autoPickAt) return;
    autoPickFlushKey.current = autoPickAt;
    const key = leagueKey.trim();
    void fetch(`/api/yahoo/sync?leagueKey=${encodeURIComponent(key)}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((snapshot: SyncSnapshot | null) => {
        if (snapshot) reconcileRemote(snapshot);
      })
      .catch(() => undefined);
    // reconcileRemote is defined later in this component and read via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAutoCountdown, autoPickSeconds, autoPickAt, leagueKey]);
  const available = useMemo(
    () => availablePlayers(state.draft, state.players),
    [state.draft, state.players],
  );
  const avoids = useMemo(
    () => resolveTrackedPlayerIds(state.avoids ?? [], state.players),
    [state.avoids, state.players],
  );
  const pins = useMemo(
    () => resolveTrackedPlayerIds(state.pins ?? [], state.players),
    [state.pins, state.players],
  );
  const draftedIds = useMemo(
    () => new Set(state.draft.picks.map((pick) => pick.player.id)),
    [state.draft.picks],
  );
  const recommendation = useMemo(
    () =>
      recommendPlayers(state.draft, state.players, {
        weights: state.weights,
        excludePlayerIds: avoids,
      }),
    [state.draft, state.players, state.weights, avoids],
  );
  const roomTendencies = useMemo(
    () => analyzeRoomTendencies(state.draft),
    [state.draft],
  );
  const availabilityById = useMemo(
    () => buildAvailabilityMap(state.draft, state.players),
    [state.draft, state.players],
  );
  const myRoster = useMemo(
    () =>
      hasDraftSeat
        ? rosterPicks(state.draft.picks, state.draft.userSlot)
        : [],
    [hasDraftSeat, state.draft.picks, state.draft.userSlot],
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
                "Best calculated value available",
            }
          : undefined,
      }),
    [myRoster, current.round, recommendation],
  );
  const pinSet = useMemo(() => new Set(pins), [pins]);
  const avoidSet = useMemo(() => new Set(avoids), [avoids]);
  const insightFlags =
    insights.alerts.filter((alert) => alert.severity !== "info").length +
    roomTendencies.alerts.filter((alert) => alert.confidence !== "low").length;
  const tiers = useMemo(
    () =>
      [...new Set(available.map((player) => player.chenTier))]
        .filter((value): value is number => value !== undefined)
        .sort((a, b) => a - b),
    [available],
  );
  const filtered = useMemo(() => {
    const needle = search.toLowerCase();
    return (listFilter === "all" ? available : state.players)
      .filter((player) => position === "ALL" || player.position === position)
      .filter((player) => tier === "ALL" || player.chenTier === Number(tier))
      .filter((player) =>
        `${player.name} ${player.team}`.toLowerCase().includes(needle),
      )
      .filter((player) =>
        listFilter === "all"
          ? true
          : listFilter === "avoids"
            ? avoidSet.has(player.id)
            : pinSet.has(player.id),
      )
      .sort((a, b) => {
        const pinDelta = Number(pinSet.has(b.id)) - Number(pinSet.has(a.id));
        return (
          pinDelta ||
          (a.chenRank ?? Number.MAX_SAFE_INTEGER) -
            (b.chenRank ?? Number.MAX_SAFE_INTEGER)
        );
      });
  }, [
    available,
    avoidSet,
    listFilter,
    pinSet,
    position,
    search,
    state.players,
    tier,
  ]);

  async function mutateDraft(
    path: string,
    body: Record<string, unknown>,
    message: string,
  ) {
    const response = await fetch(draftApi(path), {
      method: path.includes("/pick") ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as DraftPayload & {
      error?: string;
    };
    if (!response.ok || !payload?.draft) {
      setNotice(payload?.error ?? "Draft update failed");
      return false;
    }
    applyPayload(payload, message);
    return true;
  }

  function teamLabel(slot: number) {
    if (hasDraftSeat && slot === state.draft.userSlot) {
      return me?.teamName || humanTeamFallback();
    }
    const occupant = members.find((member) => member.draftSlot === slot);
    if (occupant) return occupant.teamName || occupant.displayName;
    return isDemo
      ? rpBotTeamName(slot, draftId ?? state.leagueKey ?? "")
      : `T${slot}`;
  }

  function isHumanDemoSlot(slot: number) {
    return isDemo && members.some((member) => member.draftSlot === slot);
  }

  function reconcileRemote(snapshot: SyncSnapshot) {
    const current = stateRef.current;
    setAutoPickAt(snapshot.autoPickAt ?? null);
    setWaitingSlotRemote(snapshot.waitingSlot ?? null);
    const remote = [...snapshot.draftResults].sort((a, b) => a.pick - b.pick);
    const isMockHarness = leagueKey.startsWith("mock.");
    // Source of truth for which seats pause is the snapshot — those are the
    // seats the running mock actually froze at start. The live member list
    // (`humanSlotList()`) can grow after the mock began (someone picks a slot),
    // which would mislabel robot-filled seats as "waiting". Fall back to it only
    // when a snapshot doesn't carry the set (e.g. a real Yahoo league).
    const humanSlots = new Set(
      snapshot.humanSlots && snapshot.humanSlots.length > 0
        ? snapshot.humanSlots
        : humanSlotList(),
    );
    const nextLocalSlot = selectionForOverall(
      current.draft.picks.length + 1,
      current.draft.teamCount,
    ).slot;
    if (remote.length <= current.draft.picks.length) {
      setSyncStatus(
        nextLocalSlot === current.draft.userSlot
          ? `your turn · confirm (${current.draft.picks.length} picks)`
          : isMockHarness && humanSlots.has(nextLocalSlot)
            ? `waiting on slot ${nextLocalSlot} (${current.draft.picks.length} picks)`
            : `in sync · ${remote.length} picks`,
      );
      return;
    }
    const mockLookup = new Map(
      (snapshot.mockOrder ?? []).map((player) => [`mock.p.${player.id}`, player]),
    );
    const unresolved: string[] = [];
    const resolvedRemote: Player[] = [];
    // The mock only publishes *resolved* picks (robots, confirmed humans, and
    // auto-drafted humans) and always omits the seat currently on the clock, so
    // everything here is safe to apply in order. A human seat that never picks
    // is auto-drafted server-side after the deadline and shows up as a normal
    // pick — that's how the board keeps moving when someone steps away.
    for (const pick of isMockHarness
      ? remote
      : remote.slice(current.draft.picks.length)) {
      const mockPlayer = pick.playerKey ? mockLookup.get(pick.playerKey) : undefined;
      const query = mockPlayer?.name ?? pick.playerName ?? "";
      const team = mockPlayer?.team ?? pick.playerTeam;
      const byId = mockPlayer
        ? current.players.find((player) => player.id === mockPlayer.id)
        : undefined;
      if (!query && !byId && !mockPlayer) {
        unresolved.push(`pick ${pick.pick}: no player name`);
        break;
      }
      const identity = byId
        ? { status: "resolved" as const, player: byId }
        : query
          ? resolvePlayerIdentity(query, current.players, { team })
          : { status: "unresolved" as const };
      const fallback = mockPlayer
        ? {
            id: mockPlayer.id,
            name: mockPlayer.name,
            position: mockPlayer.position as Position,
            team: mockPlayer.team,
          }
        : undefined;
      const resolved =
        identity.status === "resolved"
          ? identity.player
          : fallback;
      if (!resolved) {
        unresolved.push(`pick ${pick.pick}: ${identity.status} for ${query}`);
        break;
      }
      resolvedRemote.push(resolved);
    }
    let draft = current.draft;
    let applied = 0;
    let rebuilt = false;
    if (resolvedRemote.length > 0) {
      try {
        const next = isMockHarness
          ? extendDraftWithRemotePlayers(
              current.draft,
              resolvedRemote,
              snapshot.syncedAt,
              false,
            )
          : (() => {
              let nextDraft = current.draft;
              let added = 0;
              for (const player of resolvedRemote) {
                nextDraft = makeManualPick(nextDraft, player, {
                  madeAt: snapshot.syncedAt,
                });
                added += 1;
              }
              return { draft: nextDraft, applied: added, rebuilt: false };
            })();
        draft = next.draft;
        applied = next.applied;
        rebuilt = next.rebuilt;
      } catch (error) {
        unresolved.push(error instanceof Error ? error.message : "failed");
      }
    }
    if (applied > 0) {
      void mutateDraft(
        "/api/draft",
        {
          action: "picks",
          picks: draft.picks,
          replace: rebuilt && isMockHarness,
          expectedUpdatedAt: current.updatedAt,
        },
        rebuilt
          ? `Resynced the board to ${draft.picks.length} mock pick(s).`
          : `Synced ${applied} remote pick(s).`,
      );
    }
    if (unresolved.length) {
      setSyncStatus(`${remote.length} remote · stopped at ${unresolved[0]}`);
      setNotice(
        isMockHarness
          ? `Mock sync paused: ${unresolved[0]}`
          : `Sync paused: ${unresolved[0]}`,
      );
      return;
    }
    const nextSlot = selectionForOverall(
      draft.picks.length + 1,
      draft.teamCount,
    ).slot;
    setSyncStatus(
      nextSlot === draft.userSlot
        ? `your turn · confirm (${draft.picks.length} picks)`
        : isMockHarness && humanSlots.has(nextSlot)
          ? `waiting on slot ${nextSlot} (${draft.picks.length} picks)`
          : `in sync · ${draft.picks.length} picks`,
    );
  }

  useEffect(() => {
    if (state.mode !== "live" || syncPaused || !leagueKey.trim()) {
      setSyncStatus(state.mode === "live" ? "paused" : "idle");
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/yahoo/sync?leagueKey=${encodeURIComponent(leagueKey.trim())}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          if (!cancelled) setSyncStatus(`error · ${body.error ?? response.status}`);
          return;
        }
        const snapshot = (await response.json()) as SyncSnapshot;
        if (!cancelled) reconcileRemote(snapshot);
      } catch (error) {
        if (!cancelled) {
          setSyncStatus(
            `error · ${error instanceof Error ? error.message : "network"}`,
          );
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, Math.max(1000, syncIntervalSec * 1000));
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // reconcileRemote intentionally excluded — it reads latest state via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, syncPaused, leagueKey, syncIntervalSec]);

  async function startMockHarness() {
    if (state.players.length < 60) {
      setNotice("Load Chen or import a CSV before starting a practice mock.");
      return;
    }
    if (
      state.players.length <
      state.draft.teamCount * state.draft.rounds
    ) {
      setNotice(
        shortBoardMessage(
          state.players.length,
          state.draft.teamCount,
          state.draft.rounds,
        ),
      );
      return;
    }
    if (!confirmClearBoard()) return;
    setLauncherOpen(false);
    const key = `mock.${Math.random().toString(36).slice(2, 8)}`;
    setNotice("Starting practice mock…");
    const response = await fetch("/api/yahoo/mock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueKey: key,
        userSlot: state.draft.userSlot,
        humanSlots: humanSlotList(),
        teamCount: state.draft.teamCount,
        rounds: state.draft.rounds,
        intervalMs: Math.max(1000, syncIntervalSec * 1000),
        players: state.players.map((player) => ({
          id: player.id,
          name: player.name,
          position: player.position,
          team: player.team,
          chenRank: player.chenRank,
          chenTier: player.chenTier,
          adp: player.adp,
          byeWeek: player.byeWeek,
          projectedPoints: player.projectedPoints,
          estimatedReturnProbability: player.estimatedReturnProbability,
        })),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setNotice(`Couldn't start the practice mock: ${body.error ?? response.status}`);
      return;
    }
    await mutateDraft(
      "/api/draft",
      { action: "reset", mode: "live", leagueKey: key },
      `Practice mock running — robots pick every ${syncIntervalSec}s and pause at each manager's slot.`,
    );
    setLeagueKey(key);
    setSyncPaused(false);
    setSelected(null);
  }

  function confirmClearBoard() {
    return (
      state.draft.picks.length === 0 ||
      window.confirm(
        `Clear all ${state.draft.picks.length} recorded picks on the shared board and start fresh?`,
      )
    );
  }

  async function startLive(rawKey: string) {
    const key = rawKey.trim();
    if (!key) {
      setNotice("Enter your Yahoo league key first (looks like 461.l.12345).");
      return;
    }
    if (!confirmClearBoard()) return;
    setLauncherOpen(false);
    setSelected(null);
    setSyncPaused(false);
    await mutateDraft(
      "/api/draft",
      { action: "reset", mode: "live", leagueKey: key },
      `Live board armed for ${key}. On draft night, make picks in the Yahoo app — this board follows along automatically.`,
    );
    setLeagueKey(key);
  }

  async function startSession(mode: "mock" | "live") {
    if (!confirmClearBoard()) return;
    setLauncherOpen(false);
    setSelected(null);
    setSyncPaused(mode === "mock");
    await mutateDraft(
      "/api/draft",
      { action: "reset", mode },
      mode === "mock"
        ? `Joined a new mock draft from slot ${state.draft.userSlot}.`
        : `Live board reset and ready from slot ${state.draft.userSlot}.`,
    );
  }

  async function confirm(player: Player) {
    if (!isMyTurn) {
      setNotice(`Pick ${current.overall} belongs to draft slot ${current.slot}.`);
      return;
    }
    try {
      const ok = await mutateDraft(
        "/api/draft/pick",
        { playerId: player.id },
        leagueKey.startsWith("mock.")
          ? `Confirmed ${player.name}. Mock resume — next opponent in ~${syncIntervalSec}s.`
          : `Confirmed ${player.name} locally. Still submit the pick in Yahoo.`,
      );
      if (ok) {
        setSelected(null);
        setDetailId(null);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to record pick");
    }
  }

  async function simulateToTurn() {
    if (state.mode !== "mock") {
      setNotice("Simulation is disabled on the live draft board.");
      return;
    }
    await mutateDraft(
      "/api/draft/pick",
      { action: "simulate" },
      "Simulated to your pick.",
    );
  }

  function toggleList(key: "pins" | "avoids", id: string) {
    setState((previous) => {
      const current = resolveTrackedPlayerIds(previous[key] ?? [], previous.players);
      const nextResolved = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id];
      return {
        ...previous,
        [key]: nextResolved.map((playerId) => {
          const row = previous.players.find((player) => player.id === playerId);
          return row ? stableTrackId(row) : playerId;
        }),
      };
    });
    if (key === "avoids" && selected === id) setSelected(null);
  }

  // Dormant break-glass helpers: the board auto-loads and refreshes Boris Chen
  // tiers server-side, so these aren't wired to any button. Kept here so a
  // manual "Import CSV" / "Refresh now" control can be re-added in seconds if
  // Chen's site is ever unreachable on draft night.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function importFile(file?: File) {
    if (!file) return;
    const parsed = parseChenCsv(await file.text(), file.name);
    if (!parsed.players.length) {
      setNotice(parsed.warnings[0] ?? "No usable players found");
      return;
    }
    const players: Player[] = parsed.players.map((player) => ({
      id: player.sourceId,
      name: player.name,
      position: player.position,
      team: player.team ?? "FA",
      chenRank: player.overallRank,
      chenTier: player.tier,
      byeWeek: player.byeWeek,
      adp: player.adp,
    }));
    await mutateDraft(
      "/api/draft",
      {
        action: "chen",
        chen: parsed,
      },
      `Imported ${players.length} players; ${parsed.warnings.length} warning(s).`,
    );
  }

  async function fetchRankings(source: string, scoring: ChenScoring) {
    if (chenBusy) return;
    setChenBusy(true);
    setNotice(`Loading ${source} ${CHEN_SCORING[scoring].label}…`);
    try {
      const response = await fetch(`/api/rankings?source=${source}&scoring=${scoring}`);
      const parsed = await response.json();
      if (!response.ok) throw new Error(parsed.error ?? "Import failed");
      if (!parsed.players?.length) throw new Error("Import contained no players");
      const previousExpert = sourceFromBoard(stateRef.current.source);
      await mutateDraft(
        "/api/draft",
        { action: "chen", chen: parsed },
        parsed.players.length <
          stateRef.current.draft.teamCount * stateRef.current.draft.rounds
          ? shortBoardMessage(
              parsed.players.length,
              stateRef.current.draft.teamCount,
              stateRef.current.draft.rounds,
            )
          : `Loaded ${parsed.players.length} ${CHEN_SCORING[scoring].label} ranks.`,
      );
      if (previousExpert !== source) {
        const nextExpert = parseRankingSource(source);
        setState((previous) => ({
          ...previous,
          weights: withExpertWeights(previous.weights, nextExpert),
        }));
      }
    } catch (error) {
      setNotice(
        `${error instanceof Error ? error.message : "Rankings fetch failed"}. Try again or import a CSV.`,
      );
    } finally {
      setChenBusy(false);
    }
  }

  async function joinDemo(seat?: number | null) {
    const requested = seat ?? chosenSeat ?? null;
    if (demoTeamName.trim().length < 2) {
      setNotice("Enter a team name before choosing a seat.");
      return;
    }
    const response = await fetch("/api/demo/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: draftId,
        displayName: demoTeamName,
        ...(requested ? { slot: requested } : {}),
      }),
    });
    const payload = (await response.json()) as DraftPayload & {
      error?: string;
      takenSlots?: number[];
      demo?: DemoInfo;
    };
    if (response.status === 409) {
      if (payload.takenSlots) setTakenSlots(payload.takenSlots);
      setChosenSeat(null);
      setNotice(payload.error ?? "That seat was just taken — pick another.");
      return;
    }
    if (!response.ok || !payload.draft) {
      setNotice(payload.error ?? "Could not join the demo");
      return;
    }
    applyPayload(payload, `Joined as ${demoTeamName.trim()}`);
  }

  const selectedPlayer =
    available.find(
      (player) => player.id === selected && !avoids.includes(player.id),
    ) ?? recommendation.recommendations[0]?.player;

  const detailPlayer = detailId
    ? state.players.find((player) => player.id === detailId) ?? null
    : null;
  const detailRec = detailId
    ? recommendation.recommendations.find((item) => item.player.id === detailId)
    : undefined;
  const detailAvailability = detailId ? availabilityById.get(detailId) : undefined;
  const detailPick = detailId
    ? state.draft.picks.find((pick) => pick.player.id === detailId)
    : undefined;

  function openDetail(id: string) {
    setSelected(id);
    setDetailId(id);
  }

  function selectOrInspect(id: string) {
    if (selected === id) {
      openDetail(id);
      return;
    }
    setSelected(id);
    setDetailId(null);
  }

  const detailReady = Boolean(detailPlayer);
  useEffect(() => {
    if (!detailId) {
      setPlayerBrief(null);
      setBriefStatus("idle");
      return;
    }
    if (!detailReady) return;
    const player = stateRef.current.players.find((entry) => entry.id === detailId);
    if (!player) return;
    let cancelled = false;
    setPlayerBrief(null);
    setBriefStatus("loading");
    const params = new URLSearchParams({
      name: player.name,
      position: player.position,
    });
    void fetch(`/api/players/brief?${params}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.seasons || body?.news) {
          setPlayerBrief(body);
          setBriefStatus("ready");
        } else {
          setPlayerBrief(null);
          setBriefStatus("idle");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerBrief(null);
          setBriefStatus("idle");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detailId, detailReady]);

  const isAdmin = !isDemo && me?.role === "admin";
  const adminView = isAdmin && !previewMember;
  // A practice mock runs on a "mock." league key (robots + auto-advance); a
  // manual mock uses mode "mock". Either way the admin may want a one-click
  // restart without hunting through the "Start a draft…" launcher.
  const practiceMockActive = state.leagueKey?.startsWith("mock.") ?? false;
  const manualMockActive = state.mode === "mock";
  const mockActive = practiceMockActive || manualMockActive;
  // Restarting replaces shared state, so keep it with the board controller.
  const canRestartMock = mockActive && !isDemo && me?.canManageBoard === true;
  const restartMockButton = canRestartMock ? (
    <button
      className="secondary"
      onClick={() =>
        void (practiceMockActive ? startMockHarness() : startSession("mock"))
      }
      title="Clear the shared board and run this mock again from scratch"
    >
      Restart mock
    </button>
  ) : null;

  async function startDemoDraft() {
    if (!draftId) return;
    const response = await fetch(
      `/api/demo/start?draftId=${encodeURIComponent(draftId)}`,
      { method: "POST" },
    );
    const payload = (await response.json()) as DraftPayload & {
      error?: string;
      demo?: DemoInfo;
    };
    if (!response.ok || !payload.draft) {
      setNotice(payload.error ?? "Could not start the draft.");
      return;
    }
    applyPayload(payload, "Draft started — robots will fill empty seats.");
  }

  async function copyDemoInvite() {
    if (!draftId) return;
    const invite = `${window.location.origin}/demo?room=${encodeURIComponent(draftId)}&join=1`;
    try {
      await navigator.clipboard.writeText(invite);
      setInviteCopied(true);
      if (inviteCopiedTimer.current) clearTimeout(inviteCopiedTimer.current);
      inviteCopiedTimer.current = setTimeout(() => {
        setInviteCopied(false);
        inviteCopiedTimer.current = null;
      }, 2000);
    } catch {
      window.prompt("Copy this invite link:", invite);
    }
  }

  async function patchUser(id: string, data: Record<string, unknown>) {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...data }),
    });
    const body = (await response.json().catch(() => null)) as {
      user?: MemberSeat;
      error?: string;
    } | null;
    if (!response.ok || !body?.user) {
      setNotice(body?.error ?? "Member update failed");
      return;
    }
    const updated = body.user;
    setAdminUsers((previous) =>
      previous.map((user) => (user.id === updated.id ? updated : user)),
    );
    setMembers((previous) =>
      previous.map((user) => (user.id === updated.id ? updated : user)),
    );
    setNotice(`Updated ${updated.displayName}.`);
  }

  if (!ready) return <main className="app dark loading">Loading draft room…</main>;

  return (
    <main className="app dark">
      <div className="broadcast-bar">
        <span>{isDemo ? "PUBLIC DRAFT ROOM" : "LEAGUE DRAFT ROOM"}</span>
        <span>LIVE BOARD · ROSTER-AWARE RANKS · POST-DRAFT GRADES</span>
        <span>WAR ROOM</span>
      </div>
      <header className="topbar">
        <BrandLockup kicker={isDemo ? "PUBLIC DEMO · DOJO.FOOTBALL" : "FANTASY WAR ROOM"} />
        <nav className="topbar-nav" aria-label="Board">
          {isDemo ? (
            <Link href="/">Home</Link>
          ) : (
            <Link href="/weekly">Weekly HQ</Link>
          )}
          <span
            className={`topbar-mode ${
              state.mode === "mock" || state.leagueKey?.startsWith("mock.")
                ? "mock"
                : "live"
            }`}
          >
            {state.mode === "mock"
              ? "Manual mock"
              : state.leagueKey?.startsWith("mock.")
                ? "Practice mock"
                : "Live board"}
          </span>
          {isDemo ? null : yahooConnected ? (
            <span className="topbar-mode">{me?.displayName ?? "Yahoo"}</span>
          ) : (
            <a href="/api/yahoo/auth">Sign in with Yahoo</a>
          )}
          {isAdmin && (
            <>
              <button
                type="button"
                className="topbar-link"
                onClick={() => {
                  setPreviewMember(false);
                  setAdminOpen(true);
                }}
              >
                League admin
              </button>
              <button
                type="button"
                className={`topbar-link ${previewMember ? "is-active" : ""}`}
                onClick={() => setPreviewMember((value) => !value)}
              >
                {previewMember ? "Exit member view" : "View as member"}
              </button>
            </>
          )}
          {isDemo ? null : (
            <form action="/api/auth/logout" method="post">
              <button className="topbar-link" type="submit">
                Sign out
              </button>
            </form>
          )}
          {draftComplete ? (
            <button
              type="button"
              className="topbar-cta"
              onClick={() => setReportOpen(true)}
            >
              Report card
            </button>
          ) : null}
        </nav>
      </header>

      {isAdmin && previewMember && (
        <div className="preview-banner" role="status">
          <span>
            Member preview — you&apos;re seeing exactly what your league-mates see.
            Admin tools are hidden but you&apos;re still the admin.
          </span>
          <button onClick={() => setPreviewMember(false)}>Back to admin view</button>
        </div>
      )}

      {boardExhausted && (
        <div className="preview-banner" role="status">
          <span>
            The board ran out of ranked players after {state.draft.picks.length} of{" "}
            {state.draft.teamCount * state.draft.rounds} picks. This draft is closed.
          </span>
        </div>
      )}

      {isDemo && !demoStarted && !draftComplete && (
        <div className="preview-banner" role="status">
          <span>
            {takenSlots.length
              ? `${takenSlots.length} seated · ${Math.max(0, state.draft.teamCount - takenSlots.length)} open. Invite friends, then start when you're ready — robots will fill empty seats.`
              : "This draft is waiting. Invite friends, then start it when everyone is seated."}
          </span>
        </div>
      )}

      <section className={`control-strip ${isMyTurn ? "on-clock" : ""}`}>
        {!hasDraftSeat && !draftComplete ? (
          <label>
            Team name
            <input
              className="demo-team-name"
              value={demoTeamName}
              maxLength={32}
              placeholder="Your team"
              onChange={(event) => setDemoTeamName(event.target.value)}
            />
          </label>
        ) : null}
        {!finishedSpectator ? <label>
          Draft slot
          {!hasDraftSeat ? (
            <select
              className="seat-picker"
              value={chosenSeat ?? ""}
              disabled={
                draftComplete ||
                demoTeamName.trim().length < 2 ||
                takenSlots.length >= state.draft.teamCount
              }
              onChange={(event) => {
                const seat = Number(event.target.value);
                if (!seat) return;
                setChosenSeat(seat);
                void joinDemo(seat);
              }}
            >
              <option value="">
                {takenSlots.length >= state.draft.teamCount
                  ? "Room full"
                  : demoTeamName.trim().length < 2
                    ? "Enter name first"
                    : "Choose a seat"}
              </option>
              {Array.from({ length: state.draft.teamCount }, (_, index) => {
                const seat = index + 1;
                const taken = takenSlots.includes(seat);
                return (
                  <option key={seat} value={seat} disabled={taken}>
                    Seat {seat}{taken ? " · taken" : ""}
                  </option>
                );
              })}
            </select>
          ) : (
            <select
              value={state.draft.userSlot}
              disabled={isDemo}
              onChange={(event) =>
                setState((previous) => ({
                  ...previous,
                  draft: { ...previous.draft, userSlot: Number(event.target.value) },
                }))
              }
            >
              {Array.from({ length: state.draft.teamCount }, (_, index) => (
                <option key={index + 1}>{index + 1}</option>
              ))}
            </select>
          )}
        </label> : null}
        <div className="turn-indicator">
          <strong>
            {draftComplete
              ? "Draft complete"
              : !hasDraftSeat
                ? "Spectating — choose a seat above"
              : isDemo && !demoStarted
                ? "Waiting to start"
                : isMyTurn
                  ? showAutoCountdown
                    ? `🚨 YOU'RE ON THE CLOCK — auto-draft in ${autoPickSeconds}s`
                    : "🚨 YOU'RE ON THE CLOCK"
                  : `${picksUntilMyTurn} picks until your turn`}
          </strong>
          <span>
            {draftComplete
              ? boardExhausted
                ? `${state.draft.picks.length} picks made · ranked player pool exhausted`
                : `${state.draft.picks.length} of ${totalPicks} picks made`
              : `Pick ${current.overall} of ${totalPicks} · Round ${current.round} of ${state.draft.rounds} · Slot ${current.slot}${
                  !isMyTurn && showAutoCountdown
                    ? ` · slot ${current.slot} auto-drafts in ${autoPickSeconds}s`
                    : ""
                }`}
          </span>
          <div
            className="draft-progress"
            role="progressbar"
            aria-label="Draft progress"
            aria-valuemin={0}
            aria-valuemax={totalPicks}
            aria-valuenow={Math.min(state.draft.picks.length, totalPicks)}
          >
            <i
              style={{
                width: `${
                  totalPicks <= 0
                    ? 0
                    : Math.min(
                        100,
                        (Math.min(state.draft.picks.length, totalPicks) / totalPicks) * 100,
                      )
                }%`,
              }}
            />
          </div>
        </div>
        {isMyTurn && selectedPlayer ? (
          <button
            type="button"
            className="confirm strip-confirm"
            onClick={() => void confirm(selectedPlayer)}
          >
            Confirm pick · {selectedPlayer.name}
          </button>
        ) : null}
        {!draftComplete ? <button
          type="button"
          className="secondary turn-sound-toggle"
          aria-pressed={soundEnabled}
          title="Play a chime when your turn starts"
          onClick={() => {
            const next = !soundEnabled;
            setSoundEnabled(next);
            window.localStorage.setItem(TURN_SOUND_STORAGE_KEY, String(next));
            if (next) ensureTurnAudio();
          }}
        >
          {soundEnabled ? "🔔 Sound on" : "🔕 Sound off"}
        </button> : null}
        {adminView ? (
          <>
            <button
              onClick={simulateToTurn}
              disabled={state.mode !== "mock" || isMyTurn}
            >
              Simulate to my pick
            </button>
            <button
              className="secondary"
              onClick={() => void mutateDraft("/api/draft/pick", { action: "advance" }, "Advanced one pick.")}
              disabled={state.mode !== "mock" || isMyTurn}
            >
              Advance one
            </button>
            <button
              className="secondary"
              onClick={() => void mutateDraft("/api/draft/pick", { action: "undo" }, "Undid the latest pick.")}
              disabled={!state.draft.picks.length}
            >
              Undo
            </button>
            {restartMockButton}
            <span className="strip-spacer" />
            <button
              className="live-button"
              onClick={() => {
                setLiveKeyDraft(
                  state.leagueKey && !state.leagueKey.startsWith("mock.")
                    ? state.leagueKey
                    : "",
                );
                setLauncherOpen(true);
              }}
            >
              Start a draft…
            </button>
          </>
        ) : (
          <>
            {isDemo ? (
              <>
                <Link className="button-link secondary" href="/demo">
                  Back to lobby
                </Link>
                <button
                  className="secondary invite-copy-button"
                  type="button"
                  onClick={() => void copyDemoInvite()}
                >
                  {inviteCopied ? "Copied!" : "Copy invite link"}
                </button>
                {demoRole === "play" && !demoStarted && !draftComplete ? (
                  <button
                    className="live-button"
                    type="button"
                    onClick={() => void startDemoDraft()}
                  >
                    Start draft
                  </button>
                ) : null}
              </>
            ) : (
              restartMockButton
            )}
            {(!isDemo || demoStarted) && (
              <span className="strip-hint">
                {isDemo
                  ? "This room is public — invite others to choose an open seat, or return to the lobby for another draft."
                  : "The board is shared. Only the admin runs live sync and resets; you pick players, pins, and avoids."}
              </span>
            )}
          </>
        )}
      </section>

      <section className="presence-strip">
        <span className="presence-title">League-mates</span>
        {members.map((member) => {
          const presence = presenceLabel(member.lastSeenAt);
          const isMe = member.id === me?.id;
          return (
            <span
              className={`presence-chip ${presence.online || isMe ? "online" : ""}`}
              key={member.id}
            >
              <i />
              {member.teamName || member.displayName}
              {member.draftSlot ? ` · slot ${member.draftSlot}` : ""}
              <small>
                {isMe ? "you" : presence.label}
              </small>
            </span>
          );
        })}
        {members.length === 0 && (
          <small className="presence-empty">
            {isDemo
              ? "Human managers appear here after they choose a seat."
              : "Your league-mates appear here once they sign in with Yahoo."}
          </small>
        )}
      </section>

      <div className="notice" role="status">{notice}</div>

      {reportOpen && draftReport && (
        <DraftReportCard
          report={draftReport}
          userSlot={hasDraftSeat ? state.draft.userSlot : 0}
          teamLabel={teamLabel}
          draftId={draftId}
          onClose={() => setReportOpen(false)}
        />
      )}

      {launcherOpen && adminView && (
        <div className="launcher-overlay" onClick={() => setLauncherOpen(false)}>
          <div
            ref={launcherDialogRef}
            className="launcher"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-launcher-title"
            tabIndex={-1}
          >
            <div className="launcher-head">
              <div>
                <p className="eyebrow">Everyone shares this board</p>
                <h2 id="draft-launcher-title">Start a draft</h2>
              </div>
              <button className="icon-button" onClick={() => setLauncherOpen(false)}>
                Close
              </button>
            </div>
            <div className="launcher-options">
              <article>
                <header>
                  <h3>Practice mock</h3>
                  <span className="launcher-badge">recommended</span>
                </header>
                <p>
                  Robots draft the open seats every {syncIntervalSec} seconds
                  and pause at <strong>every real manager&apos;s slot</strong>{" "}
                  until that person confirms — so all {humanSlotList().length}{" "}
                  of you can rehearse together, each on your own screen.
                </p>
                <button onClick={() => void startMockHarness()}>
                  Start practice mock
                </button>
              </article>
              <article>
                <header>
                  <h3>Draft night — live</h3>
                </header>
                <p>
                  Follows your real Yahoo draft. Everyone makes their actual
                  picks in the Yahoo app; this board syncs them automatically
                  and keeps recommendations current. Requires Yahoo API access.
                </p>
                {yahooLeagues.length > 0 ? (
                  <label className="launcher-key">
                    Your Yahoo league
                    <select
                      value={liveKeyDraft}
                      onChange={(event) => setLiveKeyDraft(event.target.value)}
                    >
                      {yahooLeagues.map((league) => (
                        <option key={league.leagueKey} value={league.leagueKey}>
                          {league.name}
                          {league.season ? ` · ${league.season}` : ""}
                          {league.numTeams ? ` · ${league.numTeams} teams` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="launcher-key">
                    League key
                    <input
                      type="text"
                      placeholder="461.l.12345"
                      value={liveKeyDraft}
                      onChange={(event) => setLiveKeyDraft(event.target.value)}
                    />
                  </label>
                )}
                <p className={`launcher-help ${yahooLeaguesError ? "error" : ""}`}>
                  {yahooLeaguesLoading
                    ? "Finding your Yahoo leagues…"
                    : yahooLeaguesError ||
                      (yahooLeagues.length > 0
                        ? "Selected from the NFL leagues connected to your Yahoo account."
                        : "Open your league in Yahoo Fantasy and copy the key from its URL. It looks like 461.l.12345.")}
                </p>
                <button className="live-button" onClick={() => void startLive(liveKeyDraft)}>
                  Arm the live board
                </button>
              </article>
            </div>
          </div>
        </div>
      )}

      {isAdmin && adminOpen && (
        <div className="launcher-overlay" onClick={() => setAdminOpen(false)}>
          <div
            ref={adminDialogRef}
            className="launcher admin-overlay"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-overlay-title"
            tabIndex={-1}
          >
            <section className="panel admin-console">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Only you see this</p>
                  <h2 id="admin-overlay-title">League admin</h2>
                </div>
                <span>{adminUsers.length} members</span>
                <button className="icon-button" onClick={() => setAdminOpen(false)}>
                  Close
                </button>
              </div>

              <div className="admin-section">
                <p className="admin-label">Members</p>
                {adminUsers.map((user) => (
                  <div className="admin-member" key={user.id}>
                    <div className="admin-member-head">
                      <strong>{user.displayName}</strong>
                      <span className={`member-status ${user.status}`}>
                        {user.role === "admin" ? "admin" : "member"}
                      </span>
                    </div>
                    <div className="admin-member-fields">
                      <label>
                        Slot
                        <select
                          value={user.draftSlot ?? ""}
                          onChange={(event) =>
                            patchUser(user.id, {
                              draftSlot: event.target.value
                                ? Number(event.target.value)
                                : null,
                            })
                          }
                        >
                          <option value="">—</option>
                          {Array.from({ length: 12 }, (_, index) => (
                            <option key={index + 1} value={index + 1}>
                              {index + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Team
                        <input
                          type="text"
                          defaultValue={user.teamName ?? ""}
                          placeholder="Team name"
                          onBlur={(event) => {
                            const value = event.target.value.trim();
                            if (value !== (user.teamName ?? "")) {
                              patchUser(user.id, { teamName: value || null });
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
                {adminUsers.length <= 1 && (
                  <p className="admin-hint">
                    Friends show up here after they sign in with Yahoo.
                    Approve them to unlock the board.
                  </p>
                )}
              </div>

              <div className="admin-section">
                <p className="admin-label">Advanced: practice robots &amp; live sync</p>
                <div className="sync-panel">
                  <label>
                    League key
                    <input
                      type="text"
                      placeholder="mock.abc123 or 461.l.12345"
                      value={leagueKey}
                      onChange={(event) => setLeagueKey(event.target.value)}
                    />
                  </label>
                  <label>
                    Poll every
                    <select
                      value={syncIntervalSec}
                      onChange={(event) => setSyncIntervalSec(Number(event.target.value))}
                    >
                      {[2, 3, 5, 8, 15, 30].map((value) => (
                        <option key={value} value={value}>
                          {value}s
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="sync-actions">
                    <button className="secondary" onClick={startMockHarness}>
                      Start practice mock
                    </button>
                    <button
                      className="secondary"
                      onClick={async () => {
                        if (!leagueKey.trim()) return;
                        await fetch(
                          `/api/yahoo/mock?leagueKey=${encodeURIComponent(leagueKey.trim())}`,
                          { method: "DELETE" },
                        );
                        setNotice(`Stopped mock ${leagueKey}.`);
                        setSyncStatus("idle");
                      }}
                    >
                      Stop mock
                    </button>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={syncPaused}
                      onChange={(event) => setSyncPaused(event.target.checked)}
                    />
                    Pause live synchronization
                  </label>
                  <p className="sync-status">Status: {syncStatus}</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {detailPlayer && (
        <div className="detail-overlay" onClick={() => setDetailId(null)}>
          <div
            ref={detailDialogRef}
            className="detail-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-detail-title"
            tabIndex={-1}
          >
            <button
              type="button"
              className="icon-button detail-close"
              onClick={() => setDetailId(null)}
              aria-label="Close player details"
            >
              ×
            </button>
            <div
              className="detail-hero"
              data-team={detailPlayer.team?.toLowerCase()}
            >
              <span className="detail-team-mark" aria-hidden="true">
                {detailPlayer.team}
              </span>
              <div className="detail-head">
                <PlayerAvatar
                  name={detailPlayer.name}
                  imageUrl={detailPlayer.imageUrl}
                  size={220}
                  className="detail-headshot"
                  alt={detailPlayer.name}
                />
                <div className="detail-identity">
                  <h2 id="player-detail-title">{detailPlayer.name}</h2>
                  <p className="detail-sub">
                    <span className={`position ${detailPlayer.position.toLowerCase()}`}>
                      {detailPlayer.position}
                    </span>
                    <span>{detailPlayer.teamName || detailPlayer.team}</span>
                    {detailPlayer.byeWeek ? <span>Bye {detailPlayer.byeWeek}</span> : null}
                  </p>
                  {detailPlayer.injuryStatus &&
                  detailPlayer.injuryStatus !== "HEALTHY" ? (
                    <p className="detail-injury">{detailPlayer.injuryStatus}</p>
                  ) : null}
                  {detailPick ? (
                    <p className="detail-drafted">
                      Drafted · pick {detailPick.overall} (round {detailPick.round}
                      {hasDraftSeat && detailPick.slot === state.draft.userSlot
                        ? ", yours"
                        : ""})
                    </p>
                  ) : null}
                  <p className="detail-rank-label">Player rankings</p>
                  <div className="detail-stats">
                    <div>
                      <strong>{detailPlayer.chenRank ?? "—"}</strong>
                      <span>
                        {expertSliderLabel(
                          "chenRank",
                          sourceFromBoard(state.source),
                        )}
                      </span>
                    </div>
                    <div>
                      <strong>{detailPlayer.chenTier ? `T${detailPlayer.chenTier}` : "—"}</strong>
                      <span>Tier</span>
                    </div>
                    <div>
                      <strong>{formatAdp(detailPlayer.adp)}</strong>
                      <span>ADP</span>
                    </div>
                    <div>
                      <strong>
                        {detailAvailability?.probability == null
                          ? "—"
                          : `${Math.round(detailAvailability.probability * 100)}%`}
                      </strong>
                      <span>
                        {detailAvailability
                          ? `Available next turn · ${availabilityLabel(detailAvailability.signal)}`
                          : "Chance available next turn"}
                      </span>
                    </div>
                    <div>
                      <strong>
                        {detailPlayer.percentOwned != null
                          ? `${detailPlayer.percentOwned}%`
                          : "—"}
                      </strong>
                      <span>Rostered</span>
                    </div>
                    {detailPlayer.projectedPoints != null ? (
                      <div>
                        <strong>{detailPlayer.projectedPoints}</strong>
                        <span>Proj pts</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="detail-body">
              {briefStatus === "loading" ? (
                <p className="detail-note">Loading season stats and news…</p>
              ) : null}

              {playerBrief && playerBrief.seasons.length > 0 ? (
                <div className="detail-section">
                  <div className="detail-why-head">
                    <strong>Season stats</strong>
                    <span>Sleeper PPR</span>
                  </div>
                  <div className="detail-season-wrap">
                    <table className="detail-season-table">
                      <thead>
                        <tr>
                          <th>Year</th>
                          {playerBrief.seasons[0].stats.map((chip) => (
                            <th key={chip.label}>{chip.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {playerBrief.seasons.map((row) => (
                          <tr key={row.year}>
                            <th scope="row">{row.year}</th>
                            {row.stats.map((chip) => (
                              <td key={chip.label}>{chip.value}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {playerBrief && playerBrief.news.length > 0 ? (
                <div className="detail-section">
                  <div className="detail-why-head">
                    <strong>Recent news</strong>
                    <span>ESPN</span>
                  </div>
                  <ul className="detail-news">
                    {playerBrief.news.map((item) => (
                      <li key={item.url}>
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {item.title}
                        </a>
                        {item.published ? (
                          <small>
                            {new Date(item.published).toLocaleDateString()}
                          </small>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : briefStatus === "ready" &&
                (!playerBrief || playerBrief.news.length === 0) &&
                (!playerBrief || playerBrief.seasons.length === 0) ? (
                <p className="detail-note">No recent stats or news found for this player.</p>
              ) : null}

              {detailRec ? (
                <div className="detail-why">
                  <div className="detail-why-head">
                    <strong>Why the model likes him</strong>
                    <span>
                      Score {detailRec.score.toFixed(1)} · {detailRec.suggestedRosterSlot}
                    </span>
                  </div>
                  <ul>
                    {detailRec.explanations.slice(0, 4).map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!detailPlayer.imageUrl ? (
                <p className="detail-note">
                  Photo &amp; live team/bye fill in from Yahoo once connected.
                </p>
              ) : null}
            </div>
            <div className="detail-actions">
              <button
                className="secondary"
                onClick={() => toggleList("pins", detailPlayer.id)}
              >
                {(state.pins ?? []).includes(detailPlayer.id) ? "Unpin ★" : "Pin ☆"}
              </button>
              <button
                className="secondary"
                onClick={() => toggleList("avoids", detailPlayer.id)}
              >
                {avoids.includes(detailPlayer.id) ? "Allow" : "Avoid"}
              </button>
              {isMyTurn && !detailPick ? (
                <button
                  className="confirm"
                  onClick={() => {
                    void confirm(detailPlayer);
                    setDetailId(null);
                  }}
                >
                  Confirm pick · {detailPlayer.name}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {finishedSpectator ? (
        <section className="spectator-finished panel" aria-labelledby="finished-room-title">
          <div>
            <p className="eyebrow">Final board</p>
            <h2 id="finished-room-title">This draft is complete.</h2>
            <p>
              Review every selection below or open the report card to compare all
              team grades and rosters.
            </p>
          </div>
          <button type="button" onClick={() => setReportOpen(true)}>
            Open report card
          </button>
        </section>
      ) : null}

      <section className={`workspace ${!hasDraftSeat ? "spectating" : ""}`}>
        {hasDraftSeat ? (
        <aside className="panel recommendations">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live recommendations</p>
              <h2>{recoTab === "insights" ? "Insights" : "Top five"}</h2>
            </div>
            <div className="panel-heading-meta">
              <span>
                {!hasDraftSeat
                  ? "choose a seat"
                  : recoTab === "insights"
                  ? insightFlags
                    ? `${insightFlags} alert${insightFlags === 1 ? "" : "s"}`
                    : "no flags"
                  : draftComplete
                    ? "draft complete"
                    : recommendation.picksUntilNextSelection === null
                      ? "last pick"
                      : `${recommendation.picksUntilNextSelection} picks until your next turn`}
              </span>
              <b className="live-pill">LIVE</b>
            </div>
          </div>
          {!hasDraftSeat ? (
            <p className="insight-empty">
              Choose an open seat to get roster-specific recommendations and insights.
            </p>
          ) : (
          <>
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
                  No notes yet — once you have a few picks, bye stacks and holes
                  show up here.
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
                    No confident room tendency yet. This fills in as managers make picks.
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
              {draftComplete
                ? "Your picks are in. Open the report card for the room grades."
                : "No remaining players fit the board — check Best available."}
            </p>
          ) : null}
          {recommendation.recommendations.map((item, index) => {
            const availability = availabilityById.get(item.player.id);
            return (
              <article
              key={item.player.id}
              className={`recommendation ${index === 0 ? "first" : ""} ${selected === item.player.id ? "selected" : ""}`}
              onClick={() => selectOrInspect(item.player.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectOrInspect(item.player.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-pressed={selected === item.player.id}
              aria-label={`${item.player.name}, recommendation ${index + 1}. ${item.explanations[0] ?? "Best calculated value available"}`}
            >
              <div className="rank">{index + 1}</div>
              <PlayerAvatar name={item.player.name} imageUrl={item.player.imageUrl} />
              <div className="recommendation-copy">
                <div className="player-line">
                  <strong>{item.player.name}</strong>
                  <TeamLogo team={item.player.team} />
                  <span className={`position ${item.player.position.toLowerCase()}`}>
                    {item.player.position}
                  </span>
                  <span>T{item.player.chenTier ?? "—"}</span>
                  <span>Bye {item.player.byeWeek ?? "—"}</span>
                </div>
                <p>{item.explanations[0] ?? "Best calculated value available"}</p>
                <small>
                  Score {item.score.toFixed(1)} · {item.suggestedRosterSlot}
                  {availability ? (
                    <span
                      className={`availability-badge ${availability.signal}`}
                      title={availability.reasons.join(" · ")}
                      aria-label={
                        availability.probability == null
                          ? availabilityLabel(availability.signal)
                          : `${nextTurnAvailabilityPercent(availability.probability)} chance available next turn. ${availabilityLabel(availability.signal)}`
                      }
                    >
                      {availability.probability != null ? (
                        <>
                          <span className="availability-window">Next turn</span>
                          <strong>
                            {nextTurnAvailabilityPercent(availability.probability)}
                          </strong>
                        </>
                      ) : null}
                      <span className="availability-action">
                        {availabilityLabel(availability.signal)}
                      </span>
                    </span>
                  ) : null}
                </small>
              </div>
              {index === 0 && <span className="best-badge">BEST</span>}
              </article>
            );
          })}
          {recommendation.recommendations[0] && (
            <div className="comparison">
              <strong>Why #1?</strong>
              {recommendation.recommendations.slice(1, 3).map((alternative) => (
                <p key={alternative.player.id}>
                  {scoreComparison(recommendation.recommendations[0], alternative)}
                </p>
              ))}
            </div>
          )}
          </>
          )}
          <button
            className="confirm"
            disabled={!isMyTurn || !selectedPlayer}
            onClick={() => selectedPlayer && confirm(selectedPlayer)}
          >
            {isMyTurn
              ? `Confirm pick · ${selectedPlayer?.name ?? "select a player"}`
              : "Confirm pick"}
          </button>
          <p className="safety-note">
            {isMyTurn
              ? "Select a player in the list, then confirm here or in the clock bar."
              : "Picks are recorded on this board only — make the real pick in the Yahoo app."}
          </p>
          </>
          )}
        </aside>
        ) : null}

        {!finishedSpectator ? <section className="panel available-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Available players</p>
              <h2>Best available <span>{available.length}</span></h2>
            </div>
          </div>
          <div className="data-source">
            <p>
              {state.source} · {formatStamp(state.importedAt)}
              {!state.source?.startsWith("Built-in") && " · auto-updated"}
            </p>
            <label className="scoring-toggle">
              Expert
              <select
                value={sourceFromBoard(state.source)}
                disabled={chenBusy || !canChangeRankings}
                title={
                  canChangeRankings
                    ? "Change the shared ranking source"
                    : "Only seated players can change rankings before the draft ends"
                }
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === sourceFromBoard(state.source)) return;
                  void fetchRankings(next, scoringFromSource(state.source));
                }}
              >
                {rankingSources
                  .filter((source) => source.available)
                  .map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="scoring-toggle">
              Scoring
              <select
                value={scoringFromSource(state.source)}
                disabled={chenBusy || !canChangeRankings}
                title={
                  canChangeRankings
                    ? "Change the shared scoring format"
                    : "Only seated players can change scoring before the draft ends"
                }
                onChange={(event) => {
                  const next = event.target.value as ChenScoring;
                  if (next === scoringFromSource(state.source)) return;
                  void fetchRankings(sourceFromBoard(state.source), next);
                }}
              >
                {(Object.keys(CHEN_SCORING) as ChenScoring[]).map((value) => (
                  <option key={value} value={value}>
                    {CHEN_SCORING[value].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="filters">
            <input
              placeholder="Search players or teams"
              value={search}
              onChange={(event) => {
                const value = event.target.value;
                startTransition(() => setSearch(value));
              }}
            />
            <label className="filter-label">
              Pos
              <select value={position} onChange={(event) => setPosition(event.target.value as Position | "ALL")}>
                <option value="ALL">Any</option>
                {POSITIONS.filter((value) => value !== "ALL").map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="filter-label">
              Tier
              <select value={tier} onChange={(event) => setTier(event.target.value)}>
                <option value="ALL">Any</option>
                {tiers.map((value) => (
                  <option key={value} value={value}>T{value}</option>
                ))}
              </select>
            </label>
            <label className="filter-label">
              Show
              <select
                value={listFilter}
                onChange={(event) =>
                  setListFilter(event.target.value as "all" | "avoids" | "pins")
                }
              >
                <option value="all">Everyone</option>
                <option value="pins">
                  Pins{pins.length ? ` (${pins.length})` : ""}
                </option>
                <option value="avoids">
                  Avoids{avoids.length ? ` (${avoids.length})` : ""}
                </option>
              </select>
            </label>
          </div>
          {isMyTurn && selectedPlayer ? (
            <div className="pick-dock">
              <div>
                <strong>Confirm your pick</strong>
                <span>
                  {selected
                    ? `${selectedPlayer.name} is selected`
                    : `Top recommendation: ${selectedPlayer.name}`}
                </span>
              </div>
              <button
                type="button"
                className="confirm"
                onClick={() => void confirm(selectedPlayer)}
              >
                Confirm pick · {selectedPlayer.name}
              </button>
            </div>
          ) : null}
          <div className="player-table" role="table" aria-label="Available fantasy players">
            <div className={`table-row table-head ${isMyTurn ? "on-clock" : ""}`} role="row">
              <span role="columnheader">Rank</span>
              <span role="columnheader">Player</span>
              <span role="columnheader">Tier</span>
              <span role="columnheader">ADP</span>
              <span role="columnheader">Actions</span>
            </div>
            {filtered.length === 0 && (
              <p className="empty-filter">
                {listFilter === "avoids"
                  ? avoids.length
                    ? "Those avoided players are not in the current list."
                    : "You have not avoided anyone yet."
                  : listFilter === "pins"
                    ? pins.length
                      ? "Those pinned players are not in the current list."
                      : "You have not pinned anyone yet."
                    : "No players match these filters."}
              </p>
            )}
            {filtered.slice(0, 80).map((player) => (
              <div
                className={`table-row ${isMyTurn ? "on-clock" : ""} ${selected === player.id ? "selected" : ""} ${avoids.includes(player.id) ? "avoided" : ""} ${draftedIds.has(player.id) ? "taken" : ""}`}
                key={player.id}
                onClick={() => {
                  if (draftedIds.has(player.id)) {
                    openDetail(player.id);
                    return;
                  }
                  selectOrInspect(player.id);
                }}
                role="row"
              >
                <span role="cell">{player.chenRank ?? "—"}</span>
                <span className="player-cell" role="cell">
                  <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size={30} />
                  <span className="player-cell-copy">
                    <strong>{player.name}</strong>
                    <small>
                      <TeamLogo team={player.team} size={14} />
                      {player.position} · {player.team} · Bye {player.byeWeek ?? "—"}
                    </small>
                  </span>
                </span>
                <span role="cell"><i className={`tier tier-${Math.min(player.chenTier ?? 8, 8)}`}>T{player.chenTier ?? "—"}</i></span>
                <span role="cell">{formatAdp(player.adp)}</span>
                <span className="row-actions" role="cell">
                  {isMyTurn && !draftedIds.has(player.id) ? (
                    <button
                      type="button"
                      className="draft-pick"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(player.id);
                        void confirm(player);
                      }}
                    >
                      Draft
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDetail(player.id);
                      }}
                    >
                      Info
                    </button>
                  )}
                  {hasDraftSeat ? (
                    <>
                      <button
                        aria-label={`${(state.pins ?? []).includes(player.id) ? "Unpin" : "Pin"} ${player.name}`}
                        onClick={(event) => { event.stopPropagation(); toggleList("pins", player.id); }}
                      >
                        {(state.pins ?? []).includes(player.id) ? "★" : "☆"}
                      </button>
                      <button onClick={(event) => { event.stopPropagation(); toggleList("avoids", player.id); }}>
                        {avoids.includes(player.id) ? "Allow" : "Avoid"}
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </section> : null}

        {hasDraftSeat ? <aside className="right-column">
          <section className="panel roster">
            <div className="panel-heading"><h2>My roster</h2><span>{myRoster.length}/{state.draft.rounds}</span></div>
            {insights.byes.length > 0 && (
              <div className="roster-byes">
                {insights.byes.map((group) => (
                  <span className={group.count >= 3 ? "hot" : ""} key={group.week}>
                    Bye {group.week} · {group.count}
                  </span>
                ))}
              </div>
            )}
            {(["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "BENCH"] as const).map((slot) => {
              const picks = myRoster.filter((pick) => pick.rosterSlot === slot);
              return (
                <div className="roster-slot" key={slot}>
                  <span>{slot}</span>
                  <div>
                    {picks.length
                      ? picks.map((entry) => (
                          <button
                            type="button"
                            className={`roster-player pos-${entry.player.position.toLowerCase()}`}
                            key={entry.overall}
                            onClick={() => openDetail(entry.player.id)}
                          >
                            <strong>{entry.player.name}</strong>
                            {entry.player.byeWeek ? (
                              <span>Bye {entry.player.byeWeek}</span>
                            ) : null}
                          </button>
                        ))
                      : <em>Open</em>}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="panel settings">
            <div className="panel-heading"><h2>Strategy</h2></div>
            {expertSliderKeys(sourceFromBoard(state.source)).map((key) => (
              <label key={key}>
                <span>
                  {expertSliderLabel(key, sourceFromBoard(state.source))}{" "}
                  <b>{state.weights[key]}</b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={state.weights[key]}
                  onChange={(event) =>
                    setState((previous) => ({
                      ...previous,
                      weights: { ...previous.weights, [key]: Number(event.target.value) },
                    }))
                  }
                />
              </label>
            ))}
            <button
              className="secondary reset-weights"
              onClick={() =>
                setState((previous) => ({
                  ...previous,
                  weights: defaultWeightsForExpert(sourceFromBoard(previous.source)),
                }))
              }
            >
              Reset weights to defaults
            </button>
            <p className="panel-hint">
              Weights, pins, and avoids are yours alone — they don&apos;t change
              what your league-mates see.
            </p>
          </section>
        </aside> : null}
      </section>

      <section className="panel board">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">All selections</p>
            <h2>
              Draft board{" "}
              <span>
                {draftComplete
                  ? `${state.draft.rounds} rounds`
                  : `Round ${current.round} of ${state.draft.rounds}`}
              </span>
            </h2>
          </div>
          <span>Last local update {state.draft.picks.at(-1)?.madeAt ? new Date(state.draft.picks.at(-1)!.madeAt!).toLocaleTimeString() : "—"}</span>
        </div>
        <div
          className="board-grid"
          style={{
            gridTemplateColumns: `28px repeat(${state.draft.teamCount}, minmax(0, 1fr))`,
          }}
        >
          <div className="board-round board-round-head" aria-hidden="true">
            Rd
          </div>
          {Array.from({ length: state.draft.teamCount }, (_, index) => (
            <div
              className={`board-head ${
                hasDraftSeat && index + 1 === state.draft.userSlot ? "mine" : ""
              } ${isDemo ? (isHumanDemoSlot(index + 1) ? "human" : "robot") : ""}`}
              key={`head-${index + 1}`}
              title={teamLabel(index + 1)}
            >
              {teamLabel(index + 1)}
            </div>
          ))}
          {Array.from({ length: state.draft.rounds }, (_, roundIndex) => {
            const round = roundIndex + 1;
            return (
              <Fragment key={`round-${round}`}>
                <div
                  className={`board-round ${
                    !draftComplete && round === current.round ? "current-round" : ""
                  }`}
                >
                  {round}
                </div>
                {Array.from({ length: state.draft.teamCount }, (_, index) => {
                  const slot = index + 1;
                  const pick = state.draft.picks.find(
                    (entry) => entry.round === round && entry.slot === slot,
                  );
                  return (
                    <div
                      className={`board-cell ${
                        hasDraftSeat && slot === state.draft.userSlot ? "mine" : ""
                      } ${
                        !draftComplete && round === current.round ? "current-round" : ""
                      } ${
                        !draftComplete &&
                        round === current.round &&
                        slot === current.slot
                          ? "on-clock-cell"
                          : ""
                      }`}
                      key={`${round}-${slot}`}
                    >
                      {pick ? (
                        <button
                          type="button"
                          className={`board-pick pos-${pick.player.position.toLowerCase()}`}
                          onClick={() => openDetail(pick.player.id)}
                        >
                          <span>
                            {pick.round}.{pick.slot}
                            {pick.player.byeWeek ? ` · Bye ${pick.player.byeWeek}` : ""}
                          </span>
                          <b>{pick.player.name}</b>
                          <small>{pick.player.position}</small>
                          <span
                            className="board-pick-direction"
                            aria-hidden="true"
                            title={`Round ${round} moves ${
                              round % 2 === 1 ? "left to right" : "right to left"
                            }`}
                          >
                            {round % 2 === 1 ? "→" : "←"}
                          </span>
                          <PlayerAvatar
                            name={pick.player.name}
                            imageUrl={pick.player.imageUrl}
                            size={28}
                          />
                        </button>
                      ) : (
                        <div className="board-pick empty">
                          <span>{round}.{slot}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </section>
      {isDemo && draftId ? (
        <DemoChatPanel
          roomId={draftId}
          canPost={hasDraftSeat}
          currentSlot={hasDraftSeat ? state.draft.userSlot : null}
        />
      ) : null}
    </main>
  );
}
