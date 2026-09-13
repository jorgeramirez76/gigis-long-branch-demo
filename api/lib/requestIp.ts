/** Vercel supplies the trusted client IP. Never fall back to spoofable forwarded headers. */
export function clientIp(req: { headers: Record<string, unknown> }): string | undefined {
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real ? real : undefined;
}
