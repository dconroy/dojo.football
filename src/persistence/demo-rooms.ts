import { randomUUID } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import {
  getOrCreateLeagueDraft,
  saveSharedDraft,
  seedPlayersForDraft,
  type MemberSeat,
  type SharedDraft,
} from "@/persistence/league-draft";
import {
  draftBoardExhausted,
  draftIsFinished,
  uniquePlayerCount,
} from "@/domain/draft-capacity";
import {
  parseChenScoring,
  scoringFromSource,
  type ChenScoring,
} from "@/adapters/chen/boris-chen";
import {
  startMockClock,
  type MockDraftConfig,
  type MockPlayerSeed,
} from "@/adapters/yahoo/mock-runner";
import {
  addMockHumanSlot,
  loadMockConfig,
  loadMockSnapshot,
  saveMockConfig,
} from "@/adapters/yahoo/mock-store";
import { deleteDemoChatForRoom } from "@/persistence/demo-chat";
import {
  forgetDemoRoomStats,
  noteDemoRooms,
} from "@/persistence/demo-stats";

export const DEMO_ROOM_PREFIX = "demo:";
const DEMO_AUTO_PICK_MS = 30_000;
const COMPLETE_TTL_MS = 45 * 60 * 1000;
const EXHAUSTED_TTL_MS = 15 * 60 * 1000;
const IDLE_ROOM_TTL_MS = 60 * 60 * 1000;
// A room with no mock config is a half-created/orphaned shell (e.g. recreated
// from a stale cookie). Give creation a grace window, then recycle it.
const BROKEN_ROOM_TTL_MS = 2 * 60 * 1000;
// Before the clock starts, a demo seat whose client stops polling for this long
// is abandoned and frees up for a new joiner. After kickoff, missed picks are
// auto-drafted and the seat stays claimed until they explicitly leave.
const SEAT_IDLE_MS = 60 * 1000;
// Don't write a heartbeat more often than this per seat (clients poll ~3s).
const SEAT_HEARTBEAT_THROTTLE_MS = 8 * 1000;

/**
 * Per-seat heartbeats live in their own checkpoint row, decoupled from the mock
 * config (which uses optimistic concurrency for picks). Keeping them separate
 * means a heartbeat write can never clobber a concurrent pick write.
 */
function seatSeenKey(roomId: string) {
  return `demo-seats:${roomId}`;
}

interface SeatLease {
  readonly seenAt: string;
  readonly sessionId: string;
  readonly displayName: string;
}

type SeatLeases = Record<number, SeatLease>;

function parseSeatLeases(payload?: string | null): SeatLeases {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload) as Record<
      number,
      string | { seenAt?: unknown; sessionId?: unknown; displayName?: unknown }
    >;
    return Object.fromEntries(
      Object.entries(parsed).map(([slot, value]) => [
        slot,
        typeof value === "string"
          ? { seenAt: value, sessionId: "", displayName: "" }
          : {
              seenAt: typeof value.seenAt === "string" ? value.seenAt : "",
              sessionId: typeof value.sessionId === "string" ? value.sessionId : "",
              displayName:
                typeof value.displayName === "string" ? value.displayName : "",
            },
      ]),
    ) as SeatLeases;
  } catch {
    return {};
  }
}

async function loadSeatSeen(roomId: string): Promise<SeatLeases> {
  const row = await prisma.syncCheckpoint.findUnique({
    where: { id: seatSeenKey(roomId) },
  });
  return parseSeatLeases(row?.payload);
}

/** True while a claimed seat should stay taken. Clock running holds AFK humans. */
export function demoSeatIsHeld(
  lease: { readonly seenAt?: string; readonly sessionId?: string } | undefined,
  options: { readonly now?: number; readonly clockRunning?: boolean } = {},
): boolean {
  if (!lease?.sessionId) return false;
  const seenAt = Date.parse(lease.seenAt ?? "");
  if (!Number.isFinite(seenAt)) return false;
  if (options.clockRunning) return true;
  return (options.now ?? Date.now()) - seenAt < SEAT_IDLE_MS;
}

