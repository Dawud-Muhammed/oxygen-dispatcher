# Oxygen Dispatcher research model

This is an uncalibrated software experiment. It does not predict a patient's response, establish a treatment prescription, certify safety, or measure a physical oxygen source. Parameters below are explicit research assumptions. Recorded-data replay has a separate scope described in [replay.md](replay.md).

## Implementation and units

- `web/src/sim/engine.ts`: `ExperimentEngine` owns one experiment, the comparison arms, accounting, faults and exported results.
- `web/src/sim/patient.ts`: `ExogenousTrace` generates common external inputs; `PatientSimulator.advance` applies the same response equations to both arms.
- `web/src/sim/controller.ts`: `ValveController.tick` receives only current pressure, SpO₂, timestamps and quality. It cannot read hidden need, future breaths, or the other arm.
- `web/src/sim/compare.ts`: `runComparison` runs that engine synchronously.
- `web/src/sim/useSim.ts`: `useSim` schedules that same engine for React.

Time and durations are in seconds; flow is litres per minute; source and useful volumes are litres; pulse volume is displayed in millilitres. SpO₂ is a percentage. Synthetic pressure uses an illustrative cmH₂O scale; it is neither a measured airway pressure nor a calibrated sensor output. `effectLpm` and `oxygenNeed` use a model-only L/min-equivalent scale.

## Clock and causal interval order

`STEP_MS = 100`. For a tick starting at `t`, `dt = min(0.1, requestedDuration - t)`. The final interval can be shorter. Integer tick indices determine elapsed time, rather than repeatedly adding floating-point 0.1. No interval crosses the requested end.

Each `ExperimentEngine.step()` does the following:

1. Sample shared breathing, pressure noise, display noise and hidden need at `t`; apply faults active at `t`.
2. Read each arm's internal saturation before advancing its response. Pass only arm B's current measurement and pressure to `ValveController.tick`.
3. Choose the command for `[t, t + dt)`. Arm A delivers its configured continuous flow. Arm B delivers its controller setpoint if its requested valve is open, and zero otherwise.
4. Integrate source gas, useful dose and patient response using that same actual flow and `dt`.
5. Account for measurement validity and range membership over the same held interval. Store chart values at the interval start, then advance elapsed time.

A controller decision cannot use the response caused by its own forthcoming command. Continuous-condition timers use completed intervals: a one-second low threshold first becomes eligible at `t = 1.0`, not `t = 0.9`. A contradictory or invalid current observation resets a continuous low-SpO₂ timer immediately. Unknown elapsed intervals are not assumed to satisfy a threshold.

The live snapshot's `timeS` is the completed elapsed time; its displayed SpO₂, pressure, breathing phase and command describe the most recently completed interval. They are not a second observation sampled at the end. The chart's final point repeats the last held interval values at the exact endpoint to show the full run boundary; no additional dose or observation is counted there.

## Common external inputs

`ExogenousTrace` has named, seeded random streams for breathing, pressure and display noise. Both arms receive the exact same sample. Delivery does not alter the breathing generator or the number of random draws.

The first breath lasts 3.75 seconds. Subsequent periods are `60 / (14 + 6U) × (0.95 + 0.1V)` seconds, where `U` and `V` are uniform draws. Inhalation occupies one third of each generated period. Pressure is `-2.5 + U(-0.3, 0.3)` during inhalation and `0.4 + U(-0.3, 0.3)` during exhalation. Display noise is uniform `U(-0.5, 0.5)` percentage points, shared by both arms. These are illustrative signals, not empirical distributions.

## Source gas and dose-dependent response

For each arm, let `F` be the modeled actual delivery in L/min, `dt` seconds, `u` the configured utilization fraction, and `I` be 1 during the shared inhalation phase and 0 otherwise:

```text
sourceVolumeL = F × dt / 60
usefulVolumeL = sourceVolumeL × u × I
usefulRate = usefulVolumeL × 60 / dt / (1/3)   if dt > 0, otherwise 0
effectNext = effect + (1 - exp(-dt / 10)) × (usefulRate - effect)
targetSpo2 = clamp(95 + effectNext - hiddenNeed, 70, 100)
trueSpo2Next = trueSpo2 + (1 - exp(-dt / 40)) × (targetSpo2 - trueSpo2)
displaySpo2 = clamp(trueSpo2 + sharedNoise, 0, 100)
```

