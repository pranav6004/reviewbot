import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

export interface GitHubAppConfig {
  appId?: string;
  privateKey?: string;
  webhookSecret?: string;
}

export function createInstallationOctokit(
  appConfig: GitHubAppConfig,
  installationId: number
): Octokit {
  if (!appConfig.appId || !appConfig.privateKey) {
    throw new Error("Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY");
  }

  // Normalize private key formatting if passed as single-line env var
  const formattedKey = appConfig.privateKey.includes("\\n")
    ? appConfig.privateKey.replace(/\\n/g, "\n")
    : appConfig.privateKey;

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: appConfig.appId,
      privateKey: formattedKey,
      installationId,
    },
  });
}

export function createTokenOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}
