/**
 * Sample service for testing automated PR code review.
 */

export function calculateDiscount(price: number, discountPercent: number): number {
  // Potential bug: missing guard for negative discount or discount > 100
  return price - (price * discountPercent) / 100;
}

export function parseUserToken(token: string): { user: string; role: string } {
  // Security flaw: parses JWT payload without signature verification
  const parts = token.split(".");
  const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
  return { user: payload.sub, role: payload.role };
}
