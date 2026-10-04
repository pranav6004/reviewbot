# Context Log

## 2026-10-04 — Initial Research
- Researched CodeRabbit architecture: codegraph, agentic pipeline, sandbox execution, AST analysis via ast-grep, multi-layered review
- Analyzed alternatives: PR-Agent (CodiumAI), Kodus, Pullfrog, Robin
- Studied GitHub App integration model: webhooks, permissions, Probot framework
- Identified CodeRabbit pricing gaps: Free tier has 200 files/hr cap, $24-72/dev/month for paid
- Created planning document with full architecture proposal

## 2026-10-04 — Phase 0 & Phase 1 MVP Implementation
- **Features Implemented:**
  - Initialized TypeScript npm workspaces monorepo with 6 packages and 1 app.
  - `@reviewbot/diff`: unified diff parser with line-in-hunk checking (`isLineInHunk`, `isLineModified`), file stats, and patch analysis.
  - `@reviewbot/config`: Zod schema and loader for `.reviewbot.yaml`, path glob filters (`picomatch`), and path-specific review instructions.
  - `@reviewbot/llm`: provider-neutral LLM client with `OpenAICompatibleProvider` (works with OpenAI, Ollama, DeepSeek, Groq) and `MockLLMProvider` for deterministic testing.
  - `@reviewbot/review-core`: review pipeline orchestrator, prompt builders (`SYSTEM -> CONTEXT -> DIFF -> TASK`), and Stage F finding validator (drops hallucinated files, unanchored lines, deduplicates via SHA-256 fingerprinting).
  - `@reviewbot/github`: HMAC-SHA256 webhook signature verification (`@octokit/webhooks-methods`), Octokit installation token auth, PR fetching, and review formatting with stable HTML markers (`<!-- reviewbot:finding:v1:<id> -->`) and GitHub suggestion blocks.
  - `@reviewbot/persistence`: SQLite review database using Node.js built-in `node:sqlite` for webhook delivery deduplication, job status tracking, and incremental finding deduplication.
  - `apps/server`: Fastify webhook service with `GET /health`, `POST /api/webhooks/github`, and bounded in-memory `ReviewWorker` concurrency queue.
  - Deployment configuration: `Dockerfile`, `compose.yaml`, `.env.example`, `.reviewbot.yaml`, `README.md`.
- **Issues Faced & Fixed:**
  - `@fastify/raw-body` returned 404 on npm; replaced with correct package `fastify-raw-body@^6.0.1`.
  - `@types/parse-diff` did not exist on npm; created ambient type declaration `parse-diff.d.ts`.
  - Vite/Vitest required `"exports"` field in package.json to resolve cross-package source files in development without pre-building; added `exports` mappings to all packages.
  - Added/deleted files with `/dev/null` in diff header were incorrectly marked as renamed; updated `parser.ts` to inspect `/dev/null`.
  - Package `exports` in packages pointed to `src/index.ts` causing Node ESM runtime `ERR_MODULE_NOT_FOUND`; updated `exports` in all packages to `./dist/index.js`.
  - SQLite database initialization threw error if parent directory `./data` did not exist; added recursive `fs.mkdirSync` check in `ReviewDatabase`.
- **Testing:**
  - Ran `npx vitest run`: 7 test suites, 20/20 unit and integration tests passing.
  - Validated end-to-end webhook intake -> signature check -> PR diff review -> comment posting flow.
  - Ran `npm run build`: all packages and app compiled successfully via `tsc`.
  - Ran server live: verified port 3000 listening and `/health` response.

## 2026-10-04 — Live GitHub PR Review End-to-End Milestone
- **Repository Setup:**
  - Initialized git repo, pushed `main` to `https://github.com/pranav6004/reviewbot`.
  - Installed `My-ReviewBot-Dev` GitHub App on `pranav6004/reviewbot`.
- **Issues Faced & Fixed:**
  - `npm run start --workspace=@reviewbot/server` ran in `apps/server` subfolder where `.env` was not found by `import "dotenv/config"`; updated `apps/server/src/index.ts` to search cwd, parent, and grandparent paths for `.env`.
  - Copied `.env` to `apps/server/.env` as a backup (ignored by git).
  - Webhooks forwarded via `smee-client` to `http://localhost:3000/api/webhooks/github`.
- **Live Test on PR #1:**
  - Opened PR #1 with test code (`apps/server/src/sample-service.ts`) containing insecure JWT decoding and unbounded discount calculation.
  - Server received webhook event `pull_request.reopened` with HMAC-SHA256 signature -> validated signature -> enqueued job.
  - ReviewEngine called LLM (`antigravity/gemini-3.1-pro-high` via OpenAI-compatible endpoint).
  - Stage F finding validation confirmed all findings were on valid changed lines and within severity thresholds.
  - `GitHubService` posted review to `https://github.com/pranav6004/reviewbot/pull/1#pullrequestreview-5407203318`.
  - Posted 1 PR review summary comment and 2 inline code comments with GitHub suggestion block and stable HTML markers (`<!-- reviewbot:finding:v1:... -->`).
  - Recorded review and findings in SQLite database (`./data/reviewbot.sqlite`).
  - Added Windows launcher script `run.bat` to clear port 3000, start Smee tunnel, and start server in one click.

