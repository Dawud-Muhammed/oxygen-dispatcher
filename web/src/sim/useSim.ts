import { useCallback, useEffect, useRef, useState } from "react";
import { ExperimentEngine, SimulationClock } from "./engine";
import type {
  ExperimentConfig,
  FaultKind,
  RunStatus,
  SimSnapshot,
} from "./engine";
export type { SimSnapshot, LivePoint, RunStatus } from "./engine";
/** The hook schedules the shared engine; it contains no scientific calculations. */
export function useSim(config: ExperimentConfig, speedMult: number) {
  const [initial] = useState(() => new ExperimentEngine(config));
  const engine = useRef(initial),
    clock = useRef(new SimulationClock()),
    status = useRef<RunStatus>("idle");
  const speed = useRef(speedMult),
    frame = useRef(0),
    lastPublish = useRef(0);
  const [snap, setSnap] = useState<SimSnapshot>(() => initial.snapshot());
  const publish = useCallback(
    () => setSnap(engine.current.snapshot(status.current, speed.current)),
    [],
  );
  useEffect(() => {
    speed.current = speedMult;
  }, [speedMult]);
  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
  }, []);
  const loop = useCallback(
    function animate(now: number) {
      if (status.current !== "running") return;
      if (document.hidden) {
        status.current = "paused";
        clock.current.reset(engine.current.timeS);
        publish();
        return;
      }
      clock.current.accrue(now, speed.current);
      const deadline = performance.now() + 8;
      clock.current.drain(engine.current, () => performance.now() > deadline);
      if (engine.current.done) status.current = "done";
      if (now - lastPublish.current >= 200 || engine.current.done) {
        lastPublish.current = now;
        publish();
      }
      if (status.current === "running")
        frame.current = requestAnimationFrame(animate);
    },
    [publish],
  );
  const pause = useCallback(() => {
    stop();
    if (status.current === "running") status.current = "paused";
    clock.current.reset(engine.current.timeS);
    publish();
  }, [publish, stop]);
  const reset = useCallback(() => {
    stop();
    engine.current = new ExperimentEngine(config);
    status.current = "idle";
    clock.current.reset();
    publish();
  }, [config, publish, stop]);
  const start = useCallback(() => {
    if (status.current === "running") return;
    if (status.current === "idle" || status.current === "done")
      engine.current = new ExperimentEngine(config);
    status.current = engine.current.done ? "done" : "running";
    clock.current.reset(engine.current.timeS);
    publish();
    if (status.current === "running")
      frame.current = requestAnimationFrame(loop);
  }, [config, loop, publish]);
  const acknowledgeAlarm = useCallback(
    (id: string) => {
      engine.current.acknowledgeAlarm(id);
      publish();
    },
    [publish],
  );
  const injectFault = useCallback(
    (kind: FaultKind, durationS = 30) => {
      engine.current.injectFault(kind, durationS);
      publish();
    },
    [publish],
  );
  const exportRun = useCallback(() => engine.current.exportRun(), []);
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden && status.current === "running") pause();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [pause, stop]);
  return {
    snap,
    start,
    pause,
    reset,
    acknowledgeAlarm,
    injectFault,
    exportRun,
  };
}
