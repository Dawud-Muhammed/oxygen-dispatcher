import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRecording } from "../useReplay";
const main = {
  subjectId: "04",
  description: "Recorded sample",
  durationS: 5,
  samples: [{ timeS: 0, value: 95 }],
  samplePeriodS: 1,
};
const response = (data: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data,
});
afterEach(() => vi.unstubAllGlobals());
describe("Replay loading and cancellation", () => {
  it("rejects a stale response even when transport ignores cancellation", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    );
    const abort = new AbortController();
    const pending = loadRecording(
      { id: "04", file: "subject_04.json" },
      abort.signal,
    );
    abort.abort();
    resolve(response(main));
    await expect(pending).rejects.toThrow();
  });
  it("does not silently ignore a missing declared annotation file", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(main))
        .mockResolvedValueOnce(response(null, 404)),
    );
    await expect(
      loadRecording(
        {
          id: "04",
          file: "subject_04.json",
          breathsFile: "subject_04_breaths.json",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("404");
  });
  it("rejects annotation identifiers and references outside main coverage", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(main))
        .mockResolvedValueOnce(
          response({ subjectId: "04", durationS: 10, breathTimesS: [8] }),
        ),
    );
    await expect(
      loadRecording(
        {
          id: "04",
          file: "subject_04.json",
          breathsFile: "subject_04_breaths.json",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("coverage");
  });
  it("merges verified annotation data without extending recorded measurement coverage", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(main))
        .mockResolvedValueOnce(
          response({ subjectId: "04", durationS: 10, breathTimesS: [2] }),
        ),
    );
    const data = await loadRecording(
      {
        id: "04",
        file: "subject_04.json",
        breathsFile: "subject_04_breaths.json",
      },
      new AbortController().signal,
    );
    expect(data.durationS).toBe(5);
    expect(data.breathTimesS).toEqual([2]);
  });
});
