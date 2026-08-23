import { describe, expect, it } from "vitest";

import {
  shouldAutoRefreshChen,
  sourceFromBoard,
} from "../../src/adapters/rankings/labels";

describe("ranking source labels", () => {
  it("detects FantasyPros ECR on the board source string", () => {
    expect(sourceFromBoard("FantasyPros ECR · 0.5 PPR")).toBe("fantasypros");
    expect(sourceFromBoard("Boris Chen - 0.5 PPR + K")).toBe("chen");
    expect(
      sourceFromBoard("Dojo blend · Chen + FantasyPros + Sleeper · 0.5 PPR"),
    ).toBe("blend");
  });

  it("does not auto-refresh Chen over another expert", () => {
    expect(shouldAutoRefreshChen("FantasyPros ECR · 0.5 PPR", 0)).toBe(false);
    expect(shouldAutoRefreshChen("Sleeper ADP · 0.5 PPR", 0)).toBe(false);
    expect(
      shouldAutoRefreshChen("Dojo blend · Chen + Sleeper · 0.5 PPR", 0),
    ).toBe(false);
    expect(shouldAutoRefreshChen("Boris Chen - 0.5 PPR + K", 0)).toBe(true);
    expect(shouldAutoRefreshChen("Boris Chen - 0.5 PPR + K", 12)).toBe(false);
  });
});
