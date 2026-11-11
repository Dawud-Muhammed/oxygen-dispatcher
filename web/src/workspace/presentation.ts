import type { ScenarioName } from "../sim/patient";
export const scenarios: Record<ScenarioName, string> = {
  recovering: "Recovering need",
  worsening: "Increasing need",
  sensor_fault: "Scheduled sensor faults",
};
export function duration(seconds: number) {
  return seconds < 60
    ? seconds.toFixed(1) + " s"
    : seconds < 3600
      ? (seconds / 60).toFixed(1) + " min"
      : (seconds / 3600).toFixed(2) + " h";
}
