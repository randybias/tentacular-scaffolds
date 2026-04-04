import type { Context } from "tentacular";
import { parseS3Credentials, s3Fetch, sha256Hex } from "./s3.ts";

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

/** Test RustFS: PUT, GET (verify integrity), DELETE via S3 API with AWS Signature V4 */
export default async function run(ctx: Context, input: unknown): Promise<ServiceTestResult & { previousResults?: PreviousResults }> {
  const tests: TestCase[] = [];

  const s3 = parseS3Credentials(ctx.secrets);
  if (!s3) {
    ctx.log.error("No RustFS credentials (need access_key and secret_key in tentacular-rustfs secret)");
    return {
      service: "rustfs",
      passed: false,
      tests: [{ name: "connect", passed: false, latency_ms: 0, error: "No S3 credentials" }],
    };
  }

  // Use prefix from secret config for scoped object paths
  const prefix = ctx.secrets["tentacular-rustfs"]?.prefix ?? "";
  const testKey = `${prefix}exo-test/${Date.now()}/test-blob.bin`;

  ctx.log.info(`RustFS endpoint: ${s3.endpoint}, bucket: ${s3.bucket}, prefix: ${prefix}`);

  // Generate random test data
  const testData = new Uint8Array(1024);
  crypto.getRandomValues(testData);
  const originalHash = await sha256Hex(testData);

  try {
    // Test: PUT object
    let start = performance.now();
    const putRes = await s3Fetch(s3, "PUT", testKey, {
      body: testData,
      contentType: "application/octet-stream",
    });
    const putPassed = putRes.ok;
    tests.push({
      name: "put_object",
      passed: putPassed,
      latency_ms: Math.round(performance.now() - start),
      error: putPassed ? undefined : `PUT failed: ${putRes.status} ${await putRes.text()}`,
    });

    // Test: GET object and verify round-trip integrity
    start = performance.now();
    const getRes = await s3Fetch(s3, "GET", testKey);
    if (getRes.ok) {
      const retrieved = new Uint8Array(await getRes.arrayBuffer());
      const retrievedHash = await sha256Hex(retrieved);
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
    const delRes = await s3Fetch(s3, "DELETE", testKey);
    const delPassed = delRes.ok || delRes.status === 204;
    tests.push({
      name: "delete_object",
      passed: delPassed,
      latency_ms: Math.round(performance.now() - start),
      error: delPassed ? undefined : `DELETE failed: ${delRes.status}`,
    });

    // Test: Verify deletion (GET should fail with 404 or 403)
    start = performance.now();
    const verifyRes = await s3Fetch(s3, "GET", testKey);
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
      await s3Fetch(s3, "DELETE", testKey);
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
