/** Timestamp-preserving conversion of BIDMC PPG and Respiration Dataset CSVs.
 * Use annotator 1 as the timing reference; retain annotator 2 independently.
 * No row-wise averaging or implied independent pressure validation. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const here = path.dirname(fileURLToPath(import.meta.url));

export function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      if (field.trim()) throw new Error("Unexpected quote in CSV field.");
      quoted = true;
    } else if (c === ",") {
      row.push(field.trim());
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field.");
  row.push(field.trim());
  if (row.some((v) => v !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("CSV needs a header and data rows.");
  const header = rows.shift();
  if (header.some((h) => !h) || new Set(header).size !== header.length)
    throw new Error("CSV headers must be nonempty and unique.");
  return rows.map((r, i) => {
    if (r.length !== header.length)
      throw new Error(`CSV row ${i + 2} has the wrong number of fields.`);
    return Object.fromEntries(header.map((h, j) => [h, r[j]]));
  });
}
function numeric(value, label) {
  if (value === "" || value === undefined || !Number.isFinite(Number(value)))
    throw new Error(`Invalid ${label}: ${value}`);
  return Number(value);
}
export function convertNumerics(text) {
  const rows = parseCsv(text);
  if (!("Time [s]" in rows[0]) || !("SpO2" in rows[0]))
    throw new Error("Missing Time [s] or SpO2 column.");
  let invalidCount = 0;
  const samples = rows
    .map((r) => {
      const timeS = numeric(r["Time [s]"], "numeric timestamp");
      if (timeS < 0) throw new Error("Numeric timestamps cannot be negative.");
      const v = r.SpO2 === "" ? null : Number(r.SpO2);
      const missing = v === null || v === 0;
      const invalid = !missing && (!Number.isFinite(v) || v < 0 || v > 100);
      if (invalid) invalidCount++;
      return {
        timeS,
        value: missing || invalid ? null : v,
        quality: invalid ? "low" : "good",
      };
    })
    .sort((a, b) => a.timeS - b.timeS);
  let duplicateCount = 0;
  const unique = samples.filter((s, i) => {
    if (i && s.timeS === samples[i - 1].timeS) {
      if (
        s.value !== samples[i - 1].value ||
        s.quality !== samples[i - 1].quality
      )
        throw new Error(
          "Conflicting numeric values at a duplicated timestamp.",
        );
      duplicateCount++;
      return false;
    }
    return true;
  });
  const durationS = unique.at(-1).timeS;
  if (!(durationS > 0))
    throw new Error(
      "At least two distinct timestamps are needed to establish recording duration.",
    );
  return {
    samples: unique,
    durationS,
    samplePeriodS: 1,
    invalidCount,
    duplicateCount,
  };
}
export function convertBreaths(text, durationS) {
  const rows = parseCsv(text);
  const keys = Object.keys(rows[0]);
  const first = keys.find((k) => k.includes("ann1"));
  const second = keys.find((k) => k.includes("ann2"));
  if (!first)
    throw new Error("Annotator 1 column is required; no silent substitution.");
  const extract = (key) =>
    key
      ? [
          ...new Set(
            rows.flatMap((r) => {
              if (r[key] === "") return [];
              const sample = numeric(r[key], "annotation sample number");
              if (sample < 0 || !Number.isInteger(sample))
                throw new Error(
                  "Annotation sample numbers must be nonnegative integers.",
                );
              const t = sample / 125;
              if (t > durationS)
                throw new Error(
                  "Annotation falls beyond established recording coverage.",
                );
              return [t];
            }),
          ),
        ].sort((a, b) => a - b)
      : [];
  const primary = extract(first),
    secondary = extract(second);
  if (!primary.length)
    throw new Error("Annotator 1 has no valid breath annotations.");
  const available = new Set(secondary.map((_, i) => i));
  const differences = [];
  for (const t of primary) {
    const near = [...available]
      .filter((i) => Math.abs(secondary[i] - t) <= 0.5)
      .sort(
        (i, j) =>
          Math.abs(secondary[i] - t) - Math.abs(secondary[j] - t) || i - j,
      )[0];
    if (near !== undefined) {
      available.delete(near);
      differences.push(secondary[near] - t);
    }
  }
  return {
    breathTimesS: primary,
    annotator2TimesS: secondary,
    annotationPolicy:
      "Annotator 1 is the reference. Annotator 2 is retained independently; no averaging.",
    disagreement: {
      matchingWindowS: 0.5,
      matchedPairs: differences.length,
      unmatchedAnnotator1: primary.length - differences.length,
      unmatchedAnnotator2: available.size,
      maxAbsoluteDifferenceS: differences.length
        ? Math.max(...differences.map(Math.abs))
        : null,
    },
  };
}
export function convertDirectory(inputDir, outputDir) {
  const files = fs
    .readdirSync(inputDir)
    .filter((f) => /^bidmc_\d+_Numerics\.csv$/.test(f))
    .sort();
  if (!files.length)
    throw new Error(
      "No numerics CSV files found. Numerics timestamps establish recording coverage.",
    );
  const outputs = [];
  const subjects = [];
  for (const file of files) {
    const id = file.match(/^bidmc_(\d+)_/)[1];
    const raw = fs.readFileSync(path.join(inputDir, file), "utf8");
    const numerics = convertNumerics(raw);
    const breathsFile = `bidmc_${id}_Breaths.csv`;
    const sources = [
      { file, sha256: createHash("sha256").update(raw).digest("hex") },
    ];
    const jsonName = `subject_${id}.json`;
    const entry = {
      id,
      file: jsonName,
      description: `Subject ${id} · recorded SpO₂${fs.existsSync(path.join(inputDir, breathsFile)) ? " and breath annotations" : ""}`,
      hasSpO2: true,
      hasBreaths: false,
      durationS: numerics.durationS,
    };
    if (fs.existsSync(path.join(inputDir, breathsFile))) {
      const breathRaw = fs.readFileSync(
        path.join(inputDir, breathsFile),
        "utf8",
      );
      const breaths = convertBreaths(breathRaw, numerics.durationS);
      const name = `subject_${id}_breaths.json`;
      sources.push({
        file: breathsFile,
        sha256: createHash("sha256").update(breathRaw).digest("hex"),
      });
      outputs.push([
        name,
        {
          subjectId: id,
          durationS: numerics.durationS,
          signalSampleRateHz: 125,
          ...breaths,
        },
      ]);
      entry.hasBreaths = true;
      entry.breathsFile = name;
    }
    outputs.push([
      jsonName,
      {
        schemaVersion: 2,
        subjectId: id,
        description: `BIDMC subject ${id} recorded SpO₂`,
        durationS: numerics.durationS,
        samplePeriodS: 1,
        samples: numerics.samples,
        provenance: {
          dataset: "BIDMC PPG and Respiration Dataset",
          sourceUrl: "https://physionet.org/content/bidmc/1.0.0/",
          sources,
          durationPolicy:
            "Last explicit numeric timestamp; terminal sample is an endpoint, with no assumed coverage beyond it.",
          duplicateNumericRowsRemoved: numerics.duplicateCount,
          invalidNumericValuesFlagged: numerics.invalidCount,
        },
      },
    ]);
    subjects.push(entry);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [name, data] of outputs)
    fs.writeFileSync(path.join(outputDir, name), JSON.stringify(data));
  fs.writeFileSync(
    path.join(outputDir, "index.json"),
    JSON.stringify(
      {
        schemaVersion: 2,
        generated: new Date().toISOString(),
        dataset: "BIDMC PPG and Respiration Dataset",
        subjects,
      },
      null,
      2,
    ),
  );
  return subjects;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const subjects = convertDirectory(
      path.resolve(here, "../../data/bidmc"),
      path.resolve(here, "../public/replay"),
    );
    console.log(
      `Converted ${subjects.length} recording(s); timestamped SpO₂ and independent annotation provenance written.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
