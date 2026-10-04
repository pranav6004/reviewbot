import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { buildServer } from "../src/server.js";
import { MockLLMProvider } from "@reviewbot/llm";

const SAMPLE_PAYLOAD = {
  action: "opened",
  pull_request: {
    number: 42,
    base: { sha: "basesha123" },
    head: { sha: "headsha456" },
    title: "Add authentication logic",
    body: "This PR adds token auth.",
    draft: false,
  },
  repository: {
    id: 999,
    name: "webapp",
    full_name: "acme/webapp",
    owner: { login: "acme" },
  },
  installation: {
    id: 12345,
  },
  sender: {
    login: "alice",
    type: "User",
  },
};

const SAMPLE_DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index 0000000..1111111 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,5 +1,7 @@
 export function authenticate(header: string) {
+  // insecure eval
+  eval(header);
   return true;
 }
`;

describe("ReviewBot server webhook end-to-end", () => {
  it("responds to /health endpoint", async () => {
    const server = await buildServer({ dbPath: ":memory:" });
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("reviewbot");
  });

  it("rejects invalid webhook signatures with 401", async () => {
    const secret = "test-webhook-secret";
    const server = await buildServer({
      dbPath: ":memory:",
      appConfig: { webhookSecret: secret },
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "x-hub-signature-256": "sha256=invalid-signature",
        "x-github-event": "pull_request",
        "x-github-delivery": "del-1",
        "content-type": "application/json",
      },
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.statusCode).toBe(401);
  });

  it("fails closed with 500 when webhook secret is missing", async () => {
    const server = await buildServer({
      dbPath: ":memory:",
      appConfig: {},
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "x-github-event": "pull_request",
        "content-type": "application/json",
      },
      payload: SAMPLE_PAYLOAD,
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toContain("GITHUB_WEBHOOK_SECRET");
  });

  it("blocks playground route in production environment", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.ENABLE_PUBLIC_PLAYGROUND;

    try {
      const server = await buildServer({ dbPath: ":memory:" });
      const response = await server.inject({
        method: "POST",
        url: "/api/playground/review",
        payload: { diff: "diff --git a/a.ts b/a.ts" },
      });

      expect(response.statusCode).toBe(403);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("verifies signature, enqueues PR review, and executes job end-to-end", async () => {
    const secret = "test-webhook-secret";
    let postedReviewData: any = null;

    const mockGitHubService = {
      fetchPullRequestDiff: async () => SAMPLE_DIFF,
      fetchRepositoryConfig: async () => undefined,
      postReview: async (owner: string, repo: string, pr: number, sha: string, output: any) => {
        postedReviewData = { owner, repo, pr, sha, output };
        return { id: 1 };
      },
    };

    const mockLlm = new MockLLMProvider([
      JSON.stringify({
        schemaVersion: "review-output-v1",
        summary: "Insecure eval detected.",
        walkthrough: [{ file: "src/auth.ts", summary: "Added auth check." }],
        findings: [
          {
            id: "eval-bug",
            file: "src/auth.ts",
            line: 3,
            side: "RIGHT",
            severity: "critical",
            category: "security",
            title: "Remote Code Execution via eval()",
            message: "Direct execution of user header string via eval() is critical RCE.",
            evidence: "eval(header);",
            suggestion: "// Remove eval",
            confidence: 1.0,
          },
        ],
      }),
    ]);

    const server = await buildServer({
      dbPath: ":memory:",
      appConfig: { webhookSecret: secret },
      llmProvider: mockLlm,
      githubServiceOverride: () => mockGitHubService as any,
    });

    const rawPayload = JSON.stringify(SAMPLE_PAYLOAD);
    const signature = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(rawPayload)
      .digest("hex")}`;

    const response = await server.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "del-happy-path",
        "content-type": "application/json",
      },
      payload: rawPayload,
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("enqueued");
    expect(body.pr).toBe("#42");

    // Wait for in-process worker to finish
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(postedReviewData).not.toBeNull();
    expect(postedReviewData.owner).toBe("acme");
    expect(postedReviewData.repo).toBe("webapp");
    expect(postedReviewData.pr).toBe(42);
    expect(postedReviewData.output.findings).toHaveLength(1);
    expect(postedReviewData.output.findings[0].severity).toBe("critical");
    expect(postedReviewData.output.findings[0].title).toBe("Remote Code Execution via eval()");
  });
});
