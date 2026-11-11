import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRun,
  getToken,
  setToken,
  saveRun,
  askAboutRun,
  explainEvent,
  friendlyError,
  HttpError,
  OfflineError,
} from "./client";
import { DEFAULT_EXPERIMENT_CONFIG, ExperimentEngine } from "../sim/engine";

beforeEach(() => {
  const memory = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("private API transport", () => {
  it("uses a session-only bearer token and stable run identity on retries", async () => {
    const engine = new ExperimentEngine({
      ...DEFAULT_EXPERIMENT_CONFIG,
      durationS: 0,
    });
    const record = engine.exportRun();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, ...record }),
    });
    vi.stubGlobal("fetch", fetcher);
    setToken("test-token");
    expect(getToken()).toBe("test-token");
    await saveRun(record);
    await saveRun(record);
    for (const [, init] of fetcher.mock.calls) {
      expect(init.headers.Authorization).toBe("Bearer test-token");
      expect(JSON.parse(init.body).client_run_id).toBe(record.client_run_id);
    }
    setToken("");
    expect(getToken()).toBeNull();
  });
  it("passes cancellation through and does not mislabel it as an offline failure", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("cancelled")));
    controller.abort();
    await expect(getRun(1, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
  it("uses stable event IDs rather than indices and labels template responses", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        explanation: "Recorded fault",
        answer: "Recorded fault",
        source: "template",
        reason: "missing_key",
      }),
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await explainEvent(4, "event-17");
    expect(result.source).toBe("template");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      run_id: 4,
      event_id: "event-17",
    });
    await askAboutRun(4, "What happened?");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      run_id: 4,
      question: "What happened?",
    });
  });
  it("distinguishes network and authentication failures without exposing server content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private network detail")),
    );
    await expect(getRun(1)).rejects.toBeInstanceOf(OfflineError);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    await expect(getRun(1)).rejects.toBeInstanceOf(HttpError);
    expect(friendlyError(new HttpError(401, "/runs"))).toContain(
      "Authentication required",
    );
    expect(friendlyError(new HttpError(500, "/runs", "secret"))).not.toContain(
      "secret",
    );
  });
});
