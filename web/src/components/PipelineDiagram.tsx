interface PipelineState {
  flowB: number;
  actualFlowB: number;
  valveOpen: boolean;
  isInhaling: boolean;
  controllerMode: string;
  pulseVolumeMl: number;
  spo2B: number | null;
}
export function PipelineDiagram({ snap }: { snap: PipelineState }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2>Modeled delivery</h2>
        <span className="status">
          {snap.controllerMode.replaceAll("_", " ")}
        </span>
      </div>
      <div className="pipeline">
        <div>
          <small>REQUEST</small>
          <strong className="live-number">{snap.flowB.toFixed(2)} L/min</strong>
          <small>
            Flow setpoint · valve {snap.valveOpen ? "open" : "closed"}
          </small>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <small>DELIVERY</small>
          <strong className="live-number">
            {snap.actualFlowB.toFixed(2)} L/min
          </strong>
          <small>
            Instantaneous modeled flow
            <br />
            Current / last synchronized pulse: {snap.pulseVolumeMl.toFixed(
              2,
            )}{" "}
            mL
          </small>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <small>SYNTHETIC PATIENT</small>
          <strong className="live-number">
            {snap.spo2B === null ? "Unavailable" : snap.spo2B.toFixed(1) + "%"}
          </strong>
          <small>
            Breathing phase: {snap.isInhaling ? "inhalation" : "exhalation"}
          </small>
        </div>
      </div>
      <small>No physical source, sensor or valve is connected.</small>
    </section>
  );
}
