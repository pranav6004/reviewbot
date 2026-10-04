import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

const candidateEnvPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(process.cwd(), "../.env"),
];

for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}
import { buildServer } from "./server.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function start() {
  const server = await buildServer();
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`⚡ ReviewBot server listening on http://${HOST}:${PORT}`);
    console.log(`📡 GitHub webhook endpoint ready at http://${HOST}:${PORT}/api/webhooks/github`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
