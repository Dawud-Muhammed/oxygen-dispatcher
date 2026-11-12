import { lazy, Suspense, useState } from "react";
import { ReplayAssistant } from "./components/ReplayAssistant";
import { ReplayDashboard } from "./components/ReplayDashboard";
import { SpO2Review } from "./workspace/SpO2Review";
import "./dispatcher.css";

const ResearchWorkspace = lazy(() => import("./ResearchWorkspace"));

export default function App() {
  if (
    new URLSearchParams(window.location.search).get("workspace") === "research"
  ) {
    return (
      <Suspense fallback={<p role="status">Loading research workspace…</p>}>
        <ResearchWorkspace />
      </Suspense>
    );
  }
  return <Dispatcher />;
}

function Dispatcher() {
  const [view, setView] = useState<"valve" | "spo2">("valve");

  return (
    <div className="od-app">
      <header className="od-topbar">
        <div className="od-topbar-inner">
          <div className="od-brand">
            <span className="od-mark" aria-hidden="true">
              O₂
            </span>
            <strong>Oxygen Dispatcher</strong>
          </div>
          <nav className="od-navigation" aria-label="Workspace views">
            <button
              aria-current={view === "valve" ? "page" : undefined}
              onClick={() => setView("valve")}
            >
              Valve Replay
            </button>
            <button
              aria-current={view === "spo2" ? "page" : undefined}
              onClick={() => setView("spo2")}
            >
              SpO₂ Review
            </button>
          </nav>
          <button
            className="od-access-button"
            onClick={() => {
              const input = document.getElementById(
                "replay-ai-question-" + view,
              );
              input?.scrollIntoView({ block: "nearest" });
              input?.focus({ preventScroll: true });
            }}
          >
            <span aria-hidden="true">✦</span> Ask AI
          </button>
        </div>
      </header>
      <main className="od-content">
        <div className="od-page-heading">
          <div>
            <h1>{view === "valve" ? "Valve Replay" : "SpO₂ Review"}</h1>
            <p>
              {view === "valve"
                ? "See how the virtual valve follows estimated breathing phases from the recorded waveform."
                : "Review changes and gaps in recorded oxygen saturation."}
            </p>
          </div>
          <span className="od-source-label">BIDMC research replay</span>
        </div>
        <div hidden={view !== "valve"}>
          <ReplayDashboard
            active={view === "valve"}
            renderAssistant={({
              subjectId,
              startS,
              endS,
              eventId,
              seek,
              sessionKey,
            }) => (
              <ReplayAssistant
                key={sessionKey}
                subjectId={subjectId}
                view="valve"
                startS={startS}
                endS={endS}
                eventId={eventId}
                onEvidence={seek}
              />
            )}
          />
        </div>
        <div hidden={view !== "spo2"}>
          <SpO2Review active={view === "spo2"} />
        </div>
        <footer className="od-footer">
          <span>
            Recorded data and virtual valve commands. For research and
            demonstration.
          </span>
          <a
            href="https://physionet.org/content/bidmc/1.0.0/"
            target="_blank"
            rel="noreferrer"
          >
            BIDMC dataset ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
