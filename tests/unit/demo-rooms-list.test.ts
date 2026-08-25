import { describe, expect, it } from "vitest";

import type { MockDraftConfig } from "../../src/adapters/yahoo/mock-runner";
import {
  catchUpDemoBoardPicks,
  demoRoomLooksStalled,
  STALLED_STARTED_TTL_MS,
  summarizeListedDemoRoom,
} from "../../src/persistence/demo-rooms";
import type { Player } from "../../src/domain";

const row = {
  id: "demo:room-1",
  leagueKey: "mock.demo.room-1",
  teamCount: 12,
  rounds: 15,
  source: "Boris Chen 0.5 PPR",
  picksJson: "[]",
};

function config(
  overrides: Partial<MockDraftConfig> = {},
): MockDraftConfig {
  return {
    leagueKey: row.leagueKey,
    teamCount: 12,
    rounds: 15,
    intervalMs: 3000,
    startedAtIso: "",
    humanSlots: [1],
    picksBySlot: {},
    players: [
      {
        id: "p1",
        name: "Bijan Robinson",
        position: "RB",
        team: "ATL",
        chenRank: 1,
      },
    ],
    ...overrides,
  };
}

describe("summarizeListedDemoRoom", () => {
  it("skips shells and missing configs", () => {
    expect(summarizeListedDemoRoom({ ...row, leagueKey: null }, config())).toBeNull();
    expect(summarizeListedDemoRoom(row, null)).toBeNull();
  });

  it("still lists a room when the player pool is missing", () => {
    const summary = summarizeListedDemoRoom(
      row,
      config({ players: undefined as unknown as MockDraftConfig["players"] }),
    );
    expect(summary).toMatchObject({
      id: row.id,
      openSeats: 12,
      complete: false,
      picks: 0,
    });
  });

  it("does not treat mockDraftResults throwing as a dead lobby", () => {
    const summary = summarizeListedDemoRoom(
      { ...row, picksJson: JSON.stringify([{ overall: 1 }]) },
      config({ teamCount: Number.NaN }),
    );
    expect(summary?.picks).toBe(1);
    expect(summary?.id).toBe(row.id);
  });
});

describe("demoRoomLooksStalled", () => {
  it("flags a started board that has not taken a pick in 10 minutes", () => {
    const now = Date.parse("2026-08-24T23:00:00.000Z");
    expect(
      demoRoomLooksStalled({
        finished: false,
        clockStarted: true,
        boardUpdatedAtMs: now - STALLED_STARTED_TTL_MS - 1,
        now,
      }),
    ).toBe(true);
  });

  it("leaves live clocks, finished boards, and lobbies waiting to start", () => {
    const now = Date.parse("2026-08-24T23:00:00.000Z");
    expect(
      demoRoomLooksStalled({
        finished: false,
        clockStarted: true,
        boardUpdatedAtMs: now - 60_000,
        now,
      }),
    ).toBe(false);
    expect(
      demoRoomLooksStalled({
        finished: true,
        clockStarted: true,
        boardUpdatedAtMs: now - 60 * 60 * 1000,
        now,
      }),
    ).toBe(false);
    expect(
      demoRoomLooksStalled({
        finished: false,
        clockStarted: false,
        boardUpdatedAtMs: now - 60 * 60 * 1000,
        now,
      }),
    ).toBe(false);
  });
});

describe("catchUpDemoBoardPicks", () => {
  const pool: Player[] = Array.from({ length: 40 }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    position: (["RB", "WR", "QB", "TE"] as const)[index % 4],
    team: "KC",
    chenRank: index + 1,
  }));

  it("appends published mock picks the seated client never persisted", () => {
    const started = Date.parse("2026-08-25T00:00:00.000Z");
    const mock = config({
      teamCount: 4,
      rounds: 4,
      intervalMs: 1000,
      startedAtIso: new Date(started).toISOString(),
      humanSlots: [2],
      picksBySlot: { 2: ["p2"] },
      players: pool.map((player) => ({
        id: player.id,
        name: player.name,
        position: player.position,
        team: player.team,
        chenRank: player.chenRank,
      })),
    });
    const boardPicks = [
      {
        overall: 1,
        round: 1,
        slot: 1,
        rosterSlot: "RB" as const,
        player: pool[0],
      },
    ];
    const caught = catchUpDemoBoardPicks(
      { teamCount: 4, rounds: 4, picks: boardPicks, players: pool },
      mock,
      started + 8_000,
    );
    expect(caught).not.toBeNull();
    expect(caught!.length).toBeGreaterThan(boardPicks.length);
    expect(caught![0]?.player.id).toBe("p1");
  });

  it("returns null when the shared board already matches the mock", () => {
    const started = Date.parse("2026-08-25T00:00:00.000Z");
    const mock = config({
      teamCount: 2,
      rounds: 1,
      intervalMs: 1000,
      startedAtIso: new Date(started).toISOString(),
      humanSlots: [1],
      picksBySlot: { 1: ["p1"] },
      players: pool.slice(0, 8).map((player) => ({
        id: player.id,
        name: player.name,
        position: player.position,
        team: player.team,
        chenRank: player.chenRank,
      })),
    });
    const boardPicks = [
      {
        overall: 1,
        round: 1,
        slot: 1,
        rosterSlot: "RB" as const,
        player: pool[0],
      },
      {
        overall: 2,
        round: 1,
        slot: 2,
        rosterSlot: "WR" as const,
        player: pool[1],
      },
    ];
    expect(
      catchUpDemoBoardPicks(
        { teamCount: 2, rounds: 1, picks: boardPicks, players: pool },
        mock,
        started + 5_000,
      ),
    ).toBeNull();
  });
});
