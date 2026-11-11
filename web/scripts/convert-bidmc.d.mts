export function parseCsv(text: string): Record<string, string>[];
export function convertNumerics(text: string): {
  samples: { timeS: number; value: number | null; quality: "good" | "low" }[];
  durationS: number;
  samplePeriodS: number;
  invalidCount: number;
  duplicateCount: number;
};
export function convertBreaths(
  text: string,
  durationS: number,
): {
  breathTimesS: number[];
  annotator2TimesS: number[];
  annotationPolicy: string;
  disagreement: {
    matchingWindowS: number;
    matchedPairs: number;
    unmatchedAnnotator1: number;
    unmatchedAnnotator2: number;
    maxAbsoluteDifferenceS: number | null;
  };
};
export function convertDirectory(
  inputDir: string,
  outputDir: string,
): {
  id: string;
  file: string;
  description: string;
  hasSpO2: boolean;
  hasBreaths: boolean;
  durationS: number;
  breathsFile?: string;
}[];
