import type { TeamReportCard } from "./draft-report";

export const REPORT_CARD_IMAGE_WIDTH = 1200;
export const REPORT_CARD_IMAGE_HEIGHT = 630;

const MAX_IMAGE_REASONS = 3;
const MAX_IMAGE_PICKS = 5;

export interface ReportCardShareModel {
  readonly teamName: string;
  readonly grade: string;
  readonly rankLabel: string;
  readonly summary: string;
  readonly story?: string;
  readonly reasons: readonly string[];
  readonly picks: readonly {
    readonly round: string;
    readonly name: string;
    readonly position: string;
  }[];
  readonly url: string;
}

export function buildReportCardShareModel(
  team: TeamReportCard,
  teamName: string,
  fieldSize: number,
  story?: string,
): ReportCardShareModel {
  const safeFieldSize = Math.max(1, Math.trunc(fieldSize));
  return {
    teamName: teamName.trim() || `Slot ${team.slot}`,
    grade: team.grade,
    rankLabel: `${ordinal(team.rank)} of ${safeFieldSize}`,
    summary: team.summary.trim(),
    ...(story?.trim() ? { story: story.trim() } : {}),
    reasons: team.reasons
      .map((reason) => reason.text.trim())
      .filter(Boolean)
      .slice(0, MAX_IMAGE_REASONS),
    picks: team.picks.slice(0, MAX_IMAGE_PICKS).map((pick) => ({
      round: `R${pick.round}`,
      name: pick.player.name,
      position: pick.player.position,
    })),
    url: "DOJO.FOOTBALL",
  };
}

export function reportCardFileName(teamName: string): string {
  const slug = teamName
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `draft-dojo-${slug || "report-card"}.png`;
}

export function wrapTextLines(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
  maxLines = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (!text.trim() || maxLines <= 0) return [];
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }

  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    const last = lines.length - 1;
    let shortened = lines[last];
    while (shortened && measure(`${shortened}…`) > maxWidth) {
      shortened = shortened.slice(0, -1).trimEnd();
    }
    lines[last] = `${shortened}…`;
  }
  return lines.map((line) => {
    if (measure(line) <= maxWidth) return line;
    let shortened = line;
    while (shortened && measure(`${shortened}…`) > maxWidth) {
      shortened = shortened.slice(0, -1).trimEnd();
    }
    return `${shortened}…`;
  });
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}