`trueSpo2` starts at 95 and `effectLpm` starts at zero in both arms. The displayed measurement used to choose a command uses the current, pre-update saturation. `PatientSimulator.advance` returns the post-update response for callers inspecting the model directly.

The default `u = 0.75` changes only modeled useful dose. It never discounts physical source consumption. Thus 5 L/min for 60 seconds always consumes 5 litres, for every utilization value. A longer pulse contributes proportionally more useful dose than a shorter pulse at the same rate. There is no maximum-per-breath credit and no arm-specific efficiency advantage.

The factor `1/(1/3)` normalizes dose by the assumed inhalation fraction. The 10-second dose reservoir, 40-second response lag, linear mapping and saturation clamps are uncalibrated model choices shared by both arms. The model omits actual oxygen concentration, cannula dead space, gas mixing, transport delays, lung disease mechanics, nonlinear gas exchange and delivery hardware dynamics. No parameter is fitted to produce a target savings percentage.

The setpoint (`flowB`), requested valve (`valveOpen`), modeled instantaneous delivery (`actualFlowB`), pulse volume and cumulative source gas are separate quantities. Pulse volume counts only `breath_sync` openings; continuous startup or fallback delivery is not a pulse. The snapshot displays the ongoing pulse's accumulated volume, or the most recently completed pulse volume. `isInhaling` comes from the breathing trace, independently of valve state.

## Immutable configuration and scenarios

`validateExperimentConfig` freezes a copied configuration and a separately frozen, fully resolved controller configuration. A run accepts durations from 0 to 86,400 seconds, integer seeds from 0 to 4,294,967,295, continuous flow from 0 to 30 L/min, and utilization from 0 to 1. All numeric settings must be finite. Editing the UI configuration creates a new run; it does not rewrite an existing experiment.

`oxygenNeed` supplies a hidden model input:

- `recovering`: 5 to 1 L/min-equivalent linearly over six hours, then 1.
- `worsening`: 3 for three hours, then a linear rise to 7 by twelve hours, then 7.
- `sensor_fault`: 4 to 2 over eight hours, then 2. SpO₂ is missing during `[10800, 10920)` seconds; quality is low during `[14400, 14490)` seconds. Faults outside the requested duration are omitted; crossing intervals are clipped to its end.

The engine can record injected `spo2_loss`, `pressure_loss`, or `motion` intervals. Missing SpO₂ and low-quality SpO₂ affect both arms equally. Pressure loss affects the shared synthetic pressure signal supplied to arm B's detector; arm A does not use a pressure controller. Faults alter observations, not hidden physiological need. Motion marks quality as low and hides the unreliable trace instead of inventing a believable saturation value.

`Fault` contains a stable `id`, `kind`, `startS`, and `endS`. Schedules have at most 100 entries, unique nonempty identifiers, finite ordered bounds within the requested duration, and recognized kinds. An explicit constructor schedule replaces scenario defaults, making an exported schedule reusable without duplicating faults. Overlap is allowed; missing SpO₂ takes precedence over low quality. A scheduled fault is evaluated at each interval start and held for that interval, so non-grid boundaries have up to one 0.1-second interval of discretization. Ordinary UI injections start on engine boundaries and last 30 seconds, clipped to the run end.

## Sensor validity and averaging

`measurementValidity` returns `valid`, `missing`, `invalid`, `stale`, or `low_quality`. A timestamp must be finite, nonnegative and no later than the current controller time. A `null` measurement value is missing; an explicit `null` timestamp is invalid. Only omitted (`undefined`) timestamp metadata defaults to the current sample time. NaN, infinity, values outside 0–100% SpO₂ or -20–20 synthetic pressure, and invalid timestamps are invalid. A non-null value older than `maxSensorAgeS` is stale. Low quality is not valid even when the numeric value looks plausible. Validity precedence is invalid timestamp, missing value, invalid value, stale age, then quality.