function leaseIsActive(
  lease?: SeatLease,
  now = Date.now(),
  clockRunning = false,
) {
  return demoSeatIsHeld(lease, { now, clockRunning });
}

async function claimSeatLease(
  roomId: string,
  humanSlots: readonly number[],
  teamCount: number,
  displayName: string,
  requestedSlot?: number | null,
  clockRunning = false,
): Promise<{ slot: number; sessionId: string }> {
  const sessionId = randomUUID();
  for (let guard = 0; guard < 8; guard += 1) {
    const row = await prisma.syncCheckpoint.findUnique({
      where: { id: seatSeenKey(roomId) },
    });
    const leases = parseSeatLeases(row?.payload);
    const active = activeSeatSet(humanSlots, leases, Date.now(), clockRunning);
    const slot =
      requestedSlot ??
      Array.from({ length: teamCount }, (_, index) => index + 1).find(
        (candidate) => !active.has(candidate),
      );
    if (!slot) throw new Error("This demo room is full");
    if (active.has(slot)) throw new Error(`Seat ${slot} is already taken`);
    const next = {
      ...leases,
      [slot]: { seenAt: new Date().toISOString(), sessionId, displayName },
    };
    if (!row) {
      try {
        await prisma.syncCheckpoint.create({
          data: {
            id: seatSeenKey(roomId),
            sequence: 1,
            syncedAt: new Date(),
            payload: JSON.stringify(next),
          },
        });
        return { slot, sessionId };
      } catch {
        continue;
      }
    }
    const result = await prisma.syncCheckpoint.updateMany({
      where: { id: row.id, sequence: row.sequence },
      data: {
        sequence: row.sequence + 1,
        syncedAt: new Date(),
        payload: JSON.stringify(next),
      },
    });
    if (result.count === 1) return { slot, sessionId };
  }
  throw new Error("That seat changed hands; choose an open seat and try again");
}

/** Human slots currently claimed. After kickoff, stale heartbeats still count. */
function activeSeatSet(
  humanSlots: readonly number[] | undefined,
  seen: SeatLeases,
  now = Date.now(),
  clockRunning = false,
): Set<number> {
  const active = new Set<number>();
  const leasedSlots = Object.keys(seen)
    .map(Number)
    .filter(Number.isInteger);
  for (const slot of new Set([...(humanSlots ?? []), ...leasedSlots])) {
    if (leaseIsActive(seen[slot], now, clockRunning)) active.add(slot);
  }
  return active;
}

export async function validateDemoSeat(
  roomId: string,
  slot: number | null,
  sessionId: string | null,
): Promise<boolean> {
  if (!slot || !sessionId) return false;
  const leases = await loadSeatSeen(roomId);
  const lease = leases[slot];
  if (lease?.sessionId !== sessionId) return false;
  if (leaseIsActive(lease)) return true;
  return demoRoomStarted(roomId).catch(() => false);
}

export async function releaseDemoSeat(
  roomId: string,
  slot: number | null,
  sessionId: string | null,
): Promise<void> {
  if (!slot || !sessionId) return;
  for (let guard = 0; guard < 5; guard += 1) {
    const row = await prisma.syncCheckpoint.findUnique({
      where: { id: seatSeenKey(roomId) },
    });
    if (!row) return;
    const leases = parseSeatLeases(row.payload);
    if (leases[slot]?.sessionId !== sessionId) return;
    const next = { ...leases };
    delete next[slot];
    const result = await prisma.syncCheckpoint.updateMany({
      where: { id: row.id, sequence: row.sequence },
      data: {
        sequence: row.sequence + 1,
        syncedAt: new Date(),
        payload: JSON.stringify(next),
      },
    });
    if (result.count === 1) return;
  }
}

