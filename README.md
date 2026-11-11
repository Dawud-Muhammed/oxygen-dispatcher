# Oxygen Dispatcher

A research workspace for demonstrating virtual valve timing and SpO₂ review with BIDMC recordings. No physical sensor or valve is connected. The demo does not measure gas consumption, establish clinical effectiveness, or verify oxygen savings.

## Run the dashboard

Use Node.js 22.12 or newer (the installed Vite release requires a recent Node runtime).

```powershell
cd web
npm ci
npm run dev
```

Open the local URL printed by Vite. You can play both recordings without the API. To use **Ask AI**, also start the Laravel API below. The prepared recordings and their event evidence are included in `web/public/replay/`.

Checks:

```powershell
npm test
npm run lint
npm run build
npm run format:check
```

## Demo workflows

1. **Valve Replay.** Play BIDMC Subject 04 at 1× to see the virtual valve follow estimated inhale and exhale on the original clock. The chart displays the recorded chest impedance waveform. Select a valve transition to inspect its timestamp and the waveform feature behind it.
2. **SpO₂ Review.** Select a rising, falling or missing-reading case and choose **Jump to case**. Play the original readings and inspect the on-screen notice. Acknowledge the notice or record a manual demo setting change. A SpO₂ notice cannot change that setting, and the setting does not change the recording.
3. **Replay assistant.** Select **Ask AI** on either replay. Explain a selected valve change or notice, ask about the time window shown in the chart, or draft a handover for review. The assistant uses only the selected recording and links its answers to source evidence. Follow-up questions can refer to earlier questions in the same window.

Add `?workspace=research` to the local URL to reopen the original synthetic experiments and saved runs. This workspace retains its modeled flow adjustments and financial estimates for internal testing.

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

## Laravel API and AI setup

Use PHP and Composer versions compatible with `api/composer.json` and its lockfile. See `api/README.md` for database, access-token, TLS and AI setup. The frontend API base is configured using:

```dotenv
VITE_API_URL=http://localhost:8000/api
```

The demo replay assistant works without a browser token when the API is running. The OpenAI key stays in the Laravel environment. Private saved simulation records still require a research token; enter it in **Saved runs** in the research workspace using the setup in [api/README.md](api/README.md).

The replay assistant loads the selected window from the prepared BIDMC evidence on the server. It explains recorded readings, waveform-based virtual valve commands, or review notices. A provider failure produces a labeled automatic summary. The saved-run API checks the structure and arithmetic of submitted simulations.

## Replay attribution and limits

The source is the [BIDMC PPG and Respiration Dataset](https://physionet.org/content/bidmc/1.0.0/). Preserve its source attribution and applicable dataset license when redistributing source or derived files.

Valve Replay uses BIDMC's recorded chest impedance and offline estimates of breathing phase. The source measures chest impedance rather than airflow, so the phase boundaries are estimates. The separate research workspace uses synthetic pressure derived from breath annotations to test controller logic. Its scores describe that integration test. These recordings cannot establish treatment response or oxygen savings.

See `docs/replay.md` for conversion commands, timestamp coverage, source hashes, matching boundaries and repeat behavior.

## Research limits

The physiological relationship, utilization, sensor behavior and fallback thresholds are experimental assumptions. Actual pneumatic dynamics, leakage, oxygen concentration, hardware faults, patient-specific physiology and clinical decision making are not represented. Acknowledgements represent UI actions, not nurse interventions. Long histories and charts are bounded; exports disclose omitted event/alarm counts while aggregates retain all elapsed intervals. Browser storage is a convenience, not a durable clinical record. No deployment, regulatory submission or patient testing is included.
