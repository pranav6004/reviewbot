import crypto from "node:crypto";
import { ReviewEngine } from "@reviewbot/review-core";
import type { ReviewJob, ReviewResult } from "@reviewbot/review-core";
import type { LLMProvider } from "@reviewbot/llm";
import {
  createInstallationOctokit,
  GitHubService,
  type GitHubAppConfig,
} from "@reviewbot/github";
import { ReviewDatabase } from "@reviewbot/persistence";

export interface WorkerOptions {
  db: ReviewDatabase;
  llmProvider: LLMProvider;
  appConfig: GitHubAppConfig;
  maxConcurrency?: number;
  githubServiceOverride?: (installationId: number) => GitHubService;
}

export class ReviewWorker {
  private queue: ReviewJob[] = [];
  private activeCount = 0;
  private maxConcurrency: number;
  private db: ReviewDatabase;
  private llmProvider: LLMProvider;
  private appConfig: GitHubAppConfig;
  private githubServiceOverride?: (installationId: number) => GitHubService;

  constructor(options: WorkerOptions) {
    this.db = options.db;
    this.llmProvider = options.llmProvider;
    this.appConfig = options.appConfig;
    this.maxConcurrency = options.maxConcurrency || 2;
    this.githubServiceOverride = options.githubServiceOverride;
  }

  enqueue(job: ReviewJob): string {
    const jobId = crypto.randomUUID();
    this.db.recordJob(jobId, job);
    (job as any)._id = jobId;
    this.queue.push(job);
    process.nextTick(() => this.processNext());
    return jobId;
  }

  private async processNext(): Promise<void> {
    if (this.activeCount >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift()!;
    const jobId = (job as any)._id as string;
    this.activeCount++;
    this.db.updateJobStatus(jobId, "processing");

    try {
      await this.executeJob(jobId, job);
      this.db.updateJobStatus(jobId, "completed");
    } catch (err: any) {
      console.error(`[Worker] Review job ${jobId} failed:`, err);
      this.db.updateJobStatus(jobId, "failed", err.message);
    } finally {
      this.activeCount--;
      process.nextTick(() => this.processNext());
    }
  }

  private async executeJob(jobId: string, job: ReviewJob): Promise<ReviewResult> {
    const installationId = job.installationId ?? 0;
    const githubService = this.githubServiceOverride
      ? this.githubServiceOverride(installationId)
      : new GitHubService(createInstallationOctokit(this.appConfig, installationId));

    const { owner, name: repo } = job.repository;
    const pullNumber = job.pullRequest.number;

    // 1. Fetch raw diff
    const rawDiff = await githubService.fetchPullRequestDiff(owner, repo, pullNumber);

    // 2. Fetch repo config (.reviewbot.yaml)
    const configYaml = await githubService.fetchRepositoryConfig(
      owner,
      repo,
      job.pullRequest.headSha
    );

    // 3. Run review engine
    const engine = new ReviewEngine();
    const result = await engine.execute({
      job,
      rawDiff,
      configYaml,
      provider: this.llmProvider,
    });

    // 4. Suppress duplicate findings already posted in previous jobs
    const priorFingerprints = this.db.getPriorFindingFingerprints(owner, repo, pullNumber);
    const newFindings = result.output.findings.filter(
      (f) => !priorFingerprints.has(f.id)
    );

    const filteredOutput = {
      ...result.output,
      findings: newFindings,
    };

    // 5. Post review to GitHub
    await githubService.postReview(
      owner,
      repo,
      pullNumber,
      job.pullRequest.headSha,
      filteredOutput
    );

    // 6. Record findings in DB
    this.db.recordFindings(jobId, filteredOutput);

    return result;
  }
}
