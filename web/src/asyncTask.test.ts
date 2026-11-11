import { it, expect } from "vitest";
import { LatestTask } from "./asyncTask";
it("cancels old requests and rejects out-of-order results after a new run or unmount", () => {
  const gate = new LatestTask();
  const first = gate.begin();
  const second = gate.begin();
  expect(first.signal.aborted).toBe(true);
  expect(first.current()).toBe(false);
  expect(second.current()).toBe(true);
  gate.cancel();
  expect(second.current()).toBe(false);
  expect(second.signal.aborted).toBe(true);
});
