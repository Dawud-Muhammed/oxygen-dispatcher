import type { ArmStats } from "../sim/engine";
const seconds = (n: number) =>
  n < 60 ? n.toFixed(2) + " s" : (n / 60).toFixed(2) + " min";
export function Counters({
  armA,
  armB,
  savedPct,
  durationS,
  target = [92, 96],
  critical = 88,
}: {
  armA: ArmStats;
  armB: ArmStats;
  savedPct: number | null;
  durationS: number;
  target?: [number, number];
  critical?: number;
}) {
  const rows: [string, keyof ArmStats][] = [
    ["Below target", "belowRangeS"],
    ["Within target", "inRangeS"],
    ["Above target", "aboveRangeS"],
    ["Below critical threshold", "belowCriticalS"],
    ["Missing data", "missingS"],
    ["Invalid data", "invalidS"],
    ["Stale data", "staleS"],
    ["Low-quality data", "lowQualityS"],
  ];
  return (
    <>
      <div className="metrics">
        <div className="metric">
          <div className="metric-label">A · continuous source use</div>
          <div className="metric-value">
            {armA.totalOxygenL.toFixed(2)} <small>L</small>
          </div>
          <small>Integrated modeled flow</small>
        </div>
        <div className="metric">
          <div className="metric-label">B · controlled source use</div>
          <div className="metric-value">
            {armB.totalOxygenL.toFixed(2)} <small>L</small>
          </div>
          <small>Includes all fallback delivery</small>
        </div>
        <div className="metric featured">
          <div className="metric-label">Modeled gas reduction</div>
          <div className="metric-value">
            {savedPct === null ? "Not applicable" : savedPct.toFixed(2) + "%"}
          </div>
          <small>
            {savedPct !== null && savedPct < 0
              ? "Controlled arm used more gas."
              : "Relative to Arm A; not measured savings."}
          </small>
        </div>
      </div>
      <section className="card">
        <h2>Observed simulation outcomes</h2>
        <p className="muted">
          Elapsed {seconds(durationS)}. SpO₂ range {target[0]}–{target[1]}%;
          critical threshold below {critical}%. Unavailable SpO₂ intervals stay
          in the coverage denominator. Pressure validity is shown separately.
          These metrics do not establish clinical safety.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Measurement</th>
                <th>A · continuous</th>
                <th>B · controlled</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, key]) => (
                <tr key={key}>
                  <th>{label}</th>
                  <td>{seconds(armA[key] ?? 0)}</td>
                  <td>{seconds(armB[key] ?? 0)}</td>
                </tr>
              ))}
              <tr>
                <th>Valid-data coverage</th>
                <td>
                  {armA.validCoveragePct === null
                    ? "Not applicable"
                    : armA.validCoveragePct.toFixed(2) + "%"}
                </td>
                <td>
                  {armB.validCoveragePct === null
                    ? "Not applicable"
                    : armB.validCoveragePct.toFixed(2) + "%"}
                </td>
              </tr>
              <tr>
                <th>Controller alarm episodes</th>
                <td>Not applicable</td>
                <td>{armB.alarmEpisodes}</td>
              </tr>
              <tr>
                <th>Any controller alarm active</th>
                <td>Not applicable</td>
                <td>{seconds(armB.alarmActiveS)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <small>
          Alarm episodes represent controller conditions, not nurse
          interventions. Arm A has no controller alarm system.
        </small>
      </section>
    </>
  );
}
