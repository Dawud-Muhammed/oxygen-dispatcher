// Recompute an exported synthetic experiment using its immutable inputs.
// No HTTP listener is started; Vite only loads the shared TypeScript engine.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath || process.argv.length !== 4) {
  console.error(
    "Usage: node scripts/reproduce-run.mjs <export.json> <recomputed.json>",
  );
  process.exitCode = 1;
} else {
  let loader;
  try {
    const normalizePath = (value) =>
      process.platform === "win32"
        ? path.resolve(value).toLowerCase()
        : path.resolve(value);
    if (normalizePath(inputPath) === normalizePath(outputPath))
      throw new Error(
        "Use a new output file; the source evidence must not be overwritten.",
      );
    const document = JSON.parse(await readFile(inputPath, "utf8"));
    const record = document.record ?? document;
    if (
      record.provenance?.source !== "synthetic" ||
      record.provenance?.modelVersion !== "dose-integral-1" ||
      record.provenance?.schemaVersion !== "2" ||
      record.provenance?.controllerVersion !== "state-machine-1" ||
      record.provenance?.stepS !== 0.1
    )
      throw new Error(
        "Only exports from the current synthetic model, controller and schema can be reproduced by this command.",
      );
    if (
      !record.config ||
      typeof record.config !== "object" ||
      Array.isArray(record.config)
    )
      throw new Error("The export must contain its captured configuration.");
    const actualDurationS = record.summary?.simDurationS;
    if (
      !Number.isFinite(actualDurationS) ||
      actualDurationS < 0 ||
      actualDurationS > record.config?.durationS
    )
      throw new Error("The export has an invalid actual duration.");
    if (!Array.isArray(record.faults))
      throw new Error("The export must contain its fault schedule.");
    const webRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    loader = await createServer({
      root: webRoot,
      configFile: false,
      server: { middlewareMode: true },
      appType: "custom",
    });
    const { ExperimentEngine } =
      await loader.ssrLoadModule("/src/sim/engine.ts");
    const engine = new ExperimentEngine(
      record.config,
      crypto.randomUUID(),
      record.faults,
    );
    while (engine.timeS < actualDurationS) engine.step();
    if (engine.timeS !== actualDurationS)
      throw new Error("Actual duration is not an engine interval boundary.");
    const recomputed = engine.exportRun();
    const sameSummary =
      JSON.stringify(canonical(recomputed.summary)) ===
      JSON.stringify(canonical(record.summary));
    await writeFile(outputPath, JSON.stringify(recomputed, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    console.log(
      `Recomputed ${engine.timeS} s. Aggregate results ${sameSummary ? "match exactly" : "differ from the submitted export"}.`,
    );
    console.log(
      "Fault timing is reproduced. Operator acknowledgements and the original run identifier are preserved only in the original export.",
    );
    if (!sameSummary) process.exitCode = 2;
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Unable to reproduce the experiment.",
    );
    process.exitCode = 1;
  } finally {
    await loader?.close();
  }
}
