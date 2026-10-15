import type { ReviewFinding, ReviewOutput } from "@reviewbot/review-core";

export const STICKY_SUMMARY_MARKER = "<!-- reviewbot:sticky:summary -->";
export const SUMMARY_V1_MARKER = "<!-- reviewbot:summary:v1 -->";

const SEVERITY_ICONS: Record<ReviewFinding["severity"], string> = {
  critical: "🚨",
  warning: "⚠️",
  suggestion: "💡",
  nitpick: "🔍",
};

function cleanMermaidDiagram(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```mermaid")) {
    cleaned = cleaned.replace(/^```mermaid\s*/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "");
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.replace(/```$/, "");
  }
  return cleaned.trim();
}

/**
 * Format the top-level review summary comment with sticky marker,
 * Mermaid sequence/flow diagrams, and collapsible file walkthrough.
 */
export function formatReviewSummary(output: ReviewOutput): string {
  let md = `${STICKY_SUMMARY_MARKER}\n${SUMMARY_V1_MARKER}\n## ⬡ ReviewBot Summary\n\n`;

  md += `${output.summary.trim()}\n\n`;

  if (output.diagram && output.diagram.trim().length > 0) {
    const cleaned = cleanMermaidDiagram(output.diagram);
    if (cleaned.length > 0) {
      md += `### 🔄 Sequence & Architecture Diagram\n\n`;
      md += "```mermaid\n" + cleaned + "\n```\n\n";
    }
  }

  if (output.walkthrough.length > 0) {
    md += `<details>\n<summary><b>📋 File Walkthrough (${output.walkthrough.length} files)</b></summary>\n\n`;
    md += `| File | Changes |\n`;
    md += `|---|---|\n`;
    for (const item of output.walkthrough) {
      md += `| \`${item.file}\` | ${item.summary} |\n`;
    }
    md += `\n</details>\n\n`;
  }

  const criticalCount = output.findings.filter((f) => f.severity === "critical").length;
  const warningCount = output.findings.filter((f) => f.severity === "warning").length;
  const suggestionCount = output.findings.filter((f) => f.severity === "suggestion").length;

  md += `### 📊 Review Status\n`;
  md += `- 🚨 **Critical:** ${criticalCount}\n`;
  md += `- ⚠️ **Warnings:** ${warningCount}\n`;
  md += `- 💡 **Suggestions:** ${suggestionCount}\n`;

  if (output.findings.length === 0) {
    md += `\n> ✅ **No actionable issues found.** Looks good to merge!\n`;
  }

  md += `\n---\n`;
  md += `<sub>💡 **ReviewBot Tip**: Reply to any inline comment to ask questions or discuss fixes. Mention <code>@reviewbot help</code> for commands.</sub>\n`;

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
