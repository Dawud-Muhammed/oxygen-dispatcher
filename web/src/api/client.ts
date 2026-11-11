import type { ExperimentRecord } from "../sim/engine";
export const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:8000/api";
const TOKEN_KEY = "oxygen-dispatcher.access-token";
export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}
export class OfflineError extends Error {
  constructor() {
    super(
      "The API is unavailable. Local simulation, browser saving and JSON export still work.",
    );
    this.name = "OfflineError";
  }
}
export class HttpError extends Error {
  status: number;
  path: string;
  detail: string;
  constructor(status: number, path: string, detail = "") {
    super("API request failed (" + status + ").");
    this.name = "HttpError";
    this.status = status;
    this.path = path;
    this.detail = detail;
  }
}
async function request<T>(
  path: string,
  body: unknown | undefined,
  signal?: AbortSignal,
  { authenticated = true } = {},
): Promise<T> {
  let response: Response;
  try {
    const token = authenticated ? getToken() : null;
    response = await fetch(BASE + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch {
    if (signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    throw new OfflineError();
  }
  if (!response.ok) {
    let detail = "";
    if (response.status === 422) {
      try {
        const json = await response.json();
        detail = typeof json.message === "string" ? json.message : "";
      } catch {
        /* Non-JSON error pages are not shown. */
      }
    }
    throw new HttpError(response.status, path, detail);
  }
  return response.json() as Promise<T>;
}
export function friendlyError(e: unknown): string {
  if (e instanceof Error && e.name === "QuotaExceededError")
    return "Browser storage is full. Export JSON, then remove an older browser copy from Saved runs. Existing saved data has been retained.";
  if (e instanceof HttpError) {
    if (e.status === 401)
      return "Authentication required. Connect a valid personal access token in Saved runs.";
    if (e.status === 403 || e.status === 404)
      return "This record is unavailable to the current account.";
    if (e.status === 409)
      return "This run identifier already belongs to different data. Export the result and start a new run.";
    if (e.status === 422)
      return "The API rejected the submitted data. " + e.detail;
    if (e.status === 429)
      return "Request limit reached. Wait before trying again.";
    if (e.status >= 500)
      return "The API could not complete the request. Try again later.";
    return e.message;
  }
  if (e instanceof Error)
    return e.name === "AbortError" ? "Request cancelled." : e.message;
  return "An unexpected error occurred.";
}
export interface RunRecord extends ExperimentRecord {
  id: number;
  created_at: string;
  legacy?: boolean;
}
export type RunListRecord = Pick<
  RunRecord,
  "id" | "client_run_id" | "scenario" | "created_at" | "summary"
>;
export interface Explanation {
  source: "ai" | "template";
  reason?: string;
}

export type ReplayHelpAction = "explain" | "ask" | "handover";
export type ReplayHelpView = "valve" | "spo2";

export interface ReplayHelpRequest {
  subject_id: string;
  view: ReplayHelpView;
  action: ReplayHelpAction;
  start_s: number;
  end_s: number;
  event_id?: string;
  question?: string;
  history?: string[];
}

export interface ReplayHelpResponse {
  text: string;
  source: "ai" | "template";
  reason: string | null;
  evidence: { id: string; timeS: number; label: string; detail: string }[];
}

export function askAboutReplay(
  payload: ReplayHelpRequest,
  signal: AbortSignal,
) {
  return request<ReplayHelpResponse>("/ai/replay", payload, signal, {
    authenticated: false,
  });
}
export function saveRun(payload: ExperimentRecord, signal?: AbortSignal) {
  return request<RunRecord>("/runs", payload, signal);
}
export function listRuns(signal?: AbortSignal) {
  return request<RunListRecord[]>("/runs", undefined, signal);
}
export function getRun(id: number, signal?: AbortSignal) {
  return request<RunRecord>("/runs/" + id, undefined, signal);
}
export function getHandover(runId: number, signal?: AbortSignal) {
  return request<Explanation & { note: string }>(
    "/ai/handover",
    { run_id: runId },
    signal,
  );
}
export function askAboutRun(
  runId: number,
  question: string,
  signal?: AbortSignal,
) {
  return request<Explanation & { answer: string }>(
    "/ai/ask",
    { run_id: runId, question },
    signal,
  );
}
export function explainEvent(
  runId: number,
  eventId: string,
  signal?: AbortSignal,
) {
  return request<Explanation & { explanation: string }>(
    "/ai/explain-event",
    { run_id: runId, event_id: eventId },
    signal,
  );
}
