import { describe, it, expect } from "vitest";
import {
  ExperimentEngine,
  DEFAULT_EXPERIMENT_CONFIG,
  SimulationClock,
  oxygenReductionPct,
} from "../engine";
import type { ExperimentConfig } from "../engine";
import { PatientSimulator } from "../patient";
import {
  ValveController,
  SpO2Window,
  measurementValidity,
} from "../controller";
import { runComparison } from "../compare";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const config = (
  overrides: Partial<ExperimentConfig> = {},
): ExperimentConfig => ({
  ...DEFAULT_EXPERIMENT_CONFIG,
  durationS: 60,
  ...overrides,
});
const controller = {
  prescribedMaxFlow: 5,
  initialFlow: 5,
  spo2Target: "standard" as const,
};
const sample = {
  pressure: -2.5,
  isInhaling: true,
  noise: 0,
  need: 5,
  breathRate: 20,
};
describe("dose integration and interval accounting", () => {
  it("counts physical volume without physiological utilization", () => {
    for (const utilization of [0, 0.25, 1]) {
      const p = new PatientSimulator(utilization);
      let volume = 0;
      for (let i = 0; i < 600; i++)
        volume += p.advance(5, sample, 0.1).sourceVolumeL;
      expect(volume).toBeCloseTo(5, 10);
    }
  });
  it("longer equal-rate pulse produces greater dose and response", () => {
    const short = new PatientSimulator(),
      long = new PatientSimulator();
    let shortDose = 0,
      longDose = 0;
    for (let i = 0; i < 100; i++) {
      shortDose += short.advance(i < 1 ? 5 : 0, sample, 0.1).usefulVolumeL;
      longDose += long.advance(i < 8 ? 5 : 0, sample, 0.1).usefulVolumeL;
    }
    expect(longDose).toBeCloseTo(shortDose * 8);
    expect(long.spo2).toBeGreaterThan(short.spo2);
  });
  it("uses exactly requested final partial interval", () => {
    const e = new ExperimentEngine(config({ durationS: 1.25 }));
    e.advanceTicks(100);
    expect(e.timeS).toBe(1.25);
    expect(e.snapshot().oxygenA).toBeCloseTo((5 * 1.25) / 60, 12);
    e.step();
    expect(e.timeS).toBe(1.25);
  });
  it("accepts any positive final remainder, including one smaller than machine epsilon", () => {
    for (const durationS of [0.10000000000000003, 0.0000000000000001]) {
      const e = new ExperimentEngine(config({ durationS }));
      e.advanceTicks(4);
      expect(e.timeS).toBe(durationS);
      expect(e.done).toBe(true);
      const expected = (5 * durationS) / 60;
      const actual = e.snapshot().oxygenA;
      expect(actual).toBeGreaterThan(0);
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
        Number.EPSILON * expected * 4,
      );
    }
  });
  it("zero duration and zero baseline produce undefined comparisons", () => {
    const e = new ExperimentEngine(config({ durationS: 0 }));
    expect(e.done).toBe(true);
    expect(e.snapshot().oxygenSavedPct).toBeNull();
    expect(e.snapshot().armA.validCoveragePct).toBeNull();
    expect(oxygenReductionPct(0, 5)).toBeNull();
    expect(oxygenReductionPct(5, 6)).toBeCloseTo(-20);
  });
  it("does not label continuous startup volume as a pulse", () => {
    const e = new ExperimentEngine(config());
    e.advanceTicks(20);
    expect(e.snapshot().oxygenB).toBeGreaterThan(0);
    expect(e.snapshot().pulseVolumeMl).toBe(0);
  });
  it("preserves negative savings for higher controlled consumption", () => {
    const e = new ExperimentEngine(config({ continuousFlow: 1, durationS: 1 }));
    e.advanceTicks(20);
    expect(e.snapshot().oxygenSavedPct).toBeCloseTo(-400);
  });
  it("keeps extreme but representable reductions and marks overflow unavailable", () => {
    expect(oxygenReductionPct(Number.MIN_VALUE, 1)).toBeNull();
    expect(oxygenReductionPct(1e-300, 1)! / 1e302).toBeCloseTo(-1, 12);
    expect(oxygenReductionPct(Number.MIN_VALUE, 0)).toBe(100);
  });
  it("metrics partition all elapsed time including missing and low quality", () => {
    const e = new ExperimentEngine(config());
    e.injectFault("spo2_loss", 10);
    e.advanceTicks(200);
    e.injectFault("motion", 5);
    e.advanceTicks(1000);
    for (const arm of [e.snapshot().armA, e.snapshot().armB])
      expect(
        arm.belowRangeS +
          arm.inRangeS +
          arm.aboveRangeS +
          arm.missingS +
          arm.invalidS +
          arm.staleS +
          arm.lowQualityS,
      ).toBeCloseTo(60, 8);
    expect(e.snapshot().armA.missingS).toBeCloseTo(10);
    expect(e.snapshot().armB.lowQualityS).toBeCloseTo(5);
  });
});
describe("determinism, configuration and scheduling", () => {
  it("reproduces an exported fault experiment through the command-line entry point", () => {
    const e = new ExperimentEngine(config({ durationS: 1.25 }));
    e.injectFault("spo2_loss", 0.5);
    e.advanceTicks(20);
    const folder = mkdtempSync(path.join(tmpdir(), "oxygen-reproduction-"));
    const input = path.join(folder, "original.json"),
      output = path.join(folder, "recomputed.json");
    try {
      const record = e.exportRun();
      // JSON object field order is not scientific evidence and may change
      // when a record passes through a database or another serializer.
      record.summary = Object.fromEntries(
        Object.entries(record.summary).reverse(),
      ) as typeof record.summary;
      writeFileSync(input, JSON.stringify(record));
      const result = execFileSync(
        process.execPath,
        ["scripts/reproduce-run.mjs", input, output],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(result).toContain("match exactly");
      expect(JSON.parse(readFileSync(output, "utf8")).summary).toEqual(
        e.exportRun().summary,
      );
    } finally {
      for (const file of [input, output]) {
        try {
          unlinkSync(file);
        } catch {
          /* A failed CLI may not create its output. */
        }
      }
      rmdirSync(folder);
    }
  }, 10000);
  it("reproduction refuses to replace its source or an existing evidence file", () => {
    const e = new ExperimentEngine(config({ durationS: 0.1 }));
    e.step();
    const folder = mkdtempSync(path.join(tmpdir(), "oxygen-evidence-"));
    const input = path.join(folder, "original.json"),
      output = path.join(folder, "existing.json");
    const original = JSON.stringify(e.exportRun());
    try {
      writeFileSync(input, original);
      writeFileSync(output, "existing evidence");
      for (const destination of [input, output]) {
        const result = spawnSync(
          process.execPath,
          ["scripts/reproduce-run.mjs", input, destination],
          { cwd: process.cwd(), encoding: "utf8" },
        );
        expect(result.status).toBe(1);
        expect(readFileSync(input, "utf8")).toBe(original);
        expect(readFileSync(output, "utf8")).toBe("existing evidence");
      }
    } finally {
      unlinkSync(input);
      unlinkSync(output);
      rmdirSync(folder);
    }
  }, 10000);
  it("reproduces very short experiments without rounding their duration to zero", () => {
    const e = new ExperimentEngine(config({ durationS: 0.0000000000000001 }));
    e.step();
    const folder = mkdtempSync(
      path.join(tmpdir(), "oxygen-short-reproduction-"),
    );
    const input = path.join(folder, "original.json"),
      output = path.join(folder, "recomputed.json");
    try {
      writeFileSync(input, JSON.stringify(e.exportRun()));
      const result = execFileSync(
        process.execPath,
        ["scripts/reproduce-run.mjs", input, output],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(result).toContain("match exactly");
      expect(JSON.parse(readFileSync(output, "utf8")).summary).toEqual(
        e.exportRun().summary,
      );
    } finally {
      for (const file of [input, output]) {
        try {
          unlinkSync(file);
        } catch {
          /* The output may not exist if execution failed. */
        }
      }
      rmdirSync(folder);
    }
  }, 10000);
  it("reproduction rejects unsupported controller provenance before writing output", () => {
    const e = new ExperimentEngine(config({ durationS: 0 }));
    const record = e.exportRun();
    record.provenance.controllerVersion = "unsupported-controller";
    const folder = mkdtempSync(path.join(tmpdir(), "oxygen-provenance-"));
    const input = path.join(folder, "original.json"),
      output = path.join(folder, "result.json");
    try {
      writeFileSync(input, JSON.stringify(record));
      const result = spawnSync(
        process.execPath,
        ["scripts/reproduce-run.mjs", input, output],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "current synthetic model, controller and schema",
      );
      expect(() => readFileSync(output)).toThrow();
    } finally {
      unlinkSync(input);
      rmdirSync(folder);
    }
  }, 10000);
  it("rejects malformed fault schedules and keeps subsequently injected identifiers unique", () => {
    const fault = {
      id: "fault-2",
      kind: "spo2_loss" as const,
      startS: 0,
      endS: 1,
    };
    for (const faults of [
      [{ ...fault, endS: 0 }],
      [{ ...fault, endS: 61 }],
      [{ ...fault, startS: NaN }],
      [{ ...fault, id: "" }],
      [fault, fault],
    ])
      expect(
        () => new ExperimentEngine(config(), crypto.randomUUID(), faults),
      ).toThrow();
    const e = new ExperimentEngine(config(), crypto.randomUUID(), [fault]);
    e.injectFault("motion", 2);
    expect(new Set(e.snapshot().faults.map((f) => f.id)).size).toBe(2);
  });
  it("batch and arbitrary UI-sized batches agree exactly", () => {
    const c = config({ durationS: 300 });
    const batch = runComparison(c);
    const live = new ExperimentEngine(c);
    for (const n of [1, 17, 250, 9, 100, 1000, 4000]) live.advanceTicks(n);
    expect(live.exportRun().summary).toEqual({
      armA: batch.armA,
      armB: batch.armB,
      oxygenSavedPct: batch.oxygenSavedPct,
      simDurationS: batch.simDurationS,
    });
    expect(live.exportRun().series).toEqual(batch.series);
  });
  it("clock tracks elapsed time and speed, with no hidden/suspended catchup", () => {
    const e = new ExperimentEngine(config());
    const clock = new SimulationClock();
    clock.accrue(0, 1);
    clock.accrue(500, 2);
    clock.drain(e);
    expect(e.timeS).toBe(1);
    clock.accrue(3000, 2);
    clock.drain(e);
    expect(e.timeS).toBe(1);
    clock.reset(e.timeS);
    clock.accrue(4000, 10);
    clock.accrue(4500, 10);
    clock.drain(e);
    expect(e.timeS).toBe(6);
  });
  it("paused/resumed accelerated ticks preserve batch results", () => {
    const e = new ExperimentEngine(config({ durationS: 10 })),
      clock = new SimulationClock();
    clock.accrue(0, 10);
    clock.accrue(500, 10);
    clock.drain(e);
    clock.reset(e.timeS);
    clock.accrue(9000, 5);
    clock.accrue(10000, 5);
    clock.drain(e);
    const batch = new ExperimentEngine(config({ durationS: 10 }));
    batch.advanceTicks(100);
    expect(e.exportRun().summary).toEqual(batch.exportRun().summary);
  });
  it("captures frozen config, rejects invalid values and starts fresh", () => {
    const c = config();
    const e = new ExperimentEngine(c);
    c.continuousFlow = 20;
    c.controller = { ...controller, initialFlow: 4 };
    expect(e.config.continuousFlow).toBe(5);
    expect(Object.isFrozen(e.config.controller)).toBe(true);
    expect(() => new ExperimentEngine(config({ durationS: NaN }))).toThrow();
    expect(
      () => new ValveController({ ...controller, initialFlow: 8 }),
    ).toThrow();
    expect(
      () => new ValveController({ ...controller, minimumFlow: 6 }),
    ).toThrow();
    expect(
      () =>
        new ValveController({ ...controller, targetLow: 98, targetHigh: 92 }),
    ).toThrow();
    expect(new ExperimentEngine(config()).snapshot().oxygenA).toBe(0);
  });
  it("recorded fault schedule reproduces all aggregate outcomes", () => {
    const e = new ExperimentEngine(config());
    e.advanceTicks(100);
    e.injectFault("spo2_loss", 20);
    e.advanceTicks(1000);
    const record = e.exportRun();
    const repeat = new ExperimentEngine(
      record.config,
      crypto.randomUUID(),
      record.faults,
    );
    repeat.advanceTicks(1000);
    expect(repeat.exportRun().summary).toEqual(record.summary);
  });
  it("full 12-hour scenarios finish exactly and preserve whole-run chart context", () => {
    for (const scenario of [
      "recovering",
      "worsening",
      "sensor_fault",
    ] as const) {
      const e = new ExperimentEngine(config({ scenario, durationS: 43200 }));
      e.advanceTicks(432000);
      const s = e.snapshot();
      expect(s.timeS).toBe(43200);
      expect(s.oxygenA).toBeCloseTo(3600, 6);
      expect(s.series[0].timeS).toBe(0);
      expect(s.series.at(-1)!.timeS).toBe(43200);
      expect(s.series.length).toBeLessThanOrEqual(5000);
      expect(s.armA.validCoveragePct!).toBeLessThanOrEqual(100);
      expect(s.armB.validCoveragePct!).toBeLessThanOrEqual(100);
      if (scenario === "sensor_fault") {
        expect(s.armA.missingS).toBeCloseTo(120, 6);
        expect(s.armB.lowQualityS).toBeCloseTo(90, 6);
        expect(s.alarms.some((a) => a.resolvedS !== null)).toBe(true);
      }
    }
  }, 20000);
});
describe("sensor and controller invariants", () => {
  it("does not replace explicit invalid sensor timestamps with the current time", () => {
    for (const key of ["pressureTimestampS", "spo2TimestampS"] as const) {
      for (const timestamp of [null, NaN, Infinity, -1, 1]) {
        const c = new ValveController(controller);
        const result = c.tick(0.4, 95, 0, {
          [key]: timestamp as unknown as number,
        });
        expect(
          result[
            key === "pressureTimestampS" ? "pressureValidity" : "spo2Validity"
          ],
        ).toBe("invalid");
        expect(result.mode).toBe("sensor_fallback");
        expect(result.valveOpen).toBe(true);
        expect(result.flowSetpoint).toBe(5);
      }
    }
    const current = new ValveController(controller).tick(0.4, 95, 0);
    expect(current.pressureValidity).toBe("valid");
    expect(current.spo2Validity).toBe("valid");
  });
  it("rejects an explicit malformed interval rather than supplying a default", () => {
    const c = new ValveController(controller);
    expect(() =>
      c.tick(0.4, 95, 0, { dtS: null as unknown as number }),
    ).toThrow();
    expect(c.tick(0.4, 95, 0).mode).toBe("warming_up");
  });
  it("classifies invalid, missing, stale and low-quality data", () => {
    expect(measurementValidity(null, 0, 0, 0, 100, 2)).toBe("missing");
    for (const v of [NaN, Infinity, 101, -1])
      expect(measurementValidity(v, 0, 0, 0, 100, 2)).toBe("invalid");
    expect(measurementValidity(95, 0, 3, 0, 100, 2)).toBe("stale");
    expect(measurementValidity(95, 1, 0, 0, 100, 2)).toBe("invalid");
    expect(measurementValidity(95, 0, 0, 0, 100, 2, "low")).toBe("low_quality");
  });
  it("expires old readings through missing intervals", () => {
    const w = new SpO2Window();
    w.add(0, 1, 99);
    expect(w.summarize(1, 3).coverage).toBeCloseTo(1 / 3);
    expect(w.summarize(5, 3).average).toBeNull();
  });
  it("does not retrigger until exhalation after maximum-open closure", () => {
    const c = new ValveController({
      ...controller,
      warmupS: 0.1,
      noBreathS: 100,
    });
    c.tick(0.4, 95, 0);
    let detections = 0,
      openS = 0;
    for (let i = 1; i < 51; i++) {
      const o = c.tick(-2.5, 95, i * 0.1);
      if (o.breathDetected) detections++;
      if (o.mode === "breath_sync" && o.valveOpen) openS += 0.1;
    }
    expect(detections).toBe(1);
    expect(openS).toBeCloseTo(0.8);
    c.tick(0.4, 95, 5.1);
    c.tick(-2.5, 95, 5.2);
    expect(c.tick(-2.5, 95, 5.3).breathDetected).toBe(true);
  });
  it("invalid measurements select continuous configured fallback, never reduce need", () => {
    const c = new ValveController({
      ...controller,
      initialFlow: 2,
      fallbackFlow: 4,
    });
    const o = c.tick(NaN, 95, 0);
    expect(o.mode).toBe("sensor_fallback");
    expect(o.valveOpen).toBe(true);
    expect(o.flowSetpoint).toBe(4);
  });
  it("critical precedence waits for completed intervals and invalid data resets its timer", () => {
    const c = new ValveController({
      ...controller,
      criticalDurationS: 1,
      warmupS: 0.1,
    });
    let o;
    for (let i = 0; i < 10; i++) o = c.tick(0.4, 85, i * 0.1);
    expect(o!.mode).not.toBe("critical_fallback");
    o = c.tick(0.4, 85, 1);
    expect(o.mode).toBe("critical_fallback");
    expect(o.valveOpen).toBe(true);
    expect(o.flowSetpoint).toBe(5);
    o = c.tick(0.4, null, 1.1);
    expect(o.mode).toBe("sensor_fallback");
    expect(c.tick(0.4, 85, 1.2).mode).not.toBe("critical_fallback");
  });
  it("alarms persist, acknowledgement does not resolve and counts are episodes", () => {
    const c = new ValveController({ ...controller, sensorWarningS: 0.2 });
    for (let i = 0; i < 20; i++) c.tick(0.4, null, i * 0.1);
    expect(c.alarmStats.alarmEpisodes).toBe(1);
    const id = c.alarms[0].id;
    c.acknowledge(id);
    expect(c.alarms[0]).toMatchObject({ active: true, acknowledged: true });
    c.tick(0.4, 95, 2);
    expect(c.alarms[0]).toMatchObject({
      active: false,
      acknowledged: true,
      resolvedS: 2,
    });
    expect(c.alarmStats.alarmEpisodes).toBe(1);
  });
  it("rejects nonmonotonic, overlapping and skipped intervals rather than inventing readings", () => {
    const c = new ValveController(controller);
    c.tick(0.4, 95, 0);
    expect(() => c.tick(0.4, 95, 0)).toThrow();
    expect(() => c.tick(0.4, 95, Infinity)).toThrow();
    expect(() => c.tick(0.4, 95, 0.05)).toThrow();
    expect(() => c.tick(0.4, 95, 1)).toThrow();
    expect(c.tick(0.4, 95, 0.1).mode).toBe("warming_up");
  });
  it("no-breath fallback actually delivers continuously and recovers on a new eligible breath", () => {
    const c = new ValveController({
      ...controller,
      warmupS: 0.1,
      noBreathS: 1,
    });
    let o;
    for (let i = 0; i < 15; i++) o = c.tick(0.4, 95, i * 0.1);
    expect(o!.mode).toBe("no_breath_fallback");
    expect(o!.valveOpen).toBe(true);
    c.tick(-2.5, 95, 1.5);
    o = c.tick(-2.5, 95, 1.6);
    expect(o.mode).toBe("breath_sync");
    expect(o.breathDetected).toBe(true);
  });
  it("sensor recovery requires a full valid-data interval and old averages cannot cause an immediate wean", () => {
    const c = new ValveController({
      ...controller,
      warmupS: 0.1,
      recoveryS: 1,
      averageWindowS: 1,
      adjustmentIntervalS: 1,
    });
    c.tick(0.4, null, 0);
    let o;
    for (let i = 1; i < 10; i++) o = c.tick(0.4, 99, i * 0.1);
    expect(o!.mode).toBe("sensor_fallback");
    expect(o!.flowSetpoint).toBe(5);
    expect(c.tick(0.4, 99, 1).mode).toBe("sensor_fallback");
    o = c.tick(0.4, 99, 1.1);
    expect(o.mode).toBe("breath_sync");
    expect(o.flowSetpoint).toBe(5);
  });
  it("preserves sensor recovery requirements when a critical mode temporarily overrides them", () => {
    const c = new ValveController({
      ...controller,
      criticalDurationS: 0.2,
      recoveryS: 1,
      warmupS: 0.1,
    });
    c.tick(null, 85, 0);
    c.tick(null, 85, 0.1);
    expect(c.tick(null, 85, 0.2).mode).toBe("critical_fallback");
    expect(c.tick(0.4, 95, 0.3).mode).toBe("sensor_fallback");
    for (let i = 4; i < 13; i++)
      expect(c.tick(0.4, 95, i * 0.1).mode).toBe("sensor_fallback");
    expect(c.tick(0.4, 95, 1.3).mode).toBe("breath_sync");
  });
  it("stale non-null measurements invoke continuous fallback and do not wean flow", () => {
    const c = new ValveController({
      ...controller,
      warmupS: 0.1,
      averageWindowS: 1,
      adjustmentIntervalS: 0.1,
      maxSensorAgeS: 0.1,
    });
    c.tick(0.4, 99, 0);
    c.tick(0.4, 99, 0.1);
    const output = c.tick(0.4, 99, 0.2, { spo2TimestampS: 0 });
    expect(output.spo2Validity).toBe("stale");
    expect(output.mode).toBe("sensor_fallback");
    expect(output.valveOpen).toBe(true);
    expect(output.flowSetpoint).toBe(5);
  });
  it("does not treat a short high-valued window as sufficient coverage for weaning", () => {
    const c = new ValveController({
      ...controller,
      warmupS: 0.1,
      averageWindowS: 10,
      adjustmentIntervalS: 0.2,
      minimumCoverage: 0.8,
      noBreathS: 100,
    });
    for (let i = 0; i < 50; i++)
      c.tick(i % 10 < 3 && i > 0 ? -2.5 : 0.4, 99, i * 0.1);
    expect(c.flowSetpoint).toBe(5);
    for (let i = 50; i < 90; i++) c.tick(i % 10 < 3 ? -2.5 : 0.4, 99, i * 0.1);
    expect(c.flowSetpoint).toBeLessThan(5);
  });
});
