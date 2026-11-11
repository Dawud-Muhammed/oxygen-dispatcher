export function AssumptionsPanel() {
  return (
    <section className="card">
      <h2>Research assumptions</h2>
      <p>
        Both arms share synthetic breathing and noise. Oxygen consumption is the
        integral of modeled actual flow. Physiological utilization is a
        separate, uncalibrated assumption.
      </p>
      <details>
        <summary>What this experiment can establish</summary>
        <p>
          Repeatable software behavior under the configured model. Saturation
          response is simplified and dose-dependent. It does not establish
          patient benefit or device safety.
        </p>
      </details>
      <details>
        <summary>What is outside the model</summary>
        <p>
          Real gas exchange, carbon dioxide, individual physiology, physical
          valve faults, oxygen compatibility and electrical safety need
          independent investigation.
        </p>
      </details>
      <small>
        Fallback modes and thresholds are configurable research policies, not
        treatment instructions.
      </small>
    </section>
  );
}
