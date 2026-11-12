import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatRecordingTime,
  recordedSaturationAt,
  useRecordingPlayback,
} from "../sim/useRecordingPlayback";
import { ReplayAssistant } from "../components/ReplayAssistant";

const recordings = [
  { id: "22", label: "Rising SpO₂", focusS: 55 },
  { id: "46", label: "Falling SpO₂", focusS: 267 },
  { id: "01", label: "Missing SpO₂", focusS: 106 },
] as const;

type ReviewCase = (typeof recordings)[number];

interface ReviewProps {
  active: boolean;
}

export function SpO2Review(props: ReviewProps) {
  const [selected, setSelected] = useState<ReviewCase>(recordings[0]);
  return (
    <>
      <section className="od-case-select" aria-label="BIDMC review cases">
        {recordings.map((recording) => (
          <button
            className="od-case"
            key={recording.id}
            aria-pressed={recording.id === selected.id}
            onClick={() => setSelected(recording)}
          >
            <span className="od-case-symbol" aria-hidden="true">
              {recording.id === "22" ? "↗" : recording.id === "46" ? "↘" : "∅"}
            </span>
            <span>
              <strong>{recording.label}</strong>
              <small>BIDMC subject {recording.id}</small>
            </span>
          </button>
        ))}
      </section>
      <ReviewSession key={selected.id} selected={selected} {...props} />
    </>
  );
}

