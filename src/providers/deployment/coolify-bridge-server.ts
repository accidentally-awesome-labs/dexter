import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CoolifyClient,
  createCoolifyClientFromEnv,
  type CoolifyDeployResult,
  type CoolifyRollbackResult,
} from "./coolify-client.js";

interface DexterBridgeRequest {
  provider?: string;
  appName?: string;
  action?: "deploy" | "rollback";
  authorizationToken?: string | null;
  deployTag?: string;
  force?: boolean;
  image?: string;
  tag?: string;
  syncManifestImage?: boolean;
}

function readJsonBody(req: IncomingMessage): Promise<DexterBridgeRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as DexterBridgeRequest);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function isAuthorized(req: IncomingMessage): boolean {
  const expected = process.env.DEXTER_BRIDGE_TOKEN ?? process.env.DEXTER_COOLIFY_TOKEN;
  if (!expected) {
    return false;
  }
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${expected}`;
}

function toDeployPayload(result: CoolifyDeployResult): Record<string, unknown> {
  return {
    status: "ok",
    deploymentId: result.deploymentId,
    id: result.deploymentId,
    revision: result.revision ?? result.resourceUuid,
    message: result.message,
  };
}

function toRollbackPayload(result: CoolifyRollbackResult): Record<string, unknown> {
  return {
    status: "ok",
    rollbackId: result.rollbackId,
    id: result.rollbackId,
    rollbackMode: result.mode,
    message: result.message,
  };
}

export async function handleBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  client: CoolifyClient,
): Promise<void> {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method-not-allowed" });
    return;
  }

  let body: DexterBridgeRequest;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "invalid-json" });
    return;
  }

  const appName = body.appName ?? "dexter";
  const action = body.action ?? (req.url === "/rollback" ? "rollback" : "deploy");
  const rollbackMode =
    (process.env.COOLIFY_ROLLBACK_MODE as "restart" | "redeploy" | undefined) ?? "restart";

  try {
    if (action === "rollback" || req.url === "/rollback") {
      const result = await client.rollbackApplication(appName, { mode: rollbackMode });
      sendJson(res, 200, toRollbackPayload(result));
      return;
    }

    const force = body.force ?? process.env.COOLIFY_DEPLOY_FORCE === "true";
    const result = await client.deployApplication(appName, {
      force,
      deployTag: body.deployTag,
      syncManifestImage:
        body.syncManifestImage && body.image && body.tag
          ? { image: body.image, tag: body.tag }
          : undefined,
    });
    sendJson(res, 200, toDeployPayload(result));
  } catch (error) {
    sendJson(res, 502, {
      error: "coolify-request-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startCoolifyBridgeServer(options?: {
  port?: number;
  host?: string;
  client?: CoolifyClient;
}): http.Server {
  const client = options?.client ?? createCoolifyClientFromEnv();
  if (!client) {
    throw new Error("Coolify bridge requires COOLIFY_ORIGIN and COOLIFY_API_TOKEN (or DEXTER_COOLIFY_* aliases).");
  }

  const server = http.createServer((req, res) => {
    void handleBridgeRequest(req, res, client);
  });

  const port = options?.port ?? Number(process.env.DEXTER_BRIDGE_PORT ?? "9876");
  const host = options?.host ?? process.env.DEXTER_BRIDGE_HOST ?? "127.0.0.1";
  server.listen(port, host);
  return server;
}
