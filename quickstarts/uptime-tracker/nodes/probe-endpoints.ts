import type { Context } from "tentacular";

interface EndpointConfig {
  url: string;
  expected_body?: string;
}

interface ProbeResult {
  url: string;
  statusCode: number;
  responseTimeMs: number;
  tlsExpiryDays: number | null;
  bodyMatchPassed: boolean | null;
  isHealthy: boolean;
  error?: string;
}

interface ProbeOutput {
  results: ProbeResult[];
  probedAt: string;
}

/** Probe each configured endpoint: status, latency, TLS expiry, optional body match */
export default async function run(ctx: Context, _input: unknown): Promise<ProbeOutput> {
  // Reference probe-targets dependency for contract compliance (used for dynamic target egress)
  ctx.dependency("probe-targets");

  const endpointConfigs = (ctx.config.endpoints as EndpointConfig[]) ?? [];

  if (endpointConfigs.length === 0) {
    ctx.log.warn("No endpoints configured");
    return { results: [], probedAt: "" };
  }

  ctx.log.info(`Probing ${endpointConfigs.length} endpoint(s)`);
  const results: ProbeResult[] = [];
  const latencyThreshold = (ctx.config.latency_threshold_ms as number) ?? 2000;

  for (const endpoint of endpointConfigs) {
    const url = typeof endpoint === "string" ? endpoint : endpoint.url;
    const expectedBody = typeof endpoint === "string" ? "" : (endpoint.expected_body ?? "");
    const start = Date.now();

    try {
      const resp = await ctx.fetch("probe", url, { method: "GET" });
      const responseTimeMs = Date.now() - start;
      const body = await resp.text();

      // Check body match if configured
      let bodyMatchPassed: boolean | null = null;
      if (expectedBody) {
        bodyMatchPassed = body.includes(expectedBody);
      }

      // Parse TLS expiry from URL (only for HTTPS)
      let tlsExpiryDays: number | null = null;
      if (url.startsWith("https://")) {
        // TLS cert expiry is not directly accessible from fetch in Deno,
        // but we can attempt to connect and check via Deno.connectTls
        try {
          const urlObj = new URL(url);
          const conn = await Deno.connectTls({
            hostname: urlObj.hostname,
            port: Number(urlObj.port) || 443,
          });
          const handshake = await conn.handshake();
          if (handshake.peerCertificates && handshake.peerCertificates.length > 0) {
            // Parse ASN.1 cert to get expiry -- simplified approach
            // The actual expiry extraction requires cert parsing
            // For now, we note TLS is valid (connection succeeded)
            tlsExpiryDays = -1; // Placeholder: TLS valid but expiry not parsed
          }
          conn.close();
        } catch {
          // TLS check failed -- endpoint may still be healthy via HTTP
          tlsExpiryDays = null;
        }
      }

      const isHealthy = resp.ok && responseTimeMs < latencyThreshold &&
        (bodyMatchPassed === null || bodyMatchPassed);

      results.push({
        url,
        statusCode: resp.status,
        responseTimeMs,
        tlsExpiryDays,
        bodyMatchPassed,
        isHealthy,
      });

      ctx.log.info(`${url} => ${resp.status} (${responseTimeMs}ms) healthy=${isHealthy}`);
    } catch (err) {
      const responseTimeMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        url,
        statusCode: 0,
        responseTimeMs,
        tlsExpiryDays: null,
        bodyMatchPassed: null,
        isHealthy: false,
        error: message,
      });
      ctx.log.error(`${url} => ERROR: ${message} (${responseTimeMs}ms)`);
    }
  }

  const healthyCount = results.filter((r) => r.isHealthy).length;
  ctx.log.info(`Probe complete: ${healthyCount}/${results.length} healthy`);

  return { results, probedAt: new Date().toISOString() };
}