/** Refresh the heartbeat for a seat a demo client is actively polling. */
export async function touchDemoSeat(
  roomId: string,
  slot: number | null,
  sessionId: string | null,
): Promise<boolean> {
  if (!slot || !sessionId) return false;
  const shared = await getOrCreateLeagueDraft(roomId);
  if (!shared.leagueKey) return false;
  const config = await loadMockConfig(shared.leagueKey);
  if (!config || !(config.humanSlots ?? []).includes(slot)) return false;
  const clockRunning = isDemoClockStarted(config);
  for (let guard = 0; guard < 5; guard += 1) {
    const row = await prisma.syncCheckpoint.findUnique({
      where: { id: seatSeenKey(roomId) },
    });
    if (!row) return false;
    const leases = parseSeatLeases(row.payload);
    const lease = leases[slot];
    if (lease?.sessionId !== sessionId || !leaseIsActive(lease, Date.now(), clockRunning)) {
      return false;
    }
    const last = Date.parse(lease.seenAt);
    if (Number.isFinite(last) && Date.now() - last < SEAT_HEARTBEAT_THROTTLE_MS) {
      return true;
    }
    const next = {
      ...leases,
      [slot]: { ...lease, seenAt: new Date().toISOString() },
    };
    const result = await prisma.syncCheckpoint.updateMany({
      where: { id: row.id, sequence: row.sequence },
      data: {
        sequence: row.sequence + 1,
        syncedAt: new Date(),
        payload: JSON.stringify(next),
      },
    });
    if (result.count === 1) return true;
  }
  return false;
}

function leagueKeyFor(roomId: string) {
  return `mock.${roomId.replace(/:/g, ".")}`;
}

export function isDemoRoomId(id: string) {
  return id.startsWith(DEMO_ROOM_PREFIX);
}

async function deleteRoom(roomId: string) {
  await deleteDemoChatForRoom(roomId).catch(() => undefined);
  await prisma.leagueDraft.delete({ where: { id: roomId } }).catch(() => undefined);
  await prisma.syncCheckpoint
    .delete({ where: { id: `mock:${leagueKeyFor(roomId)}` } })
    .catch(() => undefined);
  await prisma.syncCheckpoint
    .delete({ where: { id: seatSeenKey(roomId) } })
    .catch(() => undefined);
}

async function recycleStaleRooms() {
  const rooms = await prisma.leagueDraft.findMany({
    where: { id: { startsWith: DEMO_ROOM_PREFIX } },
    select: {
      id: true,
      leagueKey: true,
      picksJson: true,
      teamCount: true,
      rounds: true,
      updatedAt: true,
    },
  });
  const now = Date.now();
  for (const room of rooms) {
    // Orphaned shell (no mock key) that's past the creation grace window.
    if (!room.leagueKey && now - room.updatedAt.getTime() > BROKEN_ROOM_TTL_MS) {
      await deleteRoom(room.id);
      await forgetDemoRoomStats(room.id).catch(() => undefined);
      continue;
    }
    let picks = 0;
    try {
      picks = (JSON.parse(room.picksJson) as unknown[]).length;
    } catch {
      picks = 0;
    }
    const config = room.leagueKey ? await loadMockConfig(room.leagueKey) : null;
    const exhausted =
      isDemoClockStarted(config) &&
      draftBoardExhausted({
        picks,
        playerCount: uniquePlayerCount(config?.players ?? []),
        teamCount: room.teamCount,
        rounds: room.rounds,
      });
    const finished = picks >= room.teamCount * room.rounds || exhausted;
    const ttl = exhausted ? EXHAUSTED_TTL_MS : COMPLETE_TTL_MS;
    if (finished && now - room.updatedAt.getTime() > ttl) {
      const seatRow = await prisma.syncCheckpoint.findUnique({
        where: { id: seatSeenKey(room.id) },
        select: { payload: true },
      });
      await noteDemoRooms([
        {
          roomId: room.id,
          picks,
          humans: Math.max(
            activeSeatSet(
              undefined,
              parseSeatLeases(seatRow?.payload),
              now,
              isDemoClockStarted(config),
            ).size,
            config?.humanSlots?.length ?? 0,
          ),
          complete: true,
        },
      ]).catch(() => undefined);
      await deleteRoom(room.id);
      await forgetDemoRoomStats(room.id).catch(() => undefined);
      continue;
    }
    if (!finished) {
      const seatRow = await prisma.syncCheckpoint.findUnique({
        where: { id: seatSeenKey(room.id) },
        select: { payload: true, syncedAt: true },
      });
      const activeSeats = activeSeatSet(
        undefined,
        parseSeatLeases(seatRow?.payload),
        now,
        isDemoClockStarted(config),
      );
      const lastActivity = Math.max(
        room.updatedAt.getTime(),
        seatRow?.syncedAt.getTime() ?? 0,
      );
      if (
        activeSeats.size === 0 &&
        now - lastActivity > IDLE_ROOM_TTL_MS
      ) {
        await deleteRoom(room.id);
        await forgetDemoRoomStats(room.id).catch(() => undefined);
      }
    }
  }
}

