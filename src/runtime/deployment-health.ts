export interface DeploymentHealthCheck {
  url: string;
  status: "pass" | "fail";
  statusCode?: number;
  error?: string;
  durationMs: number;
}

export interface DeploymentHealthReport {
  passed: boolean;
  skipped: boolean;
  checks: DeploymentHealthCheck[];
}

export interface DeploymentHealthOptions {
  urls: string[];
  timeoutMs?: number;
}

export async function runDeploymentHealthChecks(options: DeploymentHealthOptions): Promise<DeploymentHealthReport> {
  const urls = options.urls.map((item) => item.trim()).filter(Boolean);
  if (urls.length === 0) {
    return {
      passed: true,
      skipped: true,
      checks: [],
    };
  }

  const timeoutMs = options.timeoutMs ?? 5000;
  const checks: DeploymentHealthCheck[] = [];
  for (const url of urls) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      checks.push({
        url,
        status: response.ok ? "pass" : "fail",
        statusCode: response.status,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      checks.push({
        url,
        status: "fail",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    passed: checks.every((item) => item.status === "pass"),
    skipped: false,
    checks,
  };
}
