# Recorded-data replay

Replay is an open-loop integration exercise using the BIDMC PPG and Respiration
Dataset (https://physionet.org/content/bidmc/1.0.0/). Recorded SpO₂ cannot respond
to the software controller, and replay does not calculate treatment benefit or
oxygen savings. Pressure is an explicitly synthetic fixture generated from the
same annotations used for scoring. These scores are not independent detection
validation.

## Conversion and provenance

Run `node web/scripts/convert-bidmc.mjs` from the repository root. The converter
discovers numeric CSV recordings in `data/bidmc`, uses their explicit `Time [s]`
column, and writes the active manifest to `web/public/replay/index.json`.
It supports quoted commas, escaped quotes, multiline fields and CRLF. Malformed
rows, missing headers and conflicting duplicate timestamps fail conversion.
Exact duplicate numeric rows are removed and counted. Rows are sorted by time.
Missing/zero SpO₂ becomes null; impossible numeric values become null with a
low-quality flag and an invalid-value count in provenance. Source SHA-256 hashes
identify the CSV content used. The numeric `RESP` column is not used as a
clinician-documented respiratory rate.

Recording duration is the last explicit numeric timestamp. For subject 04,
there are 481 readings at timestamps 0 through 480 s, and playback duration is
480 s. The last reading is an endpoint; no additional coverage is inferred.
A sample is held for at most its declared one-second sample period. Gaps and
time beyond coverage are missing, not repeated last values.

Annotation sample numbers are divided by 125 Hz. Each annotator's list is
independently sorted and deduplicated. Annotator 1 is the explicit reference;
annotator 2 is retained independently in provenance. A nearest available,
one-to-one ±0.5 s comparison reports agreement and unmatched events without
averaging annotations or assuming that two entries on the same row refer to
the same breath. Out-of-coverage annotations fail conversion. A declared but
unavailable annotation file fails loading visibly instead of silently degrading.

Subject 01 and 02 JSON files are retained as legacy fixtures but are not indexed
by the active subject 04 manifest. Their array-index timing is supported only
as a documented legacy format by `normalizeSubject`; new conversion always
writes explicit timestamps.

## Event matching

`EventMatcher` receives reference timestamps separately from controller inputs.
`ReplayRunner` passes only current pressure and recorded measurements to
`ValveController.tick()`. The controller never receives annotation times,
future measurements or hidden patient need.

The matching window is ±0.6 s. References are processed in chronological order,
after the entire inclusive matching window has been observed. Each reference
consumes its nearest available detection; ties prefer the earlier detection.
A reference and a detection may each be used only once. Unmatched detections
remain pending for up to twice the matching window so later eligible references
can close. At completion all complete windows are finalized.

Both reference and detection events whose complete window would extend outside
the recording are censored and reported as exclusions. Pending and censored
events do not enter scored denominators. At every snapshot:

- `truePositives + falsePositives = scoredDetections`
- `truePositives + falseNegatives = eligibleReferences`

During playback `eligibleReferences` counts finalized references;
`totalEligibleReferences` also includes future and pending complete windows.
Mean signed timing offset is detection time minus reference time. A negative
offset means earlier than the annotation, never predicted inhalation. The
synthetic pressure deliberately begins before each annotated peak.

## Timing, summaries and UI

Runner intervals are 0.1 s with a final shortened interval if needed. Integer
tick indices avoid accumulated clock drift. Local recording time is separate
from cumulative playback time. `sampleTimeS` identifies the current input at
the interval start, while `localTimeS` reports progress through its end. Charts
use input timestamps; the final endpoint closes the held interval and does not
claim a new measurement. A completed recording snapshot is assembled
before advancing to the next subject; the next tick starts a fresh controller.
Playback stops by default. Explicit repeat mode restarts the same recording,
retaining the latest 50 per-pass summaries and cumulative counts for all passes.
Repeated passes are not independent evidence.

Playback acceleration uses visible elapsed time, not steps per animation frame.
Rendering is throttled independently. Under CPU pressure pending work is
retained; execution may run behind requested speed. Background tabs and view
changes pause playback. A scheduling interruption longer than one second also
pauses without catch-up. Pause/resume preserves pending fractional time;
reset/new playback clears it.

Charts represent the entire current recording pass with progressive thinning
above 1,000 points. Short pulses can be omitted visually, but every tick still
contributes to event matching. Final scores and reference-event history are
exportable as JSON. Alarm acknowledgement refreshes the paused snapshot and
does not resolve the underlying condition. Manifest/record loading uses abort
signals and discards responses after cancellation.

## Verification

`replay.test.ts` covers matching conservation, multiple candidate events,
inclusive boundaries, exclusions, pending windows, input validation, gaps,
exact duration, outgoing summaries, repeated passes, acknowledgement and active
subject 04. `replay-loading.test.ts` covers stale responses, missing annotation
files and mismatched coverage. Converter tests cover quoted CSV, explicit
timestamps, duplicate conflicts, invalid numerics and independent annotators.
