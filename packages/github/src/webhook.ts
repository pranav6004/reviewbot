import { verify } from "@octokit/webhooks-methods";

/**
 * Verify HMAC SHA-256 signature from GitHub webhook header X-Hub-Signature-256.
 */
export async function verifyWebhookSignature(
  secret: string,
  rawPayload: string | Buffer,
  signatureHeader?: string
): Promise<boolean> {
  if (!signatureHeader || !secret) {
    return false;
  }

  try {
    const payloadStr = Buffer.isBuffer(rawPayload)
      ? rawPayload.toString("utf8")
      : rawPayload;
    return await verify(secret, payloadStr, signatureHeader);
  } catch {
    return false;
  }
}
