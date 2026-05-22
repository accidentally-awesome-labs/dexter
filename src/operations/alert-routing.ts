import path from "node:path";
import fs from "fs-extra";
import YAML from "yaml";
import { z } from "zod";

const ALERT_RULES_PATH = path.join("docs", "operations", "ALERT_RULES.yaml");
const RUNBOOK_INDEX_PATH = path.join("docs", "operations", "RUNBOOK_LINKS.md");

const channelSchema = z.object({
  enabled: z.boolean(),
  envVar: z.string().min(1),
});

const ruleWhenSchema = z.object({
  field: z.string().min(1),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  gte: z.number().optional(),
  gt: z.number().optional(),
  in: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const alertRulesSchema = z.object({
  schemaVersion: z.literal("1.0"),
  description: z.string().optional(),
  channels: z.record(z.string(), channelSchema),
  runbooks: z.record(z.string(), z.string()),
  rules: z.array(
    z.object({
      id: z.string().min(1),
      severity: z.enum(["info", "warning", "critical"]),
      channels: z.array(z.enum(["webhook", "chat", "pager"])),
      runbook: z.string().min(1),
      when: ruleWhenSchema,
    }),
  ),
});

export type AlertRules = z.infer<typeof alertRulesSchema>;
export type AlertChannel = "webhook" | "chat" | "pager";

export interface OpsAlertContext {
  runId: string;
  runStatus: string;
  productionReady?: boolean;
  slo?: { state?: string };
  queue?: { backlogAging?: { stale?: number } };
  escalationAging?: { oldestUnresolved?: { bucket?: string } | null };
}

export interface AlertEvent {
  ruleId: string;
  severity: AlertRules["rules"][number]["severity"];
  channels: AlertChannel[];
  runbookKey: string;
  runbookPath: string;
  runbookIndexPath: string;
  title: string;
  message: string;
}

export interface AlertDelivery {
  channel: AlertChannel;
  status: "delivered" | "skipped" | "failed";
  reason: string;
  endpointEnvVar: string;
  payload: Record<string, unknown>;
}

export interface AlertRoutingResult {
  generatedAt: string;
  rulesPath: string;
  matchedRules: string[];
  events: AlertEvent[];
  deliveries: AlertDelivery[];
  deliveryLogPath: string;
}

async function resolvePolicyPath(rootDir: string, relativePath: string): Promise<string> {
  const candidates = [path.join(rootDir, relativePath), path.join(process.cwd(), relativePath)];
  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Policy not found: ${relativePath}`);
}

export async function loadAlertRules(rootDir: string): Promise<AlertRules> {
  const resolved = await resolvePolicyPath(rootDir, ALERT_RULES_PATH);
  const raw = YAML.parse(await fs.readFile(resolved, "utf8"));
  return alertRulesSchema.parse(raw);
}

function getFieldValue(context: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split(".");
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function matchesWhen(context: Record<string, unknown>, when: z.infer<typeof ruleWhenSchema>): boolean {
  const value = getFieldValue(context, when.field);
  if (when.equals !== undefined) {
    return value === when.equals;
  }
  if (when.gte !== undefined) {
    return typeof value === "number" && value >= when.gte;
  }
  if (when.gt !== undefined) {
    return typeof value === "number" && value > when.gt;
  }
  if (when.in !== undefined) {
    return when.in.includes(value as string | number | boolean);
  }
  return false;
}

function buildAlertPayload(event: AlertEvent, context: OpsAlertContext): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    ruleId: event.ruleId,
    severity: event.severity,
    runId: context.runId,
    runStatus: context.runStatus,
    productionReady: context.productionReady ?? false,
    runbook: event.runbookPath,
    runbookIndex: event.runbookIndexPath,
    title: event.title,
    message: event.message,
  };
}

async function deliverToChannel(
  channel: AlertChannel,
  config: AlertRules["channels"][string],
  payload: Record<string, unknown>,
  dryRun: boolean,
): Promise<AlertDelivery> {
  const endpointEnvVar = config.envVar;
  const endpoint = process.env[endpointEnvVar];
  if (!config.enabled) {
    return {
      channel,
      status: "skipped",
      reason: "channel disabled in policy",
      endpointEnvVar,
      payload,
    };
  }
  if (!endpoint) {
    return {
      channel,
      status: "skipped",
      reason: `missing env ${endpointEnvVar}`,
      endpointEnvVar,
      payload,
    };
  }
  if (dryRun) {
    return {
      channel,
      status: "skipped",
      reason: "dry-run mode",
      endpointEnvVar,
      payload,
    };
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return {
        channel,
        status: "failed",
        reason: `HTTP ${response.status}`,
        endpointEnvVar,
        payload,
      };
    }
    return {
      channel,
      status: "delivered",
      reason: "posted",
      endpointEnvVar,
      payload,
    };
  } catch (error) {
    return {
      channel,
      status: "failed",
      reason: error instanceof Error ? error.message : "delivery failed",
      endpointEnvVar,
      payload,
    };
  }
}

export function evaluateAlertEvents(rules: AlertRules, context: OpsAlertContext, rootDir: string): AlertEvent[] {
  const payloadContext = context as unknown as Record<string, unknown>;
  const runbookIndexPath = path.join(rootDir, RUNBOOK_INDEX_PATH);
  const events: AlertEvent[] = [];

  for (const rule of rules.rules) {
    if (!matchesWhen(payloadContext, rule.when)) {
      continue;
    }
    const runbookPath = rules.runbooks[rule.runbook] ?? rule.runbook;
    events.push({
      ruleId: rule.id,
      severity: rule.severity,
      channels: rule.channels,
      runbookKey: rule.runbook,
      runbookPath: path.join(rootDir, runbookPath),
      runbookIndexPath,
      title: `Dexter alert: ${rule.id}`,
      message: `runId=${context.runId} status=${context.runStatus} severity=${rule.severity}`,
    });
  }

  return events;
}

export async function routeAlertsFromOpsStatus(options: {
  rootDir: string;
  context: OpsAlertContext;
  dryRun?: boolean;
}): Promise<AlertRoutingResult> {
  const { rootDir, context, dryRun = false } = options;
  const rules = await loadAlertRules(rootDir);
  const rulesPath = await resolvePolicyPath(rootDir, ALERT_RULES_PATH);
  const events = evaluateAlertEvents(rules, context, rootDir);
  const deliveries: AlertDelivery[] = [];

  for (const event of events) {
    const rule = rules.rules.find((item) => item.id === event.ruleId);
    if (!rule) {
      continue;
    }
    const payload = buildAlertPayload(event, context);
    for (const channel of rule.channels) {
      const channelConfig = rules.channels[channel];
      if (!channelConfig) {
        deliveries.push({
          channel,
          status: "skipped",
          reason: "unknown channel in policy",
          endpointEnvVar: "n/a",
          payload,
        });
        continue;
      }
      deliveries.push(await deliverToChannel(channel, channelConfig, payload, dryRun));
    }
  }

  const executionDir = path.join(rootDir, "artifacts", "execution");
  await fs.ensureDir(executionDir);
  const deliveryLogPath = path.join(executionDir, "ALERT_DELIVERIES.jsonl");
  for (const delivery of deliveries) {
    await fs.appendFile(
      deliveryLogPath,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), ...delivery })}\n`,
      "utf8",
    );
  }

  const summaryPath = path.join(executionDir, "ALERT_ROUTING.json");
  const result: AlertRoutingResult = {
    generatedAt: new Date().toISOString(),
    rulesPath,
    matchedRules: events.map((event) => event.ruleId),
    events,
    deliveries,
    deliveryLogPath,
  };
  await fs.writeJson(summaryPath, result, { spaces: 2 });
  return result;
}
