import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  verifyWebhookSignature,
  formatReviewSummary,
  formatInlineComment,
} from "../src/index.js";
import type { ReviewFinding, ReviewOutput } from "@reviewbot/review-core";

describe("GitHub webhook and formatter", () => {
  it("verifies valid HMAC SHA-256 webhook signatures", async () => {
    const secret = "super-secret-key-12345";
    const payload = JSON.stringify({ action: "opened", pull_request: { id: 1 } });
    const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const signature = `sha256=${hmac}`;

    const isValid = await verifyWebhookSignature(secret, payload, signature);
    expect(isValid).toBe(true);

    const isInvalid = await verifyWebhookSignature(secret, payload, "sha256=invalidhex");
    expect(isInvalid).toBe(false);
  });

  it("formats review summary with stable marker and stats", () => {
    const output: ReviewOutput = {
      schemaVersion: "review-output-v1",
      summary: "PR adds authentication middleware with slight flaws.",
      walkthrough: [
        { file: "src/auth.ts", summary: "Added token check" },
      ],
      findings: [
        {
          id: "abc1234",
          file: "src/auth.ts",
          line: 25,
          side: "RIGHT",
          severity: "warning",
          category: "security",
          title: "Weak secret",
          message: "Secret is hardcoded",
          evidence: "const secret = '123'",
          confidence: 0.9,
        },
      ],
    };

    const summary = formatReviewSummary(output);
    expect(summary).toContain("<!-- reviewbot:summary:v1 -->");
    expect(summary).toContain("PR adds authentication middleware");
    expect(summary).toContain("`src/auth.ts`");
    expect(summary).toContain("**Warnings:** 1");
  });

  it("formats inline comment with GitHub suggestion block and stable marker", () => {
    const finding: ReviewFinding = {
      id: "deadbeef1234",
      file: "src/index.ts",
      line: 42,
      side: "RIGHT",
      severity: "critical",
      category: "correctness",
      title: "Off-by-one error",
      message: "Loop condition uses <= instead of <",
      evidence: "for (let i = 0; i <= arr.length; i++)",
      suggestion: "for (let i = 0; i < arr.length; i++)",
      confidence: 0.95,
    };

    const comment = formatInlineComment(finding);
    expect(comment).toContain("<!-- reviewbot:finding:v1:deadbeef1234 -->");
    expect(comment).toContain("### 🚨 Off-by-one error");
    expect(comment).toContain("```suggestion\nfor (let i = 0; i < arr.length; i++)\n```");
  });
});
