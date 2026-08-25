import { describe, expect, it } from "vitest";
import { formatXlm, readableError, shortenAddress } from "./format";

describe("Orbit Pay formatting", () => {
  it("shortens Stellar addresses while preserving both ends", () => {
    expect(shortenAddress("GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890")).toBe("GABCD…67890");
  });

  it("formats XLM with a useful precision", () => {
    expect(formatXlm("12.5")).toBe("12.50");
  });

  it("keeps useful errors", () => {
    expect(readableError(new Error("Transaction rejected"))).toBe("Transaction rejected");
  });
});
