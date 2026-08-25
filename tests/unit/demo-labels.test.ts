import { describe, expect, it } from "vitest";
import {
  demoSeatKind,
  demoSeatKindLabel,
  RP_BOT_NAMES,
  rpBotTeamName,
} from "../../src/domain/demo-labels";

describe("demo seat labels", () => {
  it("uses 100 short, unique fantasy names", () => {
    expect(RP_BOT_NAMES).toHaveLength(100);
    expect(new Set(RP_BOT_NAMES)).toHaveLength(100);
    expect(Math.max(...RP_BOT_NAMES.map((name) => name.length))).toBeLessThanOrEqual(20);
  });

  it("assigns stable, distinct names within each room", () => {
    const names = Array.from({ length: 14 }, (_, index) =>
      rpBotTeamName(index + 1, "demo:room-2026"),
    );
    expect(new Set(names).size).toBe(14);
    expect(rpBotTeamName(6, "demo:room-2026")).toBe(
      rpBotTeamName(6, "demo:room-2026"),
    );
    expect(rpBotTeamName(6, "demo:room-2026")).toBe(
      rpBotTeamName(6, "mock.demo.room-2026"),
    );
    expect(rpBotTeamName(6, "demo:room-2026")).toMatch(/^🤖 /);
    expect(rpBotTeamName(6, "demo:room-2026")).not.toMatch(
      /RP Bot|T6|Seat 6|Team 6/i,
    );
  });

  it("distinguishes humans from RP bots and open seats", () => {
    expect(demoSeatKind(1, [1], { started: false })).toBe("human");
    expect(demoSeatKind(2, [1], { started: false })).toBe("open");
    expect(demoSeatKind(2, [1], { started: true })).toBe("rp-bot");
    expect(demoSeatKindLabel("human")).toBe("Human");
    expect(demoSeatKindLabel("rp-bot")).toBe("RP Bot");
  });
});
