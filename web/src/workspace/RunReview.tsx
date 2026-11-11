import type { ExperimentRecord } from "../sim/engine";
import { Counters } from "../components/Counters";
import { Charts } from "../components/Charts";
import { AlarmBanner } from "../components/AlarmBanner";
import { EventLog } from "../components/EventLog";
import { BirrCalc } from "../components/BirrCalc";
import { HandoverPanel } from "../components/HandoverPanel";
import { AskPanel } from "../components/AskPanel";
export function RunReview({
  record,
  serverId = null,
  authEpoch = 0,
}: {
  record: ExperimentRecord;
  serverId?: number | null;
  authEpoch?: number;
}) {
  return (
    <>
      <Counters
        armA={record.summary.armA}
        armB={record.summary.armB}
        savedPct={record.summary.oxygenSavedPct}
        durationS={record.summary.simDurationS}
        target={[
          record.config.controller.targetLow ?? 92,
          record.config.controller.targetHigh ?? 96,
        ]}
        critical={record.config.controller.criticalThreshold ?? 88}
      />
      <Charts
        series={record.series}
        target={[
          record.config.controller.targetLow ?? 92,
          record.config.controller.targetHigh ?? 96,
        ]}
      />
      <AlarmBanner alarms={record.alarms} />
      <section className="card">
        <h2>Complete-run event history</h2>
        <EventLog entries={record.event_log} />
        {record.provenance.droppedEvents > 0 && (
          <p className="notice">
            {record.provenance.droppedEvents} earlier routine events omitted
            from bounded history; aggregate metrics cover the full run.
          </p>
        )}
      </section>
      <details className="card">
        <summary>Captured configuration and provenance</summary>
        <p className="muted">
          Client-submitted results; the API validates structure and consistency,
          but does not independently recompute the simulation.
        </p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify(
            {
              config: record.config,
              faults: record.faults,
              provenance: record.provenance,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <div className="split">
        <HandoverPanel
          key={
            "summary-" + record.client_run_id + "-" + serverId + "-" + authEpoch
          }
          runId={serverId}
          eventLog={record.event_log}
        />
        <AskPanel
          key={"ask-" + record.client_run_id + "-" + serverId + "-" + authEpoch}
          runId={serverId}
        />
      </div>
      <BirrCalc savedPct={record.summary.oxygenSavedPct} />
    </>
  );
}
