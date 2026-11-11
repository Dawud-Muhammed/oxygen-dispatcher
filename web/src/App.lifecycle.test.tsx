// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./ResearchWorkspace";
import { ExperimentEngine, DEFAULT_EXPERIMENT_CONFIG } from "./sim/engine";
import { readLibrary, saveLocal } from "./library";
import type { LocalRun } from "./library";
import type { RunRecord } from "./api/client";

const api = vi.hoisted(() => ({
  saveRun: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getHandover: vi.fn(),
  askAboutRun: vi.fn(),
  explainEvent: vi.fn(),
}));
vi.mock("./api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/client")>()),
  ...api,
}));
// Layout is covered separately. These lifecycle tests retain the actual engine,
// hooks, alarms, counters, storage and async gates, without chart measurement.
vi.mock("./components/Charts", () => ({ Charts: () => null }));
vi.mock("./components/ReplayDashboard", () => ({
  ReplayDashboard: ({ active }: { active: boolean }) => (
    <div data-testid="replay-view" data-active={active} />
  ),
}));

let nextFrameId = 0;
let wallMs = 0;
let background = false;
let frames = new Map<number, FrameRequestCallback>();
function button(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}
function click(name: string) {
  fireEvent.click(button(name));
}
async function frame(deltaMs: number) {
  wallMs += deltaMs;
  const current = [...frames.values()];
  frames.clear();
  await act(async () => {
    for (const callback of current) callback(wallMs);
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function prepare(durationS = 60) {
  fireEvent.change(screen.getByLabelText("Duration"), {
    target: { value: String(durationS) },
  });
  click("Prepare experiment");
}
async function finish() {
  click("Start experiment");
  await frame(0);
  await frame(200);
  await frame(200);
  await frame(200);
  expect(
    screen.getByRole("heading", { name: "Experiment complete" }),
  ).toBeTruthy();
}
function localFixture(): LocalRun {
  const engine = new ExperimentEngine({
    ...DEFAULT_EXPERIMENT_CONFIG,
    durationS: 1,
  });
  engine.advanceTicks(10);
  const record = engine.exportRun();
  return {
    id: record.client_run_id,
    createdAt: "2026-11-04T00:00:00.000Z",
    record,
    snapshot: engine.snapshot(),
  };
}
function remoteFixture(id = 7): RunRecord {
  const local = localFixture();
  return { ...local.record, id, created_at: local.createdAt };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.resetAllMocks();
  nextFrameId = 0;
  wallMs = 0;
  background = false;
  frames = new Map();
  vi.spyOn(document, "hidden", "get").mockImplementation(() => background);
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  api.listRuns.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("experiment and review lifecycle in a DOM emulator", () => {
  it("rejects invalid configuration and keeps the configuration available for correction", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Continuous arm (L/min)"), {
      target: { value: "-1" },
    });
    click("Prepare experiment");
    expect(screen.getByRole("alert").textContent).toContain(
      "Continuous flow must be a finite number",
    );
    expect(
      screen.queryByRole("button", { name: "Start experiment" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Continuous arm (L/min)"), {
      target: { value: "5" },
    });
    prepare();
    expect(button("Start experiment").disabled).toBe(false);
  });

  it("runs, injects and acknowledges a fault, resumes, saves, reopens, then resets without old state", async () => {
    render(<App />);
    prepare();
    click("Start experiment");
    await frame(0);
    click("Lose SpO₂ signal");
    await frame(200);
    expect(
      Number((screen.getByRole("progressbar") as HTMLProgressElement).value),
    ).toBeCloseTo(24);
    expect(screen.getByText("Active · warning")).toBeTruthy();
    click("Acknowledge");
    expect(screen.getByText("Acknowledged")).toBeTruthy();
    expect(screen.getByText("Active · warning")).toBeTruthy();
    click("Pause experiment");
    await frame(200);
    expect((screen.getByRole("progressbar") as HTMLProgressElement).value).toBe(
      24,
    );
    click("Resume experiment");
    await frame(0);
    await frame(200);
    await frame(200);
    expect(
      screen.getByRole("heading", { name: "Experiment complete" }),
    ).toBeTruthy();
    click("Save in this browser");
    const [saved] = readLibrary();
    expect(saved.record.summary.simDurationS).toBe(60);
    expect(saved.record.summary.armA.missingS).toBeCloseTo(30);
    expect(saved.record.summary.armB.missingS).toBeCloseTo(30);
    expect(saved.record.alarms[0]).toMatchObject({
      active: false,
      acknowledged: true,
    });
    expect(
      saved.record.event_log.some((e) => e.code === "ALARM_ACKNOWLEDGED"),
    ).toBe(true);
    click("Saved runs");
    click("Reopen");
    expect(screen.getByText(saved.id)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Saved experiment review" }),
    ).toBeTruthy();
    click("Simulation");
    click("Reset run");
    expect(
      screen.queryByRole("heading", { name: "Experiment complete" }),
    ).toBeNull();
    expect(screen.getByText("No alarm episodes recorded.")).toBeTruthy();
    expect((screen.getByRole("progressbar") as HTMLProgressElement).value).toBe(
      0,
    );
    await finish();
    click("Save in this browser");
    const records = readLibrary();
    expect(records).toHaveLength(2);
    expect(records[0].id).not.toBe(saved.id);
    expect(records[0].record.faults).toEqual([]);
    expect(
      records[0].record.event_log.some((e) => e.code === "ALARM_ACKNOWLEDGED"),
    ).toBe(false);
  });

  it("pauses on view changes and backgrounding without advancing hidden elapsed time", async () => {
    render(<App />);
    prepare();
    fireEvent.change(screen.getByLabelText("Requested time acceleration"), {
      target: { value: "1" },
    });
    click("Start experiment");
    await frame(0);
    await frame(200);
    click("Recorded-data replay");
    await frame(1000);
    click("Simulation");
    expect(button("Resume experiment")).toBeTruthy();
    expect(
      (screen.getByRole("progressbar") as HTMLProgressElement).value,
    ).toBeCloseTo(0.2);
    click("Resume experiment");
    await frame(0);
    await frame(200);
    background = true;
    fireEvent(document, new Event("visibilitychange"));
    await frame(1000);
    expect(button("Resume experiment")).toBeTruthy();
    expect(
      (screen.getByRole("progressbar") as HTMLProgressElement).value,
    ).toBeCloseTo(0.4);
  });

  it("ignores an old save response after resetting and ignores an old explanation after a new experiment", async () => {
    sessionStorage.setItem("oxygen-dispatcher.access-token", "test-token");
    const save = deferred<RunRecord>();
    api.saveRun.mockReturnValueOnce(save.promise);
    render(<App />);
    prepare();
    await finish();
    click("Save to private API");
    const [oldRecord, saveSignal] = api.saveRun.mock.calls[0];
    click("Reset run");
    expect((saveSignal as AbortSignal).aborted).toBe(true);
    await act(async () =>
      save.resolve({ ...oldRecord, id: 7, created_at: "2026-11-04T00:00:00Z" }),
    );
    expect(
      screen.queryByText(
        "Saved to your private API workspace. Repeated saves reuse this run.",
      ),
    ).toBeNull();
    await finish();
    expect(button("Generate run summary").disabled).toBe(true);
    api.saveRun.mockImplementation(async (record) => ({
      ...record,
      id: 8,
      created_at: "2026-11-04T00:00:00Z",
    }));
    await act(async () => click("Save to private API"));
    const explanation = deferred<{ note: string; source: "ai" }>();
    api.getHandover.mockReturnValue(explanation.promise);
    click("Generate run summary");
    const [runId, explainSignal] = api.getHandover.mock.calls[0];
    expect(runId).toBe(8);
    click("Configure new experiment");
    expect((explainSignal as AbortSignal).aborted).toBe(true);
    await act(async () =>
      explanation.resolve({ note: "STALE EXPLANATION", source: "ai" }),
    );
    expect(screen.queryByText("STALE EXPLANATION")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Configure an experiment" }),
    ).toBeTruthy();
  });

  it("keeps a local selection when a superseded private load resolves, and keeps a closed review closed", async () => {
    const local = localFixture();
    saveLocal(local);
    const remote = remoteFixture();
    api.listRuns.mockResolvedValue([remote]);
    sessionStorage.setItem("oxygen-dispatcher.access-token", "test-token");
    render(<App />);
    click("Saved runs");
    fireEvent.click(screen.getByText("Private API connection"));
    await act(async () => click("Load private runs"));
    const first = deferred<RunRecord>();
    api.getRun.mockReturnValueOnce(first.promise);
    click("Reopen private run");
    const firstSignal = api.getRun.mock.calls[0][1] as AbortSignal;
    click("Reopen");
    expect(firstSignal.aborted).toBe(true);
    await act(async () => first.resolve(remote));
    expect(screen.getByText(local.id)).toBeTruthy();
    expect(screen.queryByText(remote.client_run_id)).toBeNull();

    const second = deferred<RunRecord>();
    api.getRun.mockReturnValueOnce(second.promise);
    click("Reopen private run");
    click("Close review");
    expect((api.getRun.mock.calls[1][1] as AbortSignal).aborted).toBe(true);
    await act(async () => second.resolve(remote));
    expect(
      screen.queryByRole("heading", { name: "Saved experiment review" }),
    ).toBeNull();
  });

  it("cancels private loads when the access token changes and displays API errors without disabling local saving", async () => {
    sessionStorage.setItem("oxygen-dispatcher.access-token", "old-token");
    const list = deferred<RunRecord[]>();
    api.listRuns.mockReturnValueOnce(list.promise);
    render(<App />);
    click("Saved runs");
    fireEvent.click(screen.getByText("Private API connection"));
    click("Load private runs");
    fireEvent.change(screen.getByLabelText("Personal access token"), {
      target: { value: "new-token" },
    });
    click("Use token");
    expect((api.listRuns.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
    await act(async () => list.resolve([remoteFixture()]));
    expect(
      screen.queryByRole("button", { name: "Reopen private run" }),
    ).toBeNull();
    click("Simulation");
    prepare();
    await finish();
    api.saveRun.mockRejectedValue(new Error("API unavailable for this test"));
    await act(async () => click("Save to private API"));
    expect(screen.getByRole("alert").textContent).toContain(
      "API unavailable for this test",
    );
    expect(button("Save in this browser").disabled).toBe(false);
    click("Save in this browser");
    expect(readLibrary()).toHaveLength(1);
  });
});
