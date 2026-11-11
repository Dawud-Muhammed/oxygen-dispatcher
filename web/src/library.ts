import { validateExperimentConfig } from "./sim/engine";
import type {
  ArmStats,
  ExperimentConfig,
  ExperimentRecord,
  SimSnapshot,
} from "./sim/engine";

export interface LocalRun {
  id: string;
  createdAt: string;
  record: ExperimentRecord;
  snapshot: SimSnapshot;
  serverId?: number;
}
const KEY = "oxygen-dispatcher.research-runs";
const MAX_RUNS = 20;
const MAX_STORAGE_CHARS = 32 * 1024 * 1024;
const modes = [
  "warming_up",
  "breath_sync",
  "sensor_fallback",
  "no_breath_fallback",
  "critical_fallback",
];
const validity = ["valid", "missing", "invalid", "stale", "low_quality"];
type ObjectValue = Record<string, unknown>;
function fail(message: string): never {
  throw new Error(
    `Saved result is not compatible: ${message}. Existing data has been retained.`,
  );
}
function object(value: unknown, name: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${name} must be an object`);
  return value as ObjectValue;
}
function string(value: unknown, name: string, maximum = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    fail(`${name} must be nonempty text of at most ${maximum} characters`);
  return value;
}
function number(
  value: unknown,
  name: string,
  minimum = 0,
  maximum = Number.MAX_VALUE,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    fail(`${name} is out of range`);
  return value;
}
function integer(
  value: unknown,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
  minimum = 0,
): number {
  const n = number(value, name, minimum, maximum);
  if (!Number.isSafeInteger(n)) fail(`${name} must be an integer`);
  return n;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") fail(`${name} must be true or false`);
  return value;
}
function near(actual: number, expected: number, name: string) {
  if (Math.abs(actual - expected) > Math.max(1e-6, Math.abs(expected) * 1e-8))
    fail(`${name} does not match its source values`);
}
function nullableNumber(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number | null {
  return value === null ? null : number(value, name, minimum, maximum);
}
function array(value: unknown, name: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    fail(`${name} exceeds its supported size or is missing`);
  return value;
}
function uniqueId(value: unknown, seen: Set<string>, name: string) {
  const id = string(value, `${name} ID`, 128);
  if (seen.has(id)) fail(`${name} IDs must be unique`);
  seen.add(id);
  return id;
}
function stats(value: unknown, duration: number, maxFlow: number): ArmStats {
  const a = object(value, "arm metrics");
  for (const key of [
    "belowRangeS",
    "inRangeS",
    "aboveRangeS",
    "belowCriticalS",
    "missingS",
    "invalidS",
    "staleS",
    "lowQualityS",
    "validS",
    "alarmActiveS",
  ])
    number(a[key], key, 0, duration + 1e-6);
  const v = a as unknown as ArmStats;
  number(
    v.totalOxygenL,
    "source consumption",
    0,
    (maxFlow * duration) / 60 + 1e-5,
  );
  integer(v.alarmEpisodes, "alarm episodes", 10000000);
  near(
    v.belowRangeS + v.inRangeS + v.aboveRangeS,
    v.validS,
    "valid-time categories",
  );
  near(
    v.validS + v.missingS + v.invalidS + v.staleS + v.lowQualityS,
    duration,
    "measurement coverage",
  );
  if (v.belowCriticalS > v.belowRangeS + 1e-6)
    fail("critical time exceeds below-target time");
  if (duration === 0) {
    if (v.validCoveragePct !== null)
      fail("zero-duration coverage must be unavailable");
  } else
    near(
      number(v.validCoveragePct, "coverage percentage", 0, 100),
      (v.validS / duration) * 100,
      "coverage percentage",
    );
  return v;
}

/** Validate stored/API records before any renderer reads nested values. This does not rerun the model. */
export function validateExperimentRecord(value: unknown): ExperimentRecord {
  const r = object(value, "run");
  string(r.client_run_id, "run ID", 128);
  const rawConfig = object(r.config, "configuration");
  object(rawConfig.controller, "controller configuration");
  let config: ExperimentConfig;
  try {
    config = validateExperimentConfig(rawConfig as unknown as ExperimentConfig);
  } catch {
    fail("configuration is invalid");
  }
  if (r.scenario !== config.scenario || r.seed !== config.seed)
    fail("scenario or seed differs from captured configuration");
  const summary = object(r.summary, "summary");
  const duration = number(
    summary.simDurationS,
    "elapsed duration",
    0,
    config.durationS,
  );
  const a = stats(summary.armA, duration, config.continuousFlow);
  const b = stats(summary.armB, duration, config.controller.prescribedMaxFlow);
  near(
    a.totalOxygenL,
    (config.continuousFlow * duration) / 60,
    "continuous source consumption",
  );
  const expectedReduction =
    a.totalOxygenL > 0
      ? ((a.totalOxygenL - b.totalOxygenL) / a.totalOxygenL) * 100
      : NaN;
  if (!Number.isFinite(expectedReduction)) {
    if (summary.oxygenSavedPct !== null)
      fail("undefined baseline comparison must be unavailable");
  } else
    near(
      number(summary.oxygenSavedPct, "gas reduction", -Number.MAX_VALUE, 100),
      expectedReduction,
      "gas reduction",
    );
  const provenance = object(r.provenance, "provenance");
  if (
    provenance.schemaVersion !== "2" ||
    provenance.source !== "synthetic" ||
    provenance.verification !== "client-submitted" ||
    provenance.stepS !== 0.1
  )
    fail("unsupported schema or source provenance");
  if (
    provenance.modelVersion !== "dose-integral-1" ||
    provenance.controllerVersion !== "state-machine-1"
  )
    fail("unsupported model or controller identifier");
  integer(provenance.droppedEvents, "omitted events", 10000000);
  integer(provenance.droppedAlarms, "omitted alarms", 10000000);
  const eventIds = new Set<string>();
  let eventTime = -1;
  for (const item of array(r.event_log, "event history", 10100)) {
    const e = object(item, "event");
    uniqueId(e.id, eventIds, "event");
    string(e.code, "event code", 100);
    string(e.message, "event message", 2000);
    const t = number(e.timeS, "event time", 0, duration);
    if (t < eventTime) fail("event history is not chronological");
    eventTime = t;
  }
  let pointTime = -1;
  const series = array(r.series, "chart samples", 5000);
  for (const item of series) {
    const p = object(item, "chart point");
    const t = number(p.timeS, "chart time", 0, duration);
    if (t <= pointTime) fail("chart times must increase");
    pointTime = t;
    nullableNumber(p.spo2A, "continuous saturation", 0, 100);
    nullableNumber(p.spo2B, "controlled saturation", 0, 100);
    for (const key of ["flowA", "flowB", "actualFlowA", "actualFlowB"])
      number(p[key], key, 0, 30);
    nullableNumber(p.pressureB, "pressure", -30, 30);
    const valve = boolean(p.valveB, "valve state");
    boolean(p.isInhaling, "inhalation state");
    near(p.flowA as number, config.continuousFlow, "continuous setpoint");
    near(p.actualFlowA as number, config.continuousFlow, "continuous delivery");
    if ((p.flowB as number) > config.controller.prescribedMaxFlow)
      fail("controlled setpoint exceeds maximum");
    near(
      p.actualFlowB as number,
      valve ? (p.flowB as number) : 0,
      "controlled sampled delivery",
    );
  }
  if (
    duration > 0 &&
    (!series.length || (series[0] as ObjectValue).timeS !== 0)
  )
    fail("chart must retain the start of the run");
  if (duration === config.durationS && duration > 0 && pointTime !== duration)
    fail("complete chart must retain the end of the run");
  const faultIds = new Set<string>();
  for (const item of array(r.faults, "fault schedule", 100)) {
    const f = object(item, "fault");
    uniqueId(f.id, faultIds, "fault");
    if (!["spo2_loss", "pressure_loss", "motion"].includes(f.kind as string))
      fail("unknown fault kind");
    const start = number(f.startS, "fault start", 0, config.durationS);
    const end = number(f.endS, "fault end", start, config.durationS);
    if (end <= start) fail("fault end must follow its start");
  }
  const alarmIds = new Set<string>();
  for (const item of array(r.alarms, "alarm history", 10000)) {
    const alarm = object(item, "alarm");
    uniqueId(alarm.id, alarmIds, "alarm");
    string(alarm.code, "alarm code", 100);
    string(alarm.message, "alarm message", 2000);
    if (!["INFO", "WARNING", "CRITICAL"].includes(alarm.level as string))
      fail("unknown alarm level");
    const onset = number(alarm.onsetS, "alarm onset", 0, duration);
    const active = boolean(alarm.active, "alarm activity");
    boolean(alarm.acknowledged, "alarm acknowledgement");
    const resolved = nullableNumber(
      alarm.resolvedS,
      "alarm resolution",
      onset,
      duration,
    );
    if (active !== (resolved === null))
      fail("alarm activity and resolution disagree");
    number(
      alarm.activeDurationS,
      "alarm active duration",
      0,
      (resolved ?? duration) - onset + 1e-6,
    );
  }
  if (alarmIds.size + (provenance.droppedAlarms as number) !== b.alarmEpisodes)
    fail("alarm episode aggregate differs from retained history");
  return r as unknown as ExperimentRecord;
}

function validateLocal(value: unknown): LocalRun {
  const item = object(value, "browser entry");
  const id = string(item.id, "browser entry ID", 128);
  const createdAt = string(item.createdAt, "save timestamp", 64);
  if (!Number.isFinite(Date.parse(createdAt)))
    fail("save timestamp is invalid");
  if (item.serverId !== undefined)
    integer(item.serverId, "private run ID", Number.MAX_SAFE_INTEGER, 1);
  const record = validateExperimentRecord(item.record);
  if (id !== record.client_run_id) fail("browser entry refers to another run");
  const snap = object(item.snapshot, "snapshot");
  if (
    snap.runId !== id ||
    snap.scenario !== record.scenario ||
    snap.timeS !== record.summary.simDurationS
  )
    fail("snapshot identity or elapsed time differs from its record");
  if (
    !["idle", "running", "paused", "done"].includes(snap.status as string) ||
    !modes.includes(snap.controllerMode as string) ||
    !validity.includes(snap.pressureValidity as string) ||
    !validity.includes(snap.spo2Validity as string)
  )
    fail("snapshot state is invalid");
  number(snap.speedMult, "playback speed", 0.1, 10000);
  number(snap.flowB, "flow setpoint", 0, 30);
  number(snap.actualFlowB, "delivered flow", 0, 30);
  number(snap.pulseVolumeMl, "pulse volume", 0, 1800000);
  boolean(snap.valveOpen, "valve state");
  boolean(snap.isInhaling, "inhalation state");
  nullableNumber(snap.spo2A, "saturation", 0, 100);
  nullableNumber(snap.spo2B, "saturation", 0, 100);
  near(
    number(snap.oxygenA, "continuous consumption"),
    record.summary.armA.totalOxygenL,
    "snapshot continuous consumption",
  );
  near(
    number(snap.oxygenB, "controlled consumption"),
    record.summary.armB.totalOxygenL,
    "snapshot controlled consumption",
  );
  if (snap.oxygenSavedPct !== record.summary.oxygenSavedPct)
    fail("snapshot gas reduction differs from record");
  for (const [snapshotKey, source] of Object.entries({
    config: record.config,
    armA: record.summary.armA,
    armB: record.summary.armB,
    alarms: record.alarms,
    eventLog: record.event_log,
    series: record.series,
    faults: record.faults,
    droppedEvents: record.provenance.droppedEvents,
    droppedAlarms: record.provenance.droppedAlarms,
  })) {
    if (JSON.stringify(snap[snapshotKey]) !== JSON.stringify(source))
      fail(`snapshot ${snapshotKey} differs from record`);
  }
  return item as unknown as LocalRun;
}

export function readLibrary(
  storage: Pick<Storage, "getItem"> = localStorage,
): LocalRun[] {
  const raw = storage.getItem(KEY);
  if (raw === null || raw === "") return [];
  if (raw.length > MAX_STORAGE_CHARS)
    fail("browser library exceeds its supported size");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("browser library is not valid JSON");
  }
  const runs = array(parsed, "browser library", MAX_RUNS).map(validateLocal);
  const ids = new Set<string>();
  for (const run of runs) uniqueId(run.id, ids, "browser entry");
  return runs;
}
function store(runs: LocalRun[], storage: Pick<Storage, "setItem">) {
  const raw = JSON.stringify(runs);
  if (raw.length > MAX_STORAGE_CHARS)
    fail("browser library exceeds its supported size");
  storage.setItem(KEY, raw);
  return runs;
}
export function saveLocal(
  run: LocalRun,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): LocalRun[] {
  const checked = validateLocal(run);
  const existing = readLibrary(storage);
  const next = [checked, ...existing.filter((r) => r.id !== checked.id)];
  if (next.length > MAX_RUNS)
    throw new Error(
      "Local library holds 20 runs. Export and remove an older browser copy before saving another.",
    );
  return store(next, storage);
}
/** Explicit deletion only: no record is evicted automatically when storage is full. */
export function removeLocal(
  id: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): LocalRun[] {
  string(id, "browser entry ID", 128);
  const existing = readLibrary(storage);
  const next = existing.filter((run) => run.id !== id);
  return next.length === existing.length ? existing : store(next, storage);
}
export function downloadRun(record: ExperimentRecord) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "oxygen-dispatcher-" + record.client_run_id + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