Controller timestamps must increase strictly and intervals must be contiguous, without overlap. Each supplied `dtS` must be positive and no greater than 0.1 seconds. Callers must tick through unavailable intervals with missing measurements instead of skipping time; the controller rejects unexplained gaps. Callers must supply the real observation timestamp when holding a sensor value between samples; replay does this for recorded SpO₂.

`SpO2Window` stores covered intervals with start, end and value. It expires observations by elapsed time even during missing data, weights means by covered seconds, and divides coverage by the full configured window length. Startup does not shrink that denominator. Routine adjustments use only completed intervals and require at least `minimumCoverage` of valid data. Invalid intervals add no value and no valid coverage; they cannot extend old values indefinitely.

## Controller states, defaults and precedence

All settings below are research policies, not clinical instructions. `validateControllerConfig` resolves defaults and checks finite values, target ordering, integer debounce, and `minimumFlow ≤ initialFlow ≤ prescribedMaxFlow`, with fallback also inside those bounds. Flows are 0–30 L/min. Configurable durations are 0.1–3,600 seconds. `maxOpenTimeS` must be a multiple of the 0.1-second control interval. `sensorCriticalS` cannot precede `sensorWarningS`.

Target preset `standard` resolves to 92–96%; `co2retain` resolves to 88–92%. These labels are retained as research preset names, without validating a patient-specific target. Explicit `targetLow` and `targetHigh` override the preset. The default critical threshold is 88%, and cannot exceed the target lower bound.

The ordered mode selection in `ValveController.tick` is:

1. `critical_fallback`: valid SpO₂ has remained below `criticalThreshold` for `criticalDurationS` completed seconds. The valve is continuously open at `prescribedMaxFlow`.
2. `sensor_fallback`: either pressure or SpO₂ is unreliable, or recovery is pending. The valve is continuously open at `fallbackFlow`.
3. `warming_up`: fewer than `warmupS` completed seconds. Continuous initial delivery while pressure baseline is collected.
4. `no_breath_fallback`: no eligible detected breath for `noBreathS`. Continuous `fallbackFlow`.
5. `breath_sync`: use the current routine setpoint, and open the valve only while the pulse state is open.

Defaults are `warmupS = 5`, `noBreathS = 10`, `criticalDurationS = 30`, `recoveryS = 5`, and `fallbackFlow = prescribedMaxFlow`. Critical fallback takes precedence even if pressure is invalid, provided the low SpO₂ observation is valid. Invalid SpO₂ resets its sustained-low timer and selects sensor fallback. Critical fallback ceases when its continuous-low condition ceases; there is no separate critical recovery hysteresis. Sensor fallback requires a complete uninterrupted recovery interval with both signals valid. Its recovery latch survives an intervening higher-priority critical state. No-breath fallback clears on a new eligible detection, subject to higher-priority states.

The pressure baseline is the median of up to 50 warm-up samples. After warm-up it follows non-inhalation pressure slowly (`0.98 × baseline + 0.02 × pressure`) and freezes during inferred inhalation. An inhalation candidate is pressure below `baseline - inhaleThreshold`, with default `inhaleThreshold = 1`. Two consecutive eligible ticks (`inhaleDebounceTicks = 2`) produce one `breathDetected` event.

The pulse states are `waiting_exhale`, `ready`, and `open`. Exhalation rearms the detector. A valid inhalation opens one pulse; exhalation or `maxOpenTimeS = 0.8` closes it. Persistent low pressure cannot rearm the pulse. A fallback valve opening is not itself a breath detection. The detector may still observe breaths during a fallback, but the mode determines actual delivery.

Routine flow changes require `breath_sync` and valid signals for `adjustmentIntervalS = 300` accumulated uninterrupted seconds. On that cadence, the `averageWindowS = 180` mean must have at least `minimumCoverage = 0.8`. A mean above `targetHigh + 1` reduces the setpoint by 1 L/min; a mean below `targetLow` increases it by 1 L/min, bounded by minimum and maximum. Other states reset the adjustment timer; their temporary delivery flow does not rewrite the routine setpoint. Sensor failure never establishes lower oxygen need.

