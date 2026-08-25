import { describe, expect, it } from "vitest";

import { formatAdp } from "../../src/domain";

describe("formatAdp", () => {
  it("caps floating-point values at two decimal places", () => {
    expect(formatAdp(219.57999999999998)).toBe("219.58");
    expect(formatAdp(21.5)).toBe("21.5");
    expect(formatAdp(10)).toBe("10");
  });

  it("uses a dash for missing or invalid values", () => {
    expect(formatAdp(undefined)).toBe("—");
    expect(formatAdp(Number.NaN)).toBe("—");
  });
});
