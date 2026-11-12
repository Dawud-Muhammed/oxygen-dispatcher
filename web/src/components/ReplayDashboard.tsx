import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatRecordingTime,
  formatReplayEventTime,
  recordedSaturationAt,
  useRecordingPlayback,
} from "../sim/useRecordingPlayback";
import type {
  ReplayPhase,
  ReplayPhaseChange,
} from "../sim/useRecordingPlayback";
import "./valveReplay.css";

interface AssistantContext {
  sessionKey: string;
  subjectId: string;
  startS: number;
  endS: number;
  eventId?: string;
  seek: (timeS: number) => void;
}

const SUBJECT_ID = "04";
const WINDOW_S = 12;
const WAVEFORM_AXIS_WIDTH = 42;
const WAVEFORM_MARGIN_RIGHT = 12;
const EMPTY_PHASES: ReplayPhaseChange[] = [];
const PHASE_LABELS: Record<ReplayPhase, string> = {
  inhaling: "Estimated inhale",
  exhaling: "Estimated exhale",
  unknown: "Phase unknown",
};
const VALVE_STATES = {
  inhaling: "open",
  exhaling: "closed",
  unknown: "unknown",
} as const;
const EVENT_LABELS: Record<string, string> = {
  "valve-open": "Opened",
  "valve-closed": "Closed",
  "valve-unknown": "Phase unknown",
};

