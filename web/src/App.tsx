import { useState } from "react";
import type { ExperimentConfig } from "./sim/engine";
import { Configuration } from "./workspace/Configuration";
import { SimulationWorkspace } from "./workspace/SimulationWorkspace";
import { SavedRuns } from "./workspace/SavedRuns";
import { Disclaimer } from "./components/Disclaimer";
import { ReplayDashboard } from "./components/ReplayDashboard";
import "./index.css";
type View = "simulation" | "replay" | "library";

export default function App() {
  const [view, setView] = useState<View>("simulation"),
    [config, setConfig] = useState<ExperimentConfig | null>(null),
    [session, setSession] = useState(0),
    [refresh, setRefresh] = useState(0),
    [authEpoch, setAuthEpoch] = useState(0);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brandmark" aria-hidden="true">
            O₂
          </span>
          <div>
            Oxygen Dispatcher
            <div className="research-label">Research workspace</div>
          </div>
        </div>
        <nav className="tabs" aria-label="Workspace views">
          {(
            [
              ["simulation", "Simulation"],
              ["replay", "Recorded-data replay"],
              ["library", "Saved runs"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              aria-current={view === v ? "page" : undefined}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">
              {view === "simulation"
                ? "Model · Compare · Understand"
                : view === "replay"
                  ? "Load · Replay · Inspect"
                  : "Review · Reproduce · Export"}
            </div>
            <h1>
              {view === "simulation"
                ? "Explore oxygen delivery."
                : view === "replay"
                  ? "Inspect recorded signals."
                  : "Keep the complete experiment."}
            </h1>
            <p>
              {view === "simulation"
                ? "Test a delivery policy against the same synthetic patient inputs. Follow every modeled litre, signal fault and controller decision."
                : view === "replay"
                  ? "Recorded SpO₂ and respiratory annotations exercise the signal pipeline. Annotation-derived pressure is synthetic."
                  : "Reopen results with their original configuration, measured coverage, events and model assumptions."}
            </p>
          </div>
        </div>
        <Disclaimer />
        {config ? (
          <SimulationWorkspace
            key={session}
            config={config}
            active={view === "simulation"}
            onNew={() => {
              setConfig(null);
              setSession((s) => s + 1);
            }}
            authEpoch={authEpoch}
            onSaved={() => setRefresh((r) => r + 1)}
          />
        ) : (
          <div hidden={view !== "simulation"}>
            <Configuration
              onApply={(c) => {
                setConfig(c);
                setSession((s) => s + 1);
              }}
            />
          </div>
        )}
        <div hidden={view !== "replay"}>
          <ReplayDashboard active={view === "replay"} />
        </div>
        <div hidden={view !== "library"}>
          <SavedRuns
            refresh={refresh}
            authEpoch={authEpoch}
            onAuth={() => setAuthEpoch((n) => n + 1)}
          />
        </div>
      </main>
      <footer className="footer">
        Oxygen Dispatcher · Research simulation and recorded-data replay. No
        clinical efficacy or hospital cost savings have been established.
      </footer>
    </div>
  );
}
