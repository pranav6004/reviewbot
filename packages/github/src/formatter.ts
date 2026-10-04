import type { ReviewFinding, ReviewOutput } from "@reviewbot/review-core";

const SEVERITY_ICONS: Record<ReviewFinding["severity"], string> = {
  critical: "🚨",
  warning: "⚠️",
  suggestion: "💡",
  nitpick: "🔍",
};

/**
 * Format the top-level review summary comment.
 */
export function formatReviewSummary(output: ReviewOutput): string {
  const marker = "<!-- reviewbot:summary:v1 -->";
  let md = `${marker}\n## ⚡ ReviewBot Pull Request Review\n\n`;

  md += `${output.summary}\n\n`;

  if (output.walkthrough.length > 0) {
    md += `### 📋 Changes Walkthrough\n\n`;
    md += `| File | Summary |\n`;
    md += `|---|---|\n`;
    for (const item of output.walkthrough) {
      md += `| \`${item.file}\` | ${item.summary} |\n`;
    }
    md += `\n`;
  }

  const criticalCount = output.findings.filter((f) => f.severity === "critical").length;
  const warningCount = output.findings.filter((f) => f.severity === "warning").length;
  const suggestionCount = output.findings.filter((f) => f.severity === "suggestion").length;

  md += `### 📊 Review Status\n`;
  md += `- **Critical issues:** ${criticalCount}\n`;
  md += `- **Warnings:** ${warningCount}\n`;
  md += `- **Suggestions:** ${suggestionCount}\n`;

  if (output.findings.length === 0) {
    md += `\n> ✅ **No actionable issues found.** Looks good to merge!\n`;
  }

  return md;
}

/**
 * Format a single inline code comment with stable HTML marker and GitHub suggestion block.
 */
export function formatInlineComment(finding: ReviewFinding): string {
  const marker = `<!-- reviewbot:finding:v1:${finding.id} -->`;
  const icon = SEVERITY_ICONS[finding.severity] || "⚠️";

  let body = `${marker}\n`;
  body += `### ${icon} ${finding.title}\n\n`;
  body += `**Severity:** \`${finding.severity.toUpperCase()}\` | **Category:** \`${finding.category}\`\n\n`;
  body += `${finding.message}\n\n`;

  if (finding.evidence) {
    body += `> **Evidence:** ${finding.evidence}\n\n`;
  }

  if (finding.suggestion) {
    body += `\`\`\`suggestion\n${finding.suggestion}\n\`\`\`\n`;
  }

  return body;
}
