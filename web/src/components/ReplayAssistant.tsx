import { useEffect, useRef, useState } from "react";
import {
  askAboutReplay,
  friendlyError,
  HttpError,
  OfflineError,
} from "../api/client";
import type {
  ReplayHelpAction,
  ReplayHelpResponse,
  ReplayHelpView,
} from "../api/client";
import { LatestTask } from "../asyncTask";
import {
  formatRecordingTime,
  formatReplayEventTime,
} from "../sim/useRecordingPlayback";

interface ReplayAssistantProps {
  subjectId: string;
  view: ReplayHelpView;
  startS: number;
  endS: number;
  eventId?: string;
  onEvidence?: (timeS: number) => void;
  reviewActions?: { timeS: number; detail: string }[];
}

const resultLabels: Record<ReplayHelpAction, string> = {
  ask: "Answer",
  explain: "Explanation",
  handover: "Draft handover",
};

interface ReplayTurn {
  id: number;
  action: ReplayHelpAction;
  prompt: string;
  startS: number;
  endS: number;
  response: ReplayHelpResponse;
}

export function ReplayAssistant({
  subjectId,
  view,
  startS,
  endS,
  eventId,
  onEvidence,
  reviewActions = [],
}: ReplayAssistantProps) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState<{
    turn: ReplayTurn;
    text: string;
  }>();
  const [turns, setTurns] = useState<ReplayTurn[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const gate = useRef(new LatestTask());
  const transcript = useRef<HTMLOListElement>(null);
  const nextTurn = useRef(0);
  const focus = view === "valve" ? "valve change" : "notice";
  const formatEvidenceTime = (timeS: number) =>
    view === "valve"
      ? formatReplayEventTime(timeS)
      : formatRecordingTime(timeS, true);

  useEffect(() => {
    const task = gate.current;
    return () => task.cancel();
  }, []);

  useEffect(() => {
    const log = transcript.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns, pendingPrompt]);

  async function run(
    action: ReplayHelpAction,
    asked = question,
    clearDraft = false,
  ) {
    const task = gate.current.begin();
    const id = nextTurn.current++;
    const prompt =
      action === "ask"
        ? asked.trim()
        : action === "explain"
          ? "Explain this " + focus + "."
          : "Draft a handover.";
    const history = turns
      .filter(
        (turn) =>
          turn.action === "ask" && turn.startS === startS && turn.endS === endS,
      )
      .slice(-3)
      .map((turn) => turn.prompt);
    setBusy(true);
    setPendingPrompt(prompt);
    setError("");
    setCopyStatus(undefined);
    try {
      const response = await askAboutReplay(
        {
          subject_id: subjectId,
          view,
          action,
          start_s: startS,
          end_s: endS,
          ...(eventId && action === "explain" ? { event_id: eventId } : {}),
          ...(action === "ask" ? { question: prompt, history } : {}),
        },
        task.signal,
      );
      if (task.current()) {
        const actionsInWindow = reviewActions.filter(
          (item) => item.timeS >= startS && item.timeS <= endS,
        );
        const actionText = actionsInWindow
          .map(
            (item) =>
              formatRecordingTime(item.timeS, true) + " · " + item.detail,
          )
          .join("\n");
        setTurns((previous) => [
          ...previous.slice(-7),
          {
            id,
            action,
            prompt,
            startS,
            endS,
            response:
              action === "handover" && actionText
                ? {
                    ...response,
                    text:
                      response.text +
                      "\n\nDemo reviewer actions\n" +
                      actionText,
                  }
                : response,
          },
        ]);
        if (clearDraft) setQuestion("");
      }
    } catch (failure) {
      if (!task.current()) return;
      if (failure instanceof HttpError && [401, 403].includes(failure.status)) {
        setError(
          "The replay assistant is unavailable. Check that the demo API is up to date.",
        );
      } else if (failure instanceof OfflineError) {
        setError(
          "The AI service is offline. You can still inspect the replay.",
        );
      } else {
        setError(friendlyError(failure));
      }
    } finally {
      if (task.current()) {
        setBusy(false);
        setPendingPrompt("");
      }
    }
  }

  async function copyHandover(turn: ReplayTurn) {
    try {
      await navigator.clipboard.writeText(turn.response.text);
      setCopyStatus({ turn, text: "Draft copied." });
    } catch {
      setCopyStatus({ turn, text: "Select the draft text to copy it." });
    }
  }

  return (
    <aside className="od-assistant od-panel" aria-label="Replay assistant">
      <div className="od-panel-heading">
        <span className="od-ai-icon" aria-hidden="true">
          ✦
        </span>
        <div>
          <h2>Replay assistant</h2>
          <p>
            Subject {subjectId} · {formatRecordingTime(startS, true)}–
            {formatRecordingTime(endS, true)}
          </p>
        </div>
      </div>
      <p className="od-ai-scope">
        Ask about the visible chart. Answers use this replay’s evidence.
      </p>
      <div className="od-ai-actions">
        <button disabled={busy || !eventId} onClick={() => void run("explain")}>
          Explain {focus}
        </button>
        <button disabled={busy} onClick={() => void run("handover")}>
          Draft handover
        </button>
        <button
          className="od-ai-review"
          disabled={busy}
          onClick={() =>
            void run(
              "ask",
              "Which readings or events in this recording window should I review, and why?",
            )
          }
        >
          What should I review?
        </button>
      </div>
      {(turns.length > 0 || pendingPrompt) && (
        <ol
          className="od-ai-transcript"
          aria-label="Conversation"
          aria-live="polite"
          ref={transcript}
        >
          {turns.map((answer) => (
            <li key={answer.id} className="od-ai-turn">
              <p className="od-ai-user">
                <span className="od-ai-you">You</span>
                {answer.prompt}
              </p>
              <section
                className="od-ai-answer"
                aria-label={resultLabels[answer.action]}
              >
                <div className="od-ai-answer-top">
                  <h3>{resultLabels[answer.action]}</h3>
                  <span>
                    {answer.response.source === "ai"
                      ? "OpenAI"
                      : "Automatic summary"}
                  </span>
                </div>
                <small>
                  Subject {subjectId} ·{" "}
                  {formatRecordingTime(answer.startS, true)}–
                  {formatRecordingTime(answer.endS, true)}
                </small>
                <p>{answer.response.text}</p>
                {answer.response.reason && (
                  <small>{answer.response.reason}</small>
                )}
                {answer.response.evidence.length > 0 && (
                  <details className="od-ai-sources">
                    <summary>
                      Source evidence ({answer.response.evidence.length})
                    </summary>
                    <ul className="od-ai-evidence" aria-label="Source evidence">
                      {answer.response.evidence.map((evidence) => (
                        <li key={evidence.id}>
                          {onEvidence ? (
                            <button onClick={() => onEvidence(evidence.timeS)}>
                              <time>{formatEvidenceTime(evidence.timeS)}</time>
                              {evidence.label}
                            </button>
                          ) : (
                            <>
                              <time>{formatEvidenceTime(evidence.timeS)}</time>{" "}
                              {evidence.label}
                            </>
                          )}
                          <small>{evidence.detail}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {answer.action === "handover" && (
                  <>
                    <button onClick={() => void copyHandover(answer)}>
                      Copy draft
                    </button>
                    {copyStatus?.turn === answer && (
                      <small role="status">{copyStatus.text}</small>
                    )}
                  </>
                )}
              </section>
            </li>
          ))}
          {pendingPrompt && (
            <li className="od-ai-turn">
              <p className="od-ai-user">
                <span className="od-ai-you">You</span>
                {pendingPrompt}
              </p>
              <p role="status" className="od-ai-status">
                Reviewing recording evidence…
              </p>
            </li>
          )}
        </ol>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <form
        className="od-ai-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim() && !busy) void run("ask", question, true);
        }}
      >
        <label htmlFor={"replay-ai-question-" + view}>
          Ask about this {view === "valve" ? "replay" : "trend"}
        </label>
        <textarea
          id={"replay-ai-question-" + view}
          rows={2}
          maxLength={500}
          value={question}
          readOnly={busy}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            view === "valve"
              ? "Why did the valve open?"
              : "When did the reading return?"
          }
        />
        <button className="primary" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
    </aside>
  );
}
