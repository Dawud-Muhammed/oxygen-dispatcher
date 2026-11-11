import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ResponsiveContainer,
} from "recharts";
export interface ChartPoint {
  timeS: number;
  spo2A: number | null;
  spo2B: number | null;
  flowA: number;
  flowB: number;
  actualFlowB?: number;
}
const time = (v: unknown) => `${(Number(v) / 60).toFixed(1)} min`;
export function Charts({
  series,
  target = [92, 96],
}: {
  series: ChartPoint[];
  target?: [number, number];
}) {
  if (!series.length)
    return (
      <section className="card empty">
        Start an experiment to see synthetic saturation and modeled delivery
        over time.
      </section>
    );
  return (
    <section className="card">
      <h2>Complete experiment trends</h2>
      <p className="muted">
        Display samples retain the beginning and end of the run. Aggregate
        metrics use every interval.
      </p>
      <h3>Synthetic oxygen saturation (%)</h3>
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series}>
            <CartesianGrid stroke="#e1e9e9" strokeDasharray="3 3" />
            <XAxis
              dataKey="timeS"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={time}
            />
            <YAxis domain={[65, 100]} width={38} />
            <Tooltip labelFormatter={time} />
            <Legend />
            <ReferenceArea
              y1={target[0]}
              y2={target[1]}
              fill="#17674c"
              fillOpacity={0.08}
            />
            <Line
              dataKey="spo2A"
              name="A · continuous"
              stroke="#927245"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              dataKey="spo2B"
              name="B · controlled"
              stroke="#086b62"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <h3>Flow (L/min)</h3>
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series}>
            <CartesianGrid stroke="#e1e9e9" strokeDasharray="3 3" />
            <XAxis
              dataKey="timeS"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={time}
            />
            <YAxis width={38} />
            <Tooltip labelFormatter={time} />
            <Legend />
            <Line
              dataKey="flowA"
              name="A · delivery"
              stroke="#927245"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="flowB"
              name="B · setpoint"
              stroke="#086b62"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="actualFlowB"
              name="B · sampled delivery"
              stroke="#537caa"
              dot={false}
              strokeDasharray="3 3"
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <small>
        Delivery is modeled, not measured. Sparse chart samples cannot resolve
        each pulse; pulse volume and cumulative consumption use every engine
        tick.
      </small>
    </section>
  );
}
