import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import fastifyStatic from "@fastify/static";
import { verifyWebhookSignature, type GitHubAppConfig } from "@reviewbot/github";
import { ReviewDatabase } from "@reviewbot/persistence";
import { OpenAICompatibleProvider, type LLMProvider } from "@reviewbot/llm";
import { ReviewEngine, type ReviewJob } from "@reviewbot/review-core";
import { parseReviewBotConfig } from "@reviewbot/config";
import { ReviewWorker } from "./worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOptions {
  appConfig?: GitHubAppConfig;
  llmProvider?: LLMProvider;
  dbPath?: string;
  githubServiceOverride?: (installationId: number) => any;
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  await fastify.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });

  // Serve static UI dashboard if public directory exists
  const publicDir = path.resolve(__dirname, "../public");
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    decorateReply: false,
  });

  const appConfig: GitHubAppConfig = options.appConfig || {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  };

  const db = new ReviewDatabase(options.dbPath || process.env.DATABASE_PATH || "./data/reviewbot.sqlite");
  const llm = options.llmProvider || new OpenAICompatibleProvider();

  const worker = new ReviewWorker({
    db,
    llmProvider: llm,
    appConfig,
    githubServiceOverride: options.githubServiceOverride,
  });

  // Health check
  fastify.get("/health", async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "reviewbot",
      version: "0.1.0",
    };
  });

  // Dashboard API: System vitality & aggregate statistics
  fastify.get("/api/stats", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (process.env.ADMIN_API_KEY && authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
      reply.status(401);
      return { error: "Unauthorized access to telemetry" };
    }
    const stats = db.getStats();
    return {
      ...stats,
      uptimeSeconds: Math.round(process.uptime()),
      model: process.env.REVIEWBOT_LLM_MODEL || "gpt-4o-mini",
      providerUrl: process.env.REVIEWBOT_LLM_BASE_URL || "https://api.openai.com/v1",
      appId: process.env.GITHUB_APP_ID || "Not configured",
      webhookConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
    };
  });

  // Dashboard API: Recent review jobs feed
  fastify.get("/api/reviews", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (process.env.ADMIN_API_KEY && authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
      reply.status(401);
      return { error: "Unauthorized access to review history" };
    }
    return db.getRecentJobs(30);
  });

  // Dashboard API: Diff Review Playground
  fastify.post("/api/playground/review", async (request, reply) => {
    if (process.env.NODE_ENV === "production" && !process.env.ENABLE_PUBLIC_PLAYGROUND) {
      reply.status(403);
      return { error: "Diff playground is disabled in production environments" };
    }

    const body = request.body as any;
    if (!body || !body.diff || typeof body.diff !== "string") {
      reply.status(400);
      return { error: "Missing required 'diff' field in request body" };
    }

    if (body.diff.length > 250 * 1024) {
      reply.status(413);
      return { error: "Diff payload exceeds maximum allowed playground size (250 KB)" };
    }

    const testJob: ReviewJob = {
      provider: "github",
      repository: { owner: "playground", name: "scratchpad", id: 0 },
      pullRequest: {
        number: 0,
        baseSha: "playground-base",
        headSha: "playground-head",
        title: typeof body.title === "string" ? body.title.slice(0, 256) : "Playground Diff Review",
      },
      trigger: "manual",
      mode: "full",
    };

    const engine = new ReviewEngine();
    const result = await engine.execute({
      job: testJob,
      rawDiff: body.diff,
      configYaml: body.configYaml,
      provider: llm,
    });

    return result;
  });

  // Dashboard API: Config validation
  fastify.post("/api/config/validate", async (request, reply) => {
    const body = request.body as any;
    if (body?.yaml && typeof body.yaml === "string" && body.yaml.length > 50 * 1024) {
      reply.status(413);
      return { valid: false, error: "YAML configuration exceeds 50 KB size limit" };
    }

    try {
      const config = parseReviewBotConfig(body?.yaml || "");
      return { valid: true, config };
    } catch (err: any) {
      reply.status(400);
      return { valid: false, error: err.message };
    }
  });

  // GitHub webhook endpoint
  fastify.post(
    "/api/webhooks/github",
    {
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      const signature = request.headers["x-hub-signature-256"] as string | undefined;
      const deliveryId = request.headers["x-github-delivery"] as string | undefined;
      const eventName = request.headers["x-github-event"] as string | undefined;

      // 1. Verify HMAC Signature (fail closed if secret missing or signature invalid)
      const secret = appConfig.webhookSecret || process.env.GITHUB_WEBHOOK_SECRET;
      if (!secret) {
        reply.status(500);
        return { error: "GITHUB_WEBHOOK_SECRET is not configured on the server" };
      }

      const rawPayload = (request as any).rawBody || JSON.stringify(request.body);
      const isValid = await verifyWebhookSignature(secret, rawPayload, signature);
      if (!isValid) {
        reply.status(401);
        return { error: "Invalid webhook signature" };
      }

      // 2. Webhook delivery deduplication
      if (deliveryId && db.isDeliveryProcessed(deliveryId)) {
        return reply.status(200).send({
          status: "skipped",
          reason: "Duplicate delivery already processed",
          deliveryId,
        });
      }

      // Handle ping event
      if (eventName === "ping") {
        return reply.status(200).send({ status: "pong" });
      }

      // 3. Filter pull_request events
      if (eventName === "pull_request") {
        const payload = request.body as any;
        const action = payload.action;
        const supportedActions = ["opened", "reopened", "ready_for_review", "synchronize"];

        if (!supportedActions.includes(action)) {
          return reply.status(200).send({
            status: "ignored",
            reason: `Action '${action}' not supported for automatic review`,
          });
        }

        // Avoid infinite bot review loops
        if (payload.sender?.type === "Bot") {
          return reply.status(200).send({
            status: "ignored",
            reason: "Ignoring event triggered by bot user",
          });
        }

        const pr = payload.pull_request;
        if (pr.draft && action !== "ready_for_review") {
          return reply.status(200).send({
            status: "ignored",
            reason: "Draft PR ignored by default",
          });
        }

        const job: ReviewJob = {
          provider: "github",
          repository: {
            owner: payload.repository.owner.login,
            name: payload.repository.name,
            id: payload.repository.id,
          },
          pullRequest: {
            number: pr.number,
            baseSha: pr.base.sha,
            headSha: pr.head.sha,
            title: pr.title,
            body: pr.body || undefined,
          },
          trigger: action,
          installationId: payload.installation?.id,
          deliveryId,
          mode: action === "synchronize" ? "incremental" : "full",
        };

        const jobId = worker.enqueue(job);

        return reply.status(202).send({
          status: "enqueued",
          jobId,
          pr: `#${pr.number}`,
          repo: payload.repository.full_name,
        });
      }

      return reply.status(200).send({
        status: "ignored",
        reason: `Event '${eventName}' not processed by review engine`,
      });
    }
  );

  return fastify;
}
