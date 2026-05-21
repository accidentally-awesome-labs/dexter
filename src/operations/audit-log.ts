import path from "node:path";
import fs from "fs-extra";

export interface AuditLogEvent {
  actor: string;
  action: string;
  scope: string;
  reason?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
}

export async function appendAuditLogEvent(rootDir: string, event: AuditLogEvent): Promise<{
  path: string;
  entry: Record<string, unknown>;
}> {
  const operationsDir = path.join(rootDir, "artifacts", "operations");
  await fs.ensureDir(operationsDir);
  const logPath = path.join(operationsDir, "AUDIT_LOG.jsonl");
  const entry = {
    timestamp: new Date().toISOString(),
    actor: event.actor,
    action: event.action,
    scope: event.scope,
    reason: event.reason ?? "",
    runId: event.runId ?? "",
    metadata: event.metadata ?? {},
  };
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`);
  return {
    path: logPath,
    entry,
  };
}
