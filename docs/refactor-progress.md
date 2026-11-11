# Refactor implementation and verification record

Request: complete research-prototype refactor, started 2026-11-04; final checks continued 2026-11-05.

## Baseline and preservation

The pasted request is the implementation instruction. The supplied “oxygen dispatcher pitch.docx” is an audit reference; its findings were checked against source before changes. The original project files were untracked at baseline. No reset, clean, commit, production deployment or existing database migration was performed. A source archive was created before edits in the system temporary directory (oxygen-dispatcher-before-refactor-20261104-194329.zip), excluding secrets and generated dependencies.

The baseline frontend had 25 passing tests, three TypeScript build errors (two chart tooltip types and one unused replay value), and five lint warnings. Baseline behavior still contained incorrect efficiency-scaled consumption, peak-breath credit, duplicated live/batch calculations, transient alarms, broad safety verdicts and unauthenticated records.

## Confirmed issues mapped to implementation

1. **Duplicated scientific logic and interval mismatch.** `web/src/sim/engine.ts` now owns the causal sample/command/delivery/response/accounting interval. `compare.ts` and `useSim.ts` share it. The clock uses fixed 0.1-second steps plus an exact final remainder. Regression tests compare batch, accelerated and paused/resumed schedules.

2. **Discounted source consumption and peak-breath physiology.** `patient.ts` integrates actual L/min × seconds / 60 for consumption. Inhaled volume drives a separate dose reservoir, with identical utilization assumptions in both arms. Tests verify known volumes, zero delivery and longer-pulse dose dependence.

3. **Scattered controller overrides, repeated pulses and unreliable sensors.** `controller.ts` uses explicit precedence and pulse substates, continuous configured fallback, timestamped coverage windows and measurement-validity categories. Tests cover maximum-open duration, rearming, contiguous threshold timers, stale/nonfinite inputs, recovery and precedence.

4. **Lost alarms and misleading outcome labels.** Alarm episodes have IDs, onset, acknowledgement, active state, duration and resolution. `Counters.tsx` shows measured range durations, unavailable time, coverage and controller alarm counts. Staff-intervention and safety pass/fail claims were removed.

5. **Replay double matching and misleading validation.** `replay.ts` uses one deterministic matcher with pending windows and explicit boundary censoring. `useReplay.ts` keeps completed passes and rejects stale loads. Conversion uses CSV timestamps, explicit annotator policy and source hashes. Subject 04 and active manifest have regression coverage. The UI calls annotation-derived pressure synthetic and scores an integration exercise.

6. **Incomplete UI lifecycle and stale explanations.** The interface supports configuration, preparation, start, pause/resume, exact completion, fault injection, acknowledgement, review, browser saving, private API saving, reopening and export. New runs get new IDs; view changes pause execution. `LatestTask` cancels and rejects superseded requests. Explanation panels are keyed by run/account context.

7. **Financial overstatement.** `finance.ts` uses episodes × oxygen-hours × flow × 60, keeps a configurable benefit share/fixed charge, cash-realizable fraction and other customer costs. Negative benefit and undefined reduction remain visible. Known-value arithmetic and boundary tests replace fixed claimed savings.

8. **Public records, duplicate saves and weak validation.** Laravel routes require research-scoped bearer authentication. Records are owner-scoped, retry-safe and deeply validated. The additive migration preserves historical unowned records as legacy. Full configuration, actual duration, faults, events, alarms, charts and provenance are retained; submitted aggregates are explicitly not server-recomputed.

9. **TLS bypass and AI ambiguity.** `AiService.php` retains certificate verification and supports an optional trusted CA bundle. Credentials stay server-side; provider errors avoid sensitive request/body logs. AI receives saved aggregates, early fault context and selected history. It has no controller or record-write path. Deterministic fallback responses include source/reason labels.

10. **Unsupported presentation and stale documentation.** Visible product version badges, HIL/PID claims, fixed hardware values and old safety/savings claims were removed. Branding, accessible labels, focus states, responsive styles and reduced-motion support were standardized. README, API setup, model, architecture and replay documentation describe the implemented research assumptions.

## Verification status

- Frontend regression suite: **92 tests passed across 9 files**. This includes 6 DOM-emulator lifecycle tests using the real engine/hook/storage with controlled animation frames and deferred API responses, plus 8 static rendering tests. Model, replay, finance, persistence, transport and reproduction regressions are included.
- Frontend production build: passed. Vite reports one non-blocking bundle-size warning.
- Frontend lint: passed without warnings. Source formatting check also passed; a formatter command is available for maintenance.
- API: **18 tests passed, 84 assertions**, using `php -d extension=pdo_sqlite vendor/phpunit/phpunit/phpunit` outside the sandbox. Tests force an in-memory SQLite database and mock all provider requests. Coverage includes real bearer tokens, ability/owner isolation, retries, deep validation, zero and overflow comparisons, rate limits, legacy preservation and provider failure. An actual 60-second TypeScript engine export with a signal fault round-trips through the API. PHP syntax checks also passed.
- Browser walkthrough: **not completed**. In-app browser could not reach local 127.0.0.1:5173 (connection timeout). Native Windows computer use then stopped because it could not determine Chrome’s URL confidently enough to enforce its policy. No desktop/mobile visual pass is claimed.
- Test tooling: DOM testing and formatting dependencies were installed after foreground network approval. UI lifecycle tests are executable and passing; no live AI provider was called.
- Laravel Boost setup: attempted as required by the repository bootstrap instructions. Sandbox DNS failed; the escalated dependency command waited for approval and was aborted. Existing installed PHP/Laravel dependencies remain available; implementation proceeded under the user's routine-work authorization.
- Existing database: unchanged. Apply the documented additive migration in the intended development deployment before using private persistence.

## Outcome sanity check

The default seeded 12-hour worsening experiment used approximately 3,600 L in Arm A and 807.758 L in Arm B. Below-range time was approximately 2,264.2 seconds in A and 11,934.0 seconds in B. This demonstrates why gas reduction is reported alongside oxygenation outcomes without a safety pass/fail verdict. These are uncalibrated model outputs, not patient results or a savings target.

## Research limitations retained

No clinical validity, hardware implementation, calibrated physiology, verified hospital pricing or independent breath-detection validation is claimed. The continuous arm has no controller alarm policy, so alarm counts are not a symmetric staff-workload metric. Full-run aggregates retain every interval, while chart/event/alarm history is bounded and exports disclose omitted history counts. No live AI provider call is required for automated tests.
