import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "warning", "suggestion", "nitpick"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ReviewProfileSchema = z.enum(["quiet", "balanced", "assertive"]);
export type ReviewProfile = z.infer<typeof ReviewProfileSchema>;

export const PathInstructionSchema = z.object({
  path: z.string().min(1),
  instructions: z.union([z.string(), z.array(z.string())]).transform((val) =>
    Array.isArray(val) ? val.join("\n") : val
  ),
});
export type PathInstruction = z.infer<typeof PathInstructionSchema>;

export const DEFAULT_PATH_FILTERS = [
  "!dist/**",
  "!build/**",
  "!out/**",
  "!node_modules/**",
  "!**/*.lock",
  "!**/package-lock.json",
  "!**/pnpm-lock.yaml",
  "!**/yarn.lock",
  "!**/*.min.js",
  "!**/*.min.css",
  "!**/*.map",
  "!**/generated/**",
  "!**/*.svg",
  "!**/*.png",
  "!**/*.jpg",
  "!**/*.jpeg",
  "!**/*.ico",
  "!**/*.woff",
  "!**/*.woff2",
];

export const ReviewBotConfigSchema = z.object({
  version: z.literal(1).default(1),
  review: z
    .object({
      enabled: z.boolean().default(true),
      profile: ReviewProfileSchema.default("balanced"),
      min_severity: SeveritySchema.default("warning"),
      max_findings: z.number().int().min(1).max(100).default(20),
      draft_pull_requests: z.boolean().default(false),
      path_filters: z.array(z.string()).default(DEFAULT_PATH_FILTERS),
      instructions: z.string().optional(),
      collapse_threshold: z.number().int().min(1).default(10),
      summary_position: z.enum(["replace_description", "comment", "both"]).default("both"),
    })
    .default({}),
  path_instructions: z.array(PathInstructionSchema).default([]),
  tools: z
    .object({
      enabled: z.boolean().default(true),
      run_existing_configs: z.boolean().default(true),
    })
    .default({}),
  chat: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({}),
});

export type ReviewBotConfig = z.infer<typeof ReviewBotConfigSchema>;
