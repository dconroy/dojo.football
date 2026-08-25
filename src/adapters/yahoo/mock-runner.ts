import {
  positionFillsLineupNeed,
  remainingLineupNeed,
  type PositionCounts,
} from "@/domain/lineup-need";
import { recommendPlayers } from "@/domain/recommendation";
import { rebuildDraftFromPlayers } from "@/domain/reconcile-draft";
import type { Player } from "@/domain/types";
import type { YahooDraftResult } from "./yahoo-api";

export interface MockPlayerSeed {
  readonly id: string;
  readonly name: string;
  readonly position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
  readonly team: string;
  readonly chenRank?: number;
  readonly chenTier?: number;
  readonly adp?: number;
  readonly byeWeek?: number;
  readonly projectedPoints?: number;
  readonly estimatedReturnProbability?: number;
}

function mockPlayerKey(player: Pick<MockPlayerSeed, "name" | "position">): string {
  return `${player.name.toLowerCase()}|${player.position}`;
}

/**
 * Update ranks on the running mock without renaming already-drafted ids.
 * New experts keep existing pick identities so the clock does not stall.
 */
export function mergeMockRankingSeeds(
  current: readonly MockPlayerSeed[],
  incoming: readonly MockPlayerSeed[],
): MockPlayerSeed[] {
  const byId = new Map(incoming.map((player) => [player.id, player]));
  const byKey = new Map(incoming.map((player) => [mockPlayerKey(player), player]));
  const merged = current.map((player) => {
    const hit = byId.get(player.id) ?? byKey.get(mockPlayerKey(player));
    if (!hit) return player;
    return {
      ...player,
      chenRank: hit.chenRank,
      chenTier: hit.chenTier,
      adp: hit.adp ?? player.adp,
      byeWeek: hit.byeWeek ?? player.byeWeek,
      projectedPoints: hit.projectedPoints ?? player.projectedPoints,
      estimatedReturnProbability:
        hit.estimatedReturnProbability ?? player.estimatedReturnProbability,
      team: hit.team || player.team,
    };
  });
  const seen = new Set(merged.map(mockPlayerKey));
  for (const player of incoming) {
    const key = mockPlayerKey(player);
    if (seen.has(key)) continue;
    merged.push(player);
    seen.add(key);
  }
  return merged;
}

export interface MockDraftConfig {
  readonly leagueKey: string;
  readonly teamCount: number;
  readonly rounds: number;
  readonly intervalMs: number;
  /** Empty / invalid means the mock is paused (no clock). */
  readonly startedAtIso: string;
  readonly players: readonly MockPlayerSeed[];
  /** Draft slots that pause for a human to confirm. Robots fill the rest. */
  readonly humanSlots?: readonly number[];
  /** Confirmed player ids per human slot, in the order that slot picked them. */
  readonly picksBySlot?: Readonly<Record<number, readonly string[]>>;
  /** @deprecated single-seat legacy field; superseded by humanSlots. */
  readonly userSlot?: number;
  /** @deprecated single-seat legacy field; superseded by picksBySlot. */
  readonly userPicks?: readonly string[];
  /**
   * When set (>0), a human seat that has been on the clock longer than this many
   * milliseconds is auto-drafted the best available player. Used for multiplayer
   * mocks so an absent manager never stalls the room.
   */
  readonly autoPickMs?: number;
  /**
   * Immutable per-draft seed. When present, robots apply a small, deterministic
   * preference nudge so opponents feel like managers with slight biases instead
   * of identical best-available bots. Must never change for a given draft or the
   * projected order would reshuffle between polls.
   */
  readonly varietySeed?: string;
}

interface NormalizedSeats {
  readonly humanSlots: Set<number>;
  readonly picksBySlot: Record<number, readonly string[]>;
}

/**
 * Accepts either the multi-seat shape (`humanSlots` + `picksBySlot`) or the
 * legacy single-seat shape (`userSlot` + `userPicks`) and returns a uniform
 * view the rest of the module works against.
 */
