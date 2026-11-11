import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AlarmBanner } from "./AlarmBanner";
import { Counters } from "./Counters";
import { PipelineDiagram } from "./PipelineDiagram";
import type { Alarm } from "../sim/controller";
import type { ArmStats } from "../sim/engine";

const arm: ArmStats = {
  totalOxygenL: 1,
  belowRangeS: 1,
  inRangeS: 3,
  aboveRangeS: 1,
  belowCriticalS: 0.2,
  missingS: 2.35,
  invalidS: 0.2,
  staleS: 0.1,
  lowQualityS: 0.15,
  validS: 5,
  validCoveragePct: 64.1025641025641,
  alarmEpisodes: 2,
  alarmActiveS: 1.25,
};
const alarm: Alarm = {
  id: "alarm-1",
  code: "SENSOR_UNRELIABLE",
  level: "WARNING",
  message: "Signal unavailable.",
  onsetS: 2,
  active: true,
  acknowledged: false,
  resolvedS: null,
  activeDurationS: 3,
};
const plain = (html: string) => html.replace(/<[^>]+>/g, "");
const pipeline = {
  flowB: 5,
  actualFlowB: 5,
  valveOpen: true,
  isInhaling: false,
  controllerMode: "sensor_fallback",
  pulseVolumeMl: 20,
  spo2B: 95,
};

/**
 * Static React rendering tests. These test presentation semantics, not DOM
 * events, hook lifecycles, browser layout or accessibility-tree behavior.
 */
describe("research UI presentation semantics", () => {
  it.each([
    { valveOpen: true, isInhaling: false, phase: "exhalation" },
    { valveOpen: false, isInhaling: true, phase: "inhalation" },
  ])(
    "shows the respiratory phase independently of the valve: $phase",
    ({ phase, ...state }) => {
      const html = plain(
        renderToStaticMarkup(
          <PipelineDiagram
            snap={{
              ...pipeline,
              ...state,
              actualFlowB: state.valveOpen ? 5 : 0,
            }}
          />,
        ),
      );
      expect(html).toContain("Breathing phase: " + phase);
      expect(html).toContain(
        "Flow setpoint · valve " + (state.valveOpen ? "open" : "closed"),
      );
    },
  );
  it("keeps requested flow, closed-valve delivery and unavailable saturation distinct", () => {
    const html = plain(
      renderToStaticMarkup(
        <PipelineDiagram
          snap={{ ...pipeline, valveOpen: false, actualFlowB: 0, spo2B: null }}
        />,
      ),
    );
    expect(html).toContain("REQUEST5.00 L/min");
    expect(html).toContain("DELIVERY0.00 L/min");
    expect(html).toContain("SYNTHETIC PATIENTUnavailable");
    expect(html).toContain("Current / last synchronized pulse: 20.00 mL");
  });
  it("states the configured range and shows short unavailable-data intervals in seconds", () => {
    const html = renderToStaticMarkup(
      <Counters
        armA={arm}
        armB={arm}
        savedPct={0}
        durationS={7.8}
        target={[88, 92]}
        critical={85}
      />,
    );
    expect(plain(html)).toContain(
      "SpO₂ range 88–92%; critical threshold below 85%.",
    );
    expect(html).toContain(
      "<th>Missing data</th><td>2.35 s</td><td>2.35 s</td>",
    );
    expect(html).toContain(
      "<th>Invalid data</th><td>0.20 s</td><td>0.20 s</td>",
    );
    expect(html).toContain("<th>Stale data</th><td>0.10 s</td><td>0.10 s</td>");
    expect(html).toContain(
      "<th>Low-quality data</th><td>0.15 s</td><td>0.15 s</td>",
    );
    expect(plain(html)).toContain("64.10%");
  });
  it("shows an undefined gas comparison as not applicable rather than zero percent", () => {
    const html = renderToStaticMarkup(
      <Counters
        armA={{ ...arm, totalOxygenL: 0 }}
        armB={arm}
        savedPct={null}
        durationS={7.8}
      />,
    );
    expect(html).toContain(
      'Modeled gas reduction</div><div class="metric-value">Not applicable',
    );
    expect(html).not.toContain(
      'Modeled gas reduction</div><div class="metric-value">0.00%',
    );
  });
  it("retains negative reduction and avoids treating controller alarms as staff actions", () => {
    const html = renderToStaticMarkup(
      <Counters
        armA={arm}
        armB={{ ...arm, totalOxygenL: 1.5 }}
        savedPct={-50}
        durationS={7.8}
      />,
    );
    expect(plain(html)).toContain("-50.00%");
    expect(plain(html)).toContain("Controlled arm used more gas.");
    expect(html).toContain(
      "<th>Controller alarm episodes</th><td>Not applicable</td><td>2</td>",
    );
    expect(plain(html)).toContain("not nurse interventions");
    expect(plain(html)).not.toMatch(/Safety\s+(PASS|FAIL)/i);
  });
  it("keeps an acknowledged alarm active while its cause persists", () => {
    const html = renderToStaticMarkup(
      <AlarmBanner
        alarms={[{ ...alarm, acknowledged: true }]}
        onAcknowledge={() => {}}
      />,
    );
    expect(plain(html)).toContain("Active · warning");
    expect(plain(html)).toContain("Acknowledged");
    expect(plain(html)).toContain("Acknowledgement does not clear the cause.");
    expect(html).not.toContain("<button");
    expect(plain(html)).not.toContain("resolved alarm episode");
  });
  it("offers acknowledgement for an active episode and retains resolved history separately", () => {
    const html = renderToStaticMarkup(
      <AlarmBanner
        alarms={[
          alarm,
          { ...alarm, id: "alarm-2", active: false, resolvedS: 5 },
        ]}
        onAcknowledge={() => {}}
      />,
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(plain(html)).toContain("1 resolved alarm episode");
    expect(plain(html)).toContain("Resolved · warning");
    expect(plain(html)).toContain("Onset 2.0 s · Resolved 5.0 s");
  });
});
