import { useState } from "react";
import type { ExperimentConfig } from "../sim/engine";
import {
  DEFAULT_EXPERIMENT_CONFIG,
  validateExperimentConfig,
} from "../sim/engine";
import type { ScenarioName } from "../sim/patient";
import { friendlyError } from "../api/client";
import { duration, scenarios } from "./presentation";
const numeric = (value: number) => (Number.isFinite(value) ? value : "");
export function Configuration({
  onApply,
}: {
  onApply: (config: ExperimentConfig) => void;
}) {
  const [config, setConfig] = useState<ExperimentConfig>(
      DEFAULT_EXPERIMENT_CONFIG,
    ),
    [error, setError] = useState("");
  function controller(
    key: keyof ExperimentConfig["controller"],
    value: number,
  ) {
    setConfig((c) => ({ ...c, controller: { ...c.controller, [key]: value } }));
  }
  function apply() {
    try {
      onApply(validateExperimentConfig(config));
    } catch (e) {
      setError(friendlyError(e));
    }
  }
  return (
    <section className="card">
      <div className="card-header">
        <h2>Configure an experiment</h2>
        <span className="status">Synthetic signals</span>
      </div>
      <p className="muted">
        Compare continuous delivery with a breath-synchronized, rule-based
        controller using the same scenario and measurement noise.
      </p>
      <div className="config-grid">
        <label>
          Scenario
          <select
            value={config.scenario}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                scenario: e.target.value as ScenarioName,
              }))
            }
          >
            {Object.entries(scenarios).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Duration
          <select
            value={config.durationS}
            onChange={(e) =>
              setConfig((c) => ({ ...c, durationS: Number(e.target.value) }))
            }
          >
            {[60, 600, 3600, 43200].map((v) => (
              <option key={v} value={v}>
                {duration(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Random seed
          <input
            type="number"
            min={0}
            max={4294967295}
            step={1}
            value={numeric(config.seed)}
            onChange={(e) =>
              setConfig((c) => ({ ...c, seed: e.target.valueAsNumber }))
            }
          />
        </label>
        <label>
          Continuous arm (L/min)
          <input
            type="number"
            min={0}
            max={30}
            step={0.5}
            value={numeric(config.continuousFlow)}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                continuousFlow: e.target.valueAsNumber,
              }))
            }
          />
        </label>
      </div>
      <details>
        <summary>Controller and model assumptions</summary>
        <p className="muted">
          These experimental settings are uncalibrated research assumptions.
          They are not prescriptions. Both arms use the same utilization factor;
          source consumption never uses that factor.
        </p>
        <div className="config-grid">
          <label>
            Initial flow (L/min)
            <input
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={numeric(config.controller.initialFlow)}
              onChange={(e) =>
                controller("initialFlow", e.target.valueAsNumber)
              }
            />
          </label>
          <label>
            Maximum flow (L/min)
            <input
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={numeric(config.controller.prescribedMaxFlow)}
              onChange={(e) =>
                controller("prescribedMaxFlow", e.target.valueAsNumber)
              }
            />
          </label>
          <label>
            Minimum flow (L/min)
            <input
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={numeric(config.controller.minimumFlow ?? 0)}
              onChange={(e) =>
                controller("minimumFlow", e.target.valueAsNumber)
              }
            />
          </label>
          <label>
            Fallback flow (L/min)
            <input
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={numeric(
                config.controller.fallbackFlow ??
                  config.controller.prescribedMaxFlow,
              )}
              onChange={(e) =>
                controller("fallbackFlow", e.target.valueAsNumber)
              }
            />
          </label>
          <label>
            Target lower bound (%)
            <input
              type="number"
              min={0}
              max={100}
              value={numeric(config.controller.targetLow ?? 92)}
              onChange={(e) => controller("targetLow", e.target.valueAsNumber)}
            />
          </label>
          <label>
            Target upper bound (%)
            <input
              type="number"
              min={0}
              max={100}
              value={numeric(config.controller.targetHigh ?? 96)}
              onChange={(e) => controller("targetHigh", e.target.valueAsNumber)}
            />
          </label>
          <label>
            Maximum opening (s)
            <input
              type="number"
              min={0.1}
              max={5}
              step={0.1}
              value={numeric(config.controller.maxOpenTimeS ?? 0.8)}
              onChange={(e) =>
                controller("maxOpenTimeS", e.target.valueAsNumber)
              }
            />
          </label>
          <label>
            Physiological utilization (0–1)
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={numeric(config.utilization)}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  utilization: e.target.valueAsNumber,
                }))
              }
            />
          </label>
        </div>
      </details>
      <p className="muted">
        Short runs exercise controls. Scenario need changes and scheduled faults
        occur over hours; use the 12-hour run to observe them.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" onClick={apply}>
        Prepare experiment
      </button>
    </section>
  );
}