export function ReplayDashboard({
  active = true,
  renderAssistant,
}: {
  active?: boolean;
  renderAssistant?: (context: AssistantContext) => ReactNode;
}) {
  const [speed, setSpeed] = useState(1);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [pinnedTime, setPinnedTime] = useState<number | null>(null);
  const replay = useRecordingPlayback({ subjectId: SUBJECT_ID, speed, active });
  const { recording, evidence, timeS, playing, loading } = replay;
  const waveform = evidence?.waveform;
  const phases = evidence?.valvePhases ?? EMPTY_PHASES;
  const transitions = useMemo(
    () =>
      evidence?.events.filter((event) =>
        Object.hasOwn(EVENT_LABELS, event.kind),
      ) ?? [],
    [evidence],
  );
  const hasTimeline = !!waveform && phases.length > 0;
  const error =
    replay.error ||
    (!loading && recording && !hasTimeline
      ? "The breathing waveform and phase timeline are unavailable."
      : "");
  const phase =
    phases.findLast((change) => change.timeS <= timeS)?.phase ?? "unknown";
  const valveState = VALVE_STATES[phase];
  const valveLabel =
    phase === "unknown" ? "No command" : valveState.toUpperCase();
  const inspectTime = pinnedTime ?? hoveredTime ?? timeS;
  const inspectedPhase =
    phases.findLast((change) => change.timeS <= inspectTime)?.phase ??
    "unknown";
  const currentImpedance =
    waveform?.values[Math.floor(timeS * waveform.sampleRateHz + 1e-8)] ?? null;
  const inspectedSampleIndex = waveform
    ? Math.floor(inspectTime * waveform.sampleRateHz + 1e-8)
    : null;
  const inspectedSample =
    waveform && inspectedSampleIndex !== null
      ? {
          timeS: inspectedSampleIndex / waveform.sampleRateHz,
          value: waveform.values[inspectedSampleIndex],
        }
      : null;
  const eventAtPoint = transitions.find((event) => event.timeS === inspectTime);
  const selectedEvent = transitions.find(
    (event) => event.timeS === (pinnedTime ?? timeS),
  );
  const currentSpO2 = recording ? recordedSaturationAt(recording, timeS) : null;
  const endS = recording?.durationS ?? 0;
  const windowStart = Math.max(
    0,
    Math.min(Math.floor(timeS / 10) * 10, endS - WINDOW_S),
  );
  const windowEnd = Math.min(windowStart + WINDOW_S, endS);
  const visibleTransitions = transitions.filter(
    (event) => event.timeS >= windowStart && event.timeS <= windowEnd,
  );
  const chartData = useMemo(() => {
    if (!waveform) return [];
    const { sampleRateHz, values } = waveform;
    const first = Math.ceil(windowStart * sampleRateHz);
    const end = Math.floor(windowEnd * sampleRateHz) + 1;
    return values.slice(first, end).map((impedance, offset) => ({
      timeS: (first + offset) / sampleRateHz,
      impedance,
    }));
  }, [waveform, windowStart, windowEnd]);
  const phaseSegments = useMemo(
    () =>
      phases.flatMap(({ phase, timeS }, index) => {
        const start = Math.max(timeS, windowStart);
        const end = Math.min(phases[index + 1]?.timeS ?? windowEnd, windowEnd);
        return end > start ? [{ phase, start, end }] : [];
      }),
    [phases, windowStart, windowEnd],
  );
  const previousChange = transitions.findLast(
    (event) => event.timeS < timeS - 1e-8,
  );
  const nextChange = transitions.find((event) => event.timeS > timeS + 1e-8);
  function inspect(time: number) {
    setHoveredTime(null);
    setPinnedTime(time);
    replay.seek(time);
  }

  function seek(time: number) {
    setPinnedTime(null);
    setHoveredTime(null);
    replay.seek(time);
  }

  function exportEvidence() {
    if (!recording || !evidence) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { kind: "recorded-data-integration", recording, evidence },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "oxygen-dispatcher-replay-04.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="valve-workspace">
      <div className="valve-columns">
        <div className="valve-main">
          <section
            className="valve-panel valve-bedside"
            aria-labelledby="bedside-title"
          >
            <div className="valve-panel-heading">
              <div>
                <h2 id="bedside-title">Bedside view</h2>
                <p>Recorded BIDMC replay · Virtual valve</p>
              </div>
              <div className="valve-panel-actions">
                <span className="valve-mode" data-phase={phase}>
                  {hasTimeline ? PHASE_LABELS[phase] : "Waiting for replay"}
                </span>
                <a
                  className="valve-source"
                  href="https://physionet.org/content/bidmc/1.0.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Subject 04 <span aria-hidden="true">↗</span>
                </a>
              </div>
            </div>
            <figure className="valve-scene">
              <div className="valve-scene-art">
                <img
                  src="/images/valve-bedside.webp"
                  alt="Illustrated bedside with a valve controller in the tubing between the oxygen cylinder and the patient"
                  width="1536"
                  height="1024"
                  fetchPriority="high"
                />
                <div
                  className="valve-device"
                  role="group"
                  aria-label={`Virtual valve: ${valveLabel}`}
                  data-state={valveState}
                >
                  <strong aria-hidden="true">
                    {phase !== "unknown" && <i />}
                    {phase === "unknown" ? "—" : valveState.toUpperCase()}
                  </strong>
                </div>
              </div>
              <div className="valve-equipment valve-cylinder">
                Oxygen cylinder
              </div>
              <div className="valve-equipment valve-patient">
                Patient in bed
              </div>
            </figure>
            <div className="valve-state-readout" aria-hidden="true">
              Virtual valve <strong>{valveLabel}</strong>
            </div>
            <div className="valve-transport">
              <div className="valve-controls">
                <button
                  type="button"
                  className="primary valve-play"
                  disabled={!hasTimeline}
                  onClick={() => {
                    if (playing) replay.pause();
                    else {
                      setHoveredTime(null);
                      setPinnedTime(null);
                      replay.play();
                    }
                  }}
                >
                  <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
                  {playing ? "Pause replay" : "Play recording"}
                </button>
                <button
                  type="button"
                  disabled={!hasTimeline}
                  onClick={() => seek(0)}
                >
                  Restart
                </button>
                <label className="valve-speed">
                  <span>Speed</span>
                  <select
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                  >
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={5}>5×</option>
                    <option value={20}>20×</option>
                  </select>
                </label>
                <span className="valve-time">
                  <strong>{formatRecordingTime(timeS, true)}</strong>
                  <span> / {formatRecordingTime(endS)}</span>
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={endS || 1}
                step={0.1}
                value={timeS}
                disabled={!hasTimeline}
                aria-label="Recording position"
                aria-valuetext={formatRecordingTime(timeS, true)}
                onChange={(event) => seek(event.target.valueAsNumber)}
              />
              {loading && <p role="status">Loading the recording…</p>}
              {error && (
                <div className="valve-load-error" role="alert">
                  <span>{error}</span>
                  <button type="button" onClick={replay.retry}>
                    Try again
                  </button>
                </div>
              )}
            </div>
          </section>

          <section
            className="valve-panel valve-timeline"
            aria-labelledby="valve-timeline-title"
          >
            <div className="valve-panel-heading">
              <div>
                <h2 id="valve-timeline-title">
                  Breathing waveform and valve timeline
                </h2>
                <p>
                  Recorded respiratory impedance in relative units. Select a
                  point or event to inspect it.
                </p>
              </div>
              {hasTimeline && (
                <div className="valve-jump-controls">
                  <button
                    type="button"
                    aria-label="Previous valve change"
                    disabled={!previousChange}
                    onClick={() =>
                      previousChange && inspect(previousChange.timeS)
                    }
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label="Next valve change"
                    disabled={!nextChange}
                    onClick={() => nextChange && inspect(nextChange.timeS)}
                  >
                    →
                  </button>
                </div>
              )}
            </div>
            {hasTimeline ? (
              <>
                <div className="valve-legend" aria-label="Chart legend">
                  <span>
                    <i aria-hidden="true" /> Recorded waveform
                  </span>
                  <span data-phase="inhaling">
                    <i aria-hidden="true" /> Inhale estimate · Open
                  </span>
                  <span data-phase="exhaling">
                    <i aria-hidden="true" /> Exhale estimate · Closed
                  </span>
                  <span data-phase="unknown">
                    <i aria-hidden="true" /> Phase unknown · No command
                  </span>
                </div>
                <div
                  className="valve-chart"
                  aria-label="Recorded respiratory impedance waveform"
                >
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <ComposedChart
                      data={chartData}
                      margin={{
                        top: 8,
                        right: WAVEFORM_MARGIN_RIGHT,
                        bottom: 0,
                        left: 0,
                      }}
                      onMouseMove={({ activeLabel }) => {
                        setHoveredTime(
                          typeof activeLabel === "number" ? activeLabel : null,
                        );
                      }}
                      onMouseLeave={() => setHoveredTime(null)}
                      onClick={({ activeLabel }) => {
                        if (typeof activeLabel === "number")
                          inspect(activeLabel);
                      }}
                    >
                      <CartesianGrid vertical={false} stroke="#e6eeed" />
                      <XAxis
                        type="number"
                        dataKey="timeS"
                        domain={[windowStart, windowEnd]}
                        allowDataOverflow
                        tickFormatter={(value: number) =>
                          formatRecordingTime(value)
                        }
                        tickLine={false}
                        stroke="#5e777a"
                        minTickGap={20}
                        height={25}
                      />
                      <YAxis
                        domain={["auto", "auto"]}
                        tickFormatter={(value: number) => value.toFixed(1)}
                        tickLine={false}
                        stroke="#5e777a"
                        width={WAVEFORM_AXIS_WIDTH}
                      />
                      <Tooltip
                        content={() => null}
                        cursor={{ stroke: "#899e9e" }}
                      />
                      <ReferenceLine
                        x={inspectTime}
                        stroke="#869a9a"
                        strokeDasharray="4 3"
                      />
                      <Line
                        dataKey="impedance"
                        type="linear"
                        stroke="#08756d"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div
                  className="valve-phase-strip"
                  role="img"
                  aria-label="Estimated valve state across the chart window"
                  style={{
                    marginInlineStart: WAVEFORM_AXIS_WIDTH,
                    marginInlineEnd: WAVEFORM_MARGIN_RIGHT,
                  }}
                >
                  {phaseSegments.map(({ phase, start, end }) => (
                    <span
                      key={start}
                      data-phase={phase}
                      style={{ flexGrow: end - start }}
                      title={`${PHASE_LABELS[phase]} (${formatReplayEventTime(start)}–${formatReplayEventTime(end)})`}
                    />
                  ))}
                </div>
                <div className="valve-inspector">
                  <strong>{formatReplayEventTime(inspectTime)}</strong>
                  <span>
                    {inspectedSample?.value == null
                      ? "Waveform sample unavailable"
                      : `${inspectedSample.value.toFixed(3)} relative units at ${formatReplayEventTime(inspectedSample.timeS)}`}
                  </span>
                  <span
                    className="valve-inspect-phase"
                    data-phase={inspectedPhase}
                  >
                    {PHASE_LABELS[inspectedPhase]} ·{" "}
                    {inspectedPhase === "unknown"
                      ? "No command"
                      : VALVE_STATES[inspectedPhase].toUpperCase()}
                  </span>
                  {eventAtPoint && <p>{eventAtPoint.detail}</p>}
                  {pinnedTime !== null && (
                    <button type="button" onClick={() => setPinnedTime(null)}>
                      Clear pin
                    </button>
                  )}
                </div>
                {visibleTransitions.length > 0 && (
                  <div
                    className="valve-event-list"
                    aria-label="Valve changes in this window"
                  >
                    {visibleTransitions.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => inspect(event.timeS)}
                        aria-pressed={pinnedTime === event.timeS}
                        title={event.detail}
                      >
                        <span>{formatReplayEventTime(event.timeS)}</span>
                        {EVENT_LABELS[event.kind]}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="valve-empty">
                The timeline appears when the recording is ready.
              </p>
            )}
          </section>
        </div>

        <aside className="valve-aside">
          <section
            className="valve-panel valve-readings"
            aria-labelledby="replay-readings-title"
          >
            <h2 id="replay-readings-title">Replay readings</h2>
            <dl>
              <div>
                <dt>Recorded SpO₂</dt>
                <dd>
                  {currentSpO2 === null ? (
                    "Unavailable"
                  ) : (
                    <>
                      {currentSpO2}
                      <small>%</small>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Recorded respiratory impedance</dt>
                <dd>
                  {currentImpedance === null ? (
                    "—"
                  ) : (
                    <>
                      {currentImpedance.toFixed(3)}{" "}
                      <small>relative units</small>
                    </>
                  )}
                </dd>
              </div>
            </dl>
            <p>
              The breathing phase is estimated from the recorded waveform. It
              drives the virtual valve in this replay.
            </p>
            <button
              type="button"
              className="valve-export"
              disabled={!hasTimeline}
              onClick={exportEvidence}
            >
              Export replay data <span aria-hidden="true">↓</span>
            </button>
          </section>
          {hasTimeline &&
            renderAssistant?.({
              sessionKey: replay.sessionKey,
              subjectId: SUBJECT_ID,
              startS: windowStart,
              endS: timeS,
              eventId:
                selectedEvent && selectedEvent.timeS <= timeS
                  ? selectedEvent.id
                  : undefined,
              seek: inspect,
            })}
        </aside>
      </div>
    </div>
  );
}
