import { parseReviewBotConfig, shouldIncludeFile, type PathInstruction } from "@reviewbot/config";
import { parseUnifiedDiff, type FileDiff } from "@reviewbot/diff";
import type { LLMProvider } from "@reviewbot/llm";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { validateReviewOutput } from "./validator.js";
import { scanSecretsInDiff } from "./security.js";
import type { ReviewJob, ReviewResult, ReviewOutput } from "./types.js";

const MAX_FILES_TO_REVIEW = 50;

export interface ReviewEngineOptions {
  job: ReviewJob;
  rawDiff: string;
  configYaml?: string;
  provider: LLMProvider;
}

export class ReviewEngine {
  async execute(options: ReviewEngineOptions): Promise<ReviewResult> {
    const startTime = Date.now();
    const { job, rawDiff, configYaml, provider } = options;

    // 1. Load config
    const config = parseReviewBotConfig(configYaml || "");

    // If review disabled in config, skip
    if (!config.review.enabled) {
      return {
        job,
        output: {
          schemaVersion: "review-output-v1",
          summary: "Review is disabled for this repository via .reviewbot.yaml",
          walkthrough: [],
          findings: [],
        },
        filesReviewed: 0,
        totalFiles: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Parse diff
    const allFiles = parseUnifiedDiff(rawDiff);

    // 3. Filter files
    const includedFiles = allFiles.filter(
      (f) => !f.isBinary && shouldIncludeFile(f.newPath, config.review.path_filters)
    );

    if (includedFiles.length === 0) {
      return {
        job,
        output: {
          schemaVersion: "review-output-v1",
          summary:
            allFiles.length === 0
              ? "Pull request contains no file changes."
              : "All changed files matched exclusion filters (e.g. lockfiles, generated assets).",
          walkthrough: [],
          findings: [],
        },
        filesReviewed: 0,
        totalFiles: allFiles.length,
        durationMs: Date.now() - startTime,
      };
    }

    // 4. Guardrail: Diff Truncation & Token Budget Guard
    let filesToReview = includedFiles;
    let isTruncated = false;
    if (includedFiles.length > MAX_FILES_TO_REVIEW) {
      // Prioritize files with highest churn
      filesToReview = [...includedFiles]
        .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
        .slice(0, MAX_FILES_TO_REVIEW);
      isTruncated = true;
    }

    // 5. Guardrail: Deterministic Secret Scanner (pre-LLM)
    const secretFindings = scanSecretsInDiff(filesToReview);

    // 6. Resolve path instructions
    const matchedPathInstructions: PathInstruction[] = [];
    for (const pi of config.path_instructions) {
      const anyMatch = filesToReview.some((f) =>
        shouldIncludeFile(f.newPath, [pi.path])
      );
      if (anyMatch) {
        matchedPathInstructions.push(pi);
      }
    }

    // 7. Build prompts (secrets are automatically scrubbed from prompt text)
    const systemPrompt = buildSystemPrompt(config);
    const userPrompt = buildUserPrompt(
      job,
      filesToReview,
      config,
      matchedPathInstructions
    );

    // 8. Request review from LLM
    const llmResponse = await provider.complete({
      system: systemPrompt,
      user: userPrompt,
      responseFormat: "json_object",
      maxOutputTokens: 4096,
      temperature: 0.1,
    });

    // 9. Validate and sanitize findings (Stage F) + merge secret findings
    const output: ReviewOutput = validateReviewOutput(
      llmResponse.content,
      filesToReview,
      config,
      secretFindings
    );

    // 10. Prepend security & truncation banners if triggered
    let summaryPrefix = "";
    if (secretFindings.length > 0) {
      summaryPrefix += `🚨 **SECURITY ALERT**: Detected ${secretFindings.length} hardcoded credential(s) added in this pull request. Review immediately before merging!\n\n`;
    }
    if (isTruncated) {
      summaryPrefix += `⚠️ **Guardrail Notice**: PR contained ${includedFiles.length} files. Evaluated top ${MAX_FILES_TO_REVIEW} files with largest changes; remainder omitted to prevent token exhaustion.\n\n`;
    }
    if (summaryPrefix) {
      output.summary = summaryPrefix + output.summary;
    }

    return {
      job,
      output,
      filesReviewed: filesToReview.length,
      totalFiles: allFiles.length,
      tokensUsed: llmResponse.usage?.totalTokens,
      durationMs: Date.now() - startTime,
    };
  }
}

