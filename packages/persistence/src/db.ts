import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { ReviewJob, ReviewOutput } from "@reviewbot/review-core";

export interface StoredJob {
  id: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  trigger: string;
  baseSha: string;
  headSha: string;
  deliveryId?: string;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export class ReviewDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string = ":memory:") {
    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS review_jobs (
        id TEXT PRIMARY KEY,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        trigger TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        delivery_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_delivery ON review_jobs(delivery_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_repo_pr ON review_jobs(repo_owner, repo_name, pr_number);

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        side TEXT NOT NULL,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (job_id) REFERENCES review_jobs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);
    `);
  }

  /**
   * Check if a GitHub webhook delivery ID was already recorded.
   */
  isDeliveryProcessed(deliveryId: string): boolean {
    if (!deliveryId) return false;
    const stmt = this.db.prepare("SELECT 1 FROM review_jobs WHERE delivery_id = ? LIMIT 1");
    const row = stmt.get(deliveryId);
    return Boolean(row);
  }

  /**
   * Record a new review job.
   */
  recordJob(id: string, job: ReviewJob): void {
    const stmt = this.db.prepare(`
      INSERT INTO review_jobs (
        id, repo_owner, repo_name, pr_number, trigger, base_sha, head_sha, delivery_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    stmt.run(
      id,
      job.repository.owner,
      job.repository.name,
      job.pullRequest.number,
      job.trigger,
      job.pullRequest.baseSha,
      job.pullRequest.headSha,
      job.deliveryId ?? null,
      Date.now()
    );
  }

  /**
   * Update status of a job.
   */
  updateJobStatus(
    id: string,
    status: "processing" | "completed" | "failed",
    error?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE review_jobs
      SET status = ?, error = ?, completed_at = ?
      WHERE id = ?
    `);

    stmt.run(status, error ?? null, status === "processing" ? null : Date.now(), id);
  }

  /**
   * Record findings associated with a completed job.
   */
  recordFindings(jobId: string, output: ReviewOutput): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO findings (
        id, job_id, fingerprint, file, line, side, severity, category, title, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    for (const f of output.findings) {
      stmt.run(
        `${jobId}-${f.id}`,
        jobId,
        f.id,
        f.file,
        f.line,
        f.side,
        f.severity,
        f.category,
        f.title,
        now
      );
    }
  }

  /**
   * Retrieve prior finding fingerprints for a repository and pull request.
   */
  getPriorFindingFingerprints(owner: string, repo: string, prNumber: number): Set<string> {
    const stmt = this.db.prepare(`
      SELECT f.fingerprint
      FROM findings f
      JOIN review_jobs j ON f.job_id = j.id
      WHERE j.repo_owner = ? AND j.repo_name = ? AND j.pr_number = ?
    `);

    const rows = stmt.all(owner, repo, prNumber) as Array<{ fingerprint: string }>;
    return new Set(rows.map((r) => r.fingerprint));
  }

  /**
   * Retrieve aggregate statistics for the dashboard.
   */
  getStats() {
    const jobStats = this.db
      .prepare(`
        SELECT 
          COUNT(*) as totalJobs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedJobs,
          AVG(CASE WHEN completed_at IS NOT NULL THEN (completed_at - created_at) ELSE NULL END) as avgDurationMs
        FROM review_jobs
      `)
      .get() as any;

    const findingStats = this.db
      .prepare(`
        SELECT 
          SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as criticalCount,
          SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warningCount,
          SUM(CASE WHEN severity = 'suggestion' THEN 1 ELSE 0 END) as suggestionCount
        FROM findings
      `)
      .get() as any;

    return {
      totalJobs: Number(jobStats?.totalJobs || 0),
      completedJobs: Number(jobStats?.completedJobs || 0),
      failedJobs: Number(jobStats?.failedJobs || 0),
      avgDurationMs: Math.round(Number(jobStats?.avgDurationMs || 0)),
      criticalCount: Number(findingStats?.criticalCount || 0),
      warningCount: Number(findingStats?.warningCount || 0),
      suggestionCount: Number(findingStats?.suggestionCount || 0),
    };
  }

  /**
   * Retrieve recent jobs with their findings for the dashboard feed.
   */
  getRecentJobs(limit: number = 20) {
    const jobs = this.db
      .prepare(`
        SELECT * FROM review_jobs
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(limit) as any[];

    return jobs.map((job) => {
      const findings = this.db
        .prepare(`
          SELECT id, fingerprint, file, line, side, severity, category, title, created_at
          FROM findings
          WHERE job_id = ?
          ORDER BY line ASC
        `)
        .all(job.id);

      return {
        ...job,
        findings,
      };
    });
  }

  close() {
    this.db.close();
  }
}
