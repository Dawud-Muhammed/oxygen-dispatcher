import { describe, it, expect, vi } from "vitest";
import {
  readLibrary,
  saveLocal,
  removeLocal,
  validateExperimentRecord,
} from "./library";
import type { LocalRun } from "./library";
import { ExperimentEngine, DEFAULT_EXPERIMENT_CONFIG } from "./sim/engine";

function saved(id = "test-run", durationS = 1): LocalRun {
  const engine = new ExperimentEngine(
    { ...DEFAULT_EXPERIMENT_CONFIG, durationS },
    id,
  );
  engine.advanceTicks(Math.ceil(durationS * 10));
  return {
    id,
    createdAt: "2026-11-04T00:00:00.000Z",
    record: engine.exportRun(),
    snapshot: engine.snapshot(),
  };
}
function memory(initial: string | null = null) {
  let raw = initial;
  return {
    getItem: () => raw,
    setItem: vi.fn((_key: string, value: string) => {
      raw = value;
    }),
    raw: () => raw,
  };
}
describe("browser library preservation", () => {
  it("saves idempotently and reopens the complete original context", () => {
    const storage = memory();
    const run = saved();
    saveLocal(run, storage);
    saveLocal(run, storage);
    const loaded = readLibrary(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(run);
    expect(loaded[0].record.series[0].timeS).toBe(0);
    expect(loaded[0].record.series.at(-1)?.timeS).toBe(1);
  });
  it.each([
    "{broken",
    "{}",
    "[null]",
    '[{"id":"x","record":{"provenance":{"schemaVersion":2}},"snapshot":{"armA":{},"armB":{}}}]',
  ])("preserves malformed storage unchanged: %s", (raw) => {
    const storage = memory(raw);
    expect(() => readLibrary(storage)).toThrow(/retained/);
    expect(() => saveLocal(saved(), storage)).toThrow(/retained/);
    expect(() => removeLocal("x", storage)).toThrow(/retained/);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.raw()).toBe(raw);
  });
  it("never evicts the oldest run at capacity; explicit removal makes space", () => {
    const storage = memory();
    for (let i = 0; i < 20; i++) saveLocal(saved(`run-${i}`), storage);
    const before = storage.raw();
    expect(() => saveLocal(saved("extra"), storage)).toThrow(/20 runs/);
    expect(storage.raw()).toBe(before);
    expect(removeLocal("run-7", storage)).toHaveLength(19);
    saveLocal(saved("extra"), storage);
    expect(readLibrary(storage).map((r) => r.id)).toEqual([
      "extra",
      ...Array.from({ length: 20 }, (_, i) => `run-${19 - i}`).filter(
        (id) => id !== "run-7",
      ),
    ]);
  });
  it("does not write for an absent remove target or discard records when storage is full", () => {
    const run = saved();
    const storage = memory(JSON.stringify([run]));
    expect(removeLocal("absent", storage)).toEqual([run]);
    expect(storage.setItem).not.toHaveBeenCalled();
    storage.setItem.mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    expect(() => saveLocal(saved("other"), storage)).toThrow(/Quota/);
    expect(readLibrary(storage)).toEqual([run]);
  });
  it("rejects duplicate IDs, bad timestamps, stale snapshots and malformed incoming runs without writes", () => {
    const run = saved();
    expect(() => readLibrary(memory(JSON.stringify([run, run])))).toThrow(
      /unique/,
    );
    for (const mutate of [
      (r: LocalRun) => {
        r.createdAt = "invalid";
      },
      (r: LocalRun) => {
        r.snapshot.timeS = 0;
      },
      (r: LocalRun) => {
        r.snapshot.series = [];
      },
      (r: LocalRun) => {
        r.record.summary.armA.validS = NaN;
      },
    ]) {
      const changed = structuredClone(run);
      mutate(changed);
      const storage = memory();
      expect(() => saveLocal(changed, storage)).toThrow();
      expect(storage.setItem).not.toHaveBeenCalled();
    }
  });
});
describe("record rendering boundary", () => {
  it("accepts current zero-duration, fractional and faulted engine records", () => {
    expect(
      validateExperimentRecord(saved("zero", 0).record).summary.oxygenSavedPct,
    ).toBeNull();
    expect(
      validateExperimentRecord(saved("fractional", 0.25).record).summary
        .simDurationS,
    ).toBe(0.25);
    const engine = new ExperimentEngine({
      ...DEFAULT_EXPERIMENT_CONFIG,
      durationS: 10,
    });
    engine.injectFault("spo2_loss", 3);
    engine.advanceTicks(100);
    const record = engine.exportRun();
    expect(record.alarms.length).toBeGreaterThan(0);
    expect(validateExperimentRecord(record)).toEqual(record);
  });
  it("can save the complete 12-hour scheduled-fault experiment without losing endpoints or alarm history", () => {
    const engine = new ExperimentEngine({
      ...DEFAULT_EXPERIMENT_CONFIG,
      scenario: "sensor_fault",
    });
    engine.advanceTicks(432000);
    const record = engine.exportRun();
    const storage = memory();
    saveLocal(
      {
        id: engine.runId,
        createdAt: "2026-11-04T00:00:00.000Z",
        record,
        snapshot: engine.snapshot(),
      },
      storage,
    );
    const loaded = readLibrary(storage)[0].record;
    expect(loaded.summary).toEqual(record.summary);
    expect(loaded.series.at(-1)?.timeS).toBe(43200);
    expect(loaded.alarms).toEqual(record.alarms);
    expect(loaded.faults).toHaveLength(2);
  });
  it("rejects inconsistent duration, flow, coverage, schema and reduction before rendering", () => {
    const mutations = [
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.config.controller.prescribedMaxFlow = -1;
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.scenario = "worsening";
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.provenance.schemaVersion = "1";
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.provenance.modelVersion = "unknown-model";
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.provenance.controllerVersion = "unknown-controller";
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.summary.armA.validS += 0.1;
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.summary.armA.validCoveragePct = null;
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.summary.armA.totalOxygenL *= 0.5;
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.summary.oxygenSavedPct = 99;
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.summary.simDurationS = 10;
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.series[0].actualFlowB = 1;
      },
      (r: ReturnType<ExperimentEngine["exportRun"]>) => {
        r.series[0].spo2A = Infinity;
      },
    ];
    for (const mutate of mutations) {
      const run = structuredClone(saved().record);
      mutate(run);
      expect(() => validateExperimentRecord(run)).toThrow(/compatible/);
    }
  });
  it("rejects missing, oversized or unordered histories and duplicated stable IDs", () => {
    const base = saved().record;
    for (const field of ["series", "event_log", "faults", "alarms"]) {
      const value = { ...base, [field]: null };
      expect(() => validateExperimentRecord(value)).toThrow();
    }
    expect(() =>
      validateExperimentRecord({
        ...base,
        series: Array(5001).fill(base.series[0]),
      }),
    ).toThrow(/size/);
    expect(() =>
      validateExperimentRecord({ ...base, series: [...base.series].reverse() }),
    ).toThrow(/increase/);
    expect(() => validateExperimentRecord({ ...base, series: [] })).toThrow(
      /start/,
    );
    const event = { id: "event-1", code: "TEST", message: "Test", timeS: 0.5 };
    expect(() =>
      validateExperimentRecord({ ...base, event_log: [event, event] }),
    ).toThrow(/unique/);
    expect(() =>
      validateExperimentRecord({
        ...base,
        event_log: [{ ...event, timeS: 2 }],
      }),
    ).toThrow(/event time/);
  });
  it("rejects out-of-range faults and contradictory alarm states", () => {
    const base = saved().record;
    expect(() =>
      validateExperimentRecord({
        ...base,
        faults: [{ id: "f", kind: "spo2_loss", startS: 0, endS: 100 }],
      }),
    ).toThrow(/fault end/);
    expect(() =>
      validateExperimentRecord({
        ...base,
        faults: [{ id: "f", kind: "spo2_loss", startS: 0, endS: 0 }],
      }),
    ).toThrow(/fault end/);
    const engine = new ExperimentEngine({
      ...DEFAULT_EXPERIMENT_CONFIG,
      durationS: 4,
    });
    engine.injectFault("pressure_loss", 4);
    engine.advanceTicks(40);
    const record = engine.exportRun();
    expect(record.alarms.length).toBeGreaterThan(0);
    record.alarms[0].active = false;
    expect(() => validateExperimentRecord(record)).toThrow(
      /activity and resolution/,
    );
  });
});