function normalizeSeats(config: MockDraftConfig): NormalizedSeats {
  if (config.humanSlots && config.humanSlots.length > 0) {
    const picksBySlot: Record<number, readonly string[]> = {};
    for (const slot of config.humanSlots) {
      picksBySlot[slot] = config.picksBySlot?.[slot] ?? [];
    }
    return { humanSlots: new Set(config.humanSlots), picksBySlot };
  }
  const slot = config.userSlot ?? 1;
  return {
    humanSlots: new Set([slot]),
    picksBySlot: { [slot]: config.userPicks ?? [] },
  };
}

/** Total picks confirmed by all human seats combined. */
export function humanPickCount(config: MockDraftConfig): number {
  const { humanSlots, picksBySlot } = normalizeSeats(config);
  let total = 0;
  for (const slot of humanSlots) total += (picksBySlot[slot] ?? []).length;
  return total;
}

const MAX_PER_POSITION: Record<MockPlayerSeed["position"], number> = {
  QB: 3,
  RB: 7,
  WR: 7,
  TE: 3,
  K: 2,
  DEF: 2,
};

/** Don't touch K/DEF before this round; force the holes in the last N picks. */
const SPECIALIST_OPEN_ROUND = 13;

type PositionCount = PositionCounts;

/**
 * When a seat has only just enough picks left to finish a legal lineup, the best
 * available player that fills one of the remaining starting spots. Null while
 * there's still slack to draft best-available. Keeps auto-drafted (AFK) managers
 * from ending up with holes like zero TE or a single RB.
 */
export function rosterCompletionPick(
  sortable: readonly MockPlayerSeed[],
  available: (player: MockPlayerSeed) => boolean,
  counts: PositionCount,
  remainingPicks: number,
): MockPlayerSeed | undefined {
  const need = remainingLineupNeed(counts);
  if (need <= 0 || remainingPicks > need) return undefined;
  return sortable.find(
    (player) => available(player) && positionFillsLineupNeed(counts, player.position),
  );
}

/**
 * How far down the board a robot will even consider "reaching," and how strong
 * that reach can be (measured in board positions). Kept intentionally small so
 * opponents behave like managers with slight preferences rather than chaos: the
 * best available almost always still goes, but a favored player occasionally
 * jumps a few spots.
 */
const REACH_WINDOW = 6;
const PLAYER_LEAN = 2.2;
const POSITION_LEAN = 1.3;

/** Stable 32-bit hash so a robot's preferences never reshuffle between polls. */
function hashString(input: string): number {
  let hash = 1779033703 ^ input.length;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^= hash >>> 16) >>> 0;
}

/** Deterministic value in [0, 1) for a set of seed parts. */
function seededUnit(...parts: Array<string | number>): number {
  return hashString(parts.join("|")) / 4294967296;
}

/**
 * A per-team, per-player rank nudge (in board positions). Blends a small
 * player-specific quirk with a per-team positional lean so seats feel distinct
 * while staying anchored to best-available.
 */
function makePreference(
  seed: string,
  slot: number,
): (player: MockPlayerSeed) => number {
  return (player) => {
    const playerLean =
      (seededUnit(seed, "player", slot, player.id) - 0.5) * 2 * PLAYER_LEAN;
    const positionLean =
      (seededUnit(seed, "position", slot, player.position) - 0.5) *
      2 *
      POSITION_LEAN;
    return playerLean + positionLean;
  };
}

function missingSpecialists(
  roster: Record<MockPlayerSeed["position"], number>,
): Array<"K" | "DEF"> {
  const missing: Array<"K" | "DEF"> = [];
  if (roster.K === 0) missing.push("K");
  if (roster.DEF === 0) missing.push("DEF");
  return missing;
}

