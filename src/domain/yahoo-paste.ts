import { extendDraftWithRemotePlayers } from "./reconcile-draft";
import { makeManualPick } from "./draft";
import {
  normalizePlayerName,
  normalizeTeam,
  resolvePlayerIdentity,
  type IdentityResolution,
} from "./identity";
import type { DraftState, Player, Position } from "./types";

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

export interface ParsedYahooPick {
  readonly raw: string;
  readonly name: string;
  readonly team?: string;
  readonly position?: Position;
}

export interface YahooPasteResolution {
  readonly resolved: Player[];
  readonly pending: {
    readonly parsed: ParsedYahooPick;
    readonly resolution: IdentityResolution;
  } | null;
}

function normalizePosition(raw?: string): Position | undefined {
  const value = raw?.toUpperCase().replace(/\s/g, "");
  if (!value) return undefined;
  if (value === "DST" || value === "D/ST" || value === "DEFENSE") return "DEF";
  if (POSITIONS.has(value)) return value as Position;
}

function isHeaderLine(line: string): boolean {
  if (/^round\s+\d+\s*$/i.test(line)) return true;
  if (/^(round|pick|overall|draft|team|player|pos|position)\b/i.test(line) && !/\d/.test(line)) {
    return true;
  }
  return false;
}

function stripPickPrefix(line: string): string {
  return line
    .replace(/^\s*\d+(?:\.\d{1,2})?[.)]\s+/, "")
    .replace(/^\s*\d+\.\d{1,2}\s+/, "")
    .replace(/^round\s+\d+\s*[,:]?\s*(?:pick\s+\d+\s*[:.]?\s*)?/i, "")
    .replace(/^pick\s+\d+\s*[:.]?\s*/i, "")
    .trim();
}

function extractParenMeta(line: string): {
  name: string;
  team?: string;
  position?: Position;
} {
  const match = line.match(/\(([^)]+)\)\s*$/);
  if (!match || match.index === undefined) return { name: line };
  const name = line.slice(0, match.index).replace(/[,\s]+$/, "").trim();
  let team: string | undefined;
  let position: Position | undefined;
  for (const part of match[1].split(/[-,/]/).map((token) => token.trim()).filter(Boolean)) {
    const pos = normalizePosition(part);
    if (pos && !position) {
      position = pos;
      continue;
    }
    if (!team) team = part;
  }
  return { name, team, position };
}

function extractTrailingMeta(line: string): {
  name: string;
  team?: string;
  position?: Position;
} {
  const paren = extractParenMeta(line);
  if (paren.team || paren.position) return paren;

  const trail = line.match(
    /,?\s+(QB|RB|WR|TE|K|DEF|D\/ST|DST|DEFENSE)\b(?:\s*[-,]\s*|\s+)([A-Za-z.]{2,4}|[A-Za-z ]+)?\s*$/i,
  );
  if (!trail || trail.index === undefined) return { name: line.replace(/[,\s]+$/, "").trim() };
  return {
    name: line.slice(0, trail.index).replace(/[,\s]+$/, "").trim(),
    position: normalizePosition(trail[1]),
    team: trail[2]?.trim() || undefined,
  };
}

function parseTabLine(line: string): ParsedYahooPick | null {
  const cols = line.split(/\t/).map((col) => col.trim()).filter(Boolean);
  if (cols.length < 2) return null;
  const nameCol = cols.find(
    (col, index) =>
      index > 0 &&
      /[a-zA-Z]{2,}/.test(col) &&
      !normalizePosition(col) &&
      !/^\d+(?:\.\d+)?$/.test(col),
  );
  if (!nameCol) return null;
  const position = cols.map(normalizePosition).find(Boolean);
  const team = cols
    .slice(1)
    .find((col) => col !== nameCol && !normalizePosition(col) && (normalizeTeam(col) || /^[A-Za-z]{2,3}$/.test(col)));
  return {
    raw: line,
    name: nameCol,
    ...(position ? { position } : {}),
    ...(team ? { team } : {}),
  };
}

