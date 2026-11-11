import { finiteRange } from "./patient";
export type AlarmLevel = "CRITICAL" | "WARNING" | "INFO";
export type Validity =
  "valid" | "missing" | "invalid" | "stale" | "low_quality";
export type ControllerMode =
  | "warming_up"
  | "breath_sync"
  | "sensor_fallback"
  | "no_breath_fallback"
  | "critical_fallback";
const nonPulseReason: Record<Exclude<ControllerMode, "breath_sync">, string> = {
  warming_up: "The controller is finding a pressure reference.",
  sensor_fallback: "The controller is using its configured backup mode.",
  no_breath_fallback: "No breath was detected within the configured interval.",
  critical_fallback: "The controller detected a sustained low SpO₂ reading.",
};
export interface Alarm {
  id: string;
  code: string;
  level: AlarmLevel;
  message: string;
  onsetS: number;
  active: boolean;
  acknowledged: boolean;
  resolvedS: number | null;
  activeDurationS: number;
}
export interface EventLogEntry {
  id: string;
  timeS: number;
  code: string;
  message: string;
}
export interface ControllerOutput {
  valveOpen: boolean;
  valveReason: string;
  flowSetpoint: number;
  mode: ControllerMode;
  breathDetected: boolean;
  pressureValidity: Validity;
  spo2Validity: Validity;
  alarms: Alarm[];
  newEvents: EventLogEntry[];
}
export interface ControllerConfig {
  prescribedMaxFlow: number;
  initialFlow: number;
  spo2Target: "standard" | "co2retain";
  minimumFlow?: number;
  targetLow?: number;
  targetHigh?: number;
  inhaleThreshold?: number;
  maxOpenTimeS?: number;
  inhaleDebounceTicks?: number;
  warmupS?: number;
  noBreathS?: number;
  sensorWarningS?: number;
  sensorCriticalS?: number;
  criticalThreshold?: number;
  criticalDurationS?: number;
  recoveryS?: number;
  averageWindowS?: number;
  minimumCoverage?: number;
  adjustmentIntervalS?: number;
  maxSensorAgeS?: number;
  fallbackFlow?: number;
}
export interface SensorMetadata {
  dtS?: number;
  pressureTimestampS?: number;
  spo2TimestampS?: number;
  pressureQuality?: "good" | "low";
  spo2Quality?: "good" | "low";
}
export function measurementValidity(
  value: number | null,
  timestampS: number,
  nowS: number,
  lo: number,
  hi: number,
  maxAgeS: number,
  quality: "good" | "low" = "good",
): Validity {
  if (
    !Number.isFinite(timestampS) ||
    !Number.isFinite(nowS) ||
    timestampS > nowS + 1e-8 ||
    timestampS < 0
  )
    return "invalid";
  if (value === null) return "missing";
  if (!Number.isFinite(value) || value < lo || value > hi) return "invalid";
  if (nowS - timestampS > maxAgeS + 1e-8) return "stale";
  return quality !== "good" ? "low_quality" : "valid";
}
export function validateControllerConfig(
  input: ControllerConfig,
): Required<ControllerConfig> {
  if (!["standard", "co2retain"].includes(input.spo2Target))
    throw new Error("Unknown target preset.");
  const [low, high] = input.spo2Target === "standard" ? [92, 96] : [88, 92];
  const c = {
    minimumFlow: 0,
    targetLow: low,
    targetHigh: high,
    inhaleThreshold: 1,
    maxOpenTimeS: 0.8,
    inhaleDebounceTicks: 2,
    warmupS: 5,
    noBreathS: 10,
    sensorWarningS: 2,
    sensorCriticalS: 120,
    criticalThreshold: 88,
    criticalDurationS: 30,
    recoveryS: 5,
    averageWindowS: 180,
    minimumCoverage: 0.8,
    adjustmentIntervalS: 300,
    maxSensorAgeS: 2,
    fallbackFlow: input.prescribedMaxFlow,
    ...input,
  };
  for (const key of [
    "prescribedMaxFlow",
    "initialFlow",
    "minimumFlow",
    "fallbackFlow",
  ] as const)
    finiteRange(key, c[key], 0, 30);
  if (
    c.minimumFlow > c.initialFlow ||
    c.initialFlow > c.prescribedMaxFlow ||
    c.fallbackFlow < c.minimumFlow ||
    c.fallbackFlow > c.prescribedMaxFlow
  )
    throw new Error(
      "Flow bounds must satisfy minimum ≤ initial/fallback ≤ maximum.",
    );
  finiteRange("targetLow", c.targetLow, 0, 100);
  finiteRange("targetHigh", c.targetHigh, 0, 100);
  if (c.targetLow >= c.targetHigh)
    throw new Error("Target lower bound must be below upper bound.");
  finiteRange("criticalThreshold", c.criticalThreshold, 0, c.targetLow);
  finiteRange("minimumCoverage", c.minimumCoverage, 0.01, 1);
  finiteRange("inhaleThreshold", c.inhaleThreshold, 0.01, 20);
  finiteRange("inhaleDebounceTicks", c.inhaleDebounceTicks, 1, 100);
  if (!Number.isInteger(c.inhaleDebounceTicks))
    throw new Error("Debounce ticks must be an integer.");
  for (const key of [
    "maxOpenTimeS",
    "warmupS",
    "noBreathS",
    "sensorWarningS",
    "sensorCriticalS",
    "criticalDurationS",
    "recoveryS",
    "averageWindowS",
    "adjustmentIntervalS",
    "maxSensorAgeS",
  ] as const)
    finiteRange(key, c[key], 0.1, 3600);
  if (Math.abs(c.maxOpenTimeS * 10 - Math.round(c.maxOpenTimeS * 10)) > 1e-8)
    throw new Error(
      "Maximum pulse duration must be a multiple of the 0.1 s control interval.",
    );
  if (c.sensorCriticalS < c.sensorWarningS)
    throw new Error(
      "Extended sensor threshold must follow the warning threshold.",
    );
  return Object.freeze(c);
}
/** Timestamped intervals expire by elapsed time, including through missing data. */
export class SpO2Window {
  private samples: {
    start: number;
    end: number;
    value: number;
  }[] = [];
  add(start: number, dt: number, value: number | null) {
    if (value !== null) this.samples.push({ start, end: start + dt, value });
  }
  expire(now: number, windowS: number) {
    while (this.samples.length && this.samples[0].end <= now - windowS)
      this.samples.shift();
  }
  summarize(now: number, windowS: number) {
    const start = Math.max(0, now - windowS);
    while (this.samples.length && this.samples[0].end <= start)
      this.samples.shift();
    let coveredS = 0,
      total = 0;
    for (const s of this.samples) {
      const duration = Math.max(
        0,
        Math.min(now, s.end) - Math.max(start, s.start),
      );
      coveredS += duration;
      total += duration * s.value;
    }
    return {
      average: coveredS > 0 ? total / coveredS : null,
      coverage: coveredS / windowS,
    };
  }
}
export class ValveController {
  readonly config: Required<ControllerConfig>;
  private readonly pressureOnly: boolean;
  private flow: number;
  private mode: ControllerMode = "warming_up";
  private pulse: "waiting_exhale" | "ready" | "open" = "waiting_exhale";
  private pressureBuffer: number[] = [];
  private baseline = 0.4;
  private elapsedS = 0;
  private lastTime = -1;
  private lastEndS: number | null = null;
  private openS = 0;
  private debounce = 0;
  private sinceBreathS = 0;
  private invalidS = 0;
  private healthyS = 0;
  private sensorRecoveryPending = false;
  private criticalS = 0;
  private adjustmentS = 0;
  private window = new SpO2Window();
  private history: Alarm[] = [];
  private log: EventLogEntry[] = [];
  private sequence = 0;
  private alarmSequence = 0;
  private newEvents: EventLogEntry[] = [];
  private episodeCount = 0;
  private criticalCount = 0;
  private warningCount = 0;
  private activeSeconds = 0;
  droppedEvents = 0;
  droppedAlarms = 0;
  constructor(config: ControllerConfig, pressureOnly = false) {
    this.config = validateControllerConfig(config);
    this.pressureOnly = pressureOnly;
    this.flow = this.config.initialFlow;
  }
  private event(timeS: number, code: string, message: string) {
    const e = { id: `event-${++this.sequence}`, timeS, code, message };
    this.log.push(e);
    this.newEvents.push(e);
    if (this.log.length > 10000) {
      this.log.shift();
      this.droppedEvents++;
    }
  }
  private alarm(
    code: string,
    active: boolean,
    level: AlarmLevel,
    message: string,
    timeS: number,
    dt: number,
  ) {
    let a = this.history.findLast((x) => x.code === code && x.active);
    if (active && !a) {
      a = {
        id: `alarm-${++this.alarmSequence}`,
        code,
        level,
        message,
        onsetS: timeS,
        active: true,
        acknowledged: false,
        resolvedS: null,
        activeDurationS: 0,
      };
      this.history.push(a);
      this.episodeCount++;
      if (level === "CRITICAL") this.criticalCount++;
      if (level === "WARNING") this.warningCount++;
      this.event(timeS, code, message);
    }
    if (a && active) a.activeDurationS += dt;
    if (a && !active) {
      a.active = false;
      a.resolvedS = timeS;
      this.event(timeS, `${code}_RESOLVED`, `${message} — condition resolved.`);
    }
    if (this.history.length > 10000) {
      const idx = this.history.findIndex((x) => !x.active);
      if (idx >= 0) {
        this.history.splice(idx, 1);
        this.droppedAlarms++;
      }
    }
  }
  tick(
    pressure: number | null,
    spo2: number | null,
    timeS: number,
    meta: SensorMetadata = {},
  ): ControllerOutput {
    const c = this.config,
      dt = meta.dtS === undefined ? 0.1 : meta.dtS;
    finiteRange("Tick duration", dt, Number.MIN_VALUE, 0.100000001);
    if (!Number.isFinite(timeS) || timeS < 0 || timeS <= this.lastTime)
      throw new Error(
        "Controller timestamps must be finite, nonnegative and strictly increasing.",
      );
    if (this.lastEndS !== null && Math.abs(timeS - this.lastEndS) > 1e-8)
      throw new Error(
        "Controller intervals must be contiguous; supply missing measurements for unavailable intervals.",
      );
    this.lastTime = timeS;
    this.lastEndS = timeS + dt;
    this.newEvents = [];
    // Omitted metadata means a sample taken now. Explicit malformed values
    // (including null from external JavaScript) must remain invalid.
    const pv = measurementValidity(
      pressure,
      meta.pressureTimestampS === undefined ? timeS : meta.pressureTimestampS,
      timeS,
      -20,
      20,
      c.maxSensorAgeS,
      meta.pressureQuality,
    );
    const sv = measurementValidity(
      spo2,
      meta.spo2TimestampS === undefined ? timeS : meta.spo2TimestampS,
      timeS,
      0,
      100,
      c.maxSensorAgeS,
      meta.spo2Quality,
    );
    const valid = pv === "valid" && (this.pressureOnly || sv === "valid");
    // Commands at timeS use only intervals already completed. The current
    // sample can reset a continuous-condition timer immediately, but cannot
    // credit the forthcoming interval before it has elapsed.
    if (valid) this.invalidS = 0;
    else this.healthyS = 0;
    if (!valid) this.sensorRecoveryPending = true;
    else if (this.healthyS >= c.recoveryS - 1e-9)
      this.sensorRecoveryPending = false;
    const critical =
      !this.pressureOnly && sv === "valid" && spo2! < c.criticalThreshold;
    if (!critical) this.criticalS = 0;
    this.window.expire(timeS, c.averageWindowS);
    let detected = false;
    if (pv === "valid") {
      if (this.elapsedS < c.warmupS) {
        this.pressureBuffer.push(pressure!);
        if (this.pressureBuffer.length > 50) this.pressureBuffer.shift();
        const sorted = [...this.pressureBuffer].sort((a, b) => a - b);
        this.baseline = sorted[Math.floor(sorted.length / 2)];
      }
      const inhale = pressure! < this.baseline - c.inhaleThreshold;
      if (!inhale && this.elapsedS >= c.warmupS)
        this.baseline = 0.98 * this.baseline + 0.02 * pressure!;
      if (!inhale) {
        this.pulse = "ready";
        this.openS = 0;
        this.debounce = 0;
      } else if (this.elapsedS >= c.warmupS && this.pulse === "ready") {
        this.debounce++;
        if (this.debounce >= c.inhaleDebounceTicks) {
          this.pulse = "open";
          this.openS = 0;
          this.debounce = 0;
          this.sinceBreathS = 0;
          detected = true;
        }
      }
      if (this.pulse === "open" && this.openS >= c.maxOpenTimeS - 1e-9)
        this.pulse = "waiting_exhale";
    } else {
      this.pulse = "waiting_exhale";
      this.debounce = 0;
    }
    let next: ControllerMode;
    if (this.criticalS >= c.criticalDurationS - 1e-9)
      next = "critical_fallback";
    else if (this.sensorRecoveryPending) next = "sensor_fallback";
    else if (this.elapsedS < c.warmupS) next = "warming_up";
    else if (this.sinceBreathS >= c.noBreathS - 1e-9)
      next = "no_breath_fallback";
    else next = "breath_sync";
    if (next !== this.mode) {
      this.event(
        timeS,
        "MODE_CHANGED",
        `Research controller mode: ${this.mode} → ${next}.`,
      );
      this.mode = next;
    }
    if (!this.pressureOnly && next === "breath_sync" && valid) {
      if (this.adjustmentS >= c.adjustmentIntervalS - 1e-9) {
        this.adjustmentS = 0;
        const avg = this.window.summarize(timeS, c.averageWindowS);
        if (avg.average !== null && avg.coverage >= c.minimumCoverage) {
          const old = this.flow;
          if (avg.average > c.targetHigh + 1)
            this.flow = Math.max(c.minimumFlow, this.flow - 1);
          else if (avg.average < c.targetLow)
            this.flow = Math.min(c.prescribedMaxFlow, this.flow + 1);
          if (old !== this.flow)
            this.event(
              timeS,
              "FLOW_ADJUSTED",
              `Research rule: flow setpoint ${old} → ${this.flow} L/min; mean SpO₂ ${avg.average.toFixed(2)}%.`,
            );
        }
      }
    } else this.adjustmentS = 0;
    this.alarm(
      "SENSOR_UNRELIABLE",
      this.invalidS >= c.sensorWarningS - 1e-9,
      "WARNING",
      "Unreliable measurement; configured continuous fallback.",
      timeS,
      dt,
    );
    this.alarm(
      "SENSOR_EXTENDED",
      this.invalidS >= c.sensorCriticalS - 1e-9,
      "CRITICAL",
      "Extended measurement loss.",
      timeS,
      dt,
    );
    this.alarm(
      "SPO2_CRITICAL",
      next === "critical_fallback",
      "CRITICAL",
      "Sustained low recorded SpO₂; configured continuous fallback.",
      timeS,
      dt,
    );
    this.alarm(
      "NO_BREATH",
      next === "no_breath_fallback",
      "WARNING",
      "No detected breath; configured continuous fallback.",
      timeS,
      dt,
    );
    if (this.history.some((a) => a.active)) this.activeSeconds += dt;
    let flow = this.flow;
    if (!this.pressureOnly) {
      if (next === "critical_fallback") flow = c.prescribedMaxFlow;
      else if (next === "sensor_fallback" || next === "no_breath_fallback")
        flow = c.fallbackFlow;
    }
    const valveOpen = next !== "breath_sync" || this.pulse === "open";
    let valveReason: string;
    if (next !== "breath_sync") valveReason = nonPulseReason[next];
    else if (detected)
      valveReason = `${c.inhaleDebounceTicks} consecutive pressure readings crossed the breath threshold.`;
    else if (valveOpen) valveReason = "The timed valve opening is in progress.";
    else if (this.pulse === "waiting_exhale")
      valveReason =
        "The timed opening ended. The controller is waiting for pressure to rise.";
    else if (this.debounce > 0)
      valveReason =
        "The pressure dropped. The controller is waiting for another reading.";
    else
      valveReason =
        "Pressure is above the breath threshold. The controller is ready for the next breath.";
    if (this.pulse === "open") this.openS += dt;
    if (valid) this.healthyS += dt;
    else this.invalidS += dt;
    if (critical) this.criticalS += dt;
    if (!this.pressureOnly && next === "breath_sync" && valid)
      this.adjustmentS += dt;
    this.sinceBreathS += dt;
    if (!this.pressureOnly)
      this.window.add(timeS, dt, sv === "valid" ? spo2 : null);
    this.elapsedS += dt;
    return {
      valveOpen,
      valveReason,
      flowSetpoint: flow,
      mode: next,
      breathDetected: detected,
      pressureValidity: pv,
      spo2Validity: sv,
      alarms: this.alarms,
      newEvents: [...this.newEvents],
    };
  }
  acknowledge(id: string, timeS = Math.max(0, this.lastTime)) {
    const a = this.history.find((x) => x.id === id);
    if (a && !a.acknowledged) {
      a.acknowledged = true;
      this.event(
        timeS,
        "ALARM_ACKNOWLEDGED",
        `Acknowledged ${a.code}; its active condition is unchanged.`,
      );
    }
  }
  get alarms() {
    return this.history.map((a) => ({ ...a }));
  }
  get eventLog() {
    return this.log.map((e) => ({ ...e }));
  }
  get flowSetpoint() {
    return this.flow;
  }
  get spo2Range(): [number, number] {
    return [this.config.targetLow, this.config.targetHigh];
  }
  get alarmStats() {
    return {
      alarmEpisodes: this.episodeCount,
      alarmActiveS: this.activeSeconds,
      criticalAlarms: this.criticalCount,
      warningAlarms: this.warningCount,
    };
  }
}
