import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReplay } from "../sim/useReplay";

const formatSeconds = (value: unknown) => `${Number(value).toFixed(1)} s`;
const number = (value: number | null, digits = 1) =>
  value === null ? "Unavailable" : value.toFixed(digits);
export function ReplayDashboard({ active = true }: { active?: boolean }) {
  const [speed, setSpeed] = useState(10);
  const {
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
    retry,
    acknowledge,
  } = useReplay(speed, active);
  const { snap, series, status, error, notice } = state;
  const running = status === "running";
  const loading = status === "loading";
  const metrics = snap?.metrics;
  function exportReplay() {
    if (!snap) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            kind: "recorded-data-integration",
            recording,
            final: snap,
            chartSamples: series,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `oxygen-dispatcher-replay-${snap.subjectId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="replay-dashboard">
      <section className="card">
        <h2>Recorded-data replay</h2>
        <p>
          Exercise the controller with recorded SpO₂ from the{" "}
          <a
            href="https://physionet.org/content/bidmc/1.0.0/"
            target="_blank"
            rel="noreferrer"
          >
            BIDMC PPG and Respiration Dataset
          </a>
          .
        </p>
        <p className="notice">
          Pressure is synthesized from breath annotations. Timing scores are an
          integration check using the same reference that creates the signal,
          not independent breath-detection validation. The recorded patient does
          not respond to the controller; replay makes no oxygen-savings claim.
        </p>
        <div className="controls">
          <label>
            Recording
            <select
              value={selectedId}
              onChange={(e) => select(e.target.value)}
              disabled={loading || running}
            >
              {entries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.description ?? `Subject ${e.id}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Playback acceleration
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[1, 5, 10, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n}× elapsed time
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(e) => setLoop(e.target.checked)}
              disabled={running || loading}
            />
            Repeat recording (resets playback)
          </label>
          <button
            className="primary"
            onClick={running ? pause : start}
            disabled={loading || !!error || !recording}
          >
            {loading
              ? "Loading…"
              : running
                ? "Pause replay"
                : status === "done"
                  ? "Replay again"
                  : status === "paused"
                    ? "Resume replay"
                    : "Play recording"}
          </button>
          <button onClick={reset} disabled={!recording || loading}>
            Reset replay
          </button>
          <button onClick={exportReplay} disabled={!snap}>
            Export replay JSON
          </button>
        </div>
        <p className="muted">
          Switching views or hiding the browser pauses playback. Long scheduling
          interruptions pause without hidden-time catch-up.
        </p>
        {error && (
          <div role="alert" className="error">
            <p>{error}</p>
            <button onClick={retry}>Retry loading</button>
          </div>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {!loading && !snap && !error && (
          <p className="muted">
            Ready. Press Play recording to inspect signals, controller states
            and reference matches.
          </p>
        )}
      </section>
      {snap && (
        <>
          <section className="card" aria-label="Replay status">
            <h2>
              Subject {snap.subjectId} ·{" "}
              {status === "done" ? "Complete" : `Pass ${snap.cycle}`}
            </h2>
            <p>
              Recording time {snap.localTimeS.toFixed(1)} /{" "}
              {recording?.durationS} s · Total playback {snap.timeS.toFixed(1)}{" "}
              s · Controller: {snap.ctrlOutput.mode.replaceAll("_", " ")}
            </p>
            <p className="muted">
              Latest controller input at {snap.sampleTimeS.toFixed(1)} s in this
              recording. Commands apply over the following interval.
            </p>
            <div className="metrics">
              <div className="metric">
                <span className="metric-label">Recorded SpO₂</span>
                <strong className="metric-value" style={{ display: "block" }}>
                  {number(snap.spo2)}
                  {snap.spo2 !== null ? "%" : ""}
                </strong>
                <small>{snap.ctrlOutput.spo2Validity}</small>
              </div>
              <div className="metric">
                <span className="metric-label">Requested flow</span>
                <strong className="metric-value" style={{ display: "block" }}>
                  {snap.flowSetpoint.toFixed(1)} L/min
                </strong>
                <small>Experimental controller setpoint</small>
              </div>
              <div className="metric">
                <span className="metric-label">Requested valve</span>
                <strong className="metric-value" style={{ display: "block" }}>
                  {snap.valveOpen ? "Open" : "Closed"}
                </strong>
                <small>No physical valve connected</small>
              </div>
              <div className="metric">
                <span className="metric-label">Synthetic pressure</span>
                <strong className="metric-value" style={{ display: "block" }}>
                  {snap.pressure.toFixed(2)} cmH₂O
                </strong>
                <small>Annotation-derived fixture</small>
              </div>
            </div>
            {snap.ctrlOutput.alarms.length > 0 && (
              <div aria-label="Replay alarm history">
                {snap.ctrlOutput.alarms.map((a) => (
                  <div className="notice" key={a.id}>
                    <strong>
                      {a.level} · {a.code}
                    </strong>{" "}
                    {a.message} · {a.active ? "Active" : "Resolved"}{" "}
                    {a.acknowledged ? (
                      "· Acknowledged"
                    ) : (
                      <button onClick={() => acknowledge(a.id)}>
                        Acknowledge
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
          {metrics && (
            <section className="card">
              <h2>Annotation timing integration results</h2>
              <div className="metrics">
                <div className="metric">
                  <span className="metric-label">Matched references</span>
                  <strong className="metric-value" style={{ display: "block" }}>
                    {metrics.truePositives}
                  </strong>
                  <small>True positives</small>
                </div>
                <div className="metric">
                  <span className="metric-label">Unmatched detections</span>
                  <strong className="metric-value" style={{ display: "block" }}>
                    {metrics.falsePositives}
                  </strong>
                  <small>False positives after window closure</small>
                </div>
                <div className="metric">
                  <span className="metric-label">Unmatched references</span>
                  <strong className="metric-value" style={{ display: "block" }}>
                    {metrics.falseNegatives}
                  </strong>
                  <small>False negatives after window closure</small>
                </div>
                <div className="metric">
                  <span className="metric-label">Mean signed offset</span>
                  <strong className="metric-value" style={{ display: "block" }}>
                    {metrics.avgLatencyS === null
                      ? "Not applicable"
                      : `${(metrics.avgLatencyS * 1000).toFixed(0)} ms`}
                  </strong>
                  <small>
                    Negative means before annotation, not prediction
                  </small>
                </div>
              </div>
              <p className="muted">
                Pending: {metrics.pendingDetections} detections,{" "}
                {metrics.pendingReferences} references. Boundary exclusions:{" "}
                {metrics.excludedDetections} detections,{" "}
                {metrics.excludedReferences} references. Scored detections =
                matched + false positives ({metrics.scoredDetections});
                finalized eligible references = matched + misses (
                {metrics.eligibleReferences}).
              </p>
              <details>
                <summary>How timing is scored</summary>
                <p>
                  A reference is finalized only after its ±0.6 s window closes,
                  using its nearest available detection; ties use the earlier
                  detection. Each event is consumed once. Unmatched detections
                  remain pending for up to 1.2 s so all possible reference
                  windows can close. Events whose complete window falls outside
                  the recording are excluded. Results are an annotation-derived
                  integration exercise.
                </p>
                <p>
                  SpO₂ holds a recorded value only within its stated sample
                  period. Gaps and time beyond coverage are missing data.
                  Annotation 1 supplies the generated pressure timing;
                  annotation 2 disagreement is retained in exported provenance.
                </p>
              </details>
            </section>
          )}
          {series.length > 0 && (
            <section className="card">
              <h2>Signals over the current recording pass</h2>
              <p className="muted">
                Chart samples span the full pass and are progressively
                downsampled for display. Brief pulses may be omitted visually;
                event counts use every controller tick.
              </p>
              <div
                style={{ width: "100%", height: 240 }}
                role="img"
                aria-label="Recorded oxygen saturation versus recording time"
              >
                <ResponsiveContainer>
                  <LineChart
                    data={series}
                    margin={{ left: 4, right: 20, bottom: 24 }}
                  >
                    <CartesianGrid
                      stroke="var(--border)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="timeS"
                      type="number"
                      domain={[0, recording?.durationS ?? "auto"]}
                      label={{
                        value: "Recording time (s)",
                        position: "bottom",
                      }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      label={{
                        value: "SpO₂ (%)",
                        angle: -90,
                        position: "insideLeft",
                      }}
                    />
                    <Tooltip
                      labelFormatter={formatSeconds}
                      isAnimationActive={false}
                    />
                    <Legend verticalAlign="top" />
                    <Line
                      dataKey="spo2"
                      type="stepAfter"
                      name="Recorded SpO₂ (%)"
                      stroke="var(--accent)"
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div
                style={{ width: "100%", height: 240 }}
                role="img"
                aria-label="Synthetic pressure and requested valve state versus recording time"
              >
                <ResponsiveContainer>
                  <LineChart
                    data={series}
                    margin={{ left: 4, right: 20, bottom: 24 }}
                  >
                    <CartesianGrid
                      stroke="var(--border)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="timeS"
                      type="number"
                      domain={[0, recording?.durationS ?? "auto"]}
                      label={{
                        value: "Recording time (s)",
                        position: "bottom",
                      }}
                    />
                    <YAxis
                      yAxisId="pressure"
                      domain={[-3.5, 1]}
                      label={{
                        value: "Pressure (cmH₂O)",
                        angle: -90,
                        position: "insideLeft",
                      }}
                    />
                    <YAxis
                      yAxisId="valve"
                      orientation="right"
                      domain={[0, 1]}
                      ticks={[0, 1]}
                    />
                    <Tooltip
                      labelFormatter={formatSeconds}
                      isAnimationActive={false}
                    />
                    <Legend verticalAlign="top" />
                    <Line
                      yAxisId="pressure"
                      dataKey="pressure"
                      name="Synthetic pressure (cmH₂O)"
                      stroke="var(--accent)"
                      type="stepAfter"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="valve"
                      dataKey="valve"
                      name="Requested valve (0 closed, 1 open)"
                      stroke="var(--yellow)"
                      type="stepAfter"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
          {snap.breathResults.length > 0 && (
            <section className="card">
              <h2>Reference events</h2>
              <p className="muted">
                Last 20 observed reference windows; full results are included in
                the export.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Reference time (s)</th>
                      <th scope="col">Detection time (s)</th>
                      <th scope="col">Offset (ms)</th>
                      <th scope="col">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.breathResults.slice(-20).map((r) => (
                      <tr key={`${snap.cycle}-${r.id}`}>
                        <td>{r.annotatedTimeS.toFixed(3)}</td>
                        <td>{r.detectedTimeS?.toFixed(3) ?? "—"}</td>
                        <td>
                          {r.latencyS === null
                            ? "—"
                            : (r.latencyS * 1000).toFixed(0)}
                        </td>
                        <td>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <details className="card">
            <summary>Controller event history ({snap.eventLog.length})</summary>
            <ol>
              {snap.eventLog.slice(-100).map((e) => (
                <li key={e.id}>
                  <time>{e.timeS.toFixed(1)} s</time> · {e.message}
                </li>
              ))}
            </ol>
          </details>
          {snap.completed.length > 0 && (
            <section className="card">
              <h2>Completed recording passes</h2>
              <p>
                All completed passes: {snap.cumulative.recordings} · matched{" "}
                {snap.cumulative.truePositives} · false positives{" "}
                {snap.cumulative.falsePositives} · missed{" "}
                {snap.cumulative.falseNegatives}.
              </p>
              <p className="muted">
                Per-pass details retain the latest 50 passes; cumulative counts
                include all completed passes. Repeated passes replay the same
                data and are not additional independent evidence.
              </p>
              <ul>
                {snap.completed.map((s) => (
                  <li key={s.id}>
                    Subject {s.subjectId}, pass {s.cycle}:{" "}
                    {s.metrics.truePositives} matched,{" "}
                    {s.metrics.falsePositives} false positives,{" "}
                    {s.metrics.falseNegatives} missed.
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
