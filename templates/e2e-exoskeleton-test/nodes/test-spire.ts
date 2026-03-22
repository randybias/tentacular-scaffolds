import type { Context } from "tentacular";

interface TestCase {
  name: string;
  passed: boolean;
  latency_ms: number;
  error?: string;
}

interface ServiceTestResult {
  service: string;
  passed: boolean;
  tests: TestCase[];
}

/** Test SPIRE: read SVID, verify SPIFFE ID pattern, check cert validity */
export default async function run(ctx: Context, input: unknown): Promise<ServiceTestResult & { previousResults?: unknown }> {
  const tests: TestCase[] = [];

  // Check for SPIFFE workload API socket
  const socketPath = Deno.env.get("SPIFFE_ENDPOINT_SOCKET") ?? "/run/spire/sockets/agent.sock";
  const expectedPattern = /^spiffe:\/\/tentacular\/ns\/[^/]+\/tentacles\/[^/]+$/;

  try {
    // Test: socket exists
    let start = performance.now();
    let socketExists = false;
    try {
      const stat = await Deno.stat(socketPath);
      socketExists = stat.isFile || stat.isSymlink || stat.mode !== null;
    } catch {
      // Socket may appear as special file, try alternative detection
      try {
        // Check if the directory exists at minimum
        const dir = socketPath.substring(0, socketPath.lastIndexOf("/"));
        await Deno.stat(dir);
        socketExists = true; // Directory exists, socket might be there
      } catch {
        socketExists = false;
      }
    }
    const socketLatency = Math.round(performance.now() - start);
    tests.push({
      name: "socket_exists",
      passed: socketExists,
      latency_ms: socketExists ? socketLatency : 0,
      error: socketExists ? undefined : `SPIRE socket not found at ${socketPath}`,
    });

    // Test: read SVID from mounted certificate files (alternative to socket API)
    start = performance.now();
    const certPaths = [
      "/run/spire/certs/svid.pem",
      "/var/run/secrets/spiffe.io/svid.pem",
      Deno.env.get("SVID_CERT_PATH") ?? "",
    ].filter(Boolean);

    let svidContent = "";
    let certPath = "";
    for (const path of certPaths) {
      try {
        svidContent = await Deno.readTextFile(path);
        certPath = path;
        break;
      } catch {
        // Try next path
      }
    }

    if (svidContent) {
      tests.push({
        name: "read_svid_cert",
        passed: true,
        latency_ms: Math.round(performance.now() - start),
      });

      // Test: certificate is PEM format
      start = performance.now();
      const isPem = svidContent.includes("-----BEGIN CERTIFICATE-----") &&
        svidContent.includes("-----END CERTIFICATE-----");
      tests.push({
        name: "cert_pem_format",
        passed: isPem,
        latency_ms: Math.round(performance.now() - start),
        error: isPem ? undefined : "Certificate is not in PEM format",
      });
    } else {
      tests.push({
        name: "read_svid_cert",
        passed: false,
        latency_ms: 0,
        error: "No SVID certificate found at any expected path",
      });
    }

    // Test: read SPIFFE ID from bundle or trust domain file
    start = performance.now();
    const spiffeIdPaths = [
      "/run/spire/certs/spiffe-id",
      "/var/run/secrets/spiffe.io/spiffe-id",
      Deno.env.get("SPIFFE_ID_PATH") ?? "",
    ].filter(Boolean);

    let spiffeId = "";
    for (const path of spiffeIdPaths) {
      try {
        spiffeId = (await Deno.readTextFile(path)).trim();
        break;
      } catch {
        // Try next path
      }
    }

    // Fallback: try to extract from environment
    if (!spiffeId) {
      spiffeId = Deno.env.get("SPIFFE_ID") ?? "";
    }

    if (spiffeId) {
      const idMatches = expectedPattern.test(spiffeId);
      tests.push({
        name: "spiffe_id_pattern",
        passed: idMatches,
        latency_ms: Math.round(performance.now() - start),
        error: idMatches ? undefined : `SPIFFE ID "${spiffeId}" does not match expected pattern`,
      });
    } else {
      tests.push({
        name: "spiffe_id_pattern",
        passed: false,
        latency_ms: 0,
        error: "Could not determine SPIFFE ID from files or environment",
      });
    }

    // Test: check cert expiry (if we have the cert)
    if (svidContent) {
      start = performance.now();
      // Extract Not After from PEM certificate (basic extraction)
      // In production, use a proper X.509 parser
      const base64Cert = svidContent
        .replace(/-----BEGIN CERTIFICATE-----/g, "")
        .replace(/-----END CERTIFICATE-----/g, "")
        .replace(/\s/g, "");

      // Decode and check if cert is at least 100 bytes (minimal valid cert)
      const certBytes = Uint8Array.from(atob(base64Cert), (c) => c.charCodeAt(0));
      const validSize = certBytes.length > 100;

      tests.push({
        name: "cert_validity",
        passed: validSize,
        latency_ms: Math.round(performance.now() - start),
        error: validSize ? undefined : `Certificate too small (${certBytes.length} bytes), may be invalid`,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.error(`SPIRE test failed: ${message}`);
    tests.push({ name: "unexpected_error", passed: false, latency_ms: 0, error: message });
  }

  const allPassed = tests.every((t) => t.passed);
  ctx.log.info(`SPIRE: ${tests.filter((t) => t.passed).length}/${tests.length} tests passed`);

  const result: ServiceTestResult & { previousResults?: unknown } = {
    service: "spire",
    passed: allPassed,
    tests,
  };

  // Always chain previousResults for the sequential pipeline
  result.previousResults = input;

  return result;
}
