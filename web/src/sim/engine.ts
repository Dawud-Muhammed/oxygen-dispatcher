import {
  ExogenousTrace,
  PatientSimulator,
  finiteRange,
  STEP_MS,
} from "./patient";
import type { ScenarioName } from "./patient";
import {
  ValveController,
  measurementValidity,
  validateControllerConfig,
} from "./controller";
import type {
  Alarm,
  ControllerConfig,
  ControllerMode,
  EventLogEntry,
  Validity,
} from "./controller";
export interface ExperimentConfig {
  scenario: ScenarioName;
  seed: number;
  durationS: number;
  continuousFlow: number;
  utilization: number;
  controller: ControllerConfig;
}
export const DEFAULT_EXPERIMENT_CONFIG: ExperimentConfig = {
  scenario: "recovering",
  seed: 42,
  durationS: 43200,
  continuousFlow: 5,
  utilization: 0.75,
  controller: { prescribedMaxFlow: 5, initialFlow: 5, spo2Target: "standard" },
};
export type FaultKind = "spo2_loss" | "pressure_loss" | "motion";
export interface Fault {
  id: string;
  kind: FaultKind;
  startS: number;
  endS: number;
}
export interface ArmStats {
  totalOxygenL: number;
  belowRangeS: number;
  inRangeS: number;
  aboveRangeS: number;
  belowCriticalS: number;
  missingS: number;
  invalidS: number;
  staleS: number;
  lowQualityS: number;
  validS: number;
  validCoveragePct: number | null;
  alarmEpisodes: number;
  alarmActiveS: number;
}
export interface LivePoint {
  timeS: number;
  spo2A: number | null;
  spo2B: number | null;
  flowA: number;
  flowB: number;
  actualFlowA: number;
  actualFlowB: number;
  pressureB: number | null;
  valveB: boolean;
  isInhaling: boolean;
}
export type RunStatus = "idle" | "running" | "paused" | "done";
export interface SimSnapshot {
  runId: string;
  config: ExperimentConfig;
  status: RunStatus;
  timeS: number;
  scenario: ScenarioName;
  speedMult: number;
  oxygenA: number;
  oxygenB: number;
  oxygenSavedPct: number | null;
  flowB: number;
  actualFlowB: number;
  valveOpen: boolean;
  spo2A: number | null;
  spo2B: number | null;
  isInhaling: boolean;
  controllerMode: ControllerMode;
  pulseVolumeMl: number;
  pressureValidity: Validity;
  spo2Validity: Validity;
  armA: ArmStats;
  armB: ArmStats;
  alarms: Alarm[];
  eventLog: EventLogEntry[];
  series: LivePoint[];
  faults: Fault[];
  droppedEvents: number;
  droppedAlarms: number;
}
export interface ExperimentRecord {
  client_run_id: string;
  scenario: ScenarioName;
  seed: number;
  config: ExperimentConfig;
  summary: {
    armA: ArmStats;
    armB: ArmStats;
    oxygenSavedPct: number | null;
    simDurationS: number;
  };
  event_log: EventLogEntry[];
  series: LivePoint[];
  faults: Fault[];
  alarms: Alarm[];
  provenance: {
    schemaVersion: string;
    modelVersion: string;
    controllerVersion: string;
    source: string;
    verification: string;
    stepS: number;
    droppedEvents: number;
    droppedAlarms: number;
  };
}
export function validateExperimentConfig(
  config: ExperimentConfig,
): ExperimentConfig {
  if (!["recovering", "worsening", "sensor_fault"].includes(config.scenario))
    throw new Error("Unknown scenario.");
  finiteRange("Seed", config.seed, 0, 4294967295);
  if (!Number.isInteger(config.seed))
    throw new Error("Seed must be an integer.");
  finiteRange("Duration", config.durationS, 0, 86400);
  finiteRange("Continuous flow", config.continuousFlow, 0, 30);
  finiteRange("Utilization", config.utilization, 0, 1);
  return Object.freeze({
    ...config,
    controller: validateControllerConfig({ ...config.controller }),
  });
}
export function oxygenReductionPct(a: number, b: number): number | null {
  finiteRange("Baseline gas", a, 0, Number.MAX_VALUE);
  finiteRange("Controlled gas", b, 0, Number.MAX_VALUE);
  if (a === 0) return null;
  const percentage = ((a - b) / a) * 100;
  // Extremely small baselines can overflow an otherwise valid comparison.
  // Preserve every representable negative result; never serialize Infinity.
  return Number.isFinite(percentage) ? percentage : null;
}
function emptyStats(): ArmStats {
  return {
    totalOxygenL: 0,
    belowRangeS: 0,
    inRangeS: 0,
    aboveRangeS: 0,
    belowCriticalS: 0,
    missingS: 0,
    invalidS: 0,
    staleS: 0,
    lowQualityS: 0,
    validS: 0,
    validCoveragePct: null,
    alarmEpisodes: 0,
    alarmActiveS: 0,
  };
}
function accumulate(
  stats: ArmStats,
  value: number | null,
  validity: Validity,
  dt: number,
  lo: number,
  hi: number,
  critical: number,
  volume: number,
) {
  stats.totalOxygenL += volume;
  if (validity === "valid") {
    stats.validS += dt;
    if (value! < lo) stats.belowRangeS += dt;
    else if (value! > hi) stats.aboveRangeS += dt;
    else stats.inRangeS += dt;
    if (value! < critical) stats.belowCriticalS += dt;
  } else if (validity === "missing") stats.missingS += dt;
  else if (validity === "stale") stats.staleS += dt;
  else if (validity === "low_quality") stats.lowQualityS += dt;
  else stats.invalidS += dt;
}
/** All scientific calculations live here. UI scheduling never changes tick size. */
export class ExperimentEngine {
  readonly config: ExperimentConfig;
  readonly runId: string;
  private trace: ExogenousTrace;
  private patientA: PatientSimulator;
  private patientB: PatientSimulator;
  private controller: ValveController;
  private tickIndex = 0;
  private elapsed = 0;
  private statsA = emptyStats();
  private statsB = emptyStats();
  private points: LivePoint[] = [];
  private faults: Fault[] = [];
  private manualEvents: EventLogEntry[] = [];
  private last: LivePoint = {
    timeS: 0,
    spo2A: null,
    spo2B: null,
    flowA: 0,
    flowB: 0,
    actualFlowA: 0,
    actualFlowB: 0,
    pressureB: 0,
    valveB: false,
    isInhaling: false,
  };
  private mode: ControllerMode = "warming_up";
  private pv: Validity = "missing";
  private sv: Validity = "missing";
  private pulseL = 0;
  private lastPulseL = 0;
  private sampleTicks: number;
  constructor(
    config: ExperimentConfig = DEFAULT_EXPERIMENT_CONFIG,
    runId: string = crypto.randomUUID(),
    faultSchedule?: Fault[],
  ) {
    this.config = validateExperimentConfig(config);
    this.runId = runId;
    this.trace = new ExogenousTrace(config.scenario, config.seed);
    this.patientA = new PatientSimulator(config.utilization);
    this.patientB = new PatientSimulator(config.utilization);
    this.controller = new ValveController(this.config.controller);
    this.sampleTicks = Math.max(
      1,
      Math.ceil(config.durationS / (STEP_MS / 1000) / 4998),
    );
    if (config.scenario === "sensor_fault")
      this.faults = [
        { id: "scenario-spo2", kind: "spo2_loss", startS: 10800, endS: 10920 },
        { id: "scenario-motion", kind: "motion", startS: 14400, endS: 14490 },
      ];
    this.faults = this.faults
      .filter((f) => f.startS < config.durationS)
      .map((f) => ({ ...f, endS: Math.min(f.endS, config.durationS) }));
    if (faultSchedule) {
      if (faultSchedule.length > 100) throw new Error("Maximum 100 faults.");
      const ids = new Set<string>();
      this.faults = faultSchedule.map((f) => {
        if (
          typeof f.id !== "string" ||
          !f.id.trim() ||
          f.id.length > 128 ||
          ids.has(f.id)
        )
          throw new Error(
            "Fault identifiers must be unique, nonempty strings of at most 128 characters.",
          );
        ids.add(f.id);
        finiteRange("Fault start", f.startS, 0, config.durationS);
        finiteRange("Fault end", f.endS, f.startS, config.durationS);
        if (f.endS <= f.startS)
          throw new Error("Fault end must follow its start.");
        if (!["spo2_loss", "pressure_loss", "motion"].includes(f.kind))
          throw new Error("Unknown fault.");
        return { ...f };
      });
    }
  }
  get timeS() {
    return this.elapsed;
  }
  get done() {
    return this.elapsed >= this.config.durationS;
  }
  get nextDtS() {
    return Math.max(0, Math.min(0.1, this.config.durationS - this.elapsed));
  }
  injectFault(kind: FaultKind, durationS = 30) {
    if (this.done) throw new Error("Start a new experiment to inject a fault.");
    finiteRange("Fault duration", durationS, 0.1, 3600);
    if (!["spo2_loss", "pressure_loss", "motion"].includes(kind))
      throw new Error("Unknown fault kind.");
    if (this.faults.length >= 100)
      throw new Error("Maximum 100 fault intervals per experiment.");
    let sequence = this.faults.length + 1;
    while (this.faults.some((f) => f.id === `fault-${sequence}`)) sequence++;
    const fault = {
      id: `fault-${sequence}`,
      kind,
      startS: this.elapsed,
      endS: Math.min(this.config.durationS, this.elapsed + durationS),
    };
    this.faults.push(fault);
    const streams =
      kind === "pressure_loss"
        ? "the synthetic pressure stream"
        : "both synthetic SpO₂ streams";
    this.manualEvents.push({
      id: `manual-${fault.id}`,
      timeS: this.elapsed,
      code: "FAULT_INJECTED",
      message: `Injected ${kind} for ${(fault.endS - fault.startS).toFixed(1)} s in ${streams}.`,
    });
  }
  acknowledgeAlarm(id: string) {
    this.controller.acknowledge(id, this.elapsed);
  }
  step(): void {
    if (this.done) return;
    const t = this.elapsed,
      dt = this.nextDtS,
      c = this.config,
      ctrl = this.controller.config;
    const shared = this.trace.sample(t);
    const active = this.faults.filter((f) => t >= f.startS && t < f.endS);
    const lost = active.some((f) => f.kind === "spo2_loss"),
      motion = active.some((f) => f.kind === "motion");
    const pressure = active.some((f) => f.kind === "pressure_loss")
      ? null
      : shared.pressure;
    // Causal sample-and-hold: measurements at interval start choose its command.
    const a = lost
      ? null
      : Math.min(100, Math.max(0, this.patientA.spo2 + shared.noise));
    const b = lost
      ? null
      : Math.min(100, Math.max(0, this.patientB.spo2 + shared.noise));
    const quality = motion ? "low" : "good";
    const out = this.controller.tick(pressure, b, t, {
      dtS: dt,
      spo2Quality: quality,
    });
    const actualFlowB = out.valveOpen ? out.flowSetpoint : 0;
    const pa = this.patientA.advance(c.continuousFlow, shared, dt),
      pb = this.patientB.advance(actualFlowB, shared, dt);
    const va = measurementValidity(
      a,
      t,
      t,
      0,
      100,
      ctrl.maxSensorAgeS,
      quality,
    );
    accumulate(
      this.statsA,
      a,
      va,
      dt,
      ctrl.targetLow,
      ctrl.targetHigh,
      ctrl.criticalThreshold,
      pa.sourceVolumeL,
    );
    accumulate(
      this.statsB,
      b,
      out.spo2Validity,
      dt,
      ctrl.targetLow,
      ctrl.targetHigh,
      ctrl.criticalThreshold,
      pb.sourceVolumeL,
    );
    const pulsing = out.mode === "breath_sync" && out.valveOpen;
    const wasPulsing = this.mode === "breath_sync" && this.last.valveB;
    if (pulsing) {
      if (!wasPulsing) this.pulseL = 0;
      this.pulseL += pb.sourceVolumeL;
    } else if (wasPulsing) {
      this.lastPulseL = this.pulseL;
      this.pulseL = 0;
    }
    this.mode = out.mode;
    this.pv = out.pressureValidity;
    this.sv = out.spo2Validity;
    this.last = {
      timeS: t,
      spo2A: va === "valid" ? a : null,
      spo2B: out.spo2Validity === "valid" ? b : null,
      flowA: c.continuousFlow,
      flowB: out.flowSetpoint,
      actualFlowA: c.continuousFlow,
      actualFlowB,
      pressureB: pressure,
      valveB: out.valveOpen,
      isInhaling: shared.isInhaling,
    };
    if (this.tickIndex % this.sampleTicks === 0)
      this.points.push({ ...this.last });
    this.tickIndex++;
    this.elapsed = Math.min(c.durationS, this.tickIndex * 0.1);
    if (this.done && this.points.at(-1)?.timeS !== this.elapsed)
      this.points.push({ ...this.last, timeS: this.elapsed });
  }
  advanceTicks(count: number) {
    finiteRange("Tick count", count, 0, 1000000);
    if (!Number.isInteger(count))
      throw new Error("Tick count must be an integer.");
    for (let i = 0; i < count && !this.done; i++) this.step();
  }
  snapshot(
    status: RunStatus = this.done ? "done" : "idle",
    speedMult = 1,
  ): SimSnapshot {
    const a = {
      ...this.statsA,
      validCoveragePct:
        this.elapsed > 0
          ? Math.min(100, (this.statsA.validS / this.elapsed) * 100)
          : null,
    };
    const b = {
      ...this.statsB,
      validCoveragePct:
        this.elapsed > 0
          ? Math.min(100, (this.statsB.validS / this.elapsed) * 100)
          : null,
      alarmEpisodes: this.controller.alarmStats.alarmEpisodes,
      alarmActiveS: this.controller.alarmStats.alarmActiveS,
    };
    return {
      runId: this.runId,
      config: this.config,
      status: this.done ? "done" : status,
      timeS: this.elapsed,
      scenario: this.config.scenario,
      speedMult,
      oxygenA: a.totalOxygenL,
      oxygenB: b.totalOxygenL,
      oxygenSavedPct: oxygenReductionPct(a.totalOxygenL, b.totalOxygenL),
      flowB: this.last.flowB,
      actualFlowB: this.last.actualFlowB,
      valveOpen: this.last.valveB,
      spo2A: this.last.spo2A,
      spo2B: this.last.spo2B,
      isInhaling: this.last.isInhaling,
      controllerMode: this.mode,
      pulseVolumeMl:
        (this.mode === "breath_sync" && this.last.valveB
          ? this.pulseL
          : this.lastPulseL) * 1000,
      pressureValidity: this.pv,
      spo2Validity: this.sv,
      armA: a,
      armB: b,
      alarms: this.controller.alarms,
      eventLog: [...this.controller.eventLog, ...this.manualEvents].sort(
        (x, y) => x.timeS - y.timeS,
      ),
      series: this.points.map((p) => ({ ...p })),
      faults: this.faults.map((f) => ({ ...f })),
      droppedEvents: this.controller.droppedEvents,
      droppedAlarms: this.controller.droppedAlarms,
    };
  }
  exportRun(): ExperimentRecord {
    const s = this.snapshot();
    return {
      client_run_id: this.runId,
      scenario: this.config.scenario,
      seed: this.config.seed,
      config: this.config,
      summary: {
        armA: s.armA,
        armB: s.armB,
        oxygenSavedPct: s.oxygenSavedPct,
        simDurationS: this.elapsed,
      },
      event_log: s.eventLog,
      series: s.series,
      faults: s.faults,
      alarms: s.alarms,
      provenance: {
        schemaVersion: "2",
        modelVersion: "dose-integral-1",
        controllerVersion: "state-machine-1",
        source: "synthetic",
        verification: "client-submitted",
        stepS: 0.1,
        droppedEvents: s.droppedEvents,
        droppedAlarms: s.droppedAlarms,
      },
    };
  }
}
/** Accumulate elapsed visible time; long suspension (>1 s) earns no catch-up. */
export class SimulationClock {
  private previousMs: number | null = null;
  private targetS = 0;
  reset(timeS = 0) {
    this.previousMs = null;
    this.targetS = timeS;
  }
  accrue(nowMs: number, speed: number, visible = true) {
    finiteRange("Speed", speed, 0.1, 10000);
    finiteRange("Wall time", nowMs, 0, Number.MAX_VALUE);
    if (this.previousMs !== null && visible) {
      const elapsed = (nowMs - this.previousMs) / 1000;
      if (elapsed >= 0 && elapsed <= 1) this.targetS += elapsed * speed;
    }
    this.previousMs = visible ? nowMs : null;
    return this.targetS;
  }
  drain(engine: ExperimentEngine, budgetExpired: () => boolean = () => false) {
    while (
      !engine.done &&
      engine.timeS + engine.nextDtS <= this.targetS + 1e-9 &&
      !budgetExpired()
    )
      engine.step();
  }
}
