/** Recorded-data integration experiment. Controller receives only current samples. */
import { ValveController } from "./controller";
import type {
  ControllerConfig,
  ControllerOutput,
  EventLogEntry,
} from "./controller";

export interface RecordedSample {
  timeS: number;
  value: number | null;
  quality?: "good" | "low";
}
export interface SubjectJson {
  subjectId: string;
  description: string;
  durationS: number;
  samples?: RecordedSample[];
  spo2?: (number | null)[];
  breathTimesS?: number[];
  samplePeriodS?: number;
  sourceFiles?: string[];
  provenance?: Record<string, unknown>;
}
export interface ReplayEntry {
  id: string;
  file: string;
  breathsFile?: string;
  description?: string;
}
export interface ReplayIndex {
  subjects: ReplayEntry[];
}
export interface Recording extends SubjectJson {
  samples: RecordedSample[];
  breathTimesS: number[];
  samplePeriodS: number;
}
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
const EPS = 1e-8;
const safeFile = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]+\.json$/.test(v);
export function validateManifest(raw: unknown): ReplayIndex {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("subjects" in raw) ||
    !Array.isArray(raw.subjects) ||
    raw.subjects.length === 0 ||
    raw.subjects.length > 100
  )
    throw new Error(
      "Replay manifest must contain 1–100 recordings. Run the BIDMC converter.",
    );
  const ids = new Set<string>();
  const subjects = raw.subjects.map((e: ReplayEntry) => {
    if (
      !e ||
      typeof e.id !== "string" ||
      !e.id ||
      ids.has(e.id) ||
      !safeFile(e.file) ||
      (e.breathsFile !== undefined && !safeFile(e.breathsFile))
    )
      throw new Error(
        "Replay manifest has an invalid or duplicate recording entry.",
      );
    ids.add(e.id);
    return {
      id: e.id,
      file: e.file,
      breathsFile: e.breathsFile,
      description:
        typeof e.description === "string" ? e.description : `Subject ${e.id}`,
    };
  });
  return { subjects };
}
export function normalizeSubject(raw: SubjectJson): Recording {
  if (
    !raw ||
    typeof raw.subjectId !== "string" ||
    !raw.subjectId ||
    typeof raw.description !== "string" ||
    !finite(raw.durationS) ||
    raw.durationS <= 0 ||
    raw.durationS > 86400
  )
    throw new Error(
      "Recording requires an ID, description and finite duration between 0 and 86400 seconds.",
    );
  const samplePeriodS = raw.samplePeriodS ?? 1;
  if (!finite(samplePeriodS) || samplePeriodS <= 0 || samplePeriodS > 10)
    throw new Error("Invalid recording sample period.");
  if (raw.samples !== undefined && !Array.isArray(raw.samples))
    throw new Error("Recorded samples must be an array.");
  if (raw.spo2 !== undefined && !Array.isArray(raw.spo2))
    throw new Error("Legacy SpO₂ samples must be an array.");
  const source: RecordedSample[] =
    raw.samples ??
    (raw.spo2 ?? []).map((value, i) => ({ timeS: i * samplePeriodS, value }));
  if (source.length > 1000000)
    throw new Error("Recording exceeds the sample limit.");
  const samples = source
    .map((s) => {
      if (
        !s ||
        !finite(s.timeS) ||
        s.timeS < 0 ||
        s.timeS > raw.durationS ||
        (s.value !== null &&
          (!finite(s.value) || s.value <= 0 || s.value > 100)) ||
        (s.quality !== undefined && !["good", "low"].includes(s.quality))
      )
        throw new Error(
          "Recording contains an invalid timestamp, SpO₂ value or quality flag.",
        );
      return { timeS: s.timeS, value: s.value, quality: s.quality ?? "good" };
    })
    .sort((a, b) => a.timeS - b.timeS);
  const unique = samples.filter((s, i) => {
    if (i && s.timeS === samples[i - 1].timeS) {
      if (
        s.value !== samples[i - 1].value ||
        s.quality !== samples[i - 1].quality
      )
        throw new Error("Conflicting SpO₂ readings at the same timestamp.");
      return false;
    }
    return true;
  });
  if (raw.breathTimesS !== undefined && !Array.isArray(raw.breathTimesS))
    throw new Error("Breath annotations must be an array.");
  const times = raw.breathTimesS ?? [];
  if (
    times.length > 100000 ||
    times.some((t) => !finite(t) || t < 0 || t > raw.durationS)
  )
    throw new Error("Invalid or out-of-coverage breath annotation.");
  const breathTimesS = [...new Set(times)].sort((a, b) => a - b);
  if (!unique.length && !breathTimesS.length)
    throw new Error("Recording contains neither measurements nor annotations.");
  return structuredClone({
    ...raw,
    samples: unique,
    breathTimesS,
    samplePeriodS,
  });
}
export type MatchStatus = "pending" | "matched" | "missed" | "excluded";
export interface BreathDetectionResult {
  id: string;
  annotatedTimeS: number;
  detectedTimeS: number | null;
  latencyS: number | null;
  status: MatchStatus;
  missed: boolean;
}
export interface MatchStats {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  scoredDetections: number;
  eligibleReferences: number;
  totalEligibleReferences: number;
  pendingDetections: number;
  pendingReferences: number;
  excludedDetections: number;
  excludedReferences: number;
  avgLatencyS: number | null;
}
/** Chronological reference matching. Finalize a reference after its entire ±window
 * is observed, choose the nearest available detection (earlier wins ties), and
 * consume it once. Unmatched detections wait 2×window for all possible references.
 * Both reference and detection windows must fit inside the recording; otherwise
 * they are censored and explicitly counted, never silently marked as misses. */
