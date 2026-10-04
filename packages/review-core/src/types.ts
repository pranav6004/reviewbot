import { z } from "zod";
import { SeveritySchema } from "@reviewbot/config";

export const FindingCategorySchema = z.enum([
  "bug",
  "security",
  "performance",
  "correctness",
  "style",
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const ReviewFindingSchema = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number().int().min(1),
  endLine: z.number().int().min(1).optional(),
  side: z.enum(["RIGHT", "LEFT"]).default("RIGHT"),
  severity: SeveritySchema,
  category: FindingCategorySchema,
  title: z.string(),
  message: z.string(),
  evidence: z.string(),
  suggestion: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.8),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const WalkthroughItemSchema = z.object({
  file: z.string(),
  summary: z.string(),
  ranges: z.array(z.string()).optional(),
});
export type WalkthroughItem = z.infer<typeof WalkthroughItemSchema>;

export const ReviewOutputSchema = z.object({
  schemaVersion: z.literal("review-output-v1"),
  summary: z.string(),
  walkthrough: z.array(WalkthroughItemSchema).default([]),
  findings: z.array(ReviewFindingSchema).default([]),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export interface ReviewJob {
  provider: "github";
  repository: {
    owner: string;
    name: string;
    id: number;
  };
  pullRequest: {
    number: number;
    baseSha: string;
    headSha: string;
    title: string;
    body?: string;
  };
  trigger: "opened" | "reopened" | "ready_for_review" | "synchronize" | "manual";
  installationId?: number;
  deliveryId?: string;
  mode: "full" | "incremental" | "local";
}

export interface ReviewResult {
  job: ReviewJob;
  output: ReviewOutput;
  filesReviewed: number;
  totalFiles: number;
  tokensUsed?: number;
  durationMs: number;
}
