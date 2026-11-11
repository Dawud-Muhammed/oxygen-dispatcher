import { describe, it, expect } from "vitest";
import { estimateFinance } from "./finance";
const inputs = {
  episodes: 30,
  hoursPerEpisode: 24,
  flowLpm: 5,
  pricePerL: 0.15,
  cashRealizationPct: 100,
  feePct: 20,
  fixedCharge: 0,
  otherCosts: 0,
};
describe("Financial estimates", () => {
  it("uses actual episode hours and separates charges", () => {
    const r = estimateFinance(inputs, 50);
    expect(r.baselineLitres).toBe(216000);
    expect(r.reducedLitres).toBe(108000);
    expect(r.avoidedCost).toBe(16200);
    expect(r.serviceCharge).toBe(3240);
    expect(r.netBenefit).toBe(12960);
  });
  it("retains negative savings and excludes them from percentage fees", () => {
    const r = estimateFinance({ ...inputs, fixedCharge: 100 }, -10);
    expect(r.avoidedCost).toBe(-3240);
    expect(r.serviceCharge).toBe(100);
    expect(r.netBenefit).toBe(-3340);
  });
  it("handles zero and undefined baselines", () => {
    expect(estimateFinance({ ...inputs, episodes: 0 }, 50).netBenefit).toBe(0);
    expect(estimateFinance(inputs, null).netBenefit).toBeNull();
    expect(
      estimateFinance({ ...inputs, cashRealizationPct: 0 }, 50).avoidedCost,
    ).toBe(0);
  });
  it("rejects invalid inputs", () => {
    for (const bad of [-1, NaN, Infinity])
      expect(() => estimateFinance({ ...inputs, episodes: bad }, 10)).toThrow();
    expect(() => estimateFinance({ ...inputs, feePct: 101 }, 10)).toThrow();
    expect(() => estimateFinance(inputs, 101)).toThrow();
  });
});
