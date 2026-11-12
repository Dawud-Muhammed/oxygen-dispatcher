import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeSubject } from "./replay";
import type { Recording, SubjectJson } from "./replay";

export interface ReplayEvidenceEvent {
  id: string;
  timeS: number;
  kind: string;
  label: string;
  detail: string;
}

export type ReplayPhase = "inhaling" | "exhaling" | "unknown";

export interface ReplayPhaseChange {
  timeS: number;
  phase: ReplayPhase;
}

export interface ReplayEvidence {
  subjectId: string;
  durationS: number;
  events: ReplayEvidenceEvent[];
  waveform?: { sampleRateHz: number; values: (number | null)[] };
  valvePhases?: ReplayPhaseChange[];
}

interface RecordingResult {
  subjectId: string;
  attempt: number;
  recording: Recording | null;
  evidence: ReplayEvidence | null;
  error: string;
}

export function formatRecordingTime(seconds: number, tenths = false) {
  const ticks = Math.round(Math.max(0, seconds) * 10);
  const minutes = String(Math.floor(ticks / 600)).padStart(2, "0");
  const rest = String(Math.floor((ticks % 600) / 10)).padStart(2, "0");
  return `${minutes}:${rest}${tenths ? `.${ticks % 10}` : ""}`;
}

export function formatReplayEventTime(seconds: number) {
  const ms = Math.round(seconds * 1000);
  const minutes = String(Math.floor(ms / 60_000)).padStart(2, "0");
  const rest = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  return `${minutes}:${rest}.${String(ms % 1000).padStart(3, "0")}`;
}

export function recordedSaturationAt(recording: Recording, timeS: number) {
  const sample = recording.samples.findLast((value) => value.timeS <= timeS);
  return sample &&
    timeS - sample.timeS < recording.samplePeriodS &&
    sample.quality === "good"
    ? sample.value
    : null;
}

async function fetchReplayFile<T>(filename: string, signal: AbortSignal) {
  const response = await fetch(`/replay/${filename}`, { signal });
  if (!response.ok) throw new Error(`Could not load ${filename}.`);
  return (await response.json()) as T;
}

