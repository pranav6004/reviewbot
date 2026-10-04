<div align="center">

  <svg width="64" height="64" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fill="#10b981" fill-rule="evenodd" d="M 128 24 L 218 76 L 218 180 L 128 232 L 38 180 L 38 76 Z M 128 68 L 180 128 L 160 148 L 128 112 L 96 148 L 76 128 Z M 128 144 L 148 164 L 128 184 L 108 164 Z"/>
  </svg>

  # ReviewBot

  **Self-hosted, model-agnostic AI code reviews for GitHub Pull Requests.**

  [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
  [![Tests](https://img.shields.io/badge/tests-24%2F24%20passing-10b981.svg)](packages/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.8%20strict-3178c6.svg)](tsconfig.base.json)
  [![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933.svg)](package.json)

</div>

---

**ReviewBot** is an open-source GitHub App that automatically reviews pull requests with your own LLM keys. It flags real bugs, catches committed secrets, and posts actionable suggestions directly on lines of code — with zero per-seat fees.

## ⚡ Highlights

- **Bring Your Own Key (BYOK):** Works with any OpenAI-compatible API (OpenAI, Gemini, DeepSeek, Groq) or local models via Ollama.
- **Line-Anchored Precision:** Verifies every comment against diff hunks to eliminate hallucinations and phantom line comments.
- **Built-in Secret Scanner:** Pre-LLM scan catches committed AWS keys, GitHub PATs, JWTs, and private keys on added lines.
- **One-Click Suggestions:** Generates native GitHub ` ```suggestion ` blocks developers can commit directly in PRs.
- **Local Control Center:** Dark-mode web dashboard (`http://localhost:3000/`) with live telemetry, review feed, diff playground, and config validator.
- **Lightweight:** Single-file embedded SQLite (`node:sqlite`). Zero external Redis or Postgres dependencies.

---

## 🚀 Quick Start

### 1. Create GitHub App

1. Go to **Settings** → **Developer Settings** → **GitHub Apps** → **New GitHub App**.
2. Set Webhook URL to `https://<your-host>/api/webhooks/github` (use [smee.io](https://smee.io) for local dev).
3. Set Webhook Secret (e.g. `openssl rand -hex 20`).
4. Permissions:
   - **Pull requests**: Read & Write
   - **Contents**: Read-only
   - **Issues**: Read & Write
5. Subscribe to `Pull request` events.
6. Generate and download a **Private Key** (`.pem`), note the **App ID**, and install the app on your repositories.

### 2. Configure Environment

```bash
cp .env.example .env
```

```ini
PORT=3000
HOST=0.0.0.0

# GitHub App Credentials
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# LLM Provider
REVIEWBOT_LLM_BASE_URL=https://api.openai.com/v1
REVIEWBOT_LLM_API_KEY=sk-proj-...
REVIEWBOT_LLM_MODEL=gpt-4o-mini
```

### 3. Start Server

**With Docker:**
```bash
docker compose up -d
```

**With Node.js:**
```bash
npm install
npm run build
npm run start --workspace=@reviewbot/server
```

*(On Windows, run `run.bat` for one-click port clearing and local Smee forwarding.)*

Open `http://localhost:3000/` to access the Control Center.

---

## ⚙️ Configuration (`.reviewbot.yaml`)

Add `.reviewbot.yaml` to your repository root:

```yaml
version: 1

review:
  enabled: true
  profile: balanced          # quiet | balanced | assertive
  min_severity: warning      # critical | warning | suggestion | nitpick
  max_findings: 20
  path_filters:
    - "!dist/**"
    - "!**/*.lock"
    - "!**/generated/**"
  instructions: |
    Focus on code correctness, security flaws, and logic bugs.

path_instructions:
  - path: "apps/server/**"
    instructions:
      - "Verify authentication and authorization checks on all routes."
```

---

## 📄 License

Apache-2.0 — see [LICENSE](LICENSE) for details.
