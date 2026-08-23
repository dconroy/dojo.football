import { describe, expect, it } from "vitest";

import { paginate } from "../../src/lib/paginate";

describe("paginate", () => {
  it("returns an empty first page when there are no items", () => {
    const page = paginate([], 3, 5);
    expect(page).toMatchObject({
      items: [],
      page: 1,
      pageCount: 1,
      total: 0,
      from: 0,
      to: 0,
    });
  });

  it("clamps an out-of-range page back onto the last page", () => {
    const page = paginate(["a", "b", "c", "d", "e", "f"], 9, 5);
    expect(page.page).toBe(2);
    expect(page.items).toEqual(["f"]);
    expect(page.from).toBe(6);
    expect(page.to).toBe(6);
  });

  it("slices a middle page", () => {
    const page = paginate([1, 2, 3, 4, 5, 6, 7], 2, 3);
    expect(page.items).toEqual([4, 5, 6]);
    expect(page.pageCount).toBe(3);
    expect(page.from).toBe(4);
    expect(page.to).toBe(6);
  });
});
