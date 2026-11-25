import { describe, expect, it } from "vitest";
import { addCounts, batches } from "./import-batches";

describe("Import batches", () => {
  it("splits items into batches of a fixed size", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });

  it("adds up the counts from each batch", () => {
    expect(
      addCounts([
        { created: 2, updated: 1 },
        { created: 3, updated: 0 },
      ]),
    ).toEqual({ created: 5, updated: 1 });
  });
});
