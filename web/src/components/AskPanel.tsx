import { useEffect, useRef, useState } from "react";
import { askAboutRun, friendlyError } from "../api/client";
import { LatestTask } from "../asyncTask";
export function AskPanel({ runId }: { runId: number | null }) {
  const [q, setQ] = useState(""),
    [answer, setAnswer] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [source, setSource] = useState("");
  const gate = useRef(new LatestTask());
  useEffect(() => {
    const g = gate.current;
    return () => g.cancel();
  }, []);
  async function ask() {
    if (!runId || !q.trim()) return;
    const task = gate.current.begin();
    setLoading(true);
    setError("");
    setAnswer("");
    try {
      const r = await askAboutRun(runId, q.trim(), task.signal);
      if (task.current()) {
        setAnswer(r.answer);
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
      <h2>Ask about the saved run</h2>
      <p className="muted">
        Answers describe submitted simulation results, not treatment
        recommendations.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label>
          Question
          <textarea
            rows={3}
            maxLength={500}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={!runId || loading}
            placeholder="Which measurement faults occurred?"
          />
        </label>
        <button disabled={!runId || loading || !q.trim()}>
          {loading ? "Preparing answer…" : "Ask"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {answer && (
        <div className="output">
          <small>{source}</small>
          <p>{answer}</p>
        </div>
      )}
    </section>
  );
}
