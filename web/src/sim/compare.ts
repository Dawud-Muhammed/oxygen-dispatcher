import { ExperimentEngine, DEFAULT_EXPERIMENT_CONFIG } from "./engine";
import type { ExperimentConfig, ExperimentRecord } from "./engine";
import type { SimConfig } from "./patient";
import type { ControllerConfig } from "./controller";
export type { ArmStats, LivePoint as SeriesPoint } from "./engine";
export interface CompareConfig {
  simCfg: SimConfig;
  controllerCfg: ControllerConfig;
  durationS?: number;
  onProgress?: (fraction: number) => void;
}
export type ComparisonResult = ExperimentRecord["summary"] & {
  series: ExperimentRecord["series"];
};
export function runComparison(
  input: ExperimentConfig | CompareConfig,
): ComparisonResult {
  const config: ExperimentConfig =
    "simCfg" in input
      ? {
          ...DEFAULT_EXPERIMENT_CONFIG,
          scenario: input.simCfg.scenario,
          seed: input.simCfg.seed ?? 42,
          continuousFlow: input.simCfg.continuousFlow ?? 5,
          utilization: input.simCfg.utilization ?? 0.75,
          durationS: input.durationS ?? 43200,
          controller: input.controllerCfg,
        }
      : input;
  const engine = new ExperimentEngine(config);
  while (!engine.done) {
    engine.advanceTicks(600);
    if ("onProgress" in input)
      input.onProgress?.(engine.timeS / config.durationS);
  }
  const record = engine.exportRun();
  return { ...record.summary, series: record.series };
}
