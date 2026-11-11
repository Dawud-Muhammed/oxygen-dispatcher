import { useEffect, useRef, useState } from "react";
import type {
  ExperimentConfig,
  ExperimentRecord,
  SimSnapshot,
  FaultKind,
} from "../sim/engine";
import { useSim } from "../sim/useSim";
import { saveRun, getToken, friendlyError } from "../api/client";
import { LatestTask } from "../asyncTask";
import { saveLocal, downloadRun } from "../library";
import type { LocalRun } from "../library";
import { RunReview } from "./RunReview";
import { duration, scenarios } from "./presentation";
import { PipelineDiagram } from "../components/PipelineDiagram";
import { Counters } from "../components/Counters";
import { Charts } from "../components/Charts";
import { AlarmBanner } from "../components/AlarmBanner";
import { AssumptionsPanel } from "../components/AssumptionsPanel";
import { EventLog } from "../components/EventLog";
function SaveActions({
  record,
  snapshot,
  authEpoch,
  onSaved,
}: {
  record: ExperimentRecord;
  snapshot: SimSnapshot;
  authEpoch: number;
  onSaved: () => void;
}) {
  const [serverId, setServerId] = useState<number | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const task = useRef(new LatestTask());
  useEffect(() => {
    const g = task.current;
    return () => g.cancel();
  }, []);
  async function save(remote: boolean) {
    setError("");
    setMessage("");
    const item: LocalRun = {
      id: record.client_run_id,
      createdAt: new Date().toISOString(),
      record,
      snapshot,
    };
    if (!remote) {
      try {
        saveLocal({ ...item, ...(serverId ? { serverId } : {}) });
        onSaved();
        setMessage("Saved in this browser. Reopen it from Saved runs.");
      } catch (e) {
        setError(friendlyError(e));
      }
      return;
    }
    const request = task.current.begin();
    setBusy(true);
    try {
      const r = await saveRun(record, request.signal);
      if (request.current()) {
        setServerId(r.id);
        setMessage(
          "Saved to your private API workspace. Repeated saves reuse this run.",
        );
      }
    } catch (e) {
      if (request.current()) setError(friendlyError(e));
    } finally {
      if (request.current()) setBusy(false);
    }
  }
  return (
    <>
      <section className="card">
        <div className="card-header">
          <h2>Experiment complete</h2>
          <span className="status">
            {duration(record.summary.simDurationS)} simulated
          </span>
        </div>
        <p>
          Review the full result below. Save a browser copy, export the
          reproducible record, or save to your authenticated API workspace.
        </p>
        <div className="controls">
          <button className="primary" onClick={() => void save(false)}>
            Save in this browser
          </button>
          <button onClick={() => downloadRun(record)}>Export JSON</button>
          <button
            disabled={busy || !getToken()}
            onClick={() => void save(true)}
          >
            {busy
              ? "Saving…"
              : serverId
                ? "Save to API again"
                : "Save to private API"}
          </button>
        </div>
        {!getToken() && (
          <p className="muted">
            Connect an access token in Saved runs to enable private API storage.
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <RunReview record={record} serverId={serverId} authEpoch={authEpoch} />
    </>
  );
}

export function SimulationWorkspace({
  active,
  config,
  onNew,
  authEpoch,
  onSaved,
}: {
  active: boolean;
  config: ExperimentConfig;
  onNew: () => void;
  authEpoch: number;
  onSaved: () => void;
}) {
  const [speed, setSpeed] = useState(120),
    [faultError, setFaultError] = useState("");
  const {
    snap,
    start,
    pause,
    reset,
    injectFault,
    acknowledgeAlarm,
    exportRun,
  } = useSim(config, speed);
  useEffect(() => {
    if (!active) pause();
  }, [active, pause]);
  const running = snap.status === "running",
    done = snap.status === "done";
  function fault(kind: FaultKind) {
    try {
      injectFault(kind, 30);
      setFaultError("");
    } catch (e) {
      setFaultError(friendlyError(e));
    }
  }
  return (
    <div hidden={!active}>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>{scenarios[config.scenario]}</h2>
            <small>
              Seed {config.seed} · {duration(config.durationS)} requested ·
              configuration locked for this run
            </small>
          </div>
          <span className={"status " + (running ? "running" : "")}>
            {snap.status === "done" ? "Complete" : snap.status}
          </span>
        </div>
        <div className="controls">
          {!done && (
            <button className="primary" onClick={running ? pause : start}>
              {running
                ? "Pause experiment"
                : snap.status === "paused"
                  ? "Resume experiment"
                  : "Start experiment"}
            </button>
          )}
          <button
            disabled={running}
            onClick={() => {
              reset();
              setFaultError("");
            }}
          >
            Reset run
          </button>
          <button disabled={running} onClick={onNew}>
            Configure new experiment
          </button>
          <label className="grow">
            Requested time acceleration
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[1, 60, 120, 360, 720].map((v) => (
                <option key={v} value={v}>
                  {v}× elapsed time
                </option>
              ))}
            </select>
          </label>
          <strong>
            {duration(snap.timeS)} / {duration(config.durationS)}
          </strong>
        </div>
        <progress
          className="progress"
          aria-label="Experiment progress"
          max={config.durationS || 1}
          value={done ? config.durationS || 1 : snap.timeS}
        />
        <small>
          Switching views or hiding the tab pauses execution. Long scheduling
          interruptions do not earn catch-up time. Rendering never changes
          simulation steps.
        </small>
      </section>
      {!done && (
        <>
          <PipelineDiagram snap={snap} />
          <div className="workspace">
            <div>
              <Counters
                armA={snap.armA}
                armB={snap.armB}
                savedPct={snap.oxygenSavedPct}
                durationS={snap.timeS}
                target={[
                  config.controller.targetLow ?? 92,
                  config.controller.targetHigh ?? 96,
                ]}
                critical={config.controller.criticalThreshold ?? 88}
              />
              <Charts
                series={snap.series}
                target={[
                  config.controller.targetLow ?? 92,
                  config.controller.targetHigh ?? 96,
                ]}
              />
            </div>
            <aside>
              <section className="card">
                <h2>Introduce a fault</h2>
                <p className="muted">
                  30 simulated seconds, applied to both arms' synthetic
                  measurements.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  <button
                    disabled={!running}
                    onClick={() => fault("spo2_loss")}
                  >
                    Lose SpO₂ signal
                  </button>
                  <button
                    disabled={!running}
                    onClick={() => fault("pressure_loss")}
                  >
                    Lose pressure signal
                  </button>
                  <button disabled={!running} onClick={() => fault("motion")}>
                    Low-quality SpO₂
                  </button>
                </div>
                <p>
                  <small>
                    Pressure: {snap.pressureValidity.replaceAll("_", " ")}
                    <br />
                    SpO₂: {snap.spo2Validity.replaceAll("_", " ")}
                  </small>
                </p>
                {snap.faults
                  .filter((f) => snap.timeS >= f.startS && snap.timeS < f.endS)
                  .map((f) => (
                    <p key={f.id} className="notice">
                      {f.kind.replaceAll("_", " ")} · ends at {duration(f.endS)}
                    </p>
                  ))}
                {faultError && (
                  <p className="error" role="alert">
                    {faultError}
                  </p>
                )}
              </section>
              <AssumptionsPanel />
            </aside>
          </div>
          <AlarmBanner alarms={snap.alarms} onAcknowledge={acknowledgeAlarm} />
          <section className="card">
            <h2>Controller event history</h2>
            <EventLog entries={snap.eventLog} />
          </section>
        </>
      )}
      {done && (
        <SaveActions
          key={snap.runId + "-" + authEpoch}
          record={exportRun()}
          snapshot={snap}
          authEpoch={authEpoch}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
