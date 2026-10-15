import type { Octokit } from "@octokit/rest";
import type { ReviewOutput } from "@reviewbot/review-core";
import {
  formatReviewSummary,
  formatInlineComment,
  STICKY_SUMMARY_MARKER,
  SUMMARY_V1_MARKER,
} from "./formatter.js";

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
   * Upsert a persistent sticky comment containing review walkthrough and Mermaid diagram.
   * If a comment with the sticky marker already exists, it is edited in-place to avoid comment clutter.
   */
  async upsertStickyComment(
    owner: string,
    repo: string,
    pullNumber: number,
    body: string
  ): Promise<{ id: number; action: "created" | "updated" }> {
    const { data: comments } = await this.octokit.issues.listComments({
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 50,
    });

    const existing = comments.find(
      (c) =>
        c.body &&
        (c.body.includes(STICKY_SUMMARY_MARKER) || c.body.includes(SUMMARY_V1_MARKER))
    );

    if (existing) {
      const { data: updated } = await this.octokit.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body,
      });
      return { id: updated.id, action: "updated" };
    }

    const { data: created } = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });
    return { id: created.id, action: "created" };
  }

  /**
   * Post comprehensive review to GitHub:
   * 1. Upserts sticky walkthrough comment on the PR conversation timeline.
   * 2. Submits batch inline comments on specific lines via pulls.createReview (if findings exist).
   */
  async postReview(
    owner: string,
    repo: string,
    pullNumber: number,
    headSha: string,
    output: ReviewOutput
  ) {
    const summaryMarkdown = formatReviewSummary(output);

    // 1. Upsert sticky summary & walkthrough comment
    const stickyResult = await this.upsertStickyComment(
      owner,
      repo,
      pullNumber,
      summaryMarkdown
    );

    // 2. Submit inline findings if present
    let reviewResult: any = null;
    if (output.findings.length > 0) {
      const comments = output.findings.map((finding) => ({
        path: finding.file,
        line: finding.line,
        side: finding.side,
        body: formatInlineComment(finding),
      }));

      const response = await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: headSha,
        body: `⚡ **ReviewBot** completed review with ${output.findings.length} inline note(s).\nSee sticky comment above for full architectural walkthrough and flow.`,
        event: "COMMENT",
        comments,
      });
      reviewResult = response.data;
    }

    return {
      stickyComment: stickyResult,
      review: reviewResult,
    };
  }
}