## Alarms and outcomes

`Alarm` records stable identifier, code, level, onset, active state, acknowledgement, resolution and active duration. `SENSOR_UNRELIABLE` begins after two completed seconds of unreliable input; `SENSOR_EXTENDED` after 120. `SPO2_CRITICAL` and `NO_BREATH` follow their named modes. Acknowledgement records an operator action and does not resolve the condition. Recurrent conditions create new episodes; resolved history remains available across rendering batches.

`alarmEpisodes` counts distinct alarm onsets. `alarmActiveS` counts the union of intervals with at least one alarm active, so simultaneous alarms do not multiply elapsed time. Each alarm's own `activeDurationS` is also retained. Arm A has no alarm controller in this experiment, so its alarm metrics are zero by construction, not evidence that it needs fewer staff actions. No metric is called a nurse intervention.

For each arm, `ArmStats` stores full-precision seconds below, inside and above the configured inclusive target range; seconds below the configured critical threshold; and seconds with missing, invalid, stale or low-quality SpO₂. `belowCriticalS` is a subset of below-range time, not another partition member. Pressure validity affects control but does not make a valid SpO₂ measurement disappear from saturation coverage.

```text
belowRangeS + inRangeS + aboveRangeS = validS
validS + missingS + invalidS + staleS + lowQualityS = actualDurationS
validCoveragePct = 100 × validS / actualDurationS
oxygenSavedPct = 100 × (oxygenA - oxygenB) / oxygenA
```

Unknown-data time remains in the full-duration denominator. Range outcomes are not a safety verdict. Zero elapsed time gives null coverage; zero baseline oxygen gives null percentage reduction (displayed as not applicable). An extremely small nonzero baseline can also produce a ratio beyond finite floating-point range; this unavailable comparison is null rather than Infinity. Every representable negative reduction remains negative when arm B consumes more. Floating-point summation can introduce tiny arithmetic residuals; stored values are not rounded to whole minutes or percentages.

## Scheduling, bounded history and reproducibility

`SimulationClock.accrue` adds visible elapsed wall seconds multiplied by selected speed. `drain` executes only complete fixed intervals whose simulated time has accrued, with a shorter requested final interval when needed. `useSim` limits each rendering task to approximately 8 ms of work and publishes snapshots at most five times per second. If hardware cannot sustain a selected speed, it works through its accrued backlog; it never changes the scientific timestep to catch up.

Hiding the browser tab pauses the experiment. Returning does not resume it automatically. A wall-clock gap longer than one second is treated as a suspension and earns no catch-up credit. Pause discards unexecuted scheduler backlog and fractional wall-time credit; resume starts a fresh wall clock at the engine's last completed interval. Speed changes affect subsequent accrued wall time. Seeded results for a given completed simulation interval remain identical across batch sizes, speeds and pauses.

Charts retain full-run context using deterministic sampling of at most 5,000 points, including the first interval and final endpoint. Short faults may be missed by this display sampling; full-resolution aggregates, the fault schedule and alarm/event history remain the evidence for their duration. This is not a raw waveform archive.

The controller retains at most 10,000 events and 10,000 alarm-history entries, removing oldest events and oldest resolved alarms when necessary. Active alarms are retained. Exports disclose `droppedEvents` and `droppedAlarms`; totals continue accumulating after history truncation. At most 100 manual fault-injection events are stored in addition to controller events. The averaging buffer is limited by its configured elapsed-time window.

Exports include immutable resolved configuration, seed, actual duration, schedule, full-precision aggregates, sampled series, events, alarms and internal provenance identifiers. Results are marked client-submitted, not server-verified. See [architecture.md](architecture.md) for reproduction commands and module boundaries. Regression tests in `web/src/sim/__tests__/simulation.test.ts` verify gas arithmetic, dose dependence, exact duration, parity, scheduling, fault precedence, recovery, validity, rearming, alarms, coverage and all three full twelve-hour scenarios.
