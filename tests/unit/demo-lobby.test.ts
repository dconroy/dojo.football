import { describe, expect, it } from "vitest";

import { formatDemoStat, partitionDemoRooms } from "../../src/domain/demo-lobby";

describe("partitionDemoRooms", () => {
  it("splits open and closed rooms and puts joinable open rooms first", () => {
    const { open, closed } = partitionDemoRooms([
      { id: "full", complete: false, openSeats: 0 },
      { id: "done", complete: true, openSeats: 0 },
      { id: "joinable", complete: false, openSeats: 3 },
    ]);

    expect(open.map((room) => room.id)).toEqual(["joinable", "full"]);
    expect(closed.map((room) => room.id)).toEqual(["done"]);
  });
});

describe("formatDemoStat", () => {
  it("formats whole numbers for the lobby ticker", () => {
    expect(formatDemoStat(1840)).toBe("1,840");
    expect(formatDemoStat(-4)).toBe("0");
  });
});
