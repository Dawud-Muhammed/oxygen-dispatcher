import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeSubject, ReplayRunner, validateManifest } from "./replay";
import type { Recording, ReplayEntry, ReplaySnapshot } from "./replay";

export type ReplayStatus =
  "loading" | "idle" | "running" | "paused" | "done" | "error";
export interface ReplayLivePoint {
  timeS: number;
  spo2: number | null;
  pressure: number;
  valve: number;
  flow: number;
}
export interface ReplayUIState {
  status: ReplayStatus;
  error: string;
  notice: string;
  snap: ReplaySnapshot | null;
  series: ReplayLivePoint[];
}
const empty = (status: ReplayStatus = "loading"): ReplayUIState => ({
  status,
  error: "",
  notice: "",
  snap: null,
  series: [],
});
async function jsonFile(file: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`/replay/${file}`, { signal });
  if (!response.ok)
    throw new Error(`Unable to load ${file} (HTTP ${response.status}).`);
  const data: unknown = await response.json();
  signal.throwIfAborted();
  return data;
}
export async function loadRecording(
  entry: ReplayEntry,
  signal: AbortSignal,
): Promise<Recording> {
  const main = await jsonFile(entry.file, signal);
  if (!main || typeof main !== "object")
    throw new Error("Recording JSON must be an object.");
  let combined = { ...main } as Recording;
  if (combined.subjectId !== entry.id)
    throw new Error("Recording ID does not match its manifest entry.");
  if (entry.breathsFile) {
    const breathData = await jsonFile(entry.breathsFile, signal);
    if (
      !breathData ||
      typeof breathData !== "object" ||
      !("subjectId" in breathData) ||
      breathData.subjectId !== entry.id ||
      !("breathTimesS" in breathData) ||
      !Array.isArray(breathData.breathTimesS)
    )
      throw new Error(
        "Annotation file is malformed or belongs to another recording.",
      );
    // Main recording defines coverage; never extend it to fit annotations.
    combined = {
      ...combined,
      breathTimesS: breathData.breathTimesS,
      provenance: { ...combined.provenance, annotations: breathData },
    };
  }
  signal.throwIfAborted();
  return normalizeSubject(combined);
}
export function useReplay(speedMult: number, active = true) {
  if (!Number.isFinite(speedMult) || speedMult <= 0 || speedMult > 720)
    throw new Error("Replay speed must be between 0 and 720.");
  const [entries, setEntries] = useState<ReplayEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [reload, setReload] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [state, setState] = useState<ReplayUIState>(() => empty());
  const runner = useRef<ReplayRunner | null>(null);
  const lastSnap = useRef<ReplaySnapshot | null>(null);
  const points = useRef<ReplayLivePoint[]>([]);
  const stride = useRef(1);
  const ticks = useRef(0);
  const debt = useRef(0);
  const loopOption = useRef(repeat);
  useEffect(() => {
    loopOption.current = repeat;
  }, [repeat]);
  const pauseWithNotice = useCallback(
    (notice: string) =>
      setState((s) =>
        s.status === "running"
          ? {
              ...s,
              status: "paused",
              notice,
              snap: lastSnap.current,
              series: [...points.current],
            }
          : s,
      ),
    [],
  );

  useEffect(() => {
    const abort = new AbortController();
    jsonFile("index.json", abort.signal)
      .then(validateManifest)
      .then((index) => {
        if (abort.signal.aborted) return;
        setEntries(index.subjects);
        setSelectedId((previous) =>
          index.subjects.some((s) => s.id === previous)
            ? previous
            : index.subjects[0].id,
        );
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setState({
            ...empty("error"),
            error:
              error instanceof Error
                ? error.message
                : "Unable to read replay manifest.",
          });
      });
    return () => abort.abort();
  }, [reload]);

  const resetRunner = useCallback((subject: Recording) => {
    runner.current = new ReplayRunner(
      [subject],
      { prescribedMaxFlow: 5, initialFlow: 5, spo2Target: "standard" },
      { loop: loopOption.current },
    );
    lastSnap.current = null;
    points.current = [];
    ticks.current = 0;
    stride.current = 1;
    debt.current = 0;
    setState(empty("idle"));
  }, []);
  useEffect(() => {
    const entry = entries.find((e) => e.id === selectedId);
    if (!entry) return;
    const abort = new AbortController();
    runner.current = null;
    queueMicrotask(() => {
      if (!abort.signal.aborted) {
        setRecording(null);
        setState(empty());
      }
    });
    loadRecording(entry, abort.signal)
      .then((subject) => {
        if (abort.signal.aborted) return;
        setRecording(subject);
        resetRunner(subject);
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setState({
            ...empty("error"),
            error:
              error instanceof Error
                ? error.message
                : "Unable to load recording.",
          });
      });
    return () => abort.abort();
  }, [entries, selectedId, resetRunner]);

  useEffect(() => {
    let cancelled = false;
    if (!active)
      queueMicrotask(() => {
        if (!cancelled)
          pauseWithNotice("Replay paused when you switched views.");
      });
    return () => {
      cancelled = true;
    };
  }, [active, pauseWithNotice]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden)
        pauseWithNotice(
          "Replay paused in the background; resume to continue. No hidden-time catch-up.",
        );
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [pauseWithNotice]);

  useEffect(() => {
    if (state.status !== "running" || !active) return;
    let frame = 0,
      previous: number | null = null,
      published = 0,
      cancelled = false;
    function animate(timestamp: number) {
      if (cancelled || !runner.current) return;
      const elapsed = previous === null ? 0 : (timestamp - previous) / 1000;
      previous = timestamp;
      if (elapsed > 1) {
        pauseWithNotice(
          "Replay paused after a scheduling interruption. Resume to continue without catch-up.",
        );
        return;
      }
      debt.current += elapsed * speedMult;
      const deadline = performance.now() + 8;
      let changed = false;
      while (debt.current >= 0.1 - 1e-8 && performance.now() < deadline) {
        const snapshot = runner.current.step();
        const old = lastSnap.current;
        if (
          old &&
          (old.cycle !== snapshot.cycle || old.subjectId !== snapshot.subjectId)
        ) {
          points.current = [];
          ticks.current = 0;
          stride.current = 1;
        }
        debt.current -= Math.min(0.1, snapshot.timeS - (old?.timeS ?? 0));
        lastSnap.current = snapshot;
        ticks.current++;
        changed = true;
        if (ticks.current % stride.current === 0 || snapshot.subjectComplete) {
          const point = {
            timeS: snapshot.sampleTimeS,
            spo2: snapshot.spo2,
            pressure: snapshot.pressure,
            valve: snapshot.valveOpen ? 1 : 0,
            flow: snapshot.flowSetpoint,
          };
          points.current.push(point);
          // The final endpoint closes the held interval; it is not a new measurement.
          if (snapshot.subjectComplete)
            points.current.push({ ...point, timeS: snapshot.localTimeS });
          if (points.current.length > 1000) {
            points.current = points.current.filter(
              (_, i) => i % 2 === 0 || i === points.current.length - 1,
            );
            stride.current *= 2;
          }
        }
        if (snapshot.done) {
          setState({
            status: "done",
            error: "",
            notice:
              "Recording complete. Final matching windows have been resolved or marked as boundary exclusions.",
            snap: snapshot,
            series: [...points.current],
          });
          return;
        }
      }
      if (changed && timestamp - published >= 100) {
        published = timestamp;
        setState({
          status: "running",
          error: "",
          notice:
            debt.current > speedMult
              ? "Processing is behind the requested playback speed; samples are retained."
              : "",
          snap: lastSnap.current,
          series: [...points.current],
        });
      }
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [state.status, speedMult, active, pauseWithNotice]);

  const start = useCallback(() => {
    if (!runner.current || !recording || !active) return;
    if (lastSnap.current?.done) resetRunner(recording);
    setState((s) => ({ ...s, status: "running", notice: "" }));
  }, [recording, active, resetRunner]);
  const pause = useCallback(
    () =>
      setState((s) => ({
        ...s,
        status: "paused",
        snap: lastSnap.current,
        series: [...points.current],
      })),
    [],
  );
  const reset = useCallback(() => {
    if (recording) resetRunner(recording);
  }, [recording, resetRunner]);
  const select = useCallback((id: string) => {
    setState(empty());
    setSelectedId(id);
  }, []);
  const setLoop = useCallback(
    (value: boolean) => {
      loopOption.current = value;
      setRepeat(value);
      if (recording) resetRunner(recording);
    },
    [recording, resetRunner],
  );
  const acknowledge = useCallback((id: string) => {
    const snap = runner.current?.acknowledge(id) ?? null;
    lastSnap.current = snap;
    setState((s) => ({
      ...s,
      snap,
      notice:
        "Alarm acknowledged. Its cause remains active until the input recovers.",
    }));
  }, []);
  return {
    state,
    entries,
    selectedId,
    select,
    recording,
    repeat,
    setLoop,
    start,
    pause,
    reset,
    acknowledge,
    retry: () => {
      setState(empty());
      setReload((n) => n + 1);
    },
  };
}
