import type { EventLogEntry } from "../sim/controller";
export function EventLog({
  entries,
}: {
  entries: ReadonlyArray<EventLogEntry>;
}) {
  return (
    <section className="card">
      <div className="card-header">
        <h2>Event history</h2>
        <small>{entries.length} events</small>
      </div>
      {entries.length === 0 ? (
        <p className="muted">
          Controller transitions, faults and acknowledgements appear here.
        </p>
      ) : (
        <ol className="event-list">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="event-time">{e.timeS.toFixed(1)} s</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
