import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { waveformEvidence } from "./build-waveform-replay.mjs";

const replayDirectory = fileURLToPath(
  new URL("../public/replay/", import.meta.url),
);
const comparisonSamples = 6;
const earlierWindowS = 60;
const separationS = 10;
const changeInPoints = 2;
const missingSamples = 3;

function median(values) {
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

function reviewEvidence(recording) {
  const { subjectId, durationS, samplePeriodS, samples } = recording;
  if (samplePeriodS !== 1) {
    throw new Error("The review demo expects one SpO₂ sample per second.");
  }
  const values = new Map(
    samples.map((sample) => [
      sample.timeS,
      sample.quality === "good" && Number.isFinite(sample.value)
        ? sample.value
        : null,
    ]),
  );
  const events = [];
  let gapStart = null;
  let trend = null;

  function add(kind, timeS, label, detail) {
    events.push({ id: kind + "-" + timeS, kind, timeS, label, detail });
  }

  for (let timeS = 0; timeS <= durationS; timeS++) {
    const value = values.get(timeS) ?? null;
    if (value === null) {
      gapStart ??= timeS;
      trend = null;
      if (timeS - gapStart + 1 === missingSamples) {
        add(
          "spo2-missing",
          timeS,
          "SpO₂ reading unavailable",
          "No valid recorded reading since " +
            gapStart +
            " s. Check the signal.",
        );
      }
      continue;
    }

    if (gapStart !== null && timeS - gapStart >= missingSamples) {
      add(
        "spo2-restored",
        timeS,
        "SpO₂ reading returned",
        "The next valid reading is " + value + "% at " + timeS + " s.",
      );
    }
    gapStart = null;

    const earlier = [];
    for (
      let t = Math.max(0, timeS - earlierWindowS - separationS);
      t < timeS - separationS;
      t++
    ) {
      const sample = values.get(t);
      if (sample != null) earlier.push(sample);
    }
    if (earlier.length < 15) continue;

    const reference = median(earlier);
    const recent = Array.from({ length: comparisonSamples }, (_, index) =>
      values.get(timeS - comparisonSamples + 1 + index),
    );
    const rose = recent.every(
      (sample) => sample != null && sample >= reference + changeInPoints,
    );
    const fell = recent.every(
      (sample) => sample != null && sample <= reference - changeInPoints,
    );
    const next = rose ? "spo2-rise" : fell ? "spo2-fall" : null;
    if (next && trend !== next) {
      const direction = rose ? "higher" : "lower";
      add(
        next,
        timeS,
        rose ? "SpO₂ rose · Review trend" : "SpO₂ fell · Review trend",
        "The last six readings were " +
          direction +
          " than the earlier " +
          reference +
          "% median. Latest reading: " +
          value +
          "%. Review the trend and current oxygen plan.",
      );
    }
    trend = next;
  }
  return { subjectId, durationS, events };
}

async function readReplayFile(name) {
  return JSON.parse(await readFile(path.join(replayDirectory, name), "utf8"));
}

async function saveEvidence(evidence) {
  const output = path.join(
    replayDirectory,
    "subject_" + evidence.subjectId + "_evidence.json",
  );
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(
    "Subject " +
      evidence.subjectId +
      ": " +
      evidence.events.length +
      " replay events",
  );
}

for (const id of ["01", "22", "46"]) {
  const recording = await readReplayFile("subject_" + id + ".json");
  if (recording.subjectId !== id)
    throw new Error("Unexpected recording ID for subject " + id);
  await saveEvidence(reviewEvidence(recording));
}

const [recording, annotations, signalSource] = await Promise.all([
  readReplayFile("subject_04.json"),
  readReplayFile("subject_04_breaths.json"),
  readFile(
    new URL("../../data/bidmc/bidmc_04_Signals.csv", import.meta.url),
    "utf8",
  ),
]);
if (recording.subjectId !== "04" || annotations.subjectId !== "04") {
  throw new Error("Subject 04 does not match its annotations.");
}
await saveEvidence(waveformEvidence(recording, annotations, signalSource));