function ReviewSession({
  selected,
  active,
}: ReviewProps & { selected: ReviewCase }) {
  const [speed, setSpeed] = useState(1);
  const [focusStartS, setFocusStartS] = useState(0);
  const [acknowledgements, setAcknowledgements] = useState<
    Record<string, number>
  >({});
  const [demoFlow, setDemoFlow] = useState(5);
  const [draftFlow, setDraftFlow] = useState("5");
  const [flowChanges, setFlowChanges] = useState<
    { timeS: number; before: number; after: number }[]
  >([]);
  const {
    recording,
    sessionKey,
    evidence,
    timeS,
    playing,
    loading,
    error,
    play,
    pause,
    seek,
    reset,
    retry,
  } = useRecordingPlayback({ subjectId: selected.id, speed, active });
  const durationS = recording?.durationS ?? 0;
  const endS = Math.min(durationS, Math.max(65, Math.ceil(timeS) + 12));
  const startS = Math.max(0, endS - 65);
  const chart = useMemo(
    () =>
      recording?.samples.filter(
        (sample) => sample.timeS >= startS && sample.timeS <= endS,
      ) ?? [],
    [recording, startS, endS],
  );
  const availableEvents =
    evidence?.events.filter(
      (event) =>
        event.kind.startsWith("spo2-") &&
        event.timeS >= focusStartS &&
        event.timeS <= timeS,
    ) ?? [];
  const latest = availableEvents.at(-1);
  const saturation = recording ? recordedSaturationAt(recording, timeS) : null;
  const nextFlow = draftFlow.trim() ? Number(draftFlow) : NaN;
  const canSetFlow =
    Number.isFinite(nextFlow) &&
    nextFlow >= 0 &&
    nextFlow <= 30 &&
    nextFlow !== demoFlow;
  const reviewActions = [
    ...Object.entries(acknowledgements).map(([id, acknowledgedAt]) => ({
      timeS: acknowledgedAt,
      detail:
        "Acknowledged " +
        (evidence?.events.find((event) => event.id === id)?.label ??
          "review notice") +
        ".",
    })),
    ...flowChanges.map((change) => ({
      timeS: change.timeS,
      detail:
        "Manually changed demo setting from " +
        change.before.toFixed(1) +
        " to " +
        change.after.toFixed(1) +
        " L/min.",
    })),
  ].sort((first, second) => first.timeS - second.timeS);

  if (loading)
    return (
      <p className="od-panel od-loading" role="status">
        Loading BIDMC subject {selected.id}…
      </p>
    );
  if (error || !recording || !evidence) {
    return (
      <div className="od-panel od-loading">
        <p role="alert">{error || "Recording evidence is unavailable."}</p>
        <button onClick={retry}>Retry</button>
      </div>
    );
  }

  return (
    <div className="od-workspace-grid">
      <div className="od-main-stack">
        <section className="od-panel od-review-panel">
          <div className="od-review-heading">
            <div>
              <h2>Recorded oxygen saturation</h2>
              <p>
                BIDMC subject {selected.id} · {formatRecordingTime(durationS)}{" "}
                recording
              </p>
            </div>
            <span
              className={
                "od-status " + (saturation === null ? "od-status-warning" : "")
              }
            >
              {saturation === null
                ? "Reading unavailable"
                : "Reading available"}
            </span>
          </div>
          <div className="od-reading-strip">
            <div className="od-reading">
              <span>Recorded SpO₂</span>
              <strong>
                {saturation === null ? (
                  "—"
                ) : (
                  <>
                    {saturation}
                    <small>%</small>
                  </>
                )}
              </strong>
            </div>
            <div className="od-reading">
              <span>Recording time</span>
              <strong>{formatRecordingTime(timeS, true)}</strong>
            </div>
            <div className="od-reading">
              <span>Demo flow setting</span>
              <strong>
                {demoFlow.toFixed(1)} <small>L/min</small>
              </strong>
            </div>
          </div>
          <div
            className="od-chart"
            role="img"
            aria-label="Recorded oxygen saturation chart. Missing readings appear as gaps."
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chart}
                margin={{ top: 10, right: 22, bottom: 6, left: 0 }}
              >
                <CartesianGrid stroke="#e6ecf3" vertical={false} />
                <XAxis
                  type="number"
                  dataKey="timeS"
                  domain={[startS, endS]}
                  tickFormatter={(value) => formatRecordingTime(Number(value))}
                  tick={{ fill: "#52657d", fontSize: 11 }}
                />
                <YAxis
                  domain={[
                    (minimum: number) => Math.max(0, Math.min(88, minimum - 2)),
                    100,
                  ]}
                  tickFormatter={(value) => value + "%"}
                  tick={{ fill: "#52657d", fontSize: 11 }}
                  width={49}
                />
                <Tooltip
                  labelFormatter={(time) =>
                    formatRecordingTime(Number(time), true)
                  }
                  formatter={(value) => [
                    value == null ? "Unavailable" : value + "%",
                    "Recorded SpO₂",
                  ]}
                  filterNull={false}
                  contentStyle={{ borderRadius: 12, borderColor: "#dce5ef" }}
                />
                <ReferenceLine
                  x={timeS}
                  stroke="#087e73"
                  strokeDasharray="4 3"
                />
                <Line
                  type="stepAfter"
                  dataKey="value"
                  stroke="#087e73"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <label className="od-scrubber">
            <span>
              Recording position{" "}
              <strong>
                {formatRecordingTime(timeS)} / {formatRecordingTime(durationS)}
              </strong>
            </span>
            <input
              aria-valuetext={formatRecordingTime(timeS, true)}
              type="range"
              min={0}
              max={durationS}
              step={0.1}
              value={timeS}
              onChange={(event) => {
                const target = event.target.valueAsNumber;
                if (target < focusStartS) setFocusStartS(0);
                seek(target);
              }}
            />
          </label>
          <div className="od-playback">
            <button className="primary" onClick={playing ? pause : play}>
              {playing ? "Pause recording" : "Play recording"}
            </button>
            <button
              onClick={() => {
                setFocusStartS(selected.focusS);
                seek(selected.focusS);
              }}
            >
              Jump to case
            </button>
            <button
              onClick={() => {
                reset();
                setFocusStartS(0);
                setAcknowledgements({});
                setFlowChanges([]);
                setDemoFlow(5);
                setDraftFlow("5");
              }}
            >
              Reset
            </button>
            <label className="od-speed">
              Speed
              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                {[1, 2, 5, 10].map((value) => (
                  <option value={value} key={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section className="od-panel od-event-panel">
          <div className="od-review-heading">
            <div>
              <h2>Review timeline</h2>
              <p>Notices are based on the recorded readings.</p>
            </div>
          </div>
          {availableEvents.length === 0 ? (
            <p className="od-empty">
              Play the recording to see review notices.
            </p>
          ) : (
            <ol className="od-review-events">
              {[...availableEvents].reverse().map((event) => (
                <li key={event.id}>
                  <button onClick={() => seek(event.timeS)}>
                    <time>{formatRecordingTime(event.timeS, true)}</time>
                    <strong>{event.label}</strong>
                    <span>{event.detail}</span>
                  </button>
                  {acknowledgements[event.id] !== undefined && (
                    <small>
                      Acknowledged at{" "}
                      {formatRecordingTime(acknowledgements[event.id], true)}
                    </small>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <div className="od-side-stack">
        <section className="od-panel od-notice-panel" aria-label="Nurse review">
          <div className="od-panel-heading">
            <span className="od-ai-icon od-review-icon" aria-hidden="true">
              ✓
            </span>
            <div>
              <h2>Nurse review</h2>
              <p>On-screen demo notices</p>
            </div>
          </div>
          {latest ? (
            <div className="od-notice" role="status">
              <strong>{latest.label}</strong>
              <p>{latest.detail}</p>
              {latest.kind !== "spo2-restored" && (
                <button
                  disabled={acknowledgements[latest.id] !== undefined}
                  onClick={() =>
                    setAcknowledgements((all) => ({
                      ...all,
                      [latest.id]: timeS,
                    }))
                  }
                >
                  {acknowledgements[latest.id] !== undefined
                    ? "Acknowledged"
                    : "Acknowledge"}
                </button>
              )}
            </div>
          ) : (
            <p className="od-empty">
              No review notice at this point in the recording.
            </p>
          )}
          <form
            className="od-flow-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSetFlow) return;
              setFlowChanges((changes) => [
                ...changes,
                { timeS, before: demoFlow, after: nextFlow },
              ]);
              setDemoFlow(nextFlow);
            }}
          >
            <label>
              Manual demo setting (L/min)
              <input
                type="number"
                min={0}
                max={30}
                step={0.1}
                value={draftFlow}
                onChange={(event) => setDraftFlow(event.target.value)}
              />
            </label>
            <button disabled={!canSetFlow}>Apply</button>
          </form>
          {flowChanges.length > 0 && (
            <ul
              className="od-flow-log"
              aria-label="Manual demo setting changes"
            >
              {flowChanges.map((change, index) => (
                <li key={index}>
                  <time>{formatRecordingTime(change.timeS, true)}</time>{" "}
                  {change.before.toFixed(1)} → {change.after.toFixed(1)} L/min
                </li>
              ))}
            </ul>
          )}
        </section>
        <ReplayAssistant
          key={sessionKey}
          subjectId={selected.id}
          view="spo2"
          startS={startS}
          endS={timeS}
          eventId={latest && latest.timeS >= startS ? latest.id : undefined}
          onEvidence={seek}
          reviewActions={reviewActions}
        />
      </div>
    </div>
  );
}
