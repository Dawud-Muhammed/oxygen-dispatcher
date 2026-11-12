// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api/client";
import { ReplayAssistant } from "./ReplayAssistant";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setToken("");
});

it("answers at zero without reading ahead or calling AI", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<ReplayAssistant subjectId="04" view="valve" startS={0} endS={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Draft handover" }));
  await screen.findByText(/No playback has elapsed/);
  expect(fetch).not.toHaveBeenCalled();
});

it("discards an in-flight answer when the playback session resets", async () => {
  let resolve!: (response: Response) => void;
  let signal: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise<Response>((done) => {
        resolve = done;
      });
    }),
  );
  const { rerender } = render(
    <ReplayAssistant
      key="session-1"
      subjectId="04"
      view="valve"
      startS={0}
      endS={2}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Draft handover" }));
  rerender(
    <ReplayAssistant
      key="session-2"
      subjectId="04"
      view="valve"
      startS={0}
      endS={0}
    />,
  );
  expect(signal!.aborted).toBe(true);
  await act(async () =>
    resolve(
      Response.json({
        text: "Old session answer",
        source: "ai",
        reason: null,
        evidence: [],
      }),
    ),
  );
  expect(screen.queryByText("Old session answer")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Draft handover" }));
  await screen.findByText(/No playback has elapsed/);
});

it("keeps follow-up questions in the same replay window and leaves private credentials out", async () => {
  setToken("private-research-token");
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options: RequestInit) => {
      calls.push(options);
      return Response.json({
        text: "Answer from recording " + calls.length,
        source: "ai",
        reason: null,
        evidence: [],
      });
    }),
  );

  const { rerender } = render(
    <ReplayAssistant subjectId="04" view="valve" startS={0} endS={12} />,
  );
  const input = screen.getByRole("textbox", { name: "Ask about this replay" });
  async function ask(question: string, number: number) {
    fireEvent.change(input, { target: { value: question } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Answer from recording " + number);
  }
  await ask("When did it open?", 1);
  await ask("What was the pressure then?", 2);
  expect(screen.getByText("Answer from recording 1")).toBeTruthy();
  expect(new Headers(calls[0].headers).has("Authorization")).toBe(false);
  expect(JSON.parse(String(calls[1].body))).toMatchObject({
    history: ["When did it open?"],
    start_s: 0,
    end_s: 12,
  });

  rerender(
    <ReplayAssistant subjectId="04" view="valve" startS={10} endS={22} />,
  );
  await ask("How many changes are here?", 3);
  expect(JSON.parse(String(calls[2].body))).toMatchObject({
    history: [],
    start_s: 10,
    end_s: 22,
  });
});