function chooseRobotPlayer(
  sortable: readonly MockPlayerSeed[],
  available: (player: MockPlayerSeed) => boolean,
  roster: Record<MockPlayerSeed["position"], number>,
  round: number,
  rounds: number,
  preference?: (player: MockPlayerSeed) => number,
): MockPlayerSeed | undefined {
  const missing = missingSpecialists(roster);
  const remainingRounds = rounds - round + 1;
  const forced =
    missing.length > 0 && remainingRounds <= missing.length ? missing : [];

  const fitsCap = (player: MockPlayerSeed) =>
    roster[player.position] < MAX_PER_POSITION[player.position];
  const tooEarlySpecialist = (player: MockPlayerSeed) =>
    (player.position === "K" || player.position === "DEF") &&
    round < SPECIALIST_OPEN_ROUND;

  // Filling a forced roster hole is not a "preference" — grab the best one.
  if (forced.length > 0) {
    for (const position of forced) {
      const specialist = sortable.find(
        (player) => available(player) && player.position === position,
      );
      if (specialist) return specialist;
    }
  }

  const eligible = sortable.filter(
    (player) =>
      available(player) && fitsCap(player) && !tooEarlySpecialist(player),
  );
  if (eligible.length === 0) return sortable.find((player) => available(player));
  if (!preference) return eligible[0];

  // Windowed reach: score the top few by their best-available position plus this
  // seat's small preference nudge, then take the lowest. Ties keep the higher
  // Chen rank, so the reach stays bounded and mostly favors BPA.
  const window = eligible.slice(0, REACH_WINDOW);
  let best = window[0];
  let bestScore = Number.POSITIVE_INFINITY;
  window.forEach((player, index) => {
    const score = index + preference(player);
    if (score < bestScore) {
      bestScore = score;
      best = player;
    }
  });
  return best;
}

/** Snake-order slot for a 1-indexed overall pick. */
export function slotForOverall(overall: number, teamCount: number): number {
  const round = Math.ceil(overall / teamCount);
  const positionInRound = ((overall - 1) % teamCount) + 1;
  return round % 2 === 1 ? positionInRound : teamCount - positionInRound + 1;
}

/**
 * Deterministic BPA drafter with soft per-position caps.
 * Stops (does not invent a pick) when it reaches a human slot that has not yet
 * confirmed its next pick. Robots fill every non-human slot.
 */
export function projectedDraftOrder(config: MockDraftConfig): MockPlayerSeed[] {
  const { humanSlots, picksBySlot } = normalizeSeats(config);
  const byId = new Map(config.players.map((player) => [player.id, player]));
  const sortable = [...config.players].sort((a, b) => {
    const rank = (a.chenRank ?? 9999) - (b.chenRank ?? 9999);
    if (rank !== 0) return rank;
    return (a.adp ?? 9999) - (b.adp ?? 9999);
  });
  const totalPicks = Math.min(
    sortable.length,
    config.teamCount * config.rounds,
  );
  const rosters: Array<Record<MockPlayerSeed["position"], number>> = Array.from(
    { length: config.teamCount },
    () => ({ QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 }),
  );
  const remaining = new Set(sortable.map((player) => player.id));

  const picks: MockPlayerSeed[] = [];
  const consumed: Record<number, number> = {};

  for (let overall = 1; overall <= totalPicks; overall += 1) {
    const slot = slotForOverall(overall, config.teamCount);
    const round = Math.ceil(overall / config.teamCount);

    if (humanSlots.has(slot)) {
      const slotPicks = picksBySlot[slot] ?? [];
      const index = consumed[slot] ?? 0;
      const userId = slotPicks[index];
      if (!userId) break;
      const player = byId.get(userId);
      if (!player) break;
      consumed[slot] = index + 1;
      if (picks.some((entry) => entry.id === player.id)) {
        // Stale/duplicate confirm — don't replay a player already on the board.
        break;
      }
      remaining.delete(player.id);
      rosters[slot - 1][player.position] += 1;
      picks.push(player);
      continue;
    }

    const roster = rosters[slot - 1];
    const preference = config.varietySeed
      ? makePreference(config.varietySeed, slot)
      : undefined;
    const choice = chooseRobotPlayer(
      sortable,
      (player) => remaining.has(player.id),
      roster,
      round,
      config.rounds,
      preference,
    );
    if (!choice) break;
    remaining.delete(choice.id);
    roster[choice.position] += 1;
    picks.push(choice);
  }
  return picks;
}

/** Number of picks that should have been made by `now` based on the schedule. */
export function elapsedPickCount(
  config: MockDraftConfig,
  now: number = Date.now(),
): number {
  const started = Date.parse(config.startedAtIso);
  if (!Number.isFinite(started)) return 0;
  const delta = Math.max(0, now - started);
  return Math.floor(delta / config.intervalMs);
}

