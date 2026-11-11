# Oxygen Dispatcher

A research workspace for synthetic oxygen-delivery experiments and recorded-data integration checks. No physical sensor or valve is connected. The model is uncalibrated and does not establish clinical efficacy, safety certification, or hospital savings.

## Run the dashboard

Use Node.js 22.12 or newer (the installed Vite release requires a recent Node runtime).

```powershell
cd web
npm ci
npm run dev
```

Open the local URL printed by Vite. Simulation, recording replay, browser storage and JSON export work without an API or AI key. The converted active BIDMC recording is included in `web/public/replay/`.

Checks:

```powershell
npm test
npm run lint
npm run build
npm run format:check
```

## Main workflows

1. **Configure and prepare.** Select scenario, duration, seed and continuous flow. Expand the research settings to change controller bounds, fallback delivery and utilization. Preparation validates and freezes a configuration.
2. **Start and observe.** Pause/resume without changing scientific steps. Introduce a 30-second signal fault, inspect its consequences, and acknowledge alarms without clearing their causes. Reset creates a new run identity. Configure a new experiment to change assumptions.
3. **Finish and review.** Runs stop at the requested duration. Review gas use, measured range durations, unavailable data, coverage and alarm episodes. Save in this browser, export JSON, or save to an authenticated API. Negative gas reduction remains negative; zero baseline shows “Not applicable.”
4. **Reopen.** Saved runs retain configuration, fault schedule, aggregates, alarm/event history and sampled full-run charts. Browser copies can be removed individually after export.
5. **Replay.** Select a recording, play, pause, reset and inspect matching results. Playback stops by default. Optional repeat keeps completed-pass results and cumulative scores. Switching views or hiding the tab pauses execution.

Acceleration requests simulated seconds per elapsed foreground second. Rendering is limited independently. Long scheduling interruptions earn no catch-up time; hardware throughput may limit achievable acceleration.

## Project structure

- `web/src/sim/engine.ts`: shared scientific engine, immutable run configuration, accounting and snapshots.
- `web/src/sim/patient.ts`: shared exogenous inputs and integrated-dose response.
- `web/src/sim/controller.ts`: explicit modes, measurement validity, averaging, alarms and event identifiers.
- `web/src/sim/useSim.ts`: UI scheduler; `compare.ts` runs the same engine in batch.
- `web/src/sim/replay.ts`, `useReplay.ts`: replay engine, matching, loading and scheduling.
- `web/src/App.tsx`, `workspace/`, `components/`: configuration, live observation, review, persistence and explanations.
- `web/src/finance.ts`: hypothetical episode-based financial estimate.
- `api/`: Laravel authentication, owned run storage and optional explanation API.
- `data/bidmc/`: available source CSV files; `web/scripts/convert-bidmc.mjs`: timestamp-aware converter.
- `docs/model.md`: equations and state policies; `docs/replay.md`: ingestion and scoring; `docs/architecture.md`: data flow and reproduction.
- `docs/refactor-progress.md`: issue-to-fix record and executed checks.

## Corrected measurements

Source consumption is integrated identically in both arms:

```text
volumeL += actualFlowLpm * intervalSeconds / 60
```

The utilization factor affects only the synthetic physiological response. The response integrates delivery during inhalation; a short pulse receives proportionally less dose than a long pulse. Both arms use the same utilization and response equations. The controller only receives current pressure and SpO₂ measurements, never hidden oxygen need or future breaths.

Below/within/above range and missing/invalid/stale/low-quality intervals cover the whole actual run. Coverage uses all elapsed seconds as its denominator. Alarm episodes and seconds with any active controller alarm are different measures. The continuous arm has no controller alarm policy, so its alarm columns are not an intervention comparison.

The financial calculator uses episodes × oxygen-hours per episode × flow × 60. It separately reports gas reduction, hypothetical avoided cash cost, a configurable fee and fixed charge, other costs, and net benefit. Prices and cash realization are placeholders; a simulated gas reduction is not a verified hospital cash saving.

## Optional private API

Use PHP and Composer versions compatible with `api/composer.json` and its lockfile. See `api/README.md` for database, access-token, TLS and AI setup. The frontend API base is configured using:

```dotenv
VITE_API_URL=http://localhost:8000/api
```

The API requires a provisioned personal access token for saved-run and AI routes. Enter it in **Saved runs → Private API connection**. The browser stores it only for the tab session. Saved records are owner-scoped, retries reuse a stable client run identifier, and older unowned records remain preserved and inaccessible to ordinary users. Additive migrations do not reinterpret old results as current-model evidence.

The API validates submitted structure and aggregate consistency; it does not independently recompute the TypeScript experiment. AI explanations consume saved context only and cannot control delivery or modify runs. Missing providers and failures return clearly marked deterministic text. Credentials stay server-side; certificate verification remains enabled.

## Replay attribution and limits

The source is the [BIDMC PPG and Respiration Dataset](https://physionet.org/content/bidmc/1.0.0/). Preserve its source attribution and applicable dataset license when redistributing source or derived files.

Replay uses recorded SpO₂ and **synthetic pressure derived from respiratory annotations**. Scoring that fixture against those same annotations is an integration exercise, not independent detection validation. Annotator 1 is the explicit reference; annotator 2 and disagreement metadata are retained. Negative timing means earlier than the chosen annotation, not prediction. The recording cannot establish treatment response or oxygen savings.

See `docs/replay.md` for conversion commands, timestamp coverage, source hashes, matching boundaries and repeat behavior.

## Research limits

The physiological relationship, utilization, sensor behavior and fallback thresholds are experimental assumptions. Actual pneumatic dynamics, leakage, oxygen concentration, hardware faults, patient-specific physiology and clinical decision making are not represented. Acknowledgements represent UI actions, not nurse interventions. Long histories and charts are bounded; exports disclose omitted event/alarm counts while aggregates retain all elapsed intervals. Browser storage is a convenience, not a durable clinical record. No deployment, regulatory submission or patient testing is included.
