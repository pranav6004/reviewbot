import { describe, it, expect } from "vitest";
import { ReviewDatabase } from "../src/index.js";
import type { ReviewJob, ReviewOutput } from "@reviewbot/review-core";

describe("ReviewDatabase persistence", () => {
  it("stores and deduplicates deliveries, tracks job status and findings", () => {
    const db = new ReviewDatabase(":memory:");

    const job: ReviewJob = {
      provider: "github",
      repository: { owner: "octocat", name: "hello-world", id: 1 },
      pullRequest: {
        number: 10,
        baseSha: "base123",
        headSha: "head456",
        title: "Test PR",
      },
      trigger: "opened",
      deliveryId: "del-777",
      mode: "full",
    };

    expect(db.isDeliveryProcessed("del-777")).toBe(false);

    db.recordJob("job-1", job);
    expect(db.isDeliveryProcessed("del-777")).toBe(true);

    db.updateJobStatus("job-1", "processing");

    const output: ReviewOutput = {
      schemaVersion: "review-output-v1",
      summary: "Looks good",
      walkthrough: [],
      findings: [
        {
          id: "fp-123",
          file: "index.js",
          line: 5,
          side: "RIGHT",
          severity: "warning",
          category: "bug",
          title: "Potential Null Pointer",
          message: "Check null",
          evidence: "obj.val",
          confidence: 0.9,
        },
      ],
    };

    db.recordFindings("job-1", output);
    db.updateJobStatus("job-1", "completed");

    const priors = db.getPriorFindingFingerprints("octocat", "hello-world", 10);
    expect(priors.has("fp-123")).toBe(true);
    expect(priors.has("fp-999")).toBe(false);

    db.close();
  });
});
