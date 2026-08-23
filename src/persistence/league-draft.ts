import { prisma } from "@/persistence/prisma";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import {
  makeManualPick,
  undoLastPick,
  type DraftState,
  type Pick,
  type Player,
  type StrategyWeights,
} from "@/domain";
import { MOCK_PLAYERS } from "@/fixtures/mock-players";
import type { ChenImport } from "@/adapters/chen/boris-chen";
import {
  scoringFromSource,
  type ChenScoring,
} from "@/adapters/chen/boris-chen";
import { getFreshChenImport } from "@/adapters/chen/server-cache";
import { extendRankingImport } from "@/adapters/rankings/extend-board";
import {
  requiredPickCount,
  shortBoardMessage,
} from "@/domain/draft-capacity";
import { shouldAutoRefreshChen } from "@/adapters/rankings/labels";
import {
  getPlayerMetaIndex,
  playerMetaKey,
} from "@/adapters/yahoo/player-meta";
import { getSleeperIndex } from "@/adapters/sleeper/players";
import { byeWeekForTeam } from "@/config/nfl-byes";
import { normalizeTeam } from "@/domain/identity";
import type { User } from "@prisma/client";
import type { Position } from "@/domain";
import { playerRevision } from "@/lib/board-sync";

export { playerRevision };

export const LEAGUE_DRAFT_ID = "house-2026";

export interface SharedDraft {
  readonly id: string;
  readonly leagueKey: string | null;
  readonly mode: "mock" | "live";
  readonly teamCount: number;
  readonly rounds: number;
  readonly picks: readonly Pick[];
  readonly players: readonly Player[];
  readonly importedAt: string;
  readonly source: string;
  readonly updatedAt: string;
}

const DRAFT_META_SELECT = {
  id: true,
  leagueKey: true,
  mode: true,
  teamCount: true,
  rounds: true,
  picksJson: true,
  importedAt: true,
  source: true,
  updatedAt: true,
} as const;

export type DraftMeta = Omit<SharedDraft, "players">;

