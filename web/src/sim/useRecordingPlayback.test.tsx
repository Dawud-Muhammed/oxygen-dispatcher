// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRecordingPlayback } from "./useRecordingPlayback";
import recording from "../../public/replay/subject_04.json";
import evidence from "../../public/replay/subject_04_evidence.json";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("starts a fresh assistant session on seek, reset, and replay from the end", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(url.endsWith("_evidence.json") ? evidence : recording),
    ),
  );
  const { result } = renderHook(() =>
    useRecordingPlayback({ subjectId: "04", speed: 1 }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  const initial = result.current.sessionKey;
  act(() => result.current.seek(5));
  expect(result.current.timeS).toBe(5);
  expect(result.current.sessionKey).not.toBe(initial);
  const sought = result.current.sessionKey;
  act(() => result.current.reset());
  expect(result.current.timeS).toBe(0);
  expect(result.current.sessionKey).not.toBe(sought);
  act(() => result.current.seek(recording.durationS));
  const ended = result.current.sessionKey;
  act(() => result.current.play());
  expect(result.current.timeS).toBe(0);
  expect(result.current.sessionKey).not.toBe(ended);
  act(() => result.current.pause());
});