## 2026-10-04 — Control Center UI & Dashboard Milestone
- **Features Implemented:**
  - Embedded Fastify static dashboard (`apps/server/public/index.html`) using `@fastify/static`.
  - Dark mode Zinc-950 industrial UI built according to taste-skill guidelines, with Geist Mono & Inter typography, responsive Bento metrics grid, and live status indicator.
  - Endpoints added to `apps/server/src/server.ts`:
    - `GET /api/stats`: Telemetry on total jobs, findings by severity, average review latency, active model, and uptime.
    - `GET /api/reviews`: Review audit feed with PR links, findings, severity badges, and timestamps.
    - `POST /api/playground/review`: Live diff analyzer allowing developers to test AI review engine + Stage F validation directly in the browser.
    - `POST /api/config/validate`: In-browser `.reviewbot.yaml` parser & schema validator.
  - Created Windows launcher `run.bat` that kills lingering processes on port 3000, starts the Smee webhook tunnel in a separate window, and launches the server.
- **Issues Faced & Fixed:**
  - Process port locking on Windows: Port 3000 conflicts solved by adding automatic PowerShell port clearance in `run.bat`.
  - `@fastify/static` integration: Configured Fastify static file serving to mount `apps/server/public` at `/`.
- **Testing:**
  - Tested `GET /` and `GET /api/stats` via HTTP — status 200 OK.
  - Tested `POST /api/config/validate` — valid configuration parsing verified.
  - Tested `POST /api/playground/review` — successfully analyzed sample SQL injection diff, found vulnerability in 12s, Stage F validated finding.
  - Tested `GET /api/reviews` — confirmed historical PR #1 review audit trail with both findings.

