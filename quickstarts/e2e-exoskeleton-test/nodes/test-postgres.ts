import type { Context } from "tentacular";
import { Client } from "@db/postgres";

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

/** Test Postgres: create table, insert, read, update, delete, drop */
export default async function run(ctx: Context, _input: unknown): Promise<ServiceTestResult> {
  const tests: TestCase[] = [];
  const tableName = `exo_test_${Date.now()}`;

  const postgres = ctx.dependency("tentacular-postgres");
  if (!postgres.secret) {
    ctx.log.error("No postgres.password in secrets");
    return {
      service: "postgres",
      passed: false,
      tests: [{ name: "connect", passed: false, latency_ms: 0, error: "No credentials" }],
    };
  }

  const client = new Client({
    hostname: postgres.host,
    port: postgres.port,
    database: postgres.database,
    user: postgres.user,
    password: postgres.secret,
    tls: { enabled: false },
  });

  try {
    // Test: connect
    let start = performance.now();
    await client.connect();
    tests.push({ name: "connect", passed: true, latency_ms: Math.round(performance.now() - start) });

    // Test: create table
    start = performance.now();
    await client.queryArray(`CREATE TABLE ${tableName} (id SERIAL PRIMARY KEY, value TEXT NOT NULL, num INT);`);
    tests.push({ name: "create_table", passed: true, latency_ms: Math.round(performance.now() - start) });

    // Test: insert
    start = performance.now();
    const insertResult = await client.queryArray(
      `INSERT INTO ${tableName} (value, num) VALUES ($1, $2) RETURNING id;`,
      ["test_value", 42],
    );
    const rowId = Number(insertResult.rows[0]?.[0]);
    tests.push({ name: "insert", passed: rowId > 0, latency_ms: Math.round(performance.now() - start) });

    // Test: read
    start = performance.now();
    const readResult = await client.queryArray(
      `SELECT value, num FROM ${tableName} WHERE id = $1;`,
      [rowId],
    );
    const readValue = String(readResult.rows[0]?.[0]);
    const readNum = Number(readResult.rows[0]?.[1]);
    const readPassed = readValue === "test_value" && readNum === 42;
    tests.push({
      name: "read",
      passed: readPassed,
      latency_ms: Math.round(performance.now() - start),
      error: readPassed ? undefined : `Expected test_value/42, got ${readValue}/${readNum}`,
    });

    // Test: update
    start = performance.now();
    await client.queryArray(
      `UPDATE ${tableName} SET value = $1, num = $2 WHERE id = $3;`,
      ["updated_value", 99, rowId],
    );
    const updateCheck = await client.queryArray(
      `SELECT value, num FROM ${tableName} WHERE id = $1;`,
      [rowId],
    );
    const updatedValue = String(updateCheck.rows[0]?.[0]);
    const updatedNum = Number(updateCheck.rows[0]?.[1]);
    const updatePassed = updatedValue === "updated_value" && updatedNum === 99;
    tests.push({
      name: "update",
      passed: updatePassed,
      latency_ms: Math.round(performance.now() - start),
      error: updatePassed ? undefined : `Expected updated_value/99, got ${updatedValue}/${updatedNum}`,
    });

    // Test: delete
    start = performance.now();
    await client.queryArray(`DELETE FROM ${tableName} WHERE id = $1;`, [rowId]);
    const deleteCheck = await client.queryArray(
      `SELECT COUNT(*) FROM ${tableName} WHERE id = $1;`,
      [rowId],
    );
    const deleteCount = Number(deleteCheck.rows[0]?.[0]);
    tests.push({
      name: "delete",
      passed: deleteCount === 0,
      latency_ms: Math.round(performance.now() - start),
      error: deleteCount === 0 ? undefined : `Row still exists after delete`,
    });

    // Test: drop table
    start = performance.now();
    await client.queryArray(`DROP TABLE ${tableName};`);
    tests.push({ name: "drop_table", passed: true, latency_ms: Math.round(performance.now() - start) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.error(`Postgres test failed: ${message}`);
    tests.push({ name: "unexpected_error", passed: false, latency_ms: 0, error: message });

    // Cleanup: try to drop test table
    try {
      await client.queryArray(`DROP TABLE IF EXISTS ${tableName};`);
    } catch {
      // Ignore cleanup errors
    }
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore disconnect errors
    }
  }

  const allPassed = tests.every((t) => t.passed);
  ctx.log.info(`Postgres: ${tests.filter((t) => t.passed).length}/${tests.length} tests passed`);

  return { service: "postgres", passed: allPassed, tests };
}
