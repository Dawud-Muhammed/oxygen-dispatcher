import { useEffect, useRef, useState } from "react";
import type { ExperimentRecord } from "../sim/engine";
import {
  listRuns,
  getRun,
  getToken,
  setToken,
  friendlyError,
} from "../api/client";
import { LatestTask } from "../asyncTask";
import {
  readLibrary,
  removeLocal,
  downloadRun,
  validateExperimentRecord,
} from "../library";
import type { LocalRun } from "../library";
import { RunReview } from "./RunReview";
import { duration, scenarios } from "./presentation";
export function SavedRuns({
  refresh,
  authEpoch,
  onAuth,
}: {
  refresh: number;
  authEpoch: number;
  onAuth: () => void;
}) {
  const [local, setLocal] = useState<LocalRun[]>([]),
    [selected, setSelected] = useState<{
      record: ExperimentRecord;
      serverId: number | null;
    } | null>(null),
    [token, setTokenDraft] = useState(getToken() ?? ""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<Awaited<ReturnType<typeof listRuns>>>(
    [],
  );
  const gate = useRef(new LatestTask());
  useEffect(() => {
    const g = gate.current;
    return () => g.cancel();
  }, []);
  // Synchronize this view with the browser storage modified by SaveActions.
  useEffect(() => {
    try {
      // eslint-disable-next-line react/set-state-in-effect -- Synchronizes external browser storage after a save.
      setLocal(readLibrary());
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [refresh]);
  async function load(id?: number) {
    const task = gate.current.begin();
    setBusy(true);
    setError("");
    try {
      if (id) {
        const r = await getRun(id, task.signal);
        if (task.current()) {
          setSelected({ record: validateExperimentRecord(r), serverId: r.id });
        }
      } else {
        const rows = await listRuns(task.signal);
        if (task.current()) setRemote(rows);
      }
    } catch (e) {
      if (task.current()) setError(friendlyError(e));
    } finally {
      if (task.current()) setBusy(false);
    }
  }
  function choose(record: ExperimentRecord, serverId: number | null) {
    gate.current.cancel();
    setBusy(false);
    setSelected({ record, serverId });
    setError("");
  }
  function remove(id: string) {
    try {
      setLocal(removeLocal(id));
      if (selected?.record.client_run_id === id) {
        gate.current.cancel();
        setBusy(false);
        setSelected(null);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  }
  function connect(clear = false) {
    try {
      setToken(clear ? "" : token.trim());
      gate.current.cancel();
      setBusy(false);
      if (clear) setTokenDraft("");
      setRemote([]);
      setSelected(null);
      setError("");
      setMessage(
        clear
          ? "Disconnected from private API storage."
          : "Access token stored for this browser tab. Load private runs to check the connection.",
      );
      onAuth();
    } catch {
      setError(
        "Session storage is unavailable. Enable browser storage to connect a private API token.",
      );
    }
  }
  return (
    <>
      <section className="card">
        <h2>Saved runs</h2>
        <p className="muted">
          Browser copies stay on this device, with up to 20 records subject to
          browser storage space. JSON exports contain configuration, fault
          schedule, full-run aggregates and sampled charts.
        </p>
        {local.length === 0 ? (
          <div className="empty">
            No browser copies yet. Complete an experiment and select “Save in
            this browser.”
          </div>
        ) : (
          local.map((r) => (
            <div className="library-item" key={r.id}>
              <div>
                <strong>
                  {scenarios[r.record.scenario]} ·{" "}
                  {duration(r.record.summary.simDurationS)}
                </strong>
                <br />
                <small>
                  {new Date(r.createdAt).toLocaleString()} · {r.id.slice(0, 8)}
                </small>
              </div>
              <div className="controls">
                <button onClick={() => choose(r.record, r.serverId ?? null)}>
                  Reopen
                </button>
                <button onClick={() => downloadRun(r.record)}>
                  Export JSON
                </button>
                <button className="danger" onClick={() => remove(r.id)}>
                  Remove browser copy
                </button>
              </div>
            </div>
          ))
        )}
      </section>
      <details className="card">
        <summary>Private API connection</summary>
        <p className="muted">
          Use a personal access token provisioned by your research API
          administrator. Tokens are stored only for this tab session. Local
          simulation requires no account.
        </p>
        <div className="controls">
          <label>
            Personal access token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setTokenDraft(e.target.value)}
            />
          </label>
          <button disabled={!token.trim()} onClick={() => connect()}>
            Use token
          </button>
          <button onClick={() => connect(true)}>Disconnect</button>
          <button disabled={busy || !getToken()} onClick={() => void load()}>
            {busy ? "Loading…" : "Load private runs"}
          </button>
        </div>
        {message && <p role="status">{message}</p>}
        {remote.map((r) => (
          <div className="library-item" key={r.id}>
            <span>
              {r.scenario} · {new Date(r.created_at).toLocaleString()}
            </span>
            <button disabled={busy} onClick={() => void load(r.id)}>
              Reopen private run
            </button>
          </div>
        ))}
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {selected && (
        <>
          <section className="card">
            <div className="card-header">
              <h2>Saved experiment review</h2>
              <button
                onClick={() => {
                  gate.current.cancel();
                  setBusy(false);
                  setSelected(null);
                }}
              >
                Close review
              </button>
            </div>
            <p>{selected.record.client_run_id}</p>
            <button onClick={() => downloadRun(selected.record)}>
              Export this run
            </button>
          </section>
          <RunReview
            record={selected.record}
            serverId={getToken() ? selected.serverId : null}
            authEpoch={authEpoch}
          />
        </>
      )}
    </>
  );
}
