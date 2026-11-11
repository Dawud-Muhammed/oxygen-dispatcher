import { describe, expect, it } from "vitest";
import {
  EventMatcher,
  normalizeSubject,
  ReplayRunner,
  validateManifest,
} from "../replay";
import type { SubjectJson } from "../replay";
import main04 from "../../../public/replay/subject_04.json";
import breaths04 from "../../../public/replay/subject_04_breaths.json";
import index from "../../../public/replay/index.json";
import {
  parseCsv,
  convertNumerics,
  convertBreaths,
} from "../../../scripts/convert-bidmc.mjs";
const ctrlCfg = {
  prescribedMaxFlow: 5,
  initialFlow: 5,
  spo2Target: "standard" as const,
};
const subject = (id: string, durationS = 3): SubjectJson => ({
  subjectId: id,
  description: "test",
  durationS,
  samples: [{ timeS: 0, value: 95 }],
  breathTimesS: [1.5],
  samplePeriodS: 1,
});
function invariants(m: EventMatcher) {
  const s = m.stats;
  expect(s.truePositives + s.falsePositives).toBe(s.scoredDetections);
  expect(s.truePositives + s.falseNegatives).toBe(s.eligibleReferences);
}
describe("Replay one-to-one matching", () => {
  it("one detection cannot match two references or also become a false positive", () => {
    const m = new EventMatcher([2, 2.2], 5);
    m.detect(2.1);
    m.advance(5, true);
    expect(m.stats).toMatchObject({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 1,
      scoredDetections: 1,
      eligibleReferences: 2,
    });
    invariants(m);
  });
  it("duplicate detections consume a reference only once", () => {
    const m = new EventMatcher([2], 5);
    m.detect(1.8);
    m.detect(2.1);
    m.advance(5, true);
    expect(m.stats).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 0,
    });
    expect(m.results[0].detectedTimeS).toBe(2.1);
    invariants(m);
  });
  it("keeps observations pending until full windows have closed", () => {
    const m = new EventMatcher([2], 5);
    m.detect(1.7);
    m.advance(2.4);
    expect(m.stats).toMatchObject({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      pendingDetections: 1,
      pendingReferences: 1,
    });
    m.advance(2.7);
    expect(m.stats.truePositives).toBe(1);
    expect(m.stats.avgLatencyS).toBeCloseTo(-0.3);
    invariants(m);
  });
  it("excludes incomplete boundary windows instead of penalizing them", () => {
    const m = new EventMatcher([0.2, 2, 4.8], 5);
    m.detect(0.1);
    m.detect(1.8);
    m.detect(4.9);
    m.advance(5, true);
    expect(m.stats).toMatchObject({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 0,
      excludedReferences: 2,
      excludedDetections: 2,
    });
    invariants(m);
  });
  it("finalizes genuine unmatched references and detections", () => {
    const m = new EventMatcher([2], 6);
    m.detect(4);
    m.advance(6, true);
    expect(m.stats).toMatchObject({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 1,
    });
    invariants(m);
  });
  it("allows a detection exactly on the inclusive right boundary", () => {
    const m = new EventMatcher([2], 5);
    m.advance(2.6);
    expect(m.stats.falseNegatives).toBe(0);
    m.detect(2.6);
    m.advance(2.7);
    expect(m.stats.truePositives).toBe(1);
    invariants(m);
  });
  it("rejects nonmonotone events and premature finalization", () => {
    const m = new EventMatcher([2], 5);
    m.detect(2);
    expect(() => m.detect(1)).toThrow();
    expect(() => m.advance(1)).toThrow();
    expect(() => m.advance(3, true)).toThrow();
  });
});
describe("Replay validation and clock", () => {
  it("rejects empty manifest and path traversal", () => {
    expect(() => validateManifest({ subjects: [] })).toThrow();
    expect(() =>
      validateManifest({ subjects: [{ id: "x", file: "../secret.json" }] }),
    ).toThrow();
    expect(() => new ReplayRunner([], ctrlCfg)).toThrow();
  });
  it("sorts and deduplicates exact samples, rejects conflicts and invalid values", () => {
    const s = subject("x");
    s.samples = [
      { timeS: 1, value: 95 },
      { timeS: 0, value: 94 },
      { timeS: 1, value: 95 },
    ];
    expect(normalizeSubject(s).samples.map((x) => x.timeS)).toEqual([0, 1]);
    expect(() =>
      normalizeSubject({
        ...s,
        samples: [
          { timeS: 0, value: 95 },
          { timeS: 0, value: 96 },
        ],
      }),
    ).toThrow();
    expect(() =>
      normalizeSubject({ ...s, samples: [{ timeS: NaN, value: 95 }] }),
    ).toThrow();
    expect(() =>
      normalizeSubject({ ...s, samples: [{ timeS: 0, value: Infinity }] }),
    ).toThrow();
  });
  it("uses explicit timestamps and never holds past a sample coverage interval", () => {
    const runner = new ReplayRunner(
      [
        {
          ...subject("x", 4),
          samples: [
            { timeS: 0.5, value: 93 },
            { timeS: 2.5, value: 94 },
          ],
        },
      ],
      ctrlCfg,
    );
    expect(runner.step().spo2).toBeNull();
    let s = runner.step();
    while (s.localTimeS < 0.6 - 1e-8) s = runner.step();
    expect(s.spo2).toBe(93);
    while (s.localTimeS < 1.6 - 1e-8) s = runner.step();
    expect(s.spo2).toBeNull();
    while (!s.done) s = runner.step();
    expect(s.timeS).toBe(4);
    expect(s.spo2).toBeNull();
    expect(runner.step()).toEqual(s);
  });
  it("preserves outgoing summary and resets relative time for next subject", () => {
    const runner = new ReplayRunner(
      [subject("first", 2), subject("second", 2)],
      ctrlCfg,
    );
    let s = runner.step();
    while (!s.subjectComplete) s = runner.step();
    expect(s.subjectId).toBe("first");
    expect(s.localTimeS).toBe(2);
    expect(s.completed[0].subjectId).toBe("first");
    s = runner.step();
    expect(s.subjectId).toBe("second");
    expect(s.localTimeS).toBe(0.1);
    expect(s.sampleTimeS).toBe(0);
    expect(s.timeS).toBe(2.1);
    while (!s.done) s = runner.step();
    expect(s.cumulative.recordings).toBe(2);
    expect(s.timeS).toBe(4);
  });
  it("loops only when requested and retains independent per-pass counts", () => {
    const runner = new ReplayRunner([subject("x", 2)], ctrlCfg, { loop: true });
    let s = runner.step();
    while (!s.subjectComplete) s = runner.step();
    const first = { ...s.metrics };
    s = runner.step();
    expect(s.cycle).toBe(2);
    expect(s.localTimeS).toBe(0.1);
    while (!s.subjectComplete) s = runner.step();
    expect(s.metrics).toEqual(first);
    expect(s.cumulative.recordings).toBe(2);
    expect(s.completed).toHaveLength(2);
  });
  it("finishes a fractional final interval exactly", () => {
    const runner = new ReplayRunner([subject("x", 2.35)], ctrlCfg);
    let s = runner.step();
    expect(s.sampleTimeS).toBe(0);
    while (!s.done) s = runner.step();
    expect(s.localTimeS).toBe(2.35);
    expect(s.sampleTimeS).toBe(2.3);
    expect(s.timeS).toBe(2.35);
  });
  it("acknowledges a persistent alarm while paused without resolving its cause", () => {
    const runner = new ReplayRunner([subject("x", 30)], ctrlCfg);
    let s = runner.step();
    while (s.localTimeS < 22) s = runner.step();
    const alarm = s.ctrlOutput.alarms.find((a) => a.active)!;
    expect(alarm).toBeDefined();
    const acknowledged = runner.acknowledge(alarm.id)!;
    expect(acknowledged.timeS).toBe(s.timeS);
    expect(
      acknowledged.ctrlOutput.alarms.find((a) => a.id === alarm.id),
    ).toMatchObject({ active: true, acknowledged: true });
  });
  it("replays active subject 04 without contradictory scoring or savings fields", () => {
    expect(validateManifest(index).subjects[0].id).toBe("04");
    const data = {
      ...main04,
      breathTimesS: breaths04.breathTimesS,
    } as SubjectJson;
    const runner = new ReplayRunner([data], ctrlCfg);
    let s = runner.step();
    while (!s.done) s = runner.step();
    expect(s.localTimeS).toBe(480);
    expect(s.metrics.totalEligibleReferences).toBe(133);
    expect(s.metrics.truePositives).toBeGreaterThan(120);
    expect(s.metrics.falsePositives).toBe(0);
    expect(s.metrics.truePositives + s.metrics.falseNegatives).toBe(133);
    const detected = s.breathResults
      .filter((r) => r.status === "matched")
      .map((r) => r.detectedTimeS);
    expect(new Set(detected).size).toBe(detected.length);
    expect(s).not.toHaveProperty("oxygenSavedPct");
    expect(s).not.toHaveProperty("oxygenA");
  });
});
describe("BIDMC ingestion", () => {
  it("parses CRLF, quoted commas, newlines and escaped quotes", () => {
    expect(parseCsv('a,b\r\n"hello, world","x""y"\r\n"multi\nline",z')).toEqual(
      [
        { a: "hello, world", b: 'x"y' },
        { a: "multi\nline", b: "z" },
      ],
    );
    expect(() => parseCsv('a,b\n"unterminated,b')).toThrow();
  });
  it("keeps time gaps, sorts timestamps and flags invalid numeric values", () => {
    const n = convertNumerics("Time [s],SpO2\n4,94\n0,95\n2,150\n4,94");
    expect(n.durationS).toBe(4);
    expect(n.samples.map((x: { timeS: number }) => x.timeS)).toEqual([0, 2, 4]);
    expect(n.samples[1]).toEqual({ timeS: 2, value: null, quality: "low" });
    expect(n.invalidCount).toBe(1);
    expect(n.duplicateCount).toBe(1);
  });
  it("keeps annotators independent and measures disagreement without averaging unrelated rows", () => {
    const b = convertBreaths(
      "breaths ann1 [signal sample no],breaths ann2 [signal sample no]\n125,500\n500,125\n900,",
      10,
    );
    expect(b.breathTimesS).toEqual([1, 4, 7.2]);
    expect(b.annotator2TimesS).toEqual([1, 4]);
    expect(b.disagreement).toMatchObject({
      matchedPairs: 2,
      unmatchedAnnotator1: 1,
      unmatchedAnnotator2: 0,
      maxAbsoluteDifferenceS: 0,
    });
    expect(() =>
      convertBreaths(
        "breaths ann1 [signal sample no],breaths ann2 [signal sample no]\n2000,2001",
        10,
      ),
    ).toThrow();
  });
});
