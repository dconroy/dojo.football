import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/adapters/sleeper/players", () => ({
  getSleeperRecords: vi.fn(),
}));

import { getSleeperRecords } from "@/adapters/sleeper/players";
import {
  fetchSleeperWeekly,
  lineupSlotsFromSleeper,
  normalizeSleeperInjury,
  sleeperScoring,
} from "@/adapters/sleeper/weekly";
import { weeklyPlatformForUser } from "@/adapters/weekly/types";

const mockedRecords = vi.mocked(getSleeperRecords);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Sleeper weekly normalization", () => {
  it("normalizes scoring, roster slots, injuries, and provider dispatch", () => {
    expect(sleeperScoring({ rec: 1 })).toBe("ppr");
    expect(sleeperScoring({ rec: 0.5 })).toBe("half-ppr");
    expect(sleeperScoring({ rec: 0 })).toBe("standard");
    expect(lineupSlotsFromSleeper(["QB", "RB", "RB", "WR", "FLEX", "BN"])).toEqual({
      QB: 1,
      RB: 2,
      WR: 1,
      TE: 0,
      FLEX: 1,
      K: 0,
      DEF: 0,
    });
    expect(normalizeSleeperInjury("Questionable")).toBe("Q");
    expect(normalizeSleeperInjury("Injured Reserve")).toBe("IR");
    expect(
      weeklyPlatformForUser({
        yahooGuid: "sleeper:user-1",
        sleeperDraftId: "draft-1",
      }),
    ).toBe("sleeper");
    expect(weeklyPlatformForUser({ yahooGuid: "yahoo-user" })).toBe("yahoo");
  });

  it("reads public league endpoints and computes free agents from cached players", async () => {
    mockedRecords.mockResolvedValue([
      { sleeperId: "p1", name: "Quarter Back", position: "QB", team: "BUF" },
      {
        sleeperId: "p2",
        name: "Running Back",
        position: "RB",
        team: "KC",
        injuryStatus: "Questionable",
      },
      { sleeperId: "p3", name: "Wide Receiver", position: "WR", team: "DAL" },
      { sleeperId: "p4", name: "Other Roster", position: "RB", team: "MIA" },
      { sleeperId: "fa1", name: "Free Agent", position: "WR", team: "SEA" },
    ]);
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        let body: unknown;
        if (url.endsWith("/league/league-1")) {
          body = {
            league_id: "league-1",
            name: "Test League",
            roster_positions: ["QB", "RB", "FLEX", "BN"],
            scoring_settings: { rec: 0.5 },
            settings: { leg: 3 },
          };
        } else if (url.endsWith("/league/league-1/users")) {
          body = [
            { user_id: "user-1", display_name: "Me", metadata: { team_name: "Dojo" } },
            { user_id: "user-2", display_name: "Rival" },
          ];
        } else if (url.endsWith("/league/league-1/rosters")) {
          body = [
            {
              roster_id: 1,
              owner_id: "user-1",
              players: ["p1", "p2", "p3"],
              starters: ["p1", "p2", "p3"],
              settings: { wins: 2, losses: 0, fpts: 210, fpts_decimal: 50 },
            },
            {
              roster_id: 2,
              owner_id: "user-2",
              players: ["p4"],
              starters: ["p4"],
              settings: { wins: 1, losses: 1, fpts: 190 },
            },
          ];
        } else if (url.includes("/matchups/3")) {
          body = [
            { roster_id: 1, matchup_id: 9, points: 44.2 },
            { roster_id: 2, matchup_id: 9, points: 41.8 },
          ];
        } else if (url.includes("/transactions/3")) {
          body = [
            {
              transaction_id: "tx1",
              type: "free_agent",
              status: "complete",
              created: 1_700_000_000_000,
              drops: { p4: 2 },
            },
          ];
        } else if (url.includes("/trending/add")) {
          body = [{ player_id: "fa1", count: 20 }];
        } else {
          return new Response(null, { status: 404 });
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const snapshot = await fetchSleeperWeekly({
      leagueId: "league-1",
      userId: "user-1",
    });

    expect(snapshot.league).toMatchObject({
      name: "Test League",
      currentWeek: 3,
      scoring: "half-ppr",
    });
    expect(snapshot.team.name).toBe("Dojo");
    expect(snapshot.roster.map((player) => player.selectedSlot)).toEqual([
      "QB",
      "RB",
      "FLEX",
    ]);
    expect(snapshot.roster[1].status).toBe("Q");
    expect(snapshot.freeAgents.map((player) => player.id)).toEqual(["fa1"]);
    expect(snapshot.hotAddNames).toContain("Free Agent");
    expect(snapshot.matchup?.teams).toHaveLength(2);
    expect(snapshot.standings[0].pointsFor).toBe(210.5);
    expect(requested.some((url) => url.endsWith("/league/league-1/users"))).toBe(true);
    expect(requested.some((url) => url.includes("/players/nfl/trending/add"))).toBe(true);
  });
});
