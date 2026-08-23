import { describe, expect, it, vi } from "vitest";

vi.mock("@/persistence/prisma", () => ({
  prisma: {
    syncCheckpoint: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import {
  applyDemoRoomActivities,
  applyDemoRoomActivity,
  forgetDemoRoom,
  parseDemoStats,
  publicDemoStats,
} from "../../src/persistence/demo-stats";

const empty = parseDemoStats(null);

describe("demo network stats", () => {
  it("counts new picks as insights for each seated human", () => {
    const next = applyDemoRoomActivity(empty, {
      roomId: "demo:one",
      picks: 4,
      humans: 2,
      complete: false,
    });
    expect(next.insightsGiven).toBe(8);
    expect(next.boardsRun).toBe(0);
    expect(next.pickWatermarks["demo:one"]).toBe(4);
  });

  it("only counts the pick delta on later updates", () => {
    const started = applyDemoRoomActivity(empty, {
      roomId: "demo:one",
      picks: 4,
      humans: 2,
      complete: false,
    });
    const next = applyDemoRoomActivity(started, {
      roomId: "demo:one",
      picks: 6,
      humans: 2,
      complete: false,
    });
    expect(next.insightsGiven).toBe(12);
  });

  it("counts a finished board once", () => {
    const first = applyDemoRoomActivity(empty, {
      roomId: "demo:done",
      picks: 180,
      humans: 3,
      complete: true,
    });
    const again = applyDemoRoomActivity(first, {
      roomId: "demo:done",
      picks: 180,
      humans: 3,
      complete: true,
    });
    expect(first.boardsRun).toBe(1);
    expect(again.boardsRun).toBe(1);
  });

  it("counts new seated humans once per room", () => {
    const first = applyDemoRoomActivity(empty, {
      roomId: "demo:one",
      picks: 0,
      humans: 2,
      complete: false,
    });
    const same = applyDemoRoomActivity(first, {
      roomId: "demo:one",
      picks: 0,
      humans: 2,
      complete: false,
    });
    const third = applyDemoRoomActivity(same, {
      roomId: "demo:one",
      picks: 0,
      humans: 3,
      complete: false,
    });
    expect(first.playersHelped).toBe(2);
    expect(same.playersHelped).toBe(2);
    expect(third.playersHelped).toBe(3);
  });

  it("keeps lifetime totals after a room is forgotten", () => {
    const finished = applyDemoRoomActivities(empty, [
      { roomId: "demo:done", picks: 10, humans: 1, complete: true },
    ]);
    const forgotten = forgetDemoRoom(finished, "demo:done");
    expect(publicDemoStats(forgotten)).toEqual({
      boardsRun: 1,
      insightsGiven: 10,
      playersHelped: 1,
    });
    expect(forgotten.countedRoomIds).toEqual([]);
    expect(forgotten.pickWatermarks["demo:done"]).toBeUndefined();
  });
});
