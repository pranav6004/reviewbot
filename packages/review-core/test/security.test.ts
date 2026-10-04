import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "@reviewbot/diff";
import {
  scanSecretsInDiff,
  redactSecretsForPrompt,
  SECRET_RULES,
} from "../src/security.js";
import { ReviewEngine } from "../src/engine.js";
import { MockLLMProvider } from "@reviewbot/llm";
import type { ReviewJob } from "../src/types.js";

const sampleJob: ReviewJob = {
  provider: "github",
  repository: { owner: "test-org", name: "repo", id: 1 },
  pullRequest: {
    number: 10,
    baseSha: "base-sha",
    headSha: "head-sha",
    title: "Test PR with potential secrets",
  },
  trigger: "opened",
  mode: "full",
};

const dummyAwsKey = "AKIAIOSFODNN7EXAMPLE";
const dummyGhToken = ["ghp", "1234567890abcdefghijklmnopqrstuvwxyz"].join("_");
const dummySlackToken = ["xoxb", "12345678901", "123456789012", "abcdefghijklmnopqrstuvwx"].join("-");

describe("Security Guardrails: Secret Scanning & Redaction", () => {
  it("detects committed AWS keys and GitHub PATs on added lines", () => {
    const diff = `diff --git a/config.ts b/config.ts
index e69de29..d95f3ad 100644
--- a/config.ts
+++ b/config.ts
@@ -1,3 +1,6 @@
 export const config = {
+  awsKey: "${dummyAwsKey}",
+  ghToken: "${dummyGhToken}",
 };
`;
    const files = parseUnifiedDiff(diff);
    const findings = scanSecretsInDiff(files);

    expect(findings.length).toBe(2);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].category).toBe("security");
    expect(findings[0].title).toContain("AWS Access Key ID");
    expect(findings[0].line).toBe(2);

    expect(findings[1].title).toContain("GitHub Personal Access Token");
    expect(findings[1].line).toBe(3);
  });

  it("does NOT flag deleted secrets", () => {
    const diff = `diff --git a/config.ts b/config.ts
index e69de29..d95f3ad 100644
--- a/config.ts
+++ b/config.ts
@@ -1,4 +1,3 @@
-  awsKey: "${dummyAwsKey}",
+  awsKey: process.env.AWS_KEY,
`;
    const files = parseUnifiedDiff(diff);
    const findings = scanSecretsInDiff(files);

    expect(findings.length).toBe(0);
  });

  it("redacts credentials from raw text before sending to LLM", () => {
    const input = `Here is our AWS key: ${dummyAwsKey} and token ${dummyGhToken}`;
    const { text, redactedCount } = redactSecretsForPrompt(input);

    expect(redactedCount).toBe(2);
    expect(text).toContain("[REDACTED_AWS_KEY]");
    expect(text).toContain("[REDACTED_GITHUB_PAT]");
    expect(text).not.toContain(dummyAwsKey);
    expect(text).not.toContain(dummyGhToken);
  });

  it("automatically includes secret findings in ReviewEngine even if LLM returns 0 findings", async () => {
    const diffWithSecret = `diff --git a/src/creds.ts b/src/creds.ts
index e69de29..d95f3ad 100644
--- a/src/creds.ts
+++ b/src/creds.ts
@@ -1,2 +1,4 @@
 export function getKeys() {
+  const token = "${dummySlackToken}";
+  return token;
 }
`;
    // Mock LLM returning empty findings
    const mockLLM = new MockLLMProvider(
      JSON.stringify({
        schemaVersion: "review-output-v1",
        summary: "Code looks good to me.",
        walkthrough: [],
        findings: [],
      })
    );

    const engine = new ReviewEngine();
    const result = await engine.execute({
      job: sampleJob,
      rawDiff: diffWithSecret,
      provider: mockLLM,
    });

    expect(result.output.findings.length).toBe(1);
    expect(result.output.findings[0].category).toBe("security");
    expect(result.output.findings[0].severity).toBe("critical");
    expect(result.output.findings[0].title).toContain("Slack API / Bot Token");
    expect(result.output.summary).toContain("SECURITY ALERT");
  });
});
