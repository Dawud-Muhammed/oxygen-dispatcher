export interface FinanceInputs {
  episodes: number;
  hoursPerEpisode: number;
  flowLpm: number;
  pricePerL: number;
  cashRealizationPct: number;
  feePct: number;
  fixedCharge: number;
  otherCosts: number;
}
export function estimateFinance(input: FinanceInputs, savedPct: number | null) {
  for (const [key, value] of Object.entries(input))
    if (!Number.isFinite(value) || value < 0)
      throw new Error(key + " must be a finite, nonnegative number.");

  if (input.cashRealizationPct > 100 || input.feePct > 100)
    throw new Error("Percentages must be between 0 and 100.");

  if (savedPct !== null && (!Number.isFinite(savedPct) || savedPct > 100))
    throw new Error("Invalid gas reduction.");

  const baselineLitres =
    input.episodes * input.hoursPerEpisode * input.flowLpm * 60;

  const reducedLitres =
    savedPct === null ? null : (baselineLitres * savedPct) / 100;

  const avoidedCost =
    reducedLitres === null
      ? null
      : (reducedLitres * input.pricePerL * input.cashRealizationPct) / 100;

  const serviceCharge =
    avoidedCost === null
      ? null
      : (Math.max(0, avoidedCost) * input.feePct) / 100 + input.fixedCharge;

  const netBenefit =
    avoidedCost === null || serviceCharge === null
      ? null
      : avoidedCost - serviceCharge - input.otherCosts;

  for (const x of [
    baselineLitres,
    reducedLitres,
    avoidedCost,
    serviceCharge,
    netBenefit,
  ])
    if (x !== null && !Number.isFinite(x))
      throw new Error("Inputs are too large.");

  return {
    baselineLitres,
    reducedLitres,
    avoidedCost,
    serviceCharge,
    netBenefit,
  };
}
