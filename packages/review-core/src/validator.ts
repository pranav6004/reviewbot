import crypto from "node:crypto";
import type { ReviewBotConfig, Severity } from "@reviewbot/config";
import { isLineInHunk, type FileDiff } from "@reviewbot/diff";
import {
  ReviewOutputSchema,
  type ReviewFinding,
  type ReviewOutput,
} from "./types.js";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  warning: 3,
  suggestion: 2,
  nitpick: 1,
};

/**
 * Generate a deterministic fingerprint for a finding.
 * Format used in HTML markers: <!-- reviewbot:finding:v1:<fingerprint> -->
 */
export function generateFindingFingerprint(finding: Omit<ReviewFinding, "id">): string {
  const normTitle = finding.title.toLowerCase().trim().replace(/\s+/g, " ");
  const raw = `${finding.file}:${finding.line}:${finding.side}:${finding.category}:${normTitle}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Clean LLM response text and parse into JSON.
 */
export function extractJsonFromResponse(raw: string): any {
  let cleaned = raw.trim();

  // Strip markdown code fences if model wrapped response in ```json ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/, "");
  }

  // Find opening '{' and closing '}' if there is surrounding chatter
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

/**
 * Stage F: Validate and sanitize LLM review output against actual diffs and configuration.
 */
export function validateReviewOutput(
  rawText: string,
  files: FileDiff[],
  config: ReviewBotConfig,
  guaranteedFindings: ReviewFinding[] = []
): ReviewOutput {
  let parsedJson: any;
  try {
    parsedJson = extractJsonFromResponse(rawText);
  } catch (err: any) {
    throw new Error(`Failed to parse LLM response as JSON: ${err.message}`);
  }

  const parsed = ReviewOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `LLM response failed schema validation: ${JSON.stringify(parsed.error.issues)}`
    );
  }

  const rawOutput = parsed.data;
  const fileMap = new Map<string, FileDiff>();
  for (const f of files) {
    fileMap.set(f.newPath, f);
    if (f.oldPath) fileMap.set(f.oldPath, f);
  }

  const minSeverityScore = SEVERITY_ORDER[config.review.min_severity];
  const validatedFindings: ReviewFinding[] = [];
  const seenFingerprints = new Set<string>();

  for (const candidate of rawOutput.findings) {
    // 1. File must exist in diff
    const fileDiff = fileMap.get(candidate.file);
    if (!fileDiff) {
      continue; // Dropping hallucinated file
    }

    // 2. Line must be within a diff hunk on the specified side
    const validLine = isLineInHunk(fileDiff, candidate.line, candidate.side);
    if (!validLine) {
      continue; // Dropping finding on line outside changed hunks to avoid GitHub 422 errors
    }

    // 3. Severity threshold
    const candidateScore = SEVERITY_ORDER[candidate.severity];
    if (candidateScore < minSeverityScore) {
      continue;
    }

    // 4. Stable fingerprint & deduplication
    const fingerprint = generateFindingFingerprint(candidate);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);

    validatedFindings.push({
      ...candidate,
      id: fingerprint,
    });
  }

  // 4b. Merge guaranteed deterministic findings (e.g. secret leaks detected in diff)
  for (const gf of guaranteedFindings) {
    const fingerprint = gf.id || generateFindingFingerprint(gf);
    if (!seenFingerprints.has(fingerprint)) {
      seenFingerprints.add(fingerprint);
      validatedFindings.push({
        ...gf,
        id: fingerprint,
      });
    }
  }

  // 5. Sort by severity descending, then file, then line
  validatedFindings.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (sevDiff !== 0) return sevDiff;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  // 6. Enforce max findings budget
  const boundedFindings = validatedFindings.slice(0, config.review.max_findings);

  return {
    schemaVersion: "review-output-v1",
    summary: rawOutput.summary || "No critical issues detected in this pull request.",
    walkthrough: rawOutput.walkthrough || [],
    findings: boundedFindings,
  };
}
