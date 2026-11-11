import { useEffect, useRef, useState } from "react";
import { getHandover, explainEvent, friendlyError } from "../api/client";
import type { EventLogEntry } from "../sim/controller";
import { LatestTask } from "../asyncTask";
export function HandoverPanel({
  runId,
  eventLog,
}: {
  runId: number | null;
  eventLog: ReadonlyArray<EventLogEntry>;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [source, setSource] = useState("");
  const gate = useRef(new LatestTask());
  useEffect(() => {
    const g = gate.current;
    return () => g.cancel();
  }, []);
  async function request(eventId?: string) {
    if (!runId) return;
    const task = gate.current.begin();
    setLoading(true);
    setError("");
    setText("");
    try {
      const r = eventId
        ? await explainEvent(runId, eventId, task.signal)
        : await getHandover(runId, task.signal);
      if (task.current()) {
        setText("note" in r ? r.note : r.explanation);
        setSource(
          r.source === "template"
            ? "Deterministic template · AI unavailable"
            : "AI-generated explanation · review against source data",
        );
      }
    } catch (e) {
      if (task.current()) setError(friendlyError(e));
    } finally {
      if (task.current()) setLoading(false);
    }
  }
  return (
    <section className="card">
      <h2>Run explanation</h2>
      <p className="muted">
        Optional text for this saved run. AI cannot operate the controller.
      </p>
      <button disabled={!runId || loading} onClick={() => request()}>
        {loading ? "Preparing explanation…" : "Generate run summary"}
      </button>
      {!runId && (
        <p className="muted">
          Save to your private API workspace to enable explanations. Local
          review and export work without AI.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {text && (
        <div className="output">
          <small>{source}</small>
          <p>{text}</p>
        </div>
      )}
      {runId && (
        <details>
          <summary>Explain a specific event</summary>
          <div className="event-list">
            {eventLog.map((e) => (
              <p key={e.id}>
                <button
                  className="link"
                  disabled={loading}
                  onClick={() => request(e.id)}
                >
                  {e.timeS.toFixed(1)} s · {e.message}
                </button>
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
export function OfflineBanner({ action }: { action: string }) {
  return (
    <p className="notice">
      API unavailable: cannot {action}. Local simulation, review and JSON export
      remain available.
    </p>
  );
}