export class EventMatcher {
  private refs: BreathDetectionResult[];
  private detections: {
    timeS: number;
    status: "pending" | "matched" | "false" | "excluded";
  }[] = [];
  private currentTime = 0;
  private duration: number;
  private window: number;
  constructor(references: number[], durationS: number, windowS = 0.6) {
    if (
      !finite(durationS) ||
      durationS <= 0 ||
      !finite(windowS) ||
      windowS <= 0 ||
      references.some((t) => !finite(t) || t < 0 || t > durationS)
    )
      throw new Error("Invalid event matching configuration.");
    this.duration = durationS;
    this.window = windowS;
    this.refs = [...new Set(references)]
      .sort((a, b) => a - b)
      .map((t, i) => ({
        id: `reference-${i}`,
        annotatedTimeS: t,
        detectedTimeS: null,
        latencyS: null,
        status:
          t < windowS - EPS || t > durationS - windowS + EPS
            ? "excluded"
            : "pending",
        missed: false,
      }));
  }
  detect(timeS: number) {
    if (
      !finite(timeS) ||
      timeS < this.currentTime - EPS ||
      timeS < (this.detections.at(-1)?.timeS ?? 0) - EPS ||
      timeS >= this.duration + EPS
    )
      throw new Error(
        "Detection timestamps must be ordered and inside the recording.",
      );
    this.detections.push({
      timeS,
      status:
        timeS < this.window - EPS || timeS > this.duration - this.window + EPS
          ? "excluded"
          : "pending",
    });
  }
  advance(timeS: number, final = false) {
    if (
      !finite(timeS) ||
      timeS < this.currentTime - EPS ||
      timeS < (this.detections.at(-1)?.timeS ?? 0) - EPS ||
      timeS > this.duration + EPS ||
      (final && Math.abs(timeS - this.duration) > EPS)
    )
      throw new Error("Invalid matcher clock.");
    this.currentTime = timeS;
    for (const ref of this.refs) {
      // Advancing to an endpoint has not yet observed a detection *at* that
      // endpoint; keep the inclusive right boundary pending until the next tick.
      if (
        ref.status !== "pending" ||
        (!final && timeS <= ref.annotatedTimeS + this.window + EPS)
      )
        continue;
      const options = this.detections.filter(
        (d) =>
          d.status === "pending" &&
          Math.abs(d.timeS - ref.annotatedTimeS) <= this.window + EPS,
      );
      options.sort(
        (a, b) =>
          Math.abs(a.timeS - ref.annotatedTimeS) -
            Math.abs(b.timeS - ref.annotatedTimeS) || a.timeS - b.timeS,
      );
      const found = options[0];
      if (found) {
        found.status = "matched";
        ref.status = "matched";
        ref.detectedTimeS = found.timeS;
        ref.latencyS = found.timeS - ref.annotatedTimeS;
      } else {
        ref.status = "missed";
        ref.missed = true;
      }
    }
    for (const d of this.detections)
      if (
        d.status === "pending" &&
        (final || timeS > d.timeS + 2 * this.window + EPS)
      )
        d.status = "false";
  }
  get results() {
    return this.refs
      .filter((r) => r.annotatedTimeS - this.window <= this.currentTime + EPS)
      .map((r) => ({ ...r }));
  }
  get stats(): MatchStats {
    const tp = this.refs.filter((r) => r.status === "matched");
    const fn = this.refs.filter((r) => r.status === "missed").length;
    const fp = this.detections.filter((d) => d.status === "false").length;
    return {
      truePositives: tp.length,
      falsePositives: fp,
      falseNegatives: fn,
      scoredDetections: tp.length + fp,
      eligibleReferences: tp.length + fn,
      totalEligibleReferences: this.refs.filter((r) => r.status !== "excluded")
        .length,
      pendingDetections: this.detections.filter((d) => d.status === "pending")
        .length,
      pendingReferences: this.refs.filter(
        (r) =>
          r.status === "pending" &&
          r.annotatedTimeS - this.window <= this.currentTime,
      ).length,
      excludedReferences: this.refs.filter((r) => r.status === "excluded")
        .length,
      excludedDetections: this.detections.filter((d) => d.status === "excluded")
        .length,
      avgLatencyS: tp.length
        ? tp.reduce((sum, r) => sum + r.latencyS!, 0) / tp.length
        : null,
    };
  }
}
export interface ReplaySummary {
  id: string;
  subjectId: string;
  cycle: number;
  durationS: number;
  metrics: MatchStats;
  results: BreathDetectionResult[];
}
export interface ReplaySnapshot {
  timeS: number;
  localTimeS: number;
  sampleTimeS: number;
  subjectId: string;
  cycle: number;
  done: boolean;
  subjectComplete: boolean;
  spo2: number | null;
  pressure: number;
  valveOpen: boolean;
  flowSetpoint: number;
  ctrlOutput: ControllerOutput;
  breathResults: BreathDetectionResult[];
  detectedCount: number;
  missedCount: number;
  falsePositiveCount: number;
  avgLatencyS: number | null;
  metrics: MatchStats;
  eventLog: ReadonlyArray<EventLogEntry>;
  completed: ReplaySummary[];
  cumulative: {
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    recordings: number;
  };
}
export class ReplayRunner {
  private subjects: Recording[];
  private ctrlCfg: ControllerConfig;
  private ctrl: ValveController;
  private matcher: EventMatcher;
  private index = 0;
  private tickIndex = 0;
  private globalStart = 0;
  private cycle = 1;
  private boundary = false;
  private looping: boolean;
  private sampleIndex = 0;
  private lastSnapshot: ReplaySnapshot | null = null;
  private summaries: ReplaySummary[] = [];
  private totals = {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    recordings: 0,
  };
  constructor(
    subjects: SubjectJson[],
    ctrlCfg: ControllerConfig,
    options: { loop?: boolean } = {},
  ) {
    if (!subjects.length) throw new Error("No recordings are available.");
    this.subjects = subjects.map(normalizeSubject);
    this.ctrlCfg = structuredClone(ctrlCfg);
    this.looping = options.loop ?? false;
    this.ctrl = new ValveController(this.ctrlCfg);
    this.matcher = new EventMatcher(
      this.subjects[0].breathTimesS,
      this.subjects[0].durationS,
    );
  }
  acknowledge(id: string): ReplaySnapshot | null {
    this.ctrl.acknowledge(id);
    if (this.lastSnapshot)
      this.lastSnapshot = {
        ...this.lastSnapshot,
        ctrlOutput: {
          ...this.lastSnapshot.ctrlOutput,
          alarms: this.ctrl.alarms,
        },
        eventLog: this.ctrl.eventLog,
      };
    return this.lastSnapshot;
  }
  private nextSubject() {
    this.globalStart += this.subjects[this.index].durationS;
    this.index++;
    if (this.index === this.subjects.length) {
      this.index = 0;
      this.cycle++;
    }
    this.tickIndex = 0;
    this.sampleIndex = 0;
    this.boundary = false;
    this.ctrl = new ValveController(this.ctrlCfg);
    this.matcher = new EventMatcher(
      this.subjects[this.index].breathTimesS,
      this.subjects[this.index].durationS,
    );
  }
  step(): ReplaySnapshot {
    if (this.lastSnapshot?.done) return structuredClone(this.lastSnapshot);
    if (this.boundary) this.nextSubject();
    const subject = this.subjects[this.index];
    const t = this.tickIndex / 10;
    const dtS = Math.min(0.1, subject.durationS - t);
    const end = Math.min(subject.durationS, (this.tickIndex + 1) / 10);
    while (
      this.sampleIndex + 1 < subject.samples.length &&
      subject.samples[this.sampleIndex + 1].timeS <= t + EPS
    )
      this.sampleIndex++;
    const sample = subject.samples[this.sampleIndex];
    const available =
      sample &&
      sample.timeS <= t + EPS &&
      t < sample.timeS + subject.samplePeriodS - EPS;
    const spo2 = available ? sample.value : null;
    // Annotation-derived pressure is only an integration fixture, never a measured signal.
    const inhale = subject.breathTimesS.some(
      (peak) => t >= peak - 0.4 && t < peak - 0.05,
    );
    const noise =
      ((((this.tickIndex + 1) * 1664525 + 1013904223) >>> 0) / 4294967296 -
        0.5) *
      0.15;
    const pressure = (inhale ? -2.5 : 0.4) + noise;
    const out = this.ctrl.tick(pressure, spo2, t, {
      dtS,
      spo2TimestampS: available ? sample.timeS : t,
      spo2Quality: available ? sample.quality : "good",
      pressureTimestampS: t,
    });
    if (out.breathDetected && subject.breathTimesS.length)
      this.matcher.detect(t);
    this.tickIndex++;
    const subjectComplete = end >= subject.durationS - EPS;
    this.matcher.advance(end, subjectComplete);
    const metrics = this.matcher.stats;
    const done =
      subjectComplete &&
      this.index === this.subjects.length - 1 &&
      !this.looping;
    if (subjectComplete) {
      this.summaries.push({
        id: `${subject.subjectId}-${this.cycle}-${this.index}`,
        subjectId: subject.subjectId,
        cycle: this.cycle,
        durationS: subject.durationS,
        metrics,
        results: this.matcher.results,
      });
      if (this.summaries.length > 50) this.summaries.shift();
      this.totals.truePositives += metrics.truePositives;
      this.totals.falsePositives += metrics.falsePositives;
      this.totals.falseNegatives += metrics.falseNegatives;
      this.totals.recordings++;
      this.boundary = true;
    }
    const snapshot: ReplaySnapshot = {
      timeS: this.globalStart + end,
      localTimeS: end,
      sampleTimeS: t,
      subjectId: subject.subjectId,
      cycle: this.cycle,
      done,
      subjectComplete,
      spo2,
      pressure,
      valveOpen: out.valveOpen,
      flowSetpoint: out.flowSetpoint,
      ctrlOutput: out,
      breathResults: this.matcher.results,
      detectedCount: metrics.truePositives,
      missedCount: metrics.falseNegatives,
      falsePositiveCount: metrics.falsePositives,
      avgLatencyS: metrics.avgLatencyS,
      metrics,
      eventLog: this.ctrl.eventLog.map((e) => ({ ...e })),
      completed: this.summaries.map((s) => ({ ...s })),
      cumulative: { ...this.totals },
    };
    this.lastSnapshot = snapshot;
    return snapshot;
  }
  get timeS() {
    return this.lastSnapshot?.timeS ?? 0;
  }
}
