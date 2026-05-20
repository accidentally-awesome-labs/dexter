import path from "node:path";
import fs from "fs-extra";
import { randomUUID } from "node:crypto";
import type { IdeaInput } from "../protocols/types.js";

export interface RunContext {
  runId: string;
  rootDir: string;
  runDir: string;
  projectDir: string;
  idea: IdeaInput;
  now: string;
}

export async function createRunContext(rootDir: string, idea: IdeaInput): Promise<RunContext> {
  const runId = randomUUID();
  const now = new Date().toISOString();
  const runDir = path.join(rootDir, "runs", runId);
  const projectDir = path.join(rootDir, "state", idea.project);

  await fs.ensureDir(runDir);
  await fs.ensureDir(projectDir);

  const ctx: RunContext = {
    runId,
    rootDir,
    runDir,
    projectDir,
    idea,
    now,
  };

  await fs.writeJson(path.join(runDir, "context.json"), ctx, { spaces: 2 });
  return ctx;
}
