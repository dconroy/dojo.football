import { describe, expect, it } from "vitest";

import type { MockDraftConfig } from "../../src/adapters/yahoo/mock-runner";
import { summarizeListedDemoRoom, demoRoomLooksStalled, STALLED_STARTED_TTL_MS } from "../../src/persistence/demo-rooms";

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
