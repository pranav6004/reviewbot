import type { FileDiff } from "@reviewbot/diff";
import type { ReviewFinding } from "./types.js";
import { generateFindingFingerprint } from "./validator.js";

export interface SecretRule {
  id: string;
  name: string;
  pattern: RegExp;
  redactReplacement: string;
  severity: "critical" | "warning";
}

export const SECRET_RULES: SecretRule[] = [
  {
    id: "aws-access-key",
    name: "AWS Access Key ID",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    redactReplacement: "[REDACTED_AWS_KEY]",
    severity: "critical",
  },
  {
    id: "github-pat",
    name: "GitHub Personal Access Token",
    pattern: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/g,
    redactReplacement: "[REDACTED_GITHUB_PAT]",
    severity: "critical",
  },
  {
    id: "private-key",
    name: "Private Key Certificate",
    pattern: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    redactReplacement: "[REDACTED_PRIVATE_KEY]",
    severity: "critical",
  },
  {
    id: "slack-token",
    name: "Slack API / Bot Token",
    pattern: /\b(xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9-]{20,})\b/g,
    redactReplacement: "[REDACTED_SLACK_TOKEN]",
    severity: "critical",
  },
  {
    id: "generic-api-key",
    name: "Hardcoded API Key / Client Secret",
    pattern: /(?:api[_-]?key|client[_-]?secret|auth[_-]?token|private[_-]?key|access[_-]?token)\s*[:=]\s*['"]([a-zA-Z0-9_\-\.]{24,})['"]/gi,
    redactReplacement: "$1=[REDACTED_CREDENTIAL]",
    severity: "critical",
  },
  {
    id: "jwt-token",
    name: "Hardcoded JSON Web Token (JWT)",
    pattern: /\b(eyJ[a-zA-Z0-9_-]{12,}\.eyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,})\b/g,
    redactReplacement: "[REDACTED_JWT_TOKEN]",
    severity: "critical",
  },
];

/**
 * Scan all added lines in a diff for hardcoded credentials.
 * Produces guaranteed critical findings without relying on LLM inference.
 */
export function scanSecretsInDiff(files: FileDiff[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const file of files) {
    if (file.isBinary) continue;

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== "add" || !line.newLineNumber) continue;

        for (const rule of SECRET_RULES) {
          // Reset regex state if global
          rule.pattern.lastIndex = 0;
          if (rule.pattern.test(line.content)) {
            const rawFinding: Omit<ReviewFinding, "id"> = {
              file: file.newPath,
              line: line.newLineNumber,
              side: "RIGHT",
              severity: rule.severity,
              category: "security",
              title: `Committed credential detected: ${rule.name}`,
              message: `Potential hardcoded secret matching pattern for **${rule.name}** was added to source control. Credentials must never be committed to git repositories. Revoke this credential immediately if valid, and load it from environment variables or a secret vault instead.`,
              evidence: line.content.trim(),
              suggestion: "// TODO: Load credential securely from process.env",
              confidence: 0.99,
            };

            const id = generateFindingFingerprint(rawFinding);
            findings.push({
              ...rawFinding,
              id,
            });
            break; // One finding per line is enough
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Scrub secrets from diff text before dispatching to external LLM provider.
 * Prevents credential exfiltration to third-party model inference logs.
 */
export function redactSecretsForPrompt(rawText: string): {
  text: string;
  redactedCount: number;
} {
  let text = rawText;
  let redactedCount = 0;

  for (const rule of SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    const matches = text.match(rule.pattern);
    if (matches && matches.length > 0) {
      redactedCount += matches.length;
      text = text.replace(rule.pattern, rule.redactReplacement);
    }
  }

  return { text, redactedCount };
}
