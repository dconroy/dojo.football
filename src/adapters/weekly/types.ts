import type { LineupPlayer, OptimalLineup } from "@/domain/lineup";
import type { WaiverTarget } from "@/domain/types";

export type WeeklyPlatform = "yahoo" | "sleeper";

export interface WeeklyLeagueDto {
  readonly leagueKey: string;
  readonly name: string;
  readonly currentWeek?: number;
  readonly scoring?: "standard" | "half-ppr" | "ppr";
}

export interface WeeklyTeamDto {
  readonly teamKey: string;
  readonly name: string;
}

export interface WeeklyMatchupDto {
  readonly week?: number;
  readonly status?: string;
  readonly teams: ReadonlyArray<
    WeeklyTeamDto & {
      readonly points?: number;
      readonly projectedPoints?: number;
    }
  >;
}

export interface WeeklyStandingDto extends WeeklyTeamDto {
  readonly rank: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly pointsFor: number;
}

export interface WeeklyTransactionPlayerDto {
  readonly name: string;
  readonly position?: string;
  readonly moveType: string;
  readonly sourceTeamName?: string;
  readonly destinationTeamName?: string;
}

export interface WeeklyTransactionDto {
  readonly key: string;
  readonly type: string;
  /** Unix seconds, matching Yahoo's normalized transaction shape. */
  readonly timestamp?: number;
  readonly players: readonly WeeklyTransactionPlayerDto[];
}

export interface WeeklyHotAddDto {
  readonly name: string;
  readonly position?: string;
  readonly team?: string;
  readonly destinationTeamName?: string;
}

export interface WeeklyDataDto {
  readonly platform: WeeklyPlatform;
  readonly league: WeeklyLeagueDto;
  readonly team: WeeklyTeamDto;
  readonly roster: readonly LineupPlayer[];
  readonly lineup: OptimalLineup;
  readonly matchup: WeeklyMatchupDto | null;
  readonly standings: readonly WeeklyStandingDto[];
  readonly transactions: readonly WeeklyTransactionDto[];
  readonly waivers: readonly WaiverTarget[];
  readonly hotAdds: readonly WeeklyHotAddDto[];
  readonly chen: { readonly importedAt: string; readonly source: string };
  readonly syncedAt: string;
}

export function weeklyPlatformForUser(user: {
  readonly yahooGuid: string;
  readonly sleeperDraftId?: string | null;
  readonly sleeperLeagueId?: string | null;
}): WeeklyPlatform {
  return user.yahooGuid.startsWith("sleeper:") ||
    Boolean(user.sleeperDraftId || user.sleeperLeagueId)
    ? "sleeper"
    : "yahoo";
}
