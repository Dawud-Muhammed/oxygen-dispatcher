// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReplayDashboard } from "./ReplayDashboard";
import recording from "../../public/replay/subject_04.json";
import evidence from "../../public/replay/subject_04_evidence.json";

vi.mock("recharts", () => ({
  CartesianGrid: () => null,
  ComposedChart: () => null,
  Line: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows unknown, open, and closed waveform estimates and passes the exact event to the assistant", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(url.endsWith("_evidence.json") ? evidence : recording),
    ),
  );
  const { container } = render(
    <ReplayDashboard
      renderAssistant={({ eventId, startS, endS }) => (
        <output data-testid="assistant-selection">
          {eventId} {startS}–{endS}
        </output>
      )}
    />,
  );

  const unknown = await screen.findByRole("button", {
    name: "00:00.000 Phase unknown",
  });
  fireEvent.click(unknown);
  expect(unknown.getAttribute("aria-pressed")).toBe("true");
  expect(
    container.querySelector(".valve-device")?.getAttribute("data-state"),
  ).toBe("unknown");
  expect(
    screen.getByRole("group", { name: "Virtual valve: No command" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("img", {
        name: "Estimated valve state across the chart window",
      })
      .querySelector("[data-phase='unknown']"),
  ).toBeTruthy();

  const open = screen.getByRole("button", { name: "00:00.904 Opened" });
  fireEvent.click(open);
  expect(open.getAttribute("aria-pressed")).toBe("true");
  expect(
    container.querySelector(".valve-device")?.getAttribute("data-state"),
  ).toBe("open");
  expect(screen.getByTestId("assistant-selection").textContent).toContain(
    "valve-113 0–0.904",
  );
  expect(screen.getByText(/rose out of its low band/)).toBeTruthy();

  const closed = screen.getByRole("button", { name: "00:01.592 Closed" });
  fireEvent.click(closed);
  expect(closed.getAttribute("aria-pressed")).toBe("true");
  expect(
    container.querySelector(".valve-device")?.getAttribute("data-state"),
  ).toBe("closed");
  expect(screen.getByTestId("assistant-selection").textContent).toContain(
    "valve-199 0–1.592",
  );
});
