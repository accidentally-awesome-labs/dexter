import pino from "pino";
import path from "node:path";
import fs from "fs-extra";
import type { RunContext } from "../core/context.js";

export async function createLogger(context: RunContext) {
  const logsDir = path.join(context.runDir, "logs");
  await fs.ensureDir(logsDir);
  const transport = pino.transport({
    targets: [
      {
        target: "pino/file",
        options: {
          destination: path.join(logsDir, "run.log"),
          mkdir: true,
        },
      },
    ],
  });

  return pino(
    {
      level: process.env.DEXTER_LOG_LEVEL ?? "info",
      base: {
        runId: context.runId,
        project: context.idea.project,
      },
    },
    transport,
  );
}
