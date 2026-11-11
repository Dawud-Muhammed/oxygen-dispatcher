import type { Alarm } from "../sim/controller";
export function AlarmBanner({
  alarms,
  onAcknowledge,
}: {
  alarms: ReadonlyArray<Alarm>;
  onAcknowledge?: (id: string) => void;
}) {
  if (!alarms.length)
    return <p className="muted">No alarm episodes recorded.</p>;
  const active = alarms.filter((a) => a.active);
  const past = alarms.filter((a) => !a.active);
  const render = (a: Alarm) => (
    <div
      key={a.id}
      className={
        "alarm " +
        (a.active ? (a.level === "CRITICAL" ? "critical" : "") : "resolved")
      }
    >
      <div className="controls">
        <strong>{a.code.replaceAll("_", " ")}</strong>
        <span>
          {a.active ? "Active" : "Resolved"} · {a.level.toLowerCase()}
        </span>
        <span className="grow" />
        {a.active && onAcknowledge && !a.acknowledged && (
          <button onClick={() => onAcknowledge(a.id)}>Acknowledge</button>
        )}
        {a.acknowledged && <small>Acknowledged</small>}
      </div>
      <p>{a.message}</p>
      <small>
        Onset {a.onsetS.toFixed(1)} s
        {a.resolvedS != null
          ? " · Resolved " + a.resolvedS.toFixed(1) + " s"
          : ""}
        . Acknowledgement does not clear the cause.
      </small>
    </div>
  );
  return (
    <section aria-label="Alarm history">
      <div aria-live="polite">{active.map(render)}</div>
      {past.length > 0 && (
        <details>
          <summary>
            {past.length} resolved alarm episode{past.length === 1 ? "" : "s"}
          </summary>
          {past.map(render)}
        </details>
      )}
    </section>
  );
}
