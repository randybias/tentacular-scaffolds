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

interface PreviousResults {
  service: string;
  passed: boolean;
  tests: TestCase[];
}

/** Compute SHA-256 hash of a Uint8Array */
async function sha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Test RustFS: PUT, GET (verify integrity), DELETE via raw S3 HTTP API */
export default async function run(ctx: Context, input: unknown): Promise<ServiceTestResult & { previousResults?: PreviousResults }> {
  const tests: TestCase[] = [];
  const testKey = `exo-test/${Date.now()}/test-blob.bin`;

  const rustfs = ctx.dependency("tentacular-rustfs");
  if (!rustfs.secret) {
    ctx.log.error("No RustFS credentials");
    return {
      service: "rustfs",
      passed: false,
      tests: [{ name: "connect", passed: false, latency_ms: 0, error: "No credentials" }],
    };
  }

  // Build base URL — use protocol from contract dependency (http or https)
  const scheme = rustfs.protocol === "http" ? "http" : "https";
  const baseUrl = `${scheme}://${rustfs.host}:${rustfs.port}`;

  // Generate random test data
  const testData = new Uint8Array(1024);
  crypto.getRandomValues(testData);
  const originalHash = await sha256(testData);

  try {
    // Test: PUT object
    let start = performance.now();
    const putRes = await globalThis.fetch(`${baseUrl}/${testKey}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: testData,
    });
    const putPassed = putRes.ok;
    tests.push({
      name: "put_object",
      passed: putPassed,
      latency_ms: Math.round(performance.now() - start),
      error: putPassed ? undefined : `PUT failed: ${putRes.status}`,
    });

    // Test: GET object and verify round-trip integrity
    start = performance.now();
    const getRes = await globalThis.fetch(`${baseUrl}/${testKey}`, { method: "GET" });
    if (getRes.ok) {
      const retrieved = new Uint8Array(await getRes.arrayBuffer());
      const retrievedHash = await sha256(retrieved);
      const integrityPassed = originalHash === retrievedHash;
      tests.push({
        name: "get_object_integrity",
        passed: integrityPassed,
        latency_ms: Math.round(performance.now() - start),
        error: integrityPassed ? undefined : `Hash mismatch: ${originalHash} != ${retrievedHash}`,
      });
    } else {
      tests.push({
        name: "get_object_integrity",
        passed: false,
        latency_ms: Math.round(performance.now() - start),
        error: `GET failed: ${getRes.status}`,
      });
    }

    // Test: DELETE object
    start = performance.now();
    const delRes = await globalThis.fetch(`${baseUrl}/${testKey}`, { method: "DELETE" });
    const delPassed = delRes.ok || delRes.status === 204;
    tests.push({
      name: "delete_object",
      passed: delPassed,
      latency_ms: Math.round(performance.now() - start),
      error: delPassed ? undefined : `DELETE failed: ${delRes.status}`,
    });

    // Test: Verify deletion (GET should fail with 404)
    start = performance.now();
    const verifyRes = await globalThis.fetch(`${baseUrl}/${testKey}`, { method: "GET" });
    const deletionVerified = verifyRes.status === 404 || verifyRes.status === 403;
    tests.push({
      name: "verify_deletion",
      passed: deletionVerified,
      latency_ms: Math.round(performance.now() - start),
      error: deletionVerified ? undefined : `Object still accessible: ${verifyRes.status}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.error(`RustFS test failed: ${message}`);
    tests.push({ name: "unexpected_error", passed: false, latency_ms: 0, error: message });

    // Cleanup
    try {
      await globalThis.fetch(`${baseUrl}/${testKey}`, { method: "DELETE" });
    } catch {
      // Ignore cleanup errors
    }
  }

  const allPassed = tests.every((t) => t.passed);
  ctx.log.info(`RustFS: ${tests.filter((t) => t.passed).length}/${tests.length} tests passed`);

  return {
    service: "rustfs",
    passed: allPassed,
    tests,
    previousResults: input as PreviousResults,
  };
}