export async function getDraftMeta(
  draftId = LEAGUE_DRAFT_ID,
): Promise<DraftMeta | null> {
  const row = await prisma.leagueDraft.findUnique({
    where: { id: draftId },
    select: DRAFT_META_SELECT,
  });
  if (!row) return null;
  return {
    id: row.id,
    leagueKey: row.leagueKey,
    mode: row.mode === "live" ? "live" : "mock",
    teamCount: row.teamCount,
    rounds: row.rounds,
    picks: parseJson<Pick[]>(row.picksJson, []),
    importedAt: row.importedAt,
    source: row.source,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface MemberSeat {
  readonly id: string;
  readonly displayName: string;
  readonly draftSlot: number | null;
  readonly teamName: string | null;
  readonly role: string;
  readonly status: string;
  readonly lastSeenAt: string | null;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function shapeChenImport(cached: ChenImport | null) {
  if (!cached?.players.length) return null;
  return {
    players: cached.players.map((player) => ({
      id: player.sourceId,
      name: player.name,
      position: player.position as Position,
      team: player.team ?? "FA",
      chenRank: player.overallRank,
      chenTier: player.tier,
      byeWeek: player.byeWeek,
      adp: player.adp,
    })),
    importedAt: cached.importedAt,
    source: cached.source,
  };
}

async function freshPlayersFromChen() {
  return shapeChenImport(await getFreshChenImport());
}

export async function seedPlayersForScoring(scoring: ChenScoring) {
  const seeded = shapeChenImport(await getFreshChenImport(undefined, scoring));
  if (!seeded) {
    throw new Error(`Player rankings are unavailable for ${scoring}`);
  }
  return seeded;
}

/** Chen first, then other ranking lists until the room has enough names. */
export async function seedPlayersForDraft(
  scoring: ChenScoring,
  teamCount: number,
  rounds: number,
) {
  const need = requiredPickCount(teamCount, rounds);
  const imported = await getFreshChenImport(undefined, scoring);
  if (!imported?.players.length) {
    throw new Error(`Player rankings are unavailable for ${scoring}`);
  }
  const extended =
    imported.players.length >= need
      ? imported
      : await extendRankingImport(imported, scoring, need);
  const seeded = shapeChenImport(extended);
  if (!seeded) {
    throw new Error(`Player rankings are unavailable for ${scoring}`);
  }
  if (seeded.players.length < need) {
    throw new Error(shortBoardMessage(seeded.players.length, teamCount, rounds));
  }
  return seeded;
}

export async function getOrCreateLeagueDraft(
  draftId = LEAGUE_DRAFT_ID,
): Promise<SharedDraft> {
  const existing = await prisma.leagueDraft.findUnique({
    where: { id: draftId },
  });
  const houseBoard = draftId === LEAGUE_DRAFT_ID;
  const stillSynthetic =
    !existing ||
    existing.playersJson === "[]" ||
    existing.source === "Built-in mock data";
  if (existing && (!houseBoard || !stillSynthetic)) {
    return toShared(existing);
  }

  const chen = stillSynthetic ? await freshPlayersFromChen() : null;
  const seed = chen ?? {
    players: [...MOCK_PLAYERS],
    importedAt: "Synthetic fixture",
    source: "Built-in mock data",
  };

  const created = await prisma.leagueDraft.upsert({
    where: { id: draftId },
    create: {
      id: draftId,
      playersJson: JSON.stringify(seed.players),
      importedAt: seed.importedAt,
      source: seed.source,
    },
    update: houseBoard
      ? {
          playersJson: JSON.stringify(seed.players),
          importedAt: seed.importedAt,
          source: seed.source,
        }
      : {},
  });
  return toShared(created);
}

let lastFreshnessCheck = 0;
const FRESHNESS_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes per instance

/**
 * Keeps the shared board on current Boris Chen rankings without anyone pressing
 * a button. Only refreshes while the draft has not started (no picks) so live
 * rankings never shift mid-draft. Throttled so board polling stays cheap.
 */
export async function ensureFreshBoardPlayers(
  draftId = LEAGUE_DRAFT_ID,
): Promise<void> {
  if (Date.now() - lastFreshnessCheck < FRESHNESS_CHECK_INTERVAL_MS) return;
  lastFreshnessCheck = Date.now();
  try {
    const current = await getOrCreateLeagueDraft(draftId);
    if (!shouldAutoRefreshChen(current.source, current.picks.length)) return;
    const isSynthetic = current.source === "Built-in mock data";
    const scoring = scoringFromSource(current.source);
    const fresh = isSynthetic
      ? await freshPlayersFromChen()
      : shapeChenImport(await getFreshChenImport(undefined, scoring));
    if (!fresh) return;
    const changed =
      fresh.importedAt !== current.importedAt ||
      fresh.source !== current.source ||
      fresh.players.length !== current.players.length;
    if (!changed) return;
    await saveSharedDraft({
      draftId,
      players: fresh.players,
      source: fresh.source,
      importedAt: fresh.importedAt,
      picks: [],
    });
  } catch {
    // Never let a rankings refresh break loading the board.
  }
}

const lastByeCheck = new Map<string, number>();
const BYE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // per instance, per board

/** Map a Yahoo injury status code to our coarse injuryStatus enum. */
function mapInjuryStatus(status?: string): Player["injuryStatus"] | undefined {
  switch (status?.toUpperCase()) {
    case "Q":
      return "QUESTIONABLE";
    case "D":
      return "DOUBTFUL";
    case "O":
    case "PUP":
    case "SUSP":
    case "NA":
      return "OUT";
    case "IR":
    case "IR-R":
      return "IR";
    default:
      return undefined;
  }
}

/**
 * Backfills team, bye week, headshot, percent-owned, and injury status onto the
 * shared board, since Boris Chen's tier file carries none of it (byes would
 * otherwise render as "—" and there'd be no player photos).
 *
 * Primary source is Sleeper's free, no-auth player dump (headshots + team) paired
 * with a static 2026 bye map — this works even when Yahoo's Fantasy API isn't
 * authorized for this app. Yahoo, when connected, layers on percent-owned and
 * injury status as a best-effort extra. Throttled and best-effort: it no-ops once
 * the pool is enriched, only touches players still missing data, and never breaks
 * board loading.
 */
export async function ensureBoardByes(draftId = LEAGUE_DRAFT_ID): Promise<void> {
  const last = lastByeCheck.get(draftId) ?? 0;
  if (Date.now() - last < BYE_CHECK_INTERVAL_MS) return;
  lastByeCheck.set(draftId, Date.now());
  try {
    const current = await getOrCreateLeagueDraft(draftId);
    // Built-in fixtures already carry byes; nothing to enrich.
    if (current.source === "Built-in mock data") return;
    const needsPlayerEnrichment = (player: Player) =>
      player.byeWeek === undefined ||
      player.imageUrl === undefined ||
      !player.team ||
      player.team === "FA";
    const playersNeedEnrichment = current.players.some(needsPlayerEnrichment);
    const picksNeedEnrichment = current.picks.some((pick) =>
      needsPlayerEnrichment(pick.player),
    );
    if (!playersNeedEnrichment && !picksNeedEnrichment) return;

    // Picks persist a player snapshot. If the master pool was enriched after a
    // pick was recorded, repair that snapshot immediately without depending on
    // another external metadata fetch.
    if (!playersNeedEnrichment && picksNeedEnrichment) {
      const currentById = new Map(
        current.players.map((player) => [player.id, player]),
      );
      const picks = current.picks.map((pick) => {
        const enriched = currentById.get(pick.player.id);
        return enriched ? { ...pick, player: enriched } : pick;
      });
      await saveSharedDraft({ draftId, picks });
      return;
    }

    const sleeper = await getSleeperIndex();
    // Yahoo is a bonus (percent-owned, injuries); tolerate it being unavailable.
    const yahoo = await getPlayerMetaIndex().catch(() => null);
    if (!sleeper && !yahoo) return;

    let changed = false;
    const players = current.players.map((player) => {
      const key = playerMetaKey(player.name, player.position);
      const s = sleeper?.get(key);
      const y = yahoo?.players.get(key);

      // Resolve a canonical team abbr from whatever we know: existing team,
      // Sleeper's team, or (for defenses) the team name itself.
      const teamAbbr =
        (player.team && player.team !== "FA" ? normalizeTeam(player.team) : null) ??
        (s?.team ? normalizeTeam(s.team) : null) ??
        (player.position === "DEF" ? normalizeTeam(player.name) : null);

      const next: Player = {
        ...player,
        team:
          player.team && player.team !== "FA"
            ? player.team
            : teamAbbr ?? s?.team ?? y?.team ?? player.team,
        teamName:
          player.teamName ??
          y?.teamFull ??
          (player.position === "DEF" ? player.name : undefined),
        byeWeek: player.byeWeek ?? byeWeekForTeam(teamAbbr) ?? y?.byeWeek,
        imageUrl: player.imageUrl ?? s?.imageUrl ?? y?.imageUrl,
        percentOwned: player.percentOwned ?? y?.percentOwned,
        playerKey: player.playerKey ?? y?.playerKey,
        injuryStatus: player.injuryStatus ?? mapInjuryStatus(y?.status),
      };
      if (
        next.team === player.team &&
        next.teamName === player.teamName &&
        next.byeWeek === player.byeWeek &&
        next.imageUrl === player.imageUrl &&
        next.percentOwned === player.percentOwned &&
        next.playerKey === player.playerKey &&
        next.injuryStatus === player.injuryStatus
      ) {
        return player;
      }
      changed = true;
      return next;
    });
    const enrichedById = new Map(players.map((player) => [player.id, player]));
    let picksChanged = false;
    const picks = current.picks.map((pick) => {
      const enriched = enrichedById.get(pick.player.id);
      if (!enriched) return pick;
      const nextPlayer: Player = {
        ...pick.player,
        team: enriched.team,
        teamName: enriched.teamName,
        byeWeek: enriched.byeWeek,
        imageUrl: enriched.imageUrl,
        percentOwned: enriched.percentOwned,
        playerKey: enriched.playerKey,
        injuryStatus: enriched.injuryStatus,
      };
      if (
        nextPlayer.team === pick.player.team &&
        nextPlayer.teamName === pick.player.teamName &&
        nextPlayer.byeWeek === pick.player.byeWeek &&
        nextPlayer.imageUrl === pick.player.imageUrl &&
        nextPlayer.percentOwned === pick.player.percentOwned &&
        nextPlayer.playerKey === pick.player.playerKey &&
        nextPlayer.injuryStatus === pick.player.injuryStatus
      ) {
        return pick;
      }
      picksChanged = true;
      return { ...pick, player: nextPlayer };
    });
    if (!changed && !picksChanged) return;
    await saveSharedDraft({ draftId, players, picks });
  } catch {
    // Enrichment is a nicety; never let it break loading the board.
  }
}

function toShared(row: {
  id: string;
  leagueKey: string | null;
  mode: string;
  teamCount: number;
  rounds: number;
  picksJson: string;
  playersJson: string;
  importedAt: string;
  source: string;
  updatedAt: Date;
}): SharedDraft {
  return {
    id: row.id,
    leagueKey: row.leagueKey,
    mode: row.mode === "live" ? "live" : "mock",
    teamCount: row.teamCount,
    rounds: row.rounds,
    picks: parseJson<Pick[]>(row.picksJson, []),
    players: parseJson<Player[]>(row.playersJson, [...MOCK_PLAYERS]),
    importedAt: row.importedAt,
    source: row.source,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function draftStateFor(shared: SharedDraft, userSlot: number): DraftState {
  return {
    teamCount: shared.teamCount,
    rounds: shared.rounds,
    userSlot,
    picks: shared.picks,
  };
}

export async function listMemberSeats(
  draftId = LEAGUE_DRAFT_ID,
): Promise<MemberSeat[]> {
  const users = await prisma.user.findMany({
    where:
      draftId === LEAGUE_DRAFT_ID
        ? {
            boardId: null,
            NOT: { yahooGuid: { startsWith: "sleeper:" } },
          }
        : {
            OR: [
              { boardId: draftId },
              draftId.startsWith("sleeper:")
                ? { sleeperDraftId: draftId.slice("sleeper:".length) }
                : { boardId: draftId },
            ],
          },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      displayName: true,
      draftSlot: true,
      teamName: true,
      role: true,
      status: true,
      lastSeenAt: true,
    },
  });
  return users.map((user) => ({
    ...user,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
  }));
}

/** Record activity for presence dots. Throttled to one write per 30s. */
export async function touchLastSeen(user: User): Promise<void> {
  const last = user.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - last < 30_000) return;
  await prisma.user
    .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
}

export async function saveSharedDraft(input: {
  readonly draftId?: string;
  readonly mode?: "mock" | "live";
  readonly leagueKey?: string | null;
  readonly picks?: readonly Pick[];
  readonly players?: readonly Player[];
  readonly importedAt?: string;
  readonly source?: string;
  readonly expectedUpdatedAt?: string;
}): Promise<SharedDraft> {
  const draftId = input.draftId ?? LEAGUE_DRAFT_ID;
  const current = await getOrCreateLeagueDraft(draftId);
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== current.updatedAt) {
    throw new ConflictError("Draft was updated by someone else");
  }
  const updated = await prisma.leagueDraft.update({
    where: { id: draftId },
    data: {
      mode: input.mode ?? current.mode,
      leagueKey: input.leagueKey === undefined ? current.leagueKey : input.leagueKey,
      picksJson: JSON.stringify(input.picks ?? current.picks),
      playersJson: JSON.stringify(input.players ?? current.players),
      importedAt: input.importedAt ?? current.importedAt,
      source: input.source ?? current.source,
    },
  });
  return toShared(updated);
}

export async function appendSharedPick(
  playerId: string,
  options: { readonly madeAt?: string; readonly draftId?: string } = {},
): Promise<SharedDraft> {
  const current = await getOrCreateLeagueDraft(options.draftId);
  const player = current.players.find((item) => item.id === playerId);
  if (!player) throw new Error(`Unknown player ${playerId}`);
  // Idempotent: if this player is already on the board (e.g. another client
  // synced the pick a beat before this confirm landed), treat it as a no-op so
  // the confirming user never sees a spurious "already drafted" error.
  if (current.picks.some((pick) => pick.player.id === playerId)) {
    return current;
  }
  const next = makeManualPick(draftStateFor(current, 1), player, {
    madeAt: options.madeAt ?? new Date().toISOString(),
  });
  return saveSharedDraft({ draftId: options.draftId, picks: next.picks });
}

export async function savePicks(
  picks: readonly Pick[],
  draftId = LEAGUE_DRAFT_ID,
): Promise<SharedDraft> {
  return saveSharedDraft({ draftId, picks });
}

export async function undoSharedPick(
  draftId = LEAGUE_DRAFT_ID,
): Promise<SharedDraft> {
  const current = await getOrCreateLeagueDraft(draftId);
  const next = undoLastPick(draftStateFor(current, 1));
  return saveSharedDraft({ draftId, picks: next.picks });
}

export async function resetSharedDraft(
  mode: "mock" | "live",
  leagueKey?: string | null,
  draftId = LEAGUE_DRAFT_ID,
): Promise<SharedDraft> {
  // A brand-new draft starts every manager's pins and avoids from scratch — they
  // target a specific board, so they shouldn't bleed across drafts.
  await prisma.user.updateMany({ data: { pinsJson: "[]", avoidsJson: "[]" } });
  return saveSharedDraft({
    draftId,
    mode,
    picks: [],
    ...(leagueKey === undefined ? {} : { leagueKey }),
  });
}

export async function replacePlayers(
  players: readonly Player[],
  source: string,
  importedAt: string,
  draftId = LEAGUE_DRAFT_ID,
): Promise<SharedDraft> {
  return saveSharedDraft({
    draftId,
    players,
    source,
    importedAt,
    picks: [],
    mode: "mock",
  });
}

/** Apply a Chen list. Empty boards are replaced; live boards only get ranks remapped. */
export async function applyChenImport(
  imported: ChenImport,
  draftId = LEAGUE_DRAFT_ID,
): Promise<SharedDraft> {
  const incoming = shapeChenImport(imported);
  if (!incoming) throw new Error("Chen import contained no players");
  const current = await getOrCreateLeagueDraft(draftId);
  if (current.picks.length === 0) {
    const currentByKey = new Map(
      current.players.map((player) => [
        playerMetaKey(player.name, player.position),
        player,
      ]),
    );
    const players = incoming.players.map((player) => {
      const existing = currentByKey.get(
        playerMetaKey(player.name, player.position),
      );
      if (!existing) return player;
      return {
        ...player,
        teamName: existing.teamName,
        byeWeek: player.byeWeek ?? existing.byeWeek,
        imageUrl: existing.imageUrl,
        percentOwned: existing.percentOwned,
        playerKey: existing.playerKey,
        injuryStatus: existing.injuryStatus,
        projectedPoints: existing.projectedPoints,
        aliases: existing.aliases,
      };
    });
    const saved = await saveSharedDraft({
      draftId,
      players,
      source: incoming.source,
      importedAt: incoming.importedAt,
    });
    lastByeCheck.delete(draftId);
    return saved;
  }

  const byId = new Map(incoming.players.map((player) => [player.id, player]));
  const byKey = new Map(
    incoming.players.map((player) => [playerMetaKey(player.name, player.position), player]),
  );
  const merged = current.players.map((player) => {
    const hit =
      byId.get(player.id) ??
      byKey.get(playerMetaKey(player.name, player.position));
    if (!hit) return player;
    return {
      ...player,
      chenRank: hit.chenRank,
      chenTier: hit.chenTier,
      adp: hit.adp ?? player.adp,
    };
  });
  const seen = new Set(
    merged.map((player) => playerMetaKey(player.name, player.position)),
  );
  for (const player of incoming.players) {
    const key = playerMetaKey(player.name, player.position);
    if (!seen.has(key)) {
      merged.push(player);
      seen.add(key);
    }
  }
  const saved = await saveSharedDraft({
    draftId,
    players: merged,
    source: incoming.source,
    importedAt: incoming.importedAt,
  });
  lastByeCheck.delete(draftId);
  return saved;
}

export function userPrefs(user: User): {
  draftSlot: number;
  teamName: string;
  pins: string[];
  avoids: string[];
  waiverWatch: string[];
  weights: StrategyWeights;
  darkMode: boolean;
} {
  const weights = user.weightsJson
    ? { ...DEFAULT_STRATEGY_WEIGHTS, ...parseJson<Partial<StrategyWeights>>(user.weightsJson, {}) }
    : DEFAULT_STRATEGY_WEIGHTS;
  return {
    draftSlot: user.draftSlot && user.draftSlot >= 1 && user.draftSlot <= 12 ? user.draftSlot : 1,
    teamName: user.teamName?.trim() || (user.role === "admin" ? "Cobra Kai" : user.displayName),
    pins: parseJson<string[]>(user.pinsJson, []),
    avoids: parseJson<string[]>(user.avoidsJson, []),
    waiverWatch: parseJson<string[]>(user.waiverWatchJson, []),
    weights,
    darkMode: user.darkMode,
  };
}

export class ConflictError extends Error {}