function openSeats(
  config: MockDraftConfig | null,
  shared: SharedDraft,
  activeSlots: Set<number>,
) {
  // No mock config means the room is a broken shell — never joinable.
  if (!config || !shared.leagueKey) {
    return { complete: false, taken: new Set<number>(), openCount: 0, broken: true };
  }
  const complete = draftIsFinished({
    picks: shared.picks.length,
    playerCount: uniquePlayerCount(config.players),
    teamCount: shared.teamCount,
    rounds: shared.rounds,
  });
  return {
    complete,
    taken: activeSlots,
    openCount: complete ? 0 : Math.max(0, shared.teamCount - activeSlots.size),
    broken: false,
  };
}

async function createPausedRoom(): Promise<{ shared: SharedDraft; leagueKey: string }> {
  const roomId = `${DEMO_ROOM_PREFIX}${randomUUID()}`;
  const shared = await getOrCreateLeagueDraft(roomId);
  const leagueKey = leagueKeyFor(roomId);
  const players: MockPlayerSeed[] = shared.players.map((player) => ({
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    chenRank: player.chenRank,
    adp: player.adp,
  }));
  await saveMockConfig({
    leagueKey,
    teamCount: shared.teamCount,
    rounds: shared.rounds,
    intervalMs: 3000,
    startedAtIso: "",
    humanSlots: [],
    picksBySlot: {},
    autoPickMs: DEMO_AUTO_PICK_MS,
    varietySeed: randomUUID(),
    players,
  });
  const next = await saveSharedDraft({
    draftId: roomId,
    mode: "live",
    leagueKey,
  });
  return { shared: next, leagueKey };
}

export async function findOrCreateOpenDemoRoom(): Promise<{
  shared: SharedDraft;
  config: MockDraftConfig | null;
}> {
  await recycleStaleRooms();
  const rooms = await prisma.leagueDraft.findMany({
    where: { id: { startsWith: DEMO_ROOM_PREFIX } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      leagueKey: true,
      teamCount: true,
      rounds: true,
      picksJson: true,
    },
  });
  for (const row of rooms) {
    const config = row.leagueKey ? await loadMockConfig(row.leagueKey) : null;
    const active = config
      ? activeSeatSet(
          config.humanSlots,
          await loadSeatSeen(row.id),
          Date.now(),
          isDemoClockStarted(config),
        )
      : new Set<number>();
    const seats = openSeats(
      config,
      {
        id: row.id,
        leagueKey: row.leagueKey,
        mode: "live",
        teamCount: row.teamCount,
        rounds: row.rounds,
        picks: picksFromJson(row.picksJson) as SharedDraft["picks"],
        players: [],
        importedAt: "",
        source: "",
        updatedAt: "",
      },
      active,
    );
    if (seats.broken || !config) continue; // skip orphaned shells entirely
    const snapshot = await loadMockSnapshot(config.leagueKey);
    const complete =
      seats.complete ||
      (snapshot?.draftResults.length ?? 0) >= config.teamCount * config.rounds;
    if (!complete && seats.openCount > 0) {
      return { shared: await getOrCreateLeagueDraft(row.id), config };
    }
  }
  const created = await createPausedRoom();
  const config = await loadMockConfig(created.leagueKey);
  return { shared: created.shared, config };
}

