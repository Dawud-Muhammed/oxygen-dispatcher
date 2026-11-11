# Oxygen Dispatcher architecture

Oxygen Dispatcher is a browser research prototype with an optional Laravel persistence and explanation service. Synthetic simulation, recorded-data replay and financial estimates are separate workflows. No physical sensor or valve is connected. AI has no path into control decisions.

## Synthetic experiment boundary

`web/src/sim/engine.ts` is the calculation entry point. `ExperimentEngine` validates and freezes `ExperimentConfig`, creates one `ExogenousTrace`, two `PatientSimulator` instances, and one `ValveController`. The trace supplies comparable breathing and random noise to both arms. Only the patient-response model receives hidden need. `ValveController.tick` receives current measured inputs and explicit observation metadata.

```text
Immutable configuration + seed + recorded fault schedule
                         |
                  ExperimentEngine
                         |
      shared breathing / pressure / noise / hidden need
                  /                         \
       constant-flow command        current observations
                 |                          |
       PatientSimulator A             ValveController
                 |                          |
        response + source gas         current command
                 |                          |
                 |                 PatientSimulator B
                  \                         /
             duration / validity / gas accounting
                         |
          snapshot + exported experiment record
```

`web/src/sim/compare.ts` calls the engine synchronously for batch work. `web/src/sim/useSim.ts` contains only UI lifecycle and wall-clock scheduling. `SimulationClock` converts wall time and speed into a target elapsed simulation time; it does not change model timestep. React receives copied snapshots with stable run, event and alarm identifiers. The mathematical details and interval boundaries are in [model.md](model.md).

`web/src/App.tsx` coordinates the three views. Focused modules in `web/src/workspace/` own configuration (`Configuration.tsx`), execution and saving (`SimulationWorkspace.tsx`), saved-run selection (`SavedRuns.tsx`) and review (`RunReview.tsx`). Its keyed experiment view captures configuration at run creation. `web/src/components/PipelineDiagram.tsx` separates request, modeled delivery and respiratory state. `Charts.tsx`, `Counters.tsx`, `AlarmBanner.tsx` and `EventLog.tsx` present sampled context, aggregate outcomes and persistent history. `BirrCalc.tsx` uses explicitly hypothetical episode/oxygen-hour costs, separately from patient-model outcomes.

## Run lifecycle and persistence

An engine starts at time zero. Start and resume schedule fixed intervals. Pause stops scheduling; reset/new run creates a new engine and identifier. Completion stops exactly at the configured end. The current UI and private API save completed experiments only. For programmatic debugging, the engine can also export a partial experiment: it retains requested duration in configuration and actual completed duration in `summary.simDurationS`. These distinct fields prevent an interrupted experiment from being mistaken for a completed run.

`ExperimentEngine.exportRun()` returns `ExperimentRecord` with:

- `client_run_id`, `scenario`, `seed` and the fully resolved immutable `config`.
- `summary.armA`, `summary.armB`, `summary.oxygenSavedPct` and actual `summary.simDurationS`.
- Complete recorded `faults`, retained `event_log`, retained `alarms` and sampled `series`.
- `provenance`: schema/model/controller identifiers, source, verification status, step size and dropped-history counts.

Internal identifiers support compatibility and reproduction. They are not visible product version badges. Source gas and result durations remain full precision; UI formatting does not rewrite records.

Local browser persistence supports anonymous use without a backend. Local exports are user-controlled data and must not be treated as independently verified evidence. The optional API path is `web/src/api/client.ts` → authenticated Laravel routes → validated user-owned records. The server distinguishes client-submitted calculations from server computations. Saved historical records must not silently inherit new model semantics.

Alarms and events are review data, not transient render notifications. Acknowledgement changes the retained alarm's acknowledgement flag and records an event; it cannot clear the measured cause. The fault schedule records observation interventions, allowing their timing to be reproduced independently of button-click history. Acknowledgement does not change the numerical experiment, so the reproduction command recreates aggregates without replaying acknowledgement actions.

## Reproducing an export in batch

Install the frontend dependencies with `npm ci` in `web/`. Save a synthetic experiment through the application and export its JSON. From `web/`, run:

```powershell
node scripts/reproduce-run.mjs "C:\path\original-run.json" "C:\path\recomputed-run.json"
```

`web/scripts/reproduce-run.mjs` uses the already installed Vite loader to import the actual TypeScript engine; it does not duplicate equations or open an HTTP listener. It accepts an exported record, or an object whose `record` property contains it. It checks the supported synthetic model identifier, builds `new ExperimentEngine(record.config, newRunId, record.faults)`, and advances only to the exported actual duration. A programmatic partial debugging export is therefore not silently extended to the requested final duration, even though the UI and private API accept only completed experiments. Fault schedule validation occurs in the engine constructor.

Exit status is 0 when full-precision aggregate results match exactly, 2 when they differ, and 1 for malformed/unsupported inputs or execution errors. JSON object key order does not affect comparison. The schema, model, controller and timestep identifiers must match the supported implementation. The output is a new computed record. It has a new identifier and regenerated controller events; injected-fault button events and operator acknowledgements remain in the original evidence record. The command requires a separate, new output file and refuses to overwrite either its source or any existing output. CLI regression tests cover a 1.25-second run with a recorded fault, object-order-independent comparison, incompatible provenance and evidence-file preservation.

For direct TypeScript callers, the essential pattern is:

```ts
const repeated = new ExperimentEngine(
  record.config,
  crypto.randomUUID(),
  record.faults,
);
while (repeated.timeS < record.summary.simDurationS) repeated.step();
const results = repeated.exportRun();
```

The exported actual duration must be an engine interval boundary. A full run can end on its configured shorter final interval. Identical configuration, seed and faults reproduce numerical outcomes across live and batch paths; browser timing changes only how quickly those intervals execute.

## Recorded-data boundary

`web/src/sim/replay.ts` handles recording validation, subject-local time and one-to-one event matching. `web/src/sim/useReplay.ts` loads subjects and schedules the replay UI. `web/scripts/convert-bidmc.mjs` converts source files and metadata into the public replay format. `web/public/replay/manifest.json` describes available records; the recording workflow must handle empty or unavailable sources explicitly.

The source is the BIDMC PPG and Respiration Dataset. Recorded SpO₂ is a measurement, while annotation-derived pressure is synthetic. Because the detector's pressure signal can be built from the same annotations used as references, matching scores exercise integration, not independent breath-detection validation. A replay is never fed through the synthetic patient-response model to claim treatment effect or oxygen savings. See [replay.md](replay.md) for matching windows, censoring and recording boundaries.

## Explanation boundary

`web/src/api/client.ts` sends selected run/event context to the optional Laravel service. Provider credentials remain server-side. API requests require ownership and validated context, and explanations are attached to stable run/event identifiers. Missing provider credentials or an offline API must leave simulation and replay functional. A provider response is explanatory text, not a flow command, configuration update or patient-specific recommendation.

## Verification entry points

From `web/`:

```powershell
npm test
npm run build
npm run lint
```

Core scientific regressions are in `web/src/sim/__tests__/simulation.test.ts`. They include full twelve-hour runs, exact source volumes, partial intervals, live/batch parity, invalid measurements, expiry and coverage, pulse rearming, fallback precedence/recovery, persistent alarm episodes and command-line reproduction. Replay, financial and persistence tests cover their own boundaries. Backend tests run separately from `api/` with `php artisan test` and need the documented PHP extensions and database driver.
