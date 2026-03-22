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
  previousResults?: unknown;
}

interface CollectedResults {
  services: Array<{
    service: string;
    passed: boolean;
    tests: TestCase[];
  }>;
  totalTests: number;
  totalPassed: number;
  overallPassed: boolean;
}

/** Unwind the chain of previousResults from sequential test nodes */
function unwindResults(result: unknown): Array<{ service: string; passed: boolean; tests: TestCase[] }> {
  const services: Array<{ service: string; passed: boolean; tests: TestCase[] }> = [];
  let current = result as ServiceTestResult | undefined;

  while (current) {
    if (current.service && current.tests) {
      services.push({
        service: current.service,
        passed: current.passed,
        tests: current.tests,
      });
    }
    current = current.previousResults as ServiceTestResult | undefined;
  }

  // Reverse to get chronological order (postgres first)
  return services.reverse();
}

/** Aggregate all test results from the sequential chain */
export default async function run(ctx: Context, input: unknown): Promise<CollectedResults> {
  const services = unwindResults(input);

  let totalTests = 0;
  let totalPassed = 0;

  for (const svc of services) {
    totalTests += svc.tests.length;
    totalPassed += svc.tests.filter((t) => t.passed).length;
  }

  const overallPassed = services.every((s) => s.passed);

  ctx.log.info(
    `Collected results: ${services.length} services, ${totalPassed}/${totalTests} tests passed, overall: ${overallPassed ? "PASS" : "FAIL"}`,
  );

  return {
    services,
    totalTests,
    totalPassed,
    overallPassed,
  };
}
