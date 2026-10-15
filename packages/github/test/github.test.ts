import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import {
  verifyWebhookSignature,
  formatReviewSummary,
  formatInlineComment,
  STICKY_SUMMARY_MARKER,
  SUMMARY_V1_MARKER,
  GitHubService,
} from "../src/index.js";
import type { ReviewFinding, ReviewOutput } from "@reviewbot/review-core";

describe("GitHub webhook, formatter, and sticky comments", () => {
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

  it("formats review summary with sticky marker, collapsible walkthrough table, and Mermaid diagram", () => {
    const output: ReviewOutput = {
      schemaVersion: "review-output-v1",
      summary: "PR adds authentication middleware with slight flaws.",
      diagram: `sequenceDiagram\nClient->>Server: POST /login\nServer-->>Client: JWT Token`,
      walkthrough: [
        { file: "src/auth.ts", summary: "Added token check" },
        { file: "src/middleware.ts", summary: "Added JWT verify handler" },
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
    expect(summary).toContain(STICKY_SUMMARY_MARKER);
    expect(summary).toContain(SUMMARY_V1_MARKER);
    expect(summary).toContain("PR adds authentication middleware");
    expect(summary).toContain("<details>");
    expect(summary).toContain("<summary><b>📋 File Walkthrough (2 files)</b></summary>");
    expect(summary).toContain("| `src/auth.ts` | Added token check |");
    expect(summary).toContain("### 🔄 Sequence & Architecture Diagram");
    expect(summary).toContain("```mermaid\nsequenceDiagram\nClient->>Server: POST /login\nServer-->>Client: JWT Token\n```");
    expect(summary).toContain("**Warnings:** 1");
    expect(summary).toContain("ReviewBot Tip");
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

  it("upserts sticky comment: creates new comment on initial review, updates existing on subsequent review", async () => {
    const mockComments: any[] = [];

    const mockOctokit: any = {
      issues: {
        listComments: vi.fn(async () => ({ data: [...mockComments] })),
        createComment: vi.fn(async ({ body }: any) => {
          const newComment = { id: 101, body };
          mockComments.push(newComment);
          return { data: newComment };
        }),
        updateComment: vi.fn(async ({ comment_id, body }: any) => {
          const idx = mockComments.findIndex((c) => c.id === comment_id);
          if (idx !== -1) mockComments[idx].body = body;
          return { data: { id: comment_id, body } };
        }),
      },
      pulls: {
        createReview: vi.fn(async () => ({ data: { id: 202 } })),
      },
    };

    const service = new GitHubService(mockOctokit);

    const output1: ReviewOutput = {
      schemaVersion: "review-output-v1",
      summary: "First review summary",
      walkthrough: [{ file: "a.ts", summary: "Added a" }],
      findings: [],
    };

    // First review: should create sticky comment
    const res1 = await service.upsertStickyComment("acme", "repo", 42, formatReviewSummary(output1));
    expect(res1.action).toBe("created");
    expect(res1.id).toBe(101);
    expect(mockOctokit.issues.createComment).toHaveBeenCalledTimes(1);
    expect(mockOctokit.issues.updateComment).not.toHaveBeenCalled();

    // Second review: should update existing sticky comment instead of creating a second one
    const output2: ReviewOutput = {
      schemaVersion: "review-output-v1",
      summary: "Second updated review summary",
      walkthrough: [{ file: "a.ts", summary: "Added a" }, { file: "b.ts", summary: "Added b" }],
      findings: [],
    };

    const res2 = await service.upsertStickyComment("acme", "repo", 42, formatReviewSummary(output2));
    expect(res2.action).toBe("updated");
    expect(res2.id).toBe(101);
    expect(mockOctokit.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 101, body: expect.stringContaining("Second updated review summary") })
    );
    expect(mockComments).toHaveLength(1);
  });
});
