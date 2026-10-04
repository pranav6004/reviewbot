import YAML from "yaml";
import picomatch from "picomatch";
import {
  ReviewBotConfigSchema,
  type ReviewBotConfig,
  type PathInstruction,
  DEFAULT_PATH_FILTERS,
} from "./schema.js";

/**
 * Parse and validate a .reviewbot.yaml raw string.
 * Returns valid configuration with defaults applied.
 */
export function parseReviewBotConfig(rawYaml: string): ReviewBotConfig {
  if (!rawYaml || rawYaml.trim().length === 0) {
    return ReviewBotConfigSchema.parse({});
  }

  const parsed = YAML.parse(rawYaml);
  if (!parsed || typeof parsed !== "object") {
    return ReviewBotConfigSchema.parse({});
  }

  return ReviewBotConfigSchema.parse(parsed);
}

/**
 * Determine whether a given file path should be reviewed based on path filters.
 * Glob patterns starting with '!' are exclusions. Patterns without '!' are inclusions.
 */
export function shouldIncludeFile(filePath: string, pathFilters: string[] = DEFAULT_PATH_FILTERS): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Partition into inclusions and exclusions
  const positivePatterns: string[] = [];
  const negativePatterns: string[] = [];

  for (const filter of pathFilters) {
    if (filter.startsWith("!")) {
      negativePatterns.push(filter.slice(1));
    } else {
      positivePatterns.push(filter);
    }
  }

  // Check exclusions first
  if (negativePatterns.length > 0) {
    const isExcluded = picomatch(negativePatterns, { dot: true });
    if (isExcluded(normalizedPath)) {
      return false;
    }
  }

  // If there are positive patterns, the path must match at least one
  if (positivePatterns.length > 0) {
    const isIncluded = picomatch(positivePatterns, { dot: true });
    return Boolean(isIncluded(normalizedPath));
  }

  // By default, if not excluded, it is included
  return true;
}

/**
 * Retrieve matching custom instructions for a given file path.
 */
export function getInstructionsForFile(
  filePath: string,
  pathInstructions: PathInstruction[]
): string[] {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const matching: string[] = [];

  for (const item of pathInstructions) {
    const isMatch = picomatch(item.path, { dot: true });
    if (isMatch(normalizedPath)) {
      matching.push(item.instructions);
    }
  }

  return matching;
}
