import { createHash } from "node:crypto";

const sourceRateHz = 125;
const displayRateHz = 25;
const peakRadius = Math.round(0.35 * sourceRateHz);
const smoothingRadius = 12;
const minimumPhaseSamples = Math.round(0.25 * sourceRateHz);
const maximumCycleSamples = 10 * sourceRateHz;
const minimumExcursion = 0.03;

function parseRespiration(source, durationS) {
  const [header, ...rows] = source.trim().split(/\r?\n/);
  const columns = header.split(",").map((name) => name.trim());
  const timeColumn = columns.indexOf("Time [s]");
  const respColumn = columns.indexOf("RESP");
  if (
    timeColumn < 0 ||
    respColumn < 0 ||
    rows.length !== durationS * sourceRateHz + 1
  ) {
    throw new Error(
      "Subject 04 RESP CSV does not cover the expected 125 Hz recording.",
    );
  }
  return rows.map((row, index) => {
    const fields = row.split(",");
    // The CSV rounds late timestamps to 0.01 s. Row number gives the native sample time.
    const time = Number(fields[timeColumn]);
    if (
      fields.length !== columns.length ||
      !fields[timeColumn]?.trim() ||
      !Number.isFinite(time) ||
      Math.abs(time - index / sourceRateHz) > 0.00501
    ) {
      throw new Error("Unexpected timestamp in RESP CSV at row " + (index + 2));
    }
    const reading = fields[respColumn].trim();
    if (!reading || /^nan$/i.test(reading)) return null;
    const value = Number(reading);
    if (!Number.isFinite(value))
      throw new Error("Invalid RESP reading at row " + (index + 2));
    return value;
  });
}

function smoothRespiration(values) {
  return values.map((_, index) => {
    const start = Math.max(0, index - smoothingRadius);
    const end = Math.min(values.length - 1, index + smoothingRadius);
    let sum = 0;
    for (let sample = start; sample <= end; sample++) {
      if (values[sample] === null) return null;
      sum += values[sample];
    }
    return sum / (end - start + 1);
  });
}

function findPeak(values, marker) {
  const start = marker - peakRadius;
  const end = marker + peakRadius;
  if (start < 0 || end >= values.length) return null;
  let peak = marker;
  for (let index = start; index <= end; index++) {
    if (values[index] === null) return null;
    if (values[index] > values[peak]) peak = index;
  }
  // An extremum at the edge is not evidence of a turning point.
  return peak === start || peak === end ? null : peak;
}

function findRiseStart(values, previousPeak, peak) {
  if (
    peak === null ||
    previousPeak === null ||
    peak <= previousPeak ||
    peak - previousPeak > maximumCycleSamples
  )
    return null;

  let trough = previousPeak;
  for (let sample = previousPeak; sample <= peak; sample++) {
    if (values[sample] === null) return null;
    if (values[sample] < values[trough]) trough = sample;
  }
  const amplitude = values[peak] - values[trough];
  if (
    amplitude < minimumExcursion ||
    (previousPeak > 0 &&
      values[previousPeak] - values[trough] < minimumExcursion)
  )
    return null;

  // The bottom of an impedance trace may be flat. Use the departure from
  // the low band before this peak instead of picking an arbitrary trough sample.
  const lowBand = values[trough] + 0.08 * amplitude;
  let start = peak;
  while (start > trough && values[start - 1] > lowBand) start--;
  if (
    peak - start < minimumPhaseSamples ||
    (previousPeak > 0 && start - previousPeak < minimumPhaseSamples)
  )
    return null;
  return start;
}

function estimatePhases(values, breathTimesS) {
  const markers = breathTimesS.map((timeS) => Math.round(timeS * sourceRateHz));
  const peaks = markers.map((marker) => findPeak(values, marker));
  const phases = [{ timeS: 0, phase: "unknown" }];

  function add(sample, phase) {
    const previous = phases.at(-1);
    if (
      sample === null ||
      sample < 0 ||
      sample / sourceRateHz <= previous.timeS ||
      previous.phase === phase
    )
      return;
    phases.push({ timeS: sample / sourceRateHz, phase });
  }

  for (let index = 0; index < peaks.length; index++) {
    const previous = index === 0 ? 0 : peaks[index - 1];
    const peak = peaks[index];
    const inhale = findRiseStart(values, previous, peak);
    if (inhale === null) {
      // If a peak cannot be located, keep this interval unclassified.
      add(previous, "unknown");
      continue;
    }
    if (index > 0) add(previous, "exhaling");
    add(inhale, "inhaling");
    // The next interval will start here if both sides can be estimated.
    const next = peaks[index + 1];
    if (findRiseStart(values, peak, next ?? null) === null)
      add(peak, "unknown");
  }
  return phases;
}

const phaseLabels = {
  inhaling: ["valve-open", "Estimated inhale · Valve opened"],
  exhaling: ["valve-closed", "Estimated exhale · Valve closed"],
  unknown: ["valve-unknown", "Phase unknown · No valve command"],
};

export function waveformEvidence(recording, annotations, source) {
  const { subjectId, durationS } = recording;
  const values = parseRespiration(source, durationS);
  const valvePhases = estimatePhases(
    smoothRespiration(values),
    annotations.breathTimesS,
  );
  const events = valvePhases.map(({ phase, timeS }, index) => {
    const [kind, label] = phaseLabels[phase];
    const end = valvePhases[index + 1]?.timeS ?? durationS;
    const span = timeS.toFixed(3) + "–" + end.toFixed(3) + " s";
    const duration = (end - timeS).toFixed(3) + " s";
    const explanation =
      phase === "inhaling"
        ? "The smoothed recorded impedance rose out of its low band toward a breath peak. The virtual valve is open"
        : phase === "exhaling"
          ? "The recorded impedance reached a smoothed peak and began its fall toward the next breath. The virtual valve is closed"
          : "The replay could not assign a breathing phase here. There is no virtual valve command";
    return {
      id: "valve-" + Math.round(timeS * sourceRateHz),
      kind,
      label,
      timeS,
      detail: explanation + " for " + duration + " (" + span + ").",
    };
  });
  if (
    !events.some((event) => event.kind === "valve-open") ||
    !events.some((event) => event.kind === "valve-closed")
  ) {
    throw new Error("The waveform did not produce usable phase estimates.");
  }
  return {
    subjectId,
    durationS,
    source: {
      file: "bidmc_04_Signals.csv",
      sha256: createHash("sha256").update(source).digest("hex"),
      column: "RESP",
      sampleRateHz: sourceRateHz,
    },
    waveform: {
      sampleRateHz: displayRateHz,
      values: values.filter(
        (_, index) => index % (sourceRateHz / displayRateHz) === 0,
      ),
    },
    valvePhases,
    events,
  };
}