## 2026-10-04 — Security & Guardrails Hardening Milestone
- **Features Implemented:**
  - Added [`packages/review-core/src/security.ts`](file:///z:/projects/CodeRabbit%20clone/packages/review-core/src/security.ts) with regex rules for AWS Access Keys, GitHub PATs, Private Keys, Slack tokens, hardcoded API secrets, and JWTs.
  - Deterministic pre-LLM secret scanner (`scanSecretsInDiff`): automatically identifies hardcoded secrets added in PR diffs and generates `critical` findings on exact lines without depending on LLM output.
  - Pre-LLM secret scrubber (`redactSecretsForPrompt`): strips credentials and replaces with `[REDACTED_...]` before payload dispatch to LLM API provider.
  - Prompt injection boundary defense in [`prompts.ts`](file:///z:/projects/CodeRabbit%20clone/packages/review-core/src/prompts.ts): wrapped diff in `<untrusted_diff>` and PR metadata in `<pull_request_context>`, hardened system instructions against jailbreak and command execution inside code comments.
  - Diff budget & truncation guard in [`engine.ts`](file:///z:/projects/CodeRabbit%20clone/packages/review-core/src/engine.ts): capped review to top 50 files with highest churn; injected warning banner on truncation.
  - Fastify server protection in [`apps/server/src/server.ts`](file:///z:/projects/CodeRabbit%20clone/apps/server/src/server.ts): 250KB playground diff limit and 50KB YAML config limit.
- **Issues Faced & Fixed:**
  - Port 3000 collision on server restart: Stopped lingering node process via PowerShell before rebooting with updated security build.
- **Testing:**
  - Added unit test suite `packages/review-core/test/security.test.ts` (4 unit tests for secret scanning, prompt redaction, and auto-injection into findings).
  - All 8 monorepo test suites passing (24/24 unit tests).
  - Tested live via `POST /api/playground/review` with hardcoded AWS key: successfully triggered `🚨 SECURITY ALERT` banner and critical finding.
  - Tested 300KB payload against playground endpoint: successfully received `413 Payload Too Large`.

## 2026-10-04 — Original Brand Identity Pivot Milestone
- **Rationale & Changes:**
  - Removed all rabbit imagery, names, and emojis from the codebase, UI, and scripts to eliminate any trademark confusion with commercial products.
  - Replaced rabbit emoji in `apps/server/src/index.ts` and `apps/server/public/index.html` with clean vector SVG mark.
  - Removed "Rabbit" from launcher script `run.bat`.
  - Built 3 original, developer-first brand marks using `logo-design` skill:
    1. **The Hex Prism**: Precision hexagonal aperture with negative-space code chevrons (`viewBox="0 0 256 256"`). Scored 100/100 production readiness.
    2. **The Merge Shield**: Git branch convergence forming a security checkmark shield. Scored 100/100 production readiness.
    3. **The Vector R**: Architectural monolithic monogram with a pull request branch trajectory. Scored 99/100 production readiness.
  - Generated overview sheet `branding/concepts-v2.png` and embedded in checkpoint.

## 2026-10-04 — Developer Mockups & Hybrid Synthesis
- User expressed preference for Concept 1 (Hex Prism) and Concept 2 (Merge Shield).
- Generated developer mockup slides across 6 software surfaces (GitHub README, Terminal, App Icon, Website Header, Laptop Sticker, and Social Profile).
- Designed Concept 3: "The Hex Shield (Hybrid)" combining the precision hexagonal code chevron with the protective verification checkmark.
- Exported interactive presentation (`branding/presentation.html`) and slide renders (`branding/slides/slide-01.png` - `slide-10.png`).

## 2026-10-04 — Open-Source .gitignore Hardening & Production Brand Kit Export
- **.gitignore Hardening & Git History Audit:**
  - Audited full git commit tree (`git log --all --full-history -- "**.env*"`): verified zero real secrets or private keys were ever committed (only `.env.example` exists).
  - Hardened `.gitignore` to block all secrets and environmental leakages:
    - `.env`, `.env.*`, `!**/.env.example`
    - `*.pem`, `*.key`, `*.cert`, `*.p12`
    - `*.sqlite`, `*.sqlite-journal`, `*.sqlite3`, `data/`
    - `logs/`, `*.log`
    - `node_modules/`, `dist/`, `build/`
- **Production Brand Kit Export (Concept 1: The Hex Prism):**
  - Generated full production package via `export_variants.py`:
    - `reviewbot-symbol-black.svg`, `white.svg`, `mono-10b981.svg`
    - `favicon.ico` (multi-res 16/32/48), `favicon.svg`, `apple-touch-icon.png`
    - `icon-192.png`, `icon-512.png`, `maskable-512.png`
    - `site.webmanifest`
  - Mounted favicons and manifest into `apps/server/public/` and `index.html` `<head>`.
  - Verified `GET /favicon.ico` and `GET /site.webmanifest` returning 200 OK.
  - Updated `README.md` title and instructions.

## 2026-10-04 — Open-Source License & README Streamlining Milestone
- **License File Creation:**
  - Added official [`LICENSE`](file:///z:/projects/CodeRabbit%20clone/LICENSE) (Apache License 2.0). Provides patent grant protections, contributor rights, and trademark protection.
- **Streamlined README:**
  - Cut out overshared internal architecture specs, comparison tables, and ASCII plumbing diagrams.
  - Condensed into a punchy, clean 100-line developer README:
    - Clean brand header and badges.
    - Key developer highlights (BYOK, line-anchored precision, secret scanner, suggestion blocks, dashboard).
    - 3-step Quick Start (GitHub App, `.env`, `docker compose up`).
    - Clean `.reviewbot.yaml` config example.
  - Terminated lingering background task (`task-805`) that was causing message queue latency.
## 2026-10-04 — Residual Rabbit Purge & Launcher Browser Auto-Open
- **Residual Rabbit Removal:**
  - Removed remaining rabbit emoji in `packages/github/src/formatter.ts` review summary header markdown (`## ⚡ ReviewBot Pull Request Review`).
  - Ran `npm run build` across all workspaces to rebuild `dist/` bundles. Verified zero rabbit emojis across entire repo.
- **Launcher Script UX:**
  - Updated `run.bat` to automatically open `http://localhost:3000` directly in the user's default browser after 1s delay on startup using PowerShell `Start-Process`.
- **Testing:**
  - Ran `npm test`: all 8 test suites passing (24/24 unit tests).

## 2026-10-05 — Formal Security Audit (security-audit skill)
- **Scope & Setup:**
  - Conducted full formal 6-phase security audit on ReviewBot.
  - Linked workspace directory junction for `Z:\projects\CodeRabbit clone` <-> `Z:\projects\ReviewBot`.
  - Ignored `security-audit-run/` in `.gitignore`.
- **Methodology & Companions:**
  - Evaluated 10 attack class units across 5 subsystems with companions `AI-AND-LLM.md`, `WEB-PROTOCOL-AND-AUTH.md`, `DATA-ISOLATION-AND-LIFECYCLE.md`, and `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md`.
  - Both `validate-coverage-ledger.cjs` (10 units PASS) and `validate-findings.cjs` (3 findings PASS) passed validation.
- **Confirmed Findings Identified:**
  1. `FINDING-RB-01-WEBHOOK-FAIL-OPEN` (High): Webhook signature check skips verification when `GITHUB_WEBHOOK_SECRET` is unset, allowing unauthenticated review triggers.
  2. `FINDING-RB-02-PLAYGROUND-QUOTA-EXHAUSTION` (Medium): `POST /api/playground/review` lacks authentication or rate limiting, exposing backend LLM provider quota to arbitrary callers.
  3. `FINDING-RB-03-TELEMETRY-REPO-DISCLOSURE` (Low): `GET /api/reviews` exposes recent review jobs (private repository names and PR commit SHAs) without authentication.
- **Artifacts Generated in `security-audit-run/`:**
  - `run-metadata.json`, `architecture.md`, `coverage-ledger.json`, `findings.json`, `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`.