export function parseYahooDraftLine(line: string): ParsedYahooPick | null {
  const trimmed = line.replace(/\u00a0/g, " ").trim();
  if (!trimmed || isHeaderLine(trimmed)) return null;
  const tabbed = trimmed.includes("\t") ? parseTabLine(trimmed) : null;
  if (tabbed) return tabbed;

  const stripped = stripPickPrefix(trimmed);
  if (!stripped || isHeaderLine(stripped)) return null;
  const extracted = extractTrailingMeta(stripped);
  if (extracted.name.length < 2) return null;
  return {
    raw: trimmed,
    name: extracted.name,
    ...(extracted.team ? { team: extracted.team } : {}),
    ...(extracted.position ? { position: extracted.position } : {}),
  };
}

export function parseYahooDraftText(text: string): ParsedYahooPick[] {
  return text
    .split(/\r?\n/)
    .map(parseYahooDraftLine)
    .filter((line): line is ParsedYahooPick => line !== null);
}

function nameVariants(name: string): string[] {
  const tokens = name.split(/\s+/).filter(Boolean);
  const variants = [name];
  if (tokens.length > 2) {
    variants.push(tokens.slice(-2).join(" "));
    variants.push(tokens.slice(-3).join(" "));
  }
  return [...new Set(variants)];
}

export function resolveYahooPick(
  parsed: ParsedYahooPick,
  players: readonly Player[],
): IdentityResolution {
  let fallback: IdentityResolution | null = null;
  for (const name of nameVariants(parsed.name)) {
    const withTeam = parsed.team
      ? resolvePlayerIdentity(name, players, { team: parsed.team })
      : null;
    if (withTeam?.status === "resolved") return withTeam;
    const plain = resolvePlayerIdentity(name, players);
    if (plain.status === "resolved") return plain;
    if (plain.status === "ambiguous") fallback = plain;
    else if (withTeam?.status === "ambiguous") fallback = withTeam;
  }
  return fallback ?? resolvePlayerIdentity(parsed.name, players, { team: parsed.team });
}

export function resolveYahooPaste(
  text: string,
  players: readonly Player[],
): YahooPasteResolution {
  const resolved: Player[] = [];
  const seen = new Set<string>();
  for (const parsed of parseYahooDraftText(text)) {
    const resolution = resolveYahooPick(parsed, players);
    if (resolution.status !== "resolved") {
      return { resolved, pending: { parsed, resolution } };
    }
    if (seen.has(resolution.player.id)) continue;
    seen.add(resolution.player.id);
    resolved.push(resolution.player);
  }
  return { resolved, pending: null };
}

/**
 * Full recap from pick 1 extends or rebuilds. A snippet of later picks
 * appends names that are not already on the board.
 */
export function applyScribePaste(
  draft: DraftState,
  incoming: readonly Player[],
): DraftState {
  if (!incoming.length) return draft;
  const next = extendDraftWithRemotePlayers(draft, incoming);
  if (!next.rebuilt || draft.picks.length === 0) return next.draft;
  let state = draft;
  const seen = new Set(state.picks.map((pick) => pick.player.id));
  for (const player of incoming) {
    if (seen.has(player.id)) continue;
    state = makeManualPick(state, player);
    seen.add(player.id);
  }
  return state;
}

export function suggestPlayers(
  query: string,
  players: readonly Player[],
  limit = 8,
): Player[] {
  const needle = normalizePlayerName(query);
  if (!needle) return [];
  return players
    .filter((player) => {
      const name = normalizePlayerName(player.name);
      const team = player.team.toLowerCase();
      return (
        name.includes(needle) ||
        name.split(" ").some((part) => part.startsWith(needle)) ||
        team.startsWith(query.trim().toLowerCase())
      );
    })
    .sort(
      (left, right) =>
        (left.chenRank ?? Number.MAX_SAFE_INTEGER) -
        (right.chenRank ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, limit);
}
