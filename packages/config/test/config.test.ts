import { describe, it, expect } from "vitest";
import { parseReviewBotConfig, shouldIncludeFile, getInstructionsForFile } from "../src/index.js";

const VALID_YAML = `
version: 1
review:
  profile: assertive
  min_severity: warning
  max_findings: 15
  draft_pull_requests: false
  path_filters:
    - "!dist/**"
    - "!**/*.lock"
    - "src/**"
  instructions: |
    Focus on memory leaks and security vulnerabilities.
path_instructions:
  - path: "src/api/**"
    instructions:
      - "Validate input schemas thoroughly"
      - "Verify authentication token checks"
  - path: "src/db/**"
    instructions: "Ensure SQL queries are parameterized"
`;

describe("config loader", () => {
  it("parses valid yaml and applies schema", () => {
    const config = parseReviewBotConfig(VALID_YAML);
    expect(config.version).toBe(1);
    expect(config.review.profile).toBe("assertive");
    expect(config.review.min_severity).toBe("warning");
    expect(config.review.max_findings).toBe(15);
    expect(config.review.instructions).toContain("Focus on memory leaks");
    expect(config.path_instructions).toHaveLength(2);
    expect(config.path_instructions[0].instructions).toContain("Validate input schemas");
  });

  it("applies defaults on empty input", () => {
    const config = parseReviewBotConfig("");
    expect(config.version).toBe(1);
    expect(config.review.enabled).toBe(true);
    expect(config.review.profile).toBe("balanced");
    expect(config.review.min_severity).toBe("warning");
    expect(config.review.max_findings).toBe(20);
  });

  it("filters paths correctly based on inclusions and exclusions", () => {
    const filters = ["!dist/**", "!**/*.lock", "src/**"];

    expect(shouldIncludeFile("dist/bundle.js", filters)).toBe(false);
    expect(shouldIncludeFile("package-lock.json", filters)).toBe(false);
    expect(shouldIncludeFile("src/index.ts", filters)).toBe(true);
    expect(shouldIncludeFile("docs/readme.md", filters)).toBe(false); // positive "src/**" requires match
  });

  it("matches path instructions correctly", () => {
    const config = parseReviewBotConfig(VALID_YAML);
    const apiInstructions = getInstructionsForFile("src/api/users.ts", config.path_instructions);
    expect(apiInstructions).toHaveLength(1);
    expect(apiInstructions[0]).toContain("Validate input schemas");

    const dbInstructions = getInstructionsForFile("src/db/queries.ts", config.path_instructions);
    expect(dbInstructions).toHaveLength(1);
    expect(dbInstructions[0]).toContain("Ensure SQL queries are parameterized");

    const otherInstructions = getInstructionsForFile("src/utils/math.ts", config.path_instructions);
    expect(otherInstructions).toHaveLength(0);
  });
});
