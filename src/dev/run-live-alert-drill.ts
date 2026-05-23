import dotenv from "dotenv";
import { routeAlertsFromOpsStatus } from "../operations/alert-routing.js";

dotenv.config();

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const missing = [
    "DEXTER_ALERT_WEBHOOK_URL",
    "DEXTER_ALERT_CHAT_WEBHOOK_URL",
    "DEXTER_ALERT_PAGER_WEBHOOK_URL",
  ].filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    console.error(
      [
        "Missing alert webhook env vars:",
        ...missing.map((key) => `  - ${key}`),
        "",
        "Example (local receiver on :19298):",
        "  DEXTER_ALERT_WEBHOOK_URL=http://127.0.0.1:19298/webhook",
        "  DEXTER_ALERT_CHAT_WEBHOOK_URL=http://127.0.0.1:19298/chat",
        "  DEXTER_ALERT_PAGER_WEBHOOK_URL=http://127.0.0.1:19298/pager",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const result = await routeAlertsFromOpsStatus({
    rootDir,
    dryRun: false,
    context: {
      runId: `live-alert-drill-${new Date().toISOString().slice(0, 10)}`,
      runStatus: "blocked",
      slo: { state: "breach" },
      queue: { backlogAging: { stale: 2 } },
      escalationAging: { oldestUnresolved: { bucket: "stale" } },
    },
  });

  const delivered = result.deliveries.filter((item) => item.status === "delivered");
  console.log(
    JSON.stringify(
      {
        status: delivered.length > 0 ? "ok" : "failed",
        matchedRules: result.matchedRules,
        deliveredCount: delivered.length,
        deliveries: result.deliveries.map((item) => ({
          channel: item.channel,
          status: item.status,
          reason: item.reason,
        })),
        deliveryLogPath: result.deliveryLogPath,
        routingSummaryPath: "artifacts/execution/ALERT_ROUTING.json",
      },
      null,
      2,
    ),
  );

  if (delivered.length === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