export interface DemoRoomSummary {
  readonly id: string;
  readonly totalSeats: number;
  readonly activeSeats: number;
  readonly openSeats: number;
  readonly openSeatList: readonly number[];
  readonly scoring: ChenScoring;
  readonly rounds: number;
  readonly picks: number;
  readonly totalPicks: number;
  readonly started: boolean;
  readonly complete: boolean;
  readonly exhausted: boolean;
}

function picksFromJson(picksJson: string): unknown[] {
  try {
    const parsed = JSON.parse(picksJson) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Live demo rooms with seat availability, for the landing-page room list. */
export async function listDemoRooms(): Promise<DemoRoomSummary[]> {
  await recycleStaleRooms();
  const rows = await prisma.leagueDraft.findMany({
    where: { id: { startsWith: DEMO_ROOM_PREFIX } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      leagueKey: true,
      teamCount: true,
      rounds: true,
      source: true,
      picksJson: true,
    },
  });
  const summaries: DemoRoomSummary[] = [];
  const activities: Array<{
    roomId: string;
    picks: number;
    humans: number;
    complete: boolean;
  }> = [];
  for (const row of rows) {
    if (!row.leagueKey) continue; // orphaned shell
    const config = await loadMockConfig(row.leagueKey);
    if (!config) continue;
    const snapshot = await loadMockSnapshot(row.leagueKey);
    const active = activeSeatSet(
      config.humanSlots,
      await loadSeatSeen(row.id),
      Date.now(),
      isDemoClockStarted(config),
    );
    const totalPicks = config.teamCount * config.rounds;
    const picks = Math.max(
      picksFromJson(row.picksJson).length,
      snapshot?.draftResults.length ?? 0,
    );
    const capacity = {
      picks,
      playerCount: uniquePlayerCount(config.players),
      teamCount: row.teamCount,
      rounds: row.rounds,
    };
    const exhausted = draftBoardExhausted(capacity);
    const complete = draftIsFinished(capacity);
    const openSeatList = Array.from(
      { length: row.teamCount },
      (_, index) => index + 1,
    ).filter((slot) => !active.has(slot));
    summaries.push({
      id: row.id,
      totalSeats: row.teamCount,
      activeSeats: active.size,
      openSeats: complete ? 0 : Math.max(0, row.teamCount - active.size),
      openSeatList: complete ? [] : openSeatList,
      scoring: scoringFromSource(row.source),
      rounds: row.rounds,
      picks,
      totalPicks,
      started: Boolean(config.startedAtIso) && Number.isFinite(Date.parse(config.startedAtIso)),
      complete,
      exhausted,
    });
    activities.push({
      roomId: row.id,
      picks,
      humans: Math.max(active.size, config.humanSlots?.length ?? 0),
      complete,
    });
  }
  await noteDemoRooms(activities).catch(() => undefined);
  return summaries;
}

/** Seats claimed by a human. After kickoff, AFK managers stay seated and auto-draft. */
export async function takenSeatsFor(roomId: string): Promise<number[]> {
  const shared = await getOrCreateLeagueDraft(roomId);
  if (!shared.leagueKey) return [];
  const loaded = await loadMockConfig(shared.leagueKey);
  if (!loaded) return [];
  const active = activeSeatSet(
    loaded.humanSlots,
    await loadSeatSeen(roomId),
    Date.now(),
    isDemoClockStarted(loaded),
  );
  return [...active].sort((a, b) => a - b);
}

export async function demoSeatMembers(roomId: string): Promise<MemberSeat[]> {
  const leases = await loadSeatSeen(roomId);
  const clockRunning = await demoRoomStarted(roomId).catch(() => false);
  return Object.entries(leases)
    .map(([slot, lease]) => ({ slot: Number(slot), lease }))
    .filter(
      ({ slot, lease }) =>
        Number.isInteger(slot) && leaseIsActive(lease, Date.now(), clockRunning),
    )
    .sort((left, right) => left.slot - right.slot)
    .map(({ slot, lease }) => {
      const displayName = lease.displayName || "Human";
      return {
        id: `demo:${roomId}:${slot}`,
        displayName,
        draftSlot: slot,
        teamName: displayName,
        role: "member",
        status: "active",
        lastSeenAt: lease.seenAt || null,
      };
    });
}

export function validateDemoTeamName(value: unknown): string {
  const name =
    typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ")
      : "";
  if (name.length < 2) throw new Error("Team name must be at least 2 characters");
  if (name.length > 32) throw new Error("Team name must be 32 characters or fewer");
  return name;
}

export async function claimDemoSeat(
  roomId: string,
  displayName: string,
  requestedSlot?: number | null,
): Promise<{
  shared: SharedDraft;
  slot: number;
  sessionId: string;
  config: MockDraftConfig;
}> {
  const shared = await getOrCreateLeagueDraft(roomId);
  if (!shared.leagueKey) throw new Error("Demo room is missing a mock key");
  const loaded = await loadMockConfig(shared.leagueKey);
  if (!loaded) throw new Error("Demo room is not ready");
  const snapshot = await loadMockSnapshot(shared.leagueKey);
  if (
    snapshot &&
    draftIsFinished({
      picks: snapshot.draftResults.length,
      playerCount: uniquePlayerCount(loaded.players),
      teamCount: loaded.teamCount,
      rounds: loaded.rounds,
    })
  ) {
    throw new Error(
      draftBoardExhausted({
        picks: snapshot.draftResults.length,
        playerCount: uniquePlayerCount(loaded.players),
        teamCount: loaded.teamCount,
        rounds: loaded.rounds,
      })
        ? "This demo draft ran out of players and is closed"
        : "This demo draft is complete",
    );
  }
  if (requestedSlot != null) {
    if (
      !Number.isInteger(requestedSlot) ||
      requestedSlot < 1 ||
      requestedSlot > shared.teamCount
    ) {
      throw new Error(`Seat ${requestedSlot} is not a valid slot`);
    }
  }
  const { slot, sessionId } = await claimSeatLease(
    roomId,
    loaded.humanSlots ?? [],
    shared.teamCount,
    validateDemoTeamName(displayName),
    requestedSlot,
    isDemoClockStarted(loaded),
  );
  // Re-claiming an abandoned seat: it's already a human slot, so keep its picks
  // and just re-arm the heartbeat. A robot seat gets promoted to human.
  const alreadyHuman = (loaded.humanSlots ?? []).includes(slot);
  try {
    const next = alreadyHuman
      ? loaded
      : await addMockHumanSlot(loaded.leagueKey, slot);
    return { shared, slot, sessionId, config: next };
  } catch (error) {
    await releaseDemoSeat(roomId, slot, sessionId);
    throw error;
  }
}

export interface CreateDemoRoomInput {
  readonly scoring: ChenScoring;
  readonly teamCount: number;
  readonly rounds: number;
  readonly slot: number;
  readonly displayName: string;
}

export function validateDemoRoomInput(input: {
  scoring?: unknown;
  teamCount?: unknown;
  rounds?: unknown;
  slot?: unknown;
  displayName?: unknown;
}): CreateDemoRoomInput {
  const scoringRaw = typeof input.scoring === "string" ? input.scoring : "";
  if (!["standard", "half-ppr", "ppr"].includes(scoringRaw)) {
    throw new Error("Scoring must be Standard, Half PPR, or PPR");
  }
  const scoring = parseChenScoring(scoringRaw);
  const teamCount = Number(input.teamCount);
  const rounds = Number(input.rounds);
  const slot = Number(input.slot);
  const displayName = validateDemoTeamName(input.displayName);
  if (!Number.isInteger(teamCount) || teamCount < 8 || teamCount > 14) {
    throw new Error("Roster count must be between 8 and 14");
  }
  if (!Number.isInteger(rounds) || rounds < 10 || rounds > 16) {
    throw new Error("Rounds must be between 10 and 16");
  }
  if (!Number.isInteger(slot) || slot < 1 || slot > teamCount) {
    throw new Error(`Draft slot must be between 1 and ${teamCount}`);
  }
  return { scoring, teamCount, rounds, slot, displayName };
}

export async function createDemoRoom(
  input: CreateDemoRoomInput,
): Promise<{
  shared: SharedDraft;
  slot: number;
  sessionId: string;
  config: MockDraftConfig;
}> {
  const settings = validateDemoRoomInput(input);
  const roomId = `${DEMO_ROOM_PREFIX}${randomUUID()}`;
  const leagueKey = leagueKeyFor(roomId);
  const seeded = await seedPlayersForDraft(
    settings.scoring,
    settings.teamCount,
    settings.rounds,
  );
  await prisma.leagueDraft.create({
    data: {
      id: roomId,
      leagueKey,
      mode: "live",
      teamCount: settings.teamCount,
      rounds: settings.rounds,
      playersJson: JSON.stringify(seeded.players),
      importedAt: seeded.importedAt,
      source: seeded.source,
    },
  });
  const players: MockPlayerSeed[] = seeded.players.map((player) => ({
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    chenRank: player.chenRank,
    adp: player.adp,
  }));
  const config: MockDraftConfig = {
    leagueKey,
    teamCount: settings.teamCount,
    rounds: settings.rounds,
    intervalMs: 3000,
    startedAtIso: "",
    humanSlots: [settings.slot],
    picksBySlot: {},
    autoPickMs: DEMO_AUTO_PICK_MS,
    varietySeed: randomUUID(),
    players,
  };
  const { sessionId } = await claimSeatLease(
    roomId,
    config.humanSlots ?? [],
    settings.teamCount,
    settings.displayName,
    settings.slot,
  );
  try {
    await saveMockConfig(config);
  } catch (error) {
    await releaseDemoSeat(roomId, settings.slot, sessionId);
    throw error;
  }
  return {
    shared: await getOrCreateLeagueDraft(roomId),
    slot: settings.slot,
    sessionId,
    config,
  };
}

export function isDemoClockStarted(config: MockDraftConfig | null | undefined): boolean {
  const startedAtIso = config?.startedAtIso;
  return Boolean(
    startedAtIso && Number.isFinite(Date.parse(startedAtIso)),
  );
}

export async function demoRoomStarted(roomId: string): Promise<boolean> {
  const shared = await getOrCreateLeagueDraft(roomId);
  if (!shared.leagueKey) return false;
  return isDemoClockStarted(await loadMockConfig(shared.leagueKey));
}

export async function demoClientState(roomId: string): Promise<{
  takenSlots: number[];
  started: boolean;
}> {
  return {
    takenSlots: await takenSeatsFor(roomId),
    started: await demoRoomStarted(roomId),
  };
}

/** Begin the mock clock. Safe to call again if the room is already running. */
export async function startDemoDraft(roomId: string): Promise<MockDraftConfig> {
  const shared = await getOrCreateLeagueDraft(roomId);
  if (!shared.leagueKey) throw new Error("Demo room is missing a mock key");
  const loaded = await loadMockConfig(shared.leagueKey);
  if (!loaded) throw new Error("Demo room is not ready");
  const started = startMockClock(loaded);
  if (started.startedAtIso !== loaded.startedAtIso) {
    await saveMockConfig(started);
  }
  return started;
}
