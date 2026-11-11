import { useState } from "react";
import { estimateFinance } from "../finance";
import type { FinanceInputs } from "../finance";
export function BirrCalc({ savedPct }: { savedPct: number | null }) {
  const [inputs, setInputs] = useState<FinanceInputs>({
    episodes: 30,
    hoursPerEpisode: 24,
    flowLpm: 5,
    pricePerL: 0.15,
    cashRealizationPct: 100,
    feePct: 20,
    fixedCharge: 0,
    otherCosts: 0,
  });
  const fields: [keyof FinanceInputs, string, string][] = [
    [
      "episodes",
      "Episodes / month",
      "Number of oxygen-treatment episodes, not continuously occupied beds.",
    ],
    [
      "hoursPerEpisode",
      "Oxygen-hours / episode",
      "Average actual time receiving oxygen per episode.",
    ],
    [
      "flowLpm",
      "Baseline flow (L/min)",
      "Average continuous flow during those oxygen-hours.",
    ],
    [
      "pricePerL",
      "Oxygen price (Birr/L)",
      "Illustrative placeholder; use verified local marginal costs.",
    ],
    [
      "cashRealizationPct",
      "Cash-realizable share (%)",
      "Lower gas use may not reduce fixed supply charges.",
    ],
    [
      "feePct",
      "Proposed share of benefit (%)",
      "Hypothetical fee, applied only to positive avoided cost.",
    ],
    [
      "fixedCharge",
      "Fixed charge (Birr/month)",
      "Additional proposed device or service charge.",
    ],
    [
      "otherCosts",
      "Other customer costs (Birr/month)",
      "Consumables, maintenance or incremental costs.",
    ],
  ];
  let result: ReturnType<typeof estimateFinance> | null = null,
    error = "";
  try {
    result = estimateFinance(inputs, savedPct);
  } catch (e) {
    error = (e as Error).message;
  }
  const fmt = (n: number | null) =>
    n === null
      ? "Not applicable"
      : n.toLocaleString("en-ET", { maximumFractionDigits: 2 });
  return (
    <section className="card">
      <h2>Hypothetical cost estimate</h2>
      <p className="muted">
        Patient episodes × oxygen-hours × flow × 60. Prices and charges are
        editable assumptions; modeled gas reduction is not verified hospital
        savings.
      </p>
      <div className="config-grid">
        {fields.map(([key, label, help]) => (
          <label key={key} title={help}>
            {label}
            <input
              type="number"
              min="0"
              max={key.endsWith("Pct") ? 100 : undefined}
              step="any"
              value={Number.isNaN(inputs[key]) ? "" : inputs[key]}
              onChange={(e) =>
                setInputs({
                  ...inputs,
                  [key]: e.target.value === "" ? NaN : Number(e.target.value),
                })
              }
            />
            <small>{help}</small>
          </label>
        ))}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        result && (
          <div className="table-wrap">
            <table>
              <tbody>
                {[
                  ["Baseline volume (L/month)", result.baselineLitres],
                  ["Modeled gas reduction (L/month)", result.reducedLitres],
                  [
                    "Hypothetical avoided oxygen cost (Birr)",
                    result.avoidedCost,
                  ],
                  ["Proposed service charge (Birr)", result.serviceCharge],
                  ["Net customer benefit (Birr/month)", result.netBenefit],
                ].map(([label, value]) => (
                  <tr key={String(label)}>
                    <th>{label}</th>
                    <td>{fmt(value as number | null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      <small>
        Negative benefit remains visible. Supplier margin is not estimated
        because manufacturing and service costs are unknown.
      </small>
    </section>
  );
}
