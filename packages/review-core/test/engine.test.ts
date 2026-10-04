import { describe, it, expect } from "vitest";
import { MockLLMProvider } from "@reviewbot/llm";
import { parseReviewBotConfig } from "@reviewbot/config";
import { parseUnifiedDiff } from "@reviewbot/diff";
import {
  ReviewEngine,
  validateReviewOutput,
  generateFindingFingerprint,
  type ReviewJob,
} from "../src/index.js";

const BUGGY_DIFF = `diff --git a/src/db.ts b/src/db.ts
index e69de29..d95f3ad 100644
--- a/src/db.ts
+++ b/src/db.ts
@@ -15,5 +15,6 @@ export async function getUser(req: Request) {
   const id = req.query.id;
+  // Vulnerable raw query
+  return db.query("SELECT * FROM users WHERE id = " + id);
 }
`;

describe("ReviewEngine and Validator", () => {
  it("generates deterministic fingerprints for identical findings", () => {
    const fp1 = generateFindingFingerprint({
      file: "src/db.ts",
      line: 18,
      side: "RIGHT",
      severity: "critical",
      category: "security",
      title: "SQL Injection",
      message: "Unescaped user input concatenated into SQL query.",
      evidence: 'db.query("SELECT * FROM users WHERE id = " + id)',
      confidence: 0.95,
    });

    const fp2 = generateFindingFingerprint({
      file: "src/db.ts",
      line: 18,
      side: "RIGHT",
      severity: "critical",
      category: "security",
      title: "  sql   injection  ", // normalization test
      message: "Different wording",
      evidence: "Different evidence",
      confidence: 0.8,
    });

    expect(fp1).toBe(fp2);
  });

  it("validates and drops hallucinated files and invalid lines (Stage F)", () => {
    const files = parseUnifiedDiff(BUGGY_DIFF);
    const config = parseReviewBotConfig("version: 1\nreview:\n  min_severity: warning");

    const rawLlmOutput = JSON.stringify({
      schemaVersion: "review-output-v1",
      summary: "Found issues",
      walkthrough: [{ file: "src/db.ts", summary: "Changed user lookup" }],
      findings: [
        {
          id: "1",
          file: "src/db.ts",
          line: 18, // valid line inside hunk
          side: "RIGHT",
          severity: "critical",
          category: "security",
          title: "SQL Injection",
          message: "Raw query concat",
          evidence: "db.query(...)",
          confidence: 0.9,
        },
        {
          id: "2",
          file: "src/db.ts",
          line: 999, // INVALID line outside hunk!
          side: "RIGHT",
          severity: "critical",
          category: "bug",
          title: "Hallucinated line",
          message: "Fake error",
          evidence: "none",
          confidence: 0.9,
        },
        {
          id: "3",
          file: "non_existent.ts", // INVALID hallucinated file!
          line: 10,
          side: "RIGHT",
          severity: "critical",
          category: "bug",
          title: "Hallucinated file",
          message: "Fake file",
          evidence: "none",
          confidence: 0.9,
        },
        {
          id: "4",
          file: "src/db.ts",
          line: 18,
          side: "RIGHT",
          severity: "nitpick", // BELOW min_severity warning!
          category: "style",
          title: "Style preference",
          message: "Use single quotes",
          evidence: "SELECT",
          confidence: 0.9,
        },
      ],
    });

    const result = validateReviewOutput(rawLlmOutput, files, config);
    // Only finding 1 should survive Stage F!
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("src/db.ts");
    expect(result.findings[0].line).toBe(18);
    expect(result.findings[0].severity).toBe("critical");
  });

  it("runs full review engine pipeline with mock provider", async () => {
    const mockLlm = new MockLLMProvider([
      JSON.stringify({
        schemaVersion: "review-output-v1",
        summary: "Found SQL injection vulnerability.",
        walkthrough: [{ file: "src/db.ts", summary: "Added user query logic." }],
        findings: [
          {
            id: "tmp",
            file: "src/db.ts",
            line: 18,
            side: "RIGHT",
            severity: "critical",
            category: "security",
            title: "SQL Injection Vulnerability",
            message: "User input directly concatenated into SQL statement.",
            evidence: 'db.query("SELECT * FROM users WHERE id = " + id)',
            suggestion: 'return db.query("SELECT * FROM users WHERE id = $1", [id]);',
            confidence: 0.98,
          },
        ],
      }),
    ]);

    const job: ReviewJob = {
      provider: "github",
      repository: { owner: "acme", name: "app", id: 123 },
      pullRequest: {
        number: 42,
        baseSha: "abc",
        headSha: "def",
        title: "Add getUser endpoint",
      },
      trigger: "opened",
      mode: "full",
    };

    const engine = new ReviewEngine();
    const result = await engine.execute({
      job,
      rawDiff: BUGGY_DIFF,
      provider: mockLlm,
    });

    expect(result.filesReviewed).toBe(1);
    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0].severity).toBe("critical");
    expect(result.output.findings[0].suggestion).toContain("$1");
    expect(result.output.summary).toContain("Found SQL injection");
  });
});