export function useRecordingPlayback({
  subjectId,
  speed,
  active = true,
}: {
  subjectId: string;
  speed: number;
  active?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [timeS, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sessionRevision, setSessionRevision] = useState(0);
  const playhead = useRef(0);
  const isPlaying = useRef(false);
  const startedAt = useRef<number | null>(null);
  const current =
    result?.subjectId === subjectId && result.attempt === attempt
      ? result
      : null;
  const durationS = current?.recording?.durationS ?? 0;
  const phaseChanges = current?.evidence?.valvePhases;

  const pause = useCallback(() => {
    isPlaying.current = false;
    startedAt.current = null;
    setPlaying(false);
  }, []);

  const seek = useCallback(
    (targetS: number) => {
      if (!Number.isFinite(targetS)) return;
      pause();
      setSessionRevision((value) => value + 1);
      playhead.current = Math.max(0, Math.min(targetS, durationS));
      setTime(playhead.current);
    },
    [durationS, pause],
  );

  useEffect(() => {
    const request = new AbortController();
    const { signal } = request;
    isPlaying.current = false;
    startedAt.current = null;
    playhead.current = 0;

    async function load() {
      try {
        if (!/^\d{2}$/.test(subjectId)) {
          throw new Error("Invalid BIDMC subject.");
        }
        const [source, evidence] = await Promise.all([
          fetchReplayFile<SubjectJson>(`subject_${subjectId}.json`, signal),
          fetchReplayFile<ReplayEvidence>(
            `subject_${subjectId}_evidence.json`,
            signal,
          ),
        ]);
        const recording = normalizeSubject(source);
        if (
          !evidence ||
          recording.subjectId !== subjectId ||
          evidence.subjectId !== subjectId ||
          evidence.durationS !== recording.durationS ||
          !Array.isArray(evidence.events) ||
          evidence.events.some(
            (event) =>
              typeof event.id !== "string" ||
              typeof event.label !== "string" ||
              typeof event.detail !== "string" ||
              !Number.isFinite(event.timeS) ||
              event.timeS < 0 ||
              event.timeS > recording.durationS,
          )
        ) {
          throw new Error("The recording and its evidence do not match.");
        }
        const { waveform, valvePhases } = evidence;
        if (
          (waveform !== undefined || valvePhases !== undefined) &&
          (!waveform ||
            waveform.sampleRateHz !== 25 ||
            !Array.isArray(waveform.values) ||
            waveform.values.length !==
              recording.durationS * waveform.sampleRateHz + 1 ||
            waveform.values.some(
              (value) => value !== null && !Number.isFinite(value),
            ) ||
            !Array.isArray(valvePhases) ||
            valvePhases[0]?.timeS !== 0 ||
            valvePhases[0]?.phase !== "unknown" ||
            valvePhases.some(
              (entry, index) =>
                !entry ||
                !Number.isFinite(entry.timeS) ||
                entry.timeS >= recording.durationS ||
                (index > 0 &&
                  (entry.timeS <= valvePhases[index - 1].timeS ||
                    entry.phase === valvePhases[index - 1].phase)) ||
                !["inhaling", "exhaling", "unknown"].includes(entry.phase),
            ))
        ) {
          throw new Error(
            "The breathing waveform and phase timeline are incomplete.",
          );
        }
        if (!signal.aborted) {
          setTime(0);
          setPlaying(false);
          setResult({ subjectId, attempt, recording, evidence, error: "" });
        }
      } catch (error) {
        if (!signal.aborted) {
          setTime(0);
          setPlaying(false);
          setResult({
            subjectId,
            attempt,
            recording: null,
            evidence: null,
            error:
              error instanceof Error ? error.message : "Could not load replay.",
          });
        }
      }
    }

    void load();
    return () => request.abort();
  }, [subjectId, attempt]);

  useEffect(() => {
    let cancelled = false;
    if (!active)
      queueMicrotask(() => {
        if (!cancelled) pause();
      });
    const onVisibilityChange = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, pause]);

  useEffect(() => {
    if (!playing || !active || !durationS) return;
    let frame: number;
    let previous = startedAt.current ?? performance.now();
    startedAt.current = null;
    const startTime = playhead.current;
    const advance = (timestamp: number) => {
      if (!isPlaying.current) return;
      const elapsed = Math.max(0, timestamp - previous) / 1000;
      previous = Math.max(previous, timestamp);
      if (elapsed > 1 || document.hidden) {
        pause();
        return;
      }
      playhead.current = Math.min(
        durationS,
        playhead.current + elapsed * speed,
      );
      if (playhead.current >= durationS) {
        setTime(durationS);
        pause();
        return;
      }
      const visibleTime = Math.floor(playhead.current * 10 + 1e-8) / 10;
      const latestChange = phaseChanges?.findLast(
        (phase) => phase.timeS <= playhead.current,
      );
      // Display each transition on the first frame after its source time,
      // without waiting for the ordinary tenth-second clock update.
      setTime(Math.max(startTime, visibleTime, latestChange?.timeS ?? 0));
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, active, durationS, speed, pause, phaseChanges]);

  const play = () => {
    if (!durationS || !active) return;
    if (playhead.current >= durationS) {
      setSessionRevision((value) => value + 1);
      playhead.current = 0;
      setTime(0);
    }
    isPlaying.current = true;
    startedAt.current = performance.now();
    setPlaying(true);
  };

  return {
    recording: current?.recording ?? null,
    sessionKey: `${subjectId}-${attempt}-${sessionRevision}`,
    evidence: current?.evidence ?? null,
    timeS: current ? timeS : 0,
    playing: playing && !!current,
    loading: current === null,
    error: current?.error ?? "",
    play,
    pause,
    seek,
    reset: () => seek(0),
    retry: () => setAttempt((previous) => previous + 1),
  };
}
