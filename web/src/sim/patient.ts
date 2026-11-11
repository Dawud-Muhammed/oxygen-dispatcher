/** Synthetic research model; uncalibrated, not a physiological prediction. */
export const STEP_MS = 100;
export const SIM_DURATION_S = 12 * 3600;
export type ScenarioName = "recovering" | "worsening" | "sensor_fault";
export interface SimConfig {
  scenario: ScenarioName;
  seed?: number;
  continuousFlow?: number;
  utilization?: number;
}
export interface DeliveryOverride {
  valveOpen: boolean;
  flowLPM: number;
}
export interface ExogenousSample {
  pressure: number;
  isInhaling: boolean;
  noise: number;
  need: number;
  breathRate: number;
}
export function finiteRange(
  name: string,
  value: number,
  lo: number,
  hi: number,
): number {
  if (!Number.isFinite(value) || value < lo || value > hi)
    throw new Error(`${name} must be a finite number from ${lo} to ${hi}.`);
  return value;
}
export function makePrng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function oxygenNeed(scenario: ScenarioName, timeS: number): number {
  if (scenario === "recovering") return 5 - 4 * Math.min(timeS / 21600, 1);
  if (scenario === "worsening")
    return 3 + 4 * Math.max(0, Math.min((timeS - 10800) / 32400, 1));
  return 4 - 2 * Math.min(timeS / 28800, 1);
}
/** Shared source: delivery never changes random breathing or noise draws. */
export class ExogenousTrace {
  private breathRng: () => number;
  private pressureRng: () => number;
  private displayRng: () => number;
  private periodS = 3.75;
  private breathStartS = 0;
  private scenario: ScenarioName;
  constructor(scenario: ScenarioName, seed: number) {
    this.scenario = scenario;
    this.breathRng = makePrng(seed ^ 0x12345);
    this.pressureRng = makePrng(seed ^ 0x67890);
    this.displayRng = makePrng(seed ^ 0xabcde);
  }
  sample(timeS: number): ExogenousSample {
    while (timeS >= this.breathStartS + this.periodS - 1e-9) {
      this.breathStartS += this.periodS;
      this.periodS =
        (60 / (14 + this.breathRng() * 6)) * (0.95 + this.breathRng() * 0.1);
    }
    const isInhaling = timeS - this.breathStartS < this.periodS / 3;
    return {
      isInhaling,
      pressure: (isInhaling ? -2.5 : 0.4) + (this.pressureRng() - 0.5) * 0.6,
      noise: this.displayRng() - 0.5,
      need: oxygenNeed(this.scenario, timeS),
      breathRate: 60 / this.periodS,
    };
  }
}
export interface PatientResponse {
  trueSpo2: number;
  spo2: number;
  sourceVolumeL: number;
  usefulVolumeL: number;
  effectLpm: number;
  actualFlowLpm: number;
}
/** Both arms use identical integration of useful dose and lagged response. */
export class PatientSimulator {
  private trueSpo2 = 95;
  private effectLpm = 0;
  private utilization: number;
  constructor(utilization = 0.75) {
    this.utilization = finiteRange("Utilization", utilization, 0, 1);
  }
  advance(
    flowLpm: number,
    sample: ExogenousSample,
    dtS: number,
  ): PatientResponse {
    finiteRange("Actual flow", flowLpm, 0, 30);
    finiteRange("Interval", dtS, 0, 0.100000001);
    const sourceVolumeL = (flowLpm * dtS) / 60;
    const usefulVolumeL = sample.isInhaling
      ? sourceVolumeL * this.utilization
      : 0;
    // Dose reservoir normalised by nominal inhale fraction, equally for both arms.
    const usefulRate = dtS > 0 ? (usefulVolumeL * 60) / dtS / (1 / 3) : 0;
    this.effectLpm += (1 - Math.exp(-dtS / 10)) * (usefulRate - this.effectLpm);
    const target = Math.min(
      100,
      Math.max(70, 95 + this.effectLpm - sample.need),
    );
    this.trueSpo2 += (1 - Math.exp(-dtS / 40)) * (target - this.trueSpo2);
    return {
      trueSpo2: this.trueSpo2,
      spo2: Math.min(100, Math.max(0, this.trueSpo2 + sample.noise)),
      sourceVolumeL,
      usefulVolumeL,
      effectLpm: this.effectLpm,
      actualFlowLpm: flowLpm,
    };
  }
  get spo2() {
    return this.trueSpo2;
  }
}