/**
 * The human slot the draft is currently blocked on, or null when a robot pick
 * is due (or the draft is complete). "Blocked" means the projector stopped at a
 * human seat AND the clock has already reached that pick.
 */
export function waitingSlot(
  config: MockDraftConfig,
  now: number = Date.now(),
): number | null {
  if (!Number.isFinite(Date.parse(config.startedAtIso))) return null;
  const { humanSlots } = normalizeSeats(config);
  const order = projectedDraftOrder(config);
  if (order.length >= config.teamCount * config.rounds) return null;
  const nextOverall = order.length + 1;
  const slot = slotForOverall(nextOverall, config.teamCount);
  if (!humanSlots.has(slot)) return null;
  return elapsedPickCount(config, now) >= order.length ? slot : null;
}

/**
 * True when the draft is blocked on any human seat right now.
 */
export function isWaitingOnUser(
  config: MockDraftConfig,
  now: number = Date.now(),
): boolean {
  return waitingSlot(config, now) !== null;
}

/**
 * Yahoo-shaped draft results for the mock.
 * Never invents a user-slot pick; clock advancement past a user turn is ignored
 * until that pick is recorded via `userPicks`.
 */
export function mockDraftResults(
  config: MockDraftConfig,
  now: number = Date.now(),
): {
  picks: YahooDraftResult[];
  total: number;
  order: MockPlayerSeed[];
  waitingOnUser: boolean;
  waitingSlot: number | null;
} {
  const order = projectedDraftOrder(config);
  const readyCount = Math.min(order.length, elapsedPickCount(config, now));
  const picks: YahooDraftResult[] = order.slice(0, readyCount).map((player, index) => {
    const overall = index + 1;
    return {
      pick: overall,
      round: Math.ceil(overall / config.teamCount),
      teamKey: `mock.t.${slotForOverall(overall, config.teamCount)}`,
      playerKey: `mock.p.${player.id}`,
    };
  });
  const blockedOn = waitingSlot(config, now);
  return {
    picks,
    total: config.teamCount * config.rounds,
    order,
    waitingOnUser: blockedOn !== null,
    waitingSlot: blockedOn,
  };
}

/**
 * Append a confirmed pick for whichever human seat is currently on the clock
 * and rewind the clock so the next robot pick lands one interval from `now`.
 * When `expectedSlot` is provided it must match the on-clock seat — this guards
 * against a stale client confirming out of turn.
 */
/** Add a human seat mid-draft. Already-published robot picks for that seat stay. */
export function claimHumanSlot(
  config: MockDraftConfig,
  slot: number,
): MockDraftConfig {
  if (!Number.isInteger(slot) || slot < 1 || slot > config.teamCount) {
    throw new Error(`Slot must be between 1 and ${config.teamCount}`);
  }
  const { humanSlots, picksBySlot } = normalizeSeats(config);
  if (humanSlots.has(slot)) {
    throw new Error(`Slot ${slot} is already taken`);
  }
  const inherited: string[] = [];
  for (const pick of mockDraftResults(config).picks) {
    if (slotForOverall(pick.pick, config.teamCount) === slot) {
      inherited.push(pick.playerKey.replace(/^mock\.p\./, ""));
    }
  }
  return {
    ...config,
    humanSlots: [...humanSlots, slot].sort((a, b) => a - b),
    picksBySlot: { ...picksBySlot, [slot]: inherited },
  };
}

export function startMockClock(
  config: MockDraftConfig,
  now: number = Date.now(),
): MockDraftConfig {
  if (Number.isFinite(Date.parse(config.startedAtIso))) return config;
  return { ...config, startedAtIso: new Date(now).toISOString() };
}

