import { createHash } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import { normalizeTeam } from "@/domain/identity";
import { playerMetaKey } from "@/adapters/yahoo/player-meta";

/**
 * Sleeper publishes a free, no-auth player dump that carries a stable player id,
 * team, and position for every NFL player. We use it to put a real headshot and
 * team on the draft board without needing Yahoo's Fantasy API (which requires an
 * app-level "Fantasy Sports" grant we don't control). Headshots are served from
 * `sleepercdn.com`; defenses map to team logos.
 *
 * The raw dump is ~15 MB, so we fetch it rarely, trim it to the fantasy-relevant
 * positions, and cache the trimmed result in `DataImport`.
 */

const PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const CACHE_SOURCE = "sleeper-players";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // ids/teams change slowly
const FETCH_TIMEOUT_MS = 30_000;
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

export interface SleeperRecord {
  readonly name: string;
  readonly position: string;
  readonly team: string | null;
  readonly sleeperId: string;
  readonly injuryStatus?: string;
  readonly active?: boolean;
}

export interface SleeperHit {
  readonly team: string | null;
  readonly imageUrl: string;
}

/** Headshot for a skill player / kicker by Sleeper id. */
function headshotUrl(sleeperId: string): string {
  return `https://sleepercdn.com/content/nfl/players/${sleeperId}.jpg`;
}

/** Team logo, used as the "headshot" for defenses. */
function teamLogoUrl(abbr: string): string {
  return `https://sleepercdn.com/images/team_logos/nfl/${abbr.toLowerCase()}.png`;
}

function imageForRecord(record: SleeperRecord): string | null {
  if (record.position === "DEF") {
    const abbr = normalizeTeam(record.team ?? record.name) ?? record.team;
    return abbr ? teamLogoUrl(abbr) : null;
  }
  return headshotUrl(record.sleeperId);
}

async function readCached(): Promise<{ records: SleeperRecord[]; fetchedAt: Date } | null> {
  try {
    const row = await prisma.dataImport.findFirst({
      where: { source: CACHE_SOURCE },
      orderBy: { fetchedAt: "desc" },
      select: { payload: true, fetchedAt: true },
    });
    if (!row) return null;
    return { records: JSON.parse(row.payload) as SleeperRecord[], fetchedAt: row.fetchedAt };
  } catch {
    return null;
  }
}

/** Download the Sleeper dump, trim to fantasy positions, and cache it. */
export async function refreshSleeperPlayers(): Promise<SleeperRecord[] | null> {
  let raw: Record<string, Record<string, unknown>>;
  try {
    const response = await fetch(PLAYERS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    raw = (await response.json()) as Record<string, Record<string, unknown>>;
  } catch {
    return null;
  }

  const records: SleeperRecord[] = [];
  for (const [id, player] of Object.entries(raw)) {
    const position = String(player.position ?? "").toUpperCase();
    if (!FANTASY_POSITIONS.has(position)) continue;
    const name =
      (player.full_name as string | undefined) ??
      [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
    if (!name) continue;
    records.push({
      name,
      position,
      team: (player.team as string | undefined)?.toUpperCase() ?? null,
      sleeperId: id,
      injuryStatus:
        (player.injury_status as string | undefined) ??
        (player.status as string | undefined),
      active:
        typeof player.active === "boolean" ? player.active : undefined,
    });
  }
  if (records.length === 0) return null;

  await prisma.dataImport
    .create({
      data: {
        source: CACHE_SOURCE,
        playerCount: records.length,
        checksum: createHash("sha256").update(JSON.stringify(records)).digest("hex"),
        payload: JSON.stringify(records),
      },
    })
    .catch(() => undefined);
  return records;
}

/**
 * `playerMetaKey` → { team, imageUrl }. Serves a fresh cache, otherwise refreshes
 * from Sleeper (falling back to a stale cache if the download fails). Returns
 * null only when no data is available at all.
 */
export async function getSleeperRecords(): Promise<SleeperRecord[] | null> {
  const cached = await readCached();
  const fresh =
    cached &&
    Date.now() - cached.fetchedAt.getTime() < MAX_AGE_MS &&
    // Older cache payloads predate Weekly HQ's activity/injury fields.
    cached.records.some((record) => record.active !== undefined)
      ? cached.records
      : (await refreshSleeperPlayers()) ?? cached?.records ?? null;
  return fresh;
}

export async function getSleeperIndex(): Promise<Map<string, SleeperHit> | null> {
  const fresh = await getSleeperRecords();
  if (!fresh) return null;

  const index = new Map<string, SleeperHit>();
  for (const record of fresh) {
    const image = imageForRecord(record);
    if (!image) continue;
    const key = playerMetaKey(record.name, record.position);
    if (!index.has(key)) index.set(key, { team: record.team, imageUrl: image });
  }
  return index;
}
