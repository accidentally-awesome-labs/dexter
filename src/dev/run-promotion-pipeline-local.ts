import http from "node:http";
import path from "node:path";
import fs from "fs-extra";
import { runPromotionPipeline, type PromotionPipelineManifest } from "../operations/run-promotion-pipeline.js";
import { archivePromotionManifest, readPromotionHistory } from "../operations/promotion-history.js";

const CONTROL_PLANE_TOKEN = "promotion-pipeline-token";

function parseArg(flag: string, fallback = ""): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

async function startMockControlPlaneServer(): Promise<{ port: number; close: () => Promise<void> }> {
  let deployCount = 0;
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${CONTROL_PLANE_TOKEN}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    res.setHeader("content-type", "application/json");
    if (req.url === "/deploy") {
      deployCount += 1;
      res.end(JSON.stringify({ id: `promotion-deploy-${deployCount}`, status: "ok" }));
      return;
    }
    if (req.url === "/rollback") {
      res.end(JSON.stringify({ id: `promotion-rollback-${Date.now()}`, status: "ok" }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "unknown-action" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock control-plane server");
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function startMockHealthServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock health server");
  }
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function main() {
  const rootDir = process.cwd();
  const promotionSeq = parseArg("--promotion-seq", "1");
  const defaultTarget =
    promotionSeq === "2" ? "dexter-ops-api" : promotionSeq === "3" ? "dexter-worker" : "dexter";
  const targetService = parseArg("--target-service", defaultTarget);
  const appName = parseArg("--app", targetService);
  const promotionId =
    parseArg("--promotion-id", "") || `promotion-local-${new Date().toISOString().slice(0, 10)}-${promotionSeq.padStart(3, "0")}`;

  const controlPlane = await startMockControlPlaneServer();
  const health = await startMockHealthServer();

  try {
    const seqNumber = Number(promotionSeq);
    if (seqNumber >= 2) {
      const history = await readPromotionHistory(rootDir);
      if (history.promotions.length < seqNumber - 1) {
        const promotionsDir = path.join(rootDir, "artifacts", "release", "promotions");
        if (await fs.pathExists(promotionsDir)) {
          const archives = (await fs.readdir(promotionsDir)).filter((name) => name.endsWith(".json")).sort();
          for (const archiveName of archives) {
            const prior = (await fs.readJson(path.join(promotionsDir, archiveName))) as PromotionPipelineManifest;
            if (!history.promotions.some((item) => item.promotionId === prior.promotionId)) {
              await archivePromotionManifest(rootDir, prior);
            }
          }
        }
        const bootstrapManifestPath = path.join(rootDir, "artifacts", "release", "PROMOTION_PIPELINE_MANIFEST.json");
        if (await fs.pathExists(bootstrapManifestPath)) {
          const prior = (await fs.readJson(bootstrapManifestPath)) as PromotionPipelineManifest;
          const refreshed = await readPromotionHistory(rootDir);
          if (!refreshed.promotions.some((item) => item.promotionId === prior.promotionId)) {
            await archivePromotionManifest(rootDir, prior);
          }
        }
      }
    }

    const manifest = await runPromotionPipeline({
      rootDir,
      appName,
      controlPlane: "coolify",
      targetService,
      promotionId,
      requireApi: true,
      healthUrl: `http://127.0.0.1:${health.port}/health`,
      minimumPromotionsForGovernance: Number(promotionSeq),
      baseEnv: {
        DEXTER_CONTROL_PLANE_ENDPOINT: `http://127.0.0.1:${controlPlane.port}`,
        DEXTER_CONTROL_PLANE_TOKEN: CONTROL_PLANE_TOKEN,
        DEXTER_DEPLOY_APPROVER: `promotion-pipeline-local-${promotionSeq}`,
      },
    });

    const reportPath = path.join(rootDir, "artifacts", "release", `PROMOTION_PIPELINE_LOCAL_REPORT_${promotionSeq}.json`);
    await fs.writeJson(
      reportPath,
      {
        generatedAt: new Date().toISOString(),
        passed: manifest.passed,
        promotionId: manifest.promotionId,
        targetService: manifest.targetService,
        manifestPath: path.join(rootDir, "artifacts", "release", "PROMOTION_PIPELINE_MANIFEST.json"),
        governance: manifest.governance ?? null,
        stages: manifest.stages.map((stage) => stage.environment),
        auditEventsDelta: manifest.audit.eventsDelta,
      },
      { spaces: 2 },
    );

    console.log(
      JSON.stringify(
        {
          passed: manifest.passed,
          promotionId: manifest.promotionId,
          targetService: manifest.targetService,
          promotionSeq: Number(promotionSeq),
          manifestPath: path.join(rootDir, "artifacts", "release", "PROMOTION_PIPELINE_MANIFEST.json"),
          governanceReportPath: manifest.governance?.reportPath ?? null,
          reportPath,
          stages: manifest.stages.length,
          auditEventsDelta: manifest.audit.eventsDelta,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all([controlPlane.close(), health.close()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