export function recordUserPick(
  config: MockDraftConfig,
  playerId: string,
  now: number = Date.now(),
  expectedSlot?: number,
): MockDraftConfig {
  if (!Number.isFinite(Date.parse(config.startedAtIso))) {
    throw new Error("Mock draft has not started");
  }
  const normalized = normalizeSeats(config);
  if (
    expectedSlot !== undefined &&
    normalized.picksBySlot[expectedSlot]?.at(-1) === playerId
  ) {
    return config;
  }
  const slot = waitingSlot(config, now);
  if (slot === null) {
    throw new Error("Mock draft is not waiting on a human pick");
  }
  if (expectedSlot !== undefined && expectedSlot !== slot) {
    throw new Error(
      `Mock draft is on the clock for slot ${slot}, not slot ${expectedSlot}`,
    );
  }
  const { humanSlots, picksBySlot } = normalized;
  const alreadyPicked =
    projectedDraftOrder(config).some((player) => player.id === playerId) ||
    Object.values(picksBySlot).some((ids) => ids.includes(playerId));
  if (alreadyPicked) {
    throw new Error(`Player ${playerId} is already drafted`);
  }
  if (!config.players.some((player) => player.id === playerId)) {
    throw new Error(`Unknown player ${playerId}`);
  }
  const picksBeforeConfirm = projectedDraftOrder(config).length;
  const nextPicksBySlot: Record<number, readonly string[]> = {};
  for (const seat of humanSlots) nextPicksBySlot[seat] = picksBySlot[seat] ?? [];
  nextPicksBySlot[slot] = [...(nextPicksBySlot[slot] ?? []), playerId];

  // Align the clock so only picks through the just-confirmed selection are ready
  // now; the next robot pick appears after one more interval.
  const doneCount = picksBeforeConfirm + 1;
  const startedAtIso = new Date(
    now - doneCount * config.intervalMs,
  ).toISOString();
  return {
    ...config,
    humanSlots: [...humanSlots],
    picksBySlot: nextPicksBySlot,
    userSlot: undefined,
    userPicks: undefined,
    startedAtIso,
  };
}

/**
 * Epoch ms at which the human seat currently on the clock gets auto-drafted, or
 * null when auto-draft is disabled or no human is pending. The clock starts the
 * moment that seat's pick becomes due on the schedule, independent of `now`.
 */
export function autoPickDeadline(config: MockDraftConfig): number | null {
  const autoMs = config.autoPickMs ?? 0;
  if (autoMs <= 0) return null;
  const { humanSlots } = normalizeSeats(config);
  const order = projectedDraftOrder(config);
  if (order.length >= config.teamCount * config.rounds) return null;
  const slot = slotForOverall(order.length + 1, config.teamCount);
  if (!humanSlots.has(slot)) return null;
  const started = Date.parse(config.startedAtIso);
  if (!Number.isFinite(started)) return null;
  return started + order.length * config.intervalMs + autoMs;
}

/** Pick the same #1 player the Dojo recommendation panel shows for this seat. */
export function autoPickPlayerId(config: MockDraftConfig): string | null {
  const { humanSlots } = normalizeSeats(config);
  const order = projectedDraftOrder(config);
  if (order.length >= config.teamCount * config.rounds) return null;
  const nextOverall = order.length + 1;
  const slot = slotForOverall(nextOverall, config.teamCount);
  if (!humanSlots.has(slot)) return null;
  const players = config.players as readonly Player[];
  const state = rebuildDraftFromPlayers(
    {
      userSlot: slot,
      teamCount: config.teamCount,
      rounds: config.rounds,
    },
    order as readonly Player[],
  );
  return (
    recommendPlayers(state, players, { topCount: 1 }).recommendations[0]?.player
      .id ?? null
  );
}

/**
 * If the on-clock human has blown the auto-pick deadline, return a new config
 * with the best available player recorded for that seat and the clock anchored
 * to the deadline (so following robots resume from there, not from `now`).
 * Returns null when nothing is due.
 */
export function autoPickIfDue(
  config: MockDraftConfig,
  now: number = Date.now(),
): MockDraftConfig | null {
  const deadline = autoPickDeadline(config);
  if (deadline === null || now < deadline) return null;
  const playerId = autoPickPlayerId(config);
  if (!playerId) return null;
  const slot = slotForOverall(
    projectedDraftOrder(config).length + 1,
    config.teamCount,
  );
  return recordUserPick(config, playerId, deadline, slot);
}
