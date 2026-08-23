import { describe, expect, it } from "vitest";

import { DEFAULT_STRATEGY_WEIGHTS } from "../../src/config/strategy";
import {
  defaultWeightsForExpert,
  expertSliderKeys,
  expertSliderLabel,
  withExpertWeights,
} from "../../src/adapters/rankings/strategy-presets";

describe("expert strategy sliders", () => {
  it("shows Chen rank and tier cliff for Chen and FantasyPros", () => {
    expect(expertSliderKeys("chen")).toEqual([
      "chenRank",
      "tierCliff",
      "positionalNeed",
      "turnUrgency",
    ]);
    expect(expertSliderLabel("chenRank", "chen")).toBe("Chen rank");
    expect(expertSliderLabel("chenRank", "fantasypros")).toBe("ECR rank");
    expect(expertSliderLabel("tierCliff", "fantasypros")).toBe("Tier cliff");
  });

  it("swaps in ADP value for ADP boards", () => {
    expect(expertSliderKeys("sleeper")[0]).toBe("adpValue");
    expect(expertSliderLabel("adpValue", "sleeper")).toBe("ADP value");
    expect(expertSliderLabel("chenRank", "sleeper")).toBe("Board rank");
  });

  it("retargets rank knobs without touching need or urgency", () => {
    const custom = {
      ...DEFAULT_STRATEGY_WEIGHTS,
      positionalNeed: 41,
      turnUrgency: 22,
    };
    const next = withExpertWeights(custom, "sleeper");
    expect(next.adpValue).toBeGreaterThan(custom.adpValue);
    expect(next.chenRank).toBeLessThan(custom.chenRank);
    expect(next.positionalNeed).toBe(41);
    expect(next.turnUrgency).toBe(22);
    expect(defaultWeightsForExpert("chen").chenRank).toBe(
      DEFAULT_STRATEGY_WEIGHTS.chenRank,
    );
  });
});
