import type { Octokit } from "@octokit/rest";
import type { ReviewOutput } from "@reviewbot/review-core";
import { formatReviewSummary, formatInlineComment } from "./formatter.js";

export interface PRMetadata {
  number: number;
  title: string;
  body?: string;
  baseSha: string;
  headSha: string;
  isDraft: boolean;
}

export class GitHubService {
  constructor(private readonly octokit: Octokit) {}

  /**
   * Fetch pull request metadata.
   */
  async fetchPullRequest(owner: string, repo: string, pullNumber: number): Promise<PRMetadata> {
    const { data: pr } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    return {
      number: pr.number,
      title: pr.title,
      body: pr.body || undefined,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      isDraft: Boolean(pr.draft),
    };
  }

  /**
   * Fetch raw unified diff for the pull request.
   */
  async fetchPullRequestDiff(owner: string, repo: string, pullNumber: number): Promise<string> {
    const response = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      headers: {
        accept: "application/vnd.github.v3.diff",
      },
    });

    return typeof response.data === "string" ? response.data : String(response.data);
  }

  /**
   * Fetch optional .reviewbot.yaml from repository at target commit SHA.
   */
  async fetchRepositoryConfig(owner: string, repo: string, ref: string): Promise<string | undefined> {
    const configCandidates = [".reviewbot.yaml", ".reviewbot.yml"];

    for (const path of configCandidates) {
      try {
        const { data } = await this.octokit.repos.getContent({
          owner,
          repo,
          path,
          ref,
        });

        if ("content" in data && data.content) {
          return Buffer.from(data.content, "base64").toString("utf8");
        }
      } catch (err: any) {
        if (err.status !== 404) {
          // Ignore 404, throw other errors
          console.warn(`Failed reading config file ${path}:`, err.message);
        }
      }
    }

    return undefined;
  }

  /**
   * Post comprehensive review (summary body + inline comments) to GitHub.
   */
  async postReview(
    owner: string,
    repo: string,
    pullNumber: number,
    headSha: string,
    output: ReviewOutput
  ) {
    const summaryMarkdown = formatReviewSummary(output);

    // Map findings to GitHub review comment objects
    const comments = output.findings.map((finding) => ({
      path: finding.file,
      line: finding.line,
      side: finding.side,
      body: formatInlineComment(finding),
    }));

    const hasCriticalIssues = output.findings.some((f) => f.severity === "critical");
    const event = hasCriticalIssues ? "COMMENT" : "COMMENT"; // default to COMMENT; could be REQUEST_CHANGES if configured

    // Submit as a single batch review
    const response = await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: headSha,
      body: summaryMarkdown,
      event,
      comments: comments.length > 0 ? comments : undefined,
    });

    return response.data;
  }
}
