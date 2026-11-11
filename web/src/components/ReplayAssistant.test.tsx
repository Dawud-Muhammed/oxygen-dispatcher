// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api/client";
import { ReplayAssistant } from "./ReplayAssistant";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setToken("");
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
